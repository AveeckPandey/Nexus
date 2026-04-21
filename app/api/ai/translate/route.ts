import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

const apiKey = process.env.GEMINI_API_KEY;
const modelName = "gemini-2.5-flash";

export async function POST(req: Request) {
  if (!apiKey) {
    return NextResponse.json({ error: "Missing Gemini API key" }, { status: 500 });
  }

  try {
    const { text, targetLanguage } = await req.json();

    if (!text || !targetLanguage) {
      return NextResponse.json(
        { error: "Text and target language are required" },
        { status: 400 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });
    const prompt = [
      `Translate the following message into ${targetLanguage}.`,
      "Return only the translated text with no extra explanation.",
      "",
      text,
    ].join("\n");

    const result = await model.generateContent(prompt);
    const translatedText = result.response.text().trim();

    if (!translatedText) {
      return NextResponse.json({ error: "Translation returned an empty response" }, { status: 502 });
    }

    return NextResponse.json({ translatedText });
  } catch (error) {
    console.error("Translation error:", error);
    const message = error instanceof Error ? error.message : "Translation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
