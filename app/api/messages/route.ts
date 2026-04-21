import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import connectToDatabase from "@/store/lib/mongodb";
import { verifyToken } from "@/store/lib/jwt";
import { Message } from "@/store/models/Message";
import User from "@/store/models/User";

const getAuthenticatedUserId = async () => {
  const token = (await cookies()).get("token")?.value;
  const decoded = token ? verifyToken(token) : null;

  if (!decoded || typeof decoded !== "object" || !("userId" in decoded)) {
    return null;
  }

  return String(decoded.userId);
};

const formatMessage = (message: {
  _id?: { toString: () => string } | string;
  content?: string;
  createdAt?: Date | string;
  imageUrl?: string;
  audioUrl?: string;
  transcript?: string;
  senderName?: string;
  senderImage?: string;
  sender?: { _id?: { toString: () => string } | string; username?: string; image?: string } | string;
  receiver?: { _id?: { toString: () => string } | string } | string;
  deletedForEveryone?: boolean;
}) => {
  const createdAt = new Date(message.createdAt ?? Date.now());

  return {
    id:
      typeof message._id === "object" && message._id
        ? message._id.toString()
        : String(message._id || ""),
    content: message.content || "",
    createdAt: createdAt.toISOString(),
    imageUrl: message.imageUrl || "",
    audioUrl: message.audioUrl || "",
    transcript: message.transcript || "",
    sender:
      message.senderName ||
      (typeof message.sender === "object" && message.sender?.username) ||
      "Anonymous",
    senderId:
      typeof message.sender === "object" && message.sender?._id
        ? message.sender._id.toString()
        : typeof message.sender === "string"
          ? message.sender
          : "",
    senderImage:
      message.senderImage ||
      (typeof message.sender === "object" ? message.sender?.image || "" : ""),
    receiverId:
      typeof message.receiver === "object" && message.receiver?._id
        ? message.receiver._id.toString()
        : typeof message.receiver === "string"
          ? message.receiver
          : "",
    deletedForEveryone: Boolean(message.deletedForEveryone),
    timestamp: createdAt.toLocaleTimeString(),
  };
};

export async function GET(req: Request) {
  try {
    await connectToDatabase();

    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const recipientId = searchParams.get("recipientId");

    if (!recipientId) {
      return NextResponse.json({ error: "recipientId is required" }, { status: 400 });
    }

    const messages = await Message.find({
      $and: [
        {
          $or: [
            { sender: userId, receiver: recipientId },
            { sender: recipientId, receiver: userId },
          ],
        },
        {
          deletedFor: { $ne: userId },
        },
      ],
    })
      .sort({ createdAt: 1 })
      .populate("sender", "username image")
      .populate("receiver", "_id");

    return NextResponse.json(messages.map((message) => formatMessage(message)));
  } catch (error) {
    console.error("Fetch messages error:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await connectToDatabase();

    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { content, imageUrl, audioUrl, transcript, receiverId } = await req.json();
    const normalizedContent = typeof content === "string" ? content.trim() : "";
    const normalizedImageUrl = typeof imageUrl === "string" ? imageUrl : "";
    const normalizedAudioUrl = typeof audioUrl === "string" ? audioUrl : "";
    const normalizedTranscript = typeof transcript === "string" ? transcript.trim() : "";

    if (!receiverId || typeof receiverId !== "string") {
      return NextResponse.json({ error: "receiverId is required" }, { status: 400 });
    }

    if (!normalizedContent && !normalizedImageUrl && !normalizedAudioUrl) {
      return NextResponse.json(
        { error: "Message content, image, or audio is required" },
        { status: 400 }
      );
    }

    const [sender, receiver] = await Promise.all([
      User.findById(userId).select("username image"),
      User.findById(receiverId).select("username"),
    ]);

    if (!sender || !receiver) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const message = await Message.create({
      sender: sender._id,
      senderName: sender.username,
      senderImage: sender.image || "",
      receiver: receiver._id,
      receiverName: receiver.username,
      content: normalizedContent,
      imageUrl: normalizedImageUrl,
      audioUrl: normalizedAudioUrl,
      transcript: normalizedTranscript,
    });

    const hydratedMessage = await Message.findById(message._id)
      .populate("sender", "username image")
      .populate("receiver", "_id");

    return NextResponse.json(formatMessage(hydratedMessage), { status: 201 });
  } catch (error) {
    console.error("Save message error:", error);
    return NextResponse.json({ error: "Failed to save message" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    await connectToDatabase();

    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { messageId, scope } = await req.json();

    if (!messageId || typeof messageId !== "string") {
      return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    }

    if (scope !== "me" && scope !== "everyone") {
      return NextResponse.json({ error: "Invalid delete scope" }, { status: 400 });
    }

    const message = await Message.findById(messageId)
      .populate("sender", "username image")
      .populate("receiver", "_id");

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const senderId =
      typeof message.sender === "object" && message.sender?._id
        ? message.sender._id.toString()
        : String(message.sender || "");
    const receiverId =
      typeof message.receiver === "object" && message.receiver?._id
        ? message.receiver._id.toString()
        : String(message.receiver || "");

    if (senderId !== userId && receiverId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (scope === "me") {
      await Message.findByIdAndUpdate(messageId, {
        $addToSet: { deletedFor: userId },
      });

      return NextResponse.json({ messageId, scope: "me" });
    }

    if (senderId !== userId) {
      return NextResponse.json(
        { error: "Only the sender can delete a message for everyone" },
        { status: 403 }
      );
    }

    message.content = "";
    message.imageUrl = "";
    message.audioUrl = "";
    message.transcript = "";
    message.deletedForEveryone = true;
    await message.save();

    const updatedMessage = await Message.findById(messageId)
      .populate("sender", "username image")
      .populate("receiver", "_id");

    return NextResponse.json({
      scope: "everyone",
      message: formatMessage(updatedMessage),
    });
  } catch (error) {
    console.error("Delete message error:", error);
    return NextResponse.json({ error: "Failed to delete message" }, { status: 500 });
  }
}
