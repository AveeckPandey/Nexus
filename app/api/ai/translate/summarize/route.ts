import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

type ChatMessage = { sender: string; content: string };
const apiKey = process.env.GEMINI_API_KEY;
const modelName = "gemini-2.5-flash";

export async function POST(req: Request) {
  if (!apiKey) {
    return NextResponse.json({ error: "Missing Gemini API key" }, { status: 500 });
  }

  try {
    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Messages are required" }, { status: 400 });
    }

    const chatHistory = (messages as ChatMessage[])
      .map((message) => `${message.sender}: ${message.content}`)
      .join("\n");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });
    
    const prompt = `You are a helpful assistant for a chat app called Nexus. 
    Summarize the following conversation briefly so a user can catch up. 
    Keep it under 3 sentences:\n\n${chatHistory}`;

    const result = await model.generateContent(prompt);
    const summary = result.response.text().trim();

    if (!summary) {
      return NextResponse.json({ error: "Summary returned an empty response" }, { status: 502 });
    }

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("Summarization error:", error);
    const message = error instanceof Error ? error.message : "AI failed to summarize";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
