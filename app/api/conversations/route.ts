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

export async function GET() {
  try {
    await connectToDatabase();

    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [users, recentMessages] = await Promise.all([
      User.find({ _id: { $ne: userId } })
        .sort({ username: 1 })
        .select("username email image"),
      Message.find({
        $and: [
          {
            $or: [{ sender: userId }, { receiver: userId }],
          },
          {
            deletedFor: { $ne: userId },
          },
        ],
      })
        .sort({ createdAt: -1 })
        .populate("sender", "username image")
        .populate("receiver", "_id")
        .limit(200),
    ]);

    const previews = new Map<string, ReturnType<typeof formatMessage>>();

    for (const message of recentMessages) {
      const senderId =
        typeof message.sender === "object" && message.sender?._id
          ? message.sender._id.toString()
          : "";
      const receiverId =
        typeof message.receiver === "object" && message.receiver?._id
          ? message.receiver._id.toString()
          : "";
      const otherUserId = senderId === userId ? receiverId : senderId;

      if (otherUserId && !previews.has(otherUserId)) {
        previews.set(otherUserId, formatMessage(message));
      }
    }

    const payload = users
      .map((user) => ({
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        image: user.image || "",
        lastMessage: previews.get(user._id.toString()),
      }))
      .sort((a, b) => {
        const aTime = a.lastMessage?.createdAt ?? "";
        const bTime = b.lastMessage?.createdAt ?? "";

        if (aTime && bTime) {
          return bTime.localeCompare(aTime);
        }

        if (aTime) {
          return -1;
        }

        if (bTime) {
          return 1;
        }

        return a.username.localeCompare(b.username);
      });

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Conversations fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch conversations" }, { status: 500 });
  }
}
