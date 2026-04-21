import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import connectToDatabase from "@/store/lib/mongodb";
import { verifyToken } from "@/store/lib/jwt";
import User from "@/store/models/User";

const getAuthenticatedUserId = async () => {
  const token = (await cookies()).get("token")?.value;
  const decoded = token ? verifyToken(token) : null;

  if (!decoded || typeof decoded !== "object" || !("userId" in decoded)) {
    return null;
  }

  return String(decoded.userId);
};

export async function GET() {
  try {
    await connectToDatabase();

    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const users = await User.find({ _id: { $ne: userId } })
      .sort({ username: 1 })
      .select("username email image");

    return NextResponse.json(
      users.map((user) => ({
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        image: user.image || "",
      }))
    );
  } catch (error) {
    console.error("Users fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}
