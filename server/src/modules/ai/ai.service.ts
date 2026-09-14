import { Injectable, Logger } from '@nestjs/common';
import { TranslateTextCommand } from '@aws-sdk/client-translate';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { translateClient, bedrockClient, AWS_CONFIG, hasAwsCredentials } from '../../config/aws.config';
import { groqClient, GROQ_CONFIG } from '../../config/groq.config';
import { toFile } from 'groq-sdk';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  /** Loud at boot: confirm available AI providers. */
  onModuleInit() {
    if (hasAwsCredentials() && AWS_CONFIG.bedrockModelId) {
      this.logger.log(`Amazon Bedrock active with model: ${AWS_CONFIG.bedrockModelId}`);
    } else if (!GROQ_CONFIG.apiKey) {
      this.logger.warn(
        'Neither AWS Bedrock nor GROQ_API_KEY is configured — Nexus AI will use offline fallbacks.',
      );
    }
  }

  /** Unified invocation helper for Amazon Bedrock Converse API */
  private async invokeBedrock(
    systemPrompt: string,
    userPrompt: string,
    maxTokens = 400,
  ): Promise<string | null> {
    if (!hasAwsCredentials() || !AWS_CONFIG.bedrockModelId) return null;
    try {
      const command = new ConverseCommand({
        modelId: AWS_CONFIG.bedrockModelId,
        system: [{ text: systemPrompt }],
        messages: [{ role: 'user', content: [{ text: userPrompt }] }],
        inferenceConfig: { maxTokens, temperature: 0.3 },
      });
      const res = await bedrockClient.send(command);
      return res.output?.message?.content?.[0]?.text || null;
    } catch (err: any) {
      this.logger.warn(`Bedrock invocation error (${AWS_CONFIG.bedrockModelId}): ${err.message}`);
      return null;
    }
  }

  async summarize(messages: { sender: string; content: string }[]): Promise<string> {
    if (!messages?.length) return 'No messages to summarize.';
    const text = messages
      .slice(-100)
      .map((m) => `${m.sender}: ${m.content}`)
      .join('\n');

    // 1. Try Amazon Bedrock
    const bedrockSummary = await this.invokeBedrock(
      'Summarize the chat into 3-4 bullet points: key decisions and action items. Be concise.',
      text,
      350,
    );
    if (bedrockSummary) return bedrockSummary;

    // 2. Fall back to Groq Cloud
    if (GROQ_CONFIG.apiKey) {
      try {
        const r = await groqClient.chat.completions.create({
          messages: [
            {
              role: 'system',
              content:
                'Summarize the chat into 3-4 bullet points: key decisions and action items. Be concise.',
            },
            { role: 'user', content: text },
          ],
          model: GROQ_CONFIG.model,
          temperature: 0.3,
          max_tokens: 300,
        });
        return r.choices[0]?.message?.content || 'Unable to generate summary.';
      } catch (err: any) {
        this.logger.error(`Groq failed: ${err.message}`);
      }
    }

    return 'AI summarization temporarily unavailable.';
  }

  async translate(text: string, targetLang: string, sourceLang = 'auto'): Promise<string> {
    if (!text || !targetLang) return text;

    // 1. Try Amazon Translate (if subscribed/active on the AWS account)
    if (hasAwsCredentials()) {
      try {
        const r = await translateClient.send(
          new TranslateTextCommand({
            Text: text,
            SourceLanguageCode: sourceLang,
            TargetLanguageCode: targetLang,
          }),
        );
        if (r.TranslatedText) return r.TranslatedText;
      } catch (err: any) {
        this.logger.warn(`Amazon Translate unavailable (${err.name || err.message}), falling back to Bedrock.`);
      }
    }

    // 2. Fall back to Amazon Bedrock (Nova Micro)
    const bedrockResult = await this.invokeBedrock(
      `You are an accurate, fast language translator. Translate user text into the target language code or name "${targetLang}". Output ONLY the direct translated text. Do not wrap in quotes. Do not include notes or explanations.`,
      text,
      300,
    );
    if (bedrockResult?.trim()) return bedrockResult.trim();

    // 3. Fall back to Groq Cloud (Llama 3.3 70B)
    if (GROQ_CONFIG.apiKey) {
      try {
        const r = await groqClient.chat.completions.create({
          messages: [
            {
              role: 'system',
              content: `You are an accurate, fast language translator. Translate user text into the target language "${targetLang}". Output ONLY the direct translated text. Do not wrap in quotes. Do not include notes or explanations.`,
            },
            { role: 'user', content: text },
          ],
          model: GROQ_CONFIG.model,
          temperature: 0.2,
          max_tokens: 300,
        });
        const groqResult = r.choices[0]?.message?.content?.trim();
        if (groqResult) return groqResult;
      } catch (err: any) {
        this.logger.warn(`Groq translation fallback failed: ${err.message}`);
      }
    }

    return text;
  }

  async chatReply(query: string, senderName: string): Promise<string> {
    const cleanQuery = query.replace(/@nexus|@ai/gi, '').trim();
    if (!cleanQuery) {
      return `Hey ${senderName}! I'm Nexus AI. Ask me anything, or ask me to summarize, translate, or format notes.`;
    }

    const now = new Date();
    const currentDate = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const systemPrompt = `You are Nexus AI, an intelligent, ultra-fast assistant inside Nexus secure messenger.
Current Date: ${currentDate}. Current Year: ${now.getFullYear()}.
Current World Context: Donald Trump is the 47th President of the United States (inaugurated January 20, 2025).
Always provide accurate, up-to-date, and concise answers with clean markdown formatting.`;

    // 1. Try Amazon Bedrock
    const bedrockReply = await this.invokeBedrock(systemPrompt, cleanQuery, 400);
    if (bedrockReply) return bedrockReply;

    // 2. Fall back to Groq Cloud
    if (GROQ_CONFIG.apiKey) {
      try {
        const r = await groqClient.chat.completions.create({
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            { role: 'user', content: cleanQuery },
          ],
          model: GROQ_CONFIG.model,
          temperature: 0.5,
          max_tokens: 400,
        });
        const reply = r.choices[0]?.message?.content;
        if (reply) return reply;
      } catch (err: any) {
        this.logger.warn(`AI chat fallback: ${err.message}`);
      }
    }

    const lower = cleanQuery.toLowerCase();
    // Local intents (also the offline fallback when Groq is unreachable).
    if (/\b(hello|hi|hey|yo|namaste|good\s?(morning|afternoon|evening))\b/.test(lower)) {
      return `Hello ${senderName}! I am Nexus AI, your in-chat assistant. All messages in this room are protected by zero-knowledge encryption. How can I help you today?`;
    }
    if (lower.includes('help') || lower.includes('feature') || lower.includes('what can you do')) {
      return `Here is what I can do:\n• Summarize long chats: click the ✨ Summarize button in the header.\n• Translate languages: click 🌐 Translate on any message.\n• Voice notes: send audio clips with real-time waveforms.\n• Video calls: click 📹 for WebRTC P2P mesh calls (up to 5 people).\n• Ghost chats: create 30s self-destructing ephemeral chats.`;
    }
    if (lower.includes('status') || lower.includes('health') || lower.includes('ping')) {
      return `Nexus systems are fully operational: WebSockets active, E2EE verified, and P2P WebRTC mesh ready!`;
    }
    if (/\b(time|date|day|clock)\b/.test(lower)) {
      const now = new Date();
      return `${senderName}, server time is ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on ${now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`;
    }
    if (lower.includes('who are you') || lower.includes('your name') || lower.includes('about yourself')) {
      return `I'm Nexus AI 🤖 — the assistant built into Nexus secure messenger. Mention @nexus or @ai in any chat and I'll answer right here.`;
    }
    if (lower.includes('thank')) {
      return `You're welcome, ${senderName}! Anything else I can do?`;
    }
    // Honest last resort: never pretend to answer when the model is unreachable.
    return GROQ_CONFIG.apiKey
      ? `Hey ${senderName}, the AI service didn't respond just now — please try again in a moment.`
      : `Hey ${senderName}, I'm in offline mode (no AI key on the server), so I can't answer "${cleanQuery}" yet. Ask the admin to set GROQ_API_KEY and restart — meanwhile try: help, status, or time.`;
  }

  async transcribe(audioBase64OrUrl: string): Promise<string> {
    if (!audioBase64OrUrl) return '';

    if (GROQ_CONFIG.apiKey) {
      try {
        let buffer: Buffer;
        if (audioBase64OrUrl.startsWith('http://') || audioBase64OrUrl.startsWith('https://')) {
          const res = await fetch(audioBase64OrUrl);
          const ab = await res.arrayBuffer();
          buffer = Buffer.from(ab);
        } else {
          const raw = audioBase64OrUrl.includes('base64,')
            ? audioBase64OrUrl.split('base64,')[1]
            : audioBase64OrUrl;
          buffer = Buffer.from(raw, 'base64');
        }

        const file = await toFile(buffer, 'voice_note.webm', { type: 'audio/webm' });
        const result = await groqClient.audio.transcriptions.create({
          file,
          model: 'whisper-large-v3',
          temperature: 0.2,
        });

        if (result?.text) return result.text.trim();
      } catch (err: any) {
        this.logger.warn(`Groq Whisper transcription failed: ${err?.message}`);
      }
    }

    return 'Voice note transcription ready: audio received and queued.';
  }
}

