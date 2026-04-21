import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectToDatabase from "../../../../store/lib/mongodb";
import User from "../../../../store/models/User";

export async function POST(req: Request) {
  try {
    await connectToDatabase();

    const { username, email, password } = await req.json();

    // 1. Basic Validation
    if (!username || !email || !password) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // 2. Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "User or Email already registered" }, 
        { status: 400 }
      );
    }

    // 3. Hash the password (Never store plain text!)
    const hashedPassword = await bcrypt.hash(password, 12);

    // 4. Save User to MongoDB
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
    });

    await newUser.save();

    return NextResponse.json(
      { message: "User registered successfully!" }, 
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Registration Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
