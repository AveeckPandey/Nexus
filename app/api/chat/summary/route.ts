import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
type ChatMessage = { sender: string; content: string };

export async function POST(req: Request) {
  const { messages } = await req.json();
  const history = (messages as ChatMessage[])
    .map((message) => `${message.sender}: ${message.content}`)
    .join("\n");

  const model = genAI.getGenerativeModel({ model: "gemini-pro" });
  const prompt = `Summarize this chat history in 3 concise bullet points:\n${history}`;

  const result = await model.generateContent(prompt);
  const response = await result.response;

  return NextResponse.json({ summary: response.text() });
}
