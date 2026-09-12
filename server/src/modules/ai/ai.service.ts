import { Injectable, Logger } from '@nestjs/common';
import { TranslateTextCommand } from '@aws-sdk/client-translate';
import { translateClient, hasAwsCredentials } from '../../config/aws.config';
import { groqClient, GROQ_CONFIG } from '../../config/groq.config';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  async summarize(messages: { sender: string; content: string }[]): Promise<string> {
    if (!messages?.length) return 'No messages to summarize.';
    if (!GROQ_CONFIG.apiKey) return 'AI summarization is not configured on the server.';
    const text = messages
      .slice(-100)
      .map((m) => `${m.sender}: ${m.content}`)
      .join('\n');
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
      return 'AI summarization temporarily unavailable.';
    }
  }

  async translate(text: string, targetLang: string, sourceLang = 'auto'): Promise<string> {
    if (!text || !targetLang) return text;
    if (!hasAwsCredentials()) return text;
    try {
      const r = await translateClient.send(
        new TranslateTextCommand({
          Text: text,
          SourceLanguageCode: sourceLang,
          TargetLanguageCode: targetLang,
        }),
      );
      return r.TranslatedText || text;
    } catch (err: any) {
      this.logger.warn(`Translate failed: ${err.message}`);
      return text;
    }
  }
}
