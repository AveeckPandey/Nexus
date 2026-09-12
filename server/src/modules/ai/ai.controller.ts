import {
  Controller,
  Post,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { CognitoAuthGuard } from '../../common/guards/cognito-auth.guard';

@Controller('api/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('summarize')
  @UseGuards(CognitoAuthGuard)
  async summarize(@Body() b: { messages?: { sender: string; content: string }[] }) {
    if (!Array.isArray(b.messages) || !b.messages.length) {
      throw new BadRequestException('messages[] required');
    }
    // Never send ciphertext to the AI provider.
    const plain = b.messages.filter((m) => m.content && !m.content.startsWith('🔒'));
    return { success: true, summary: await this.ai.summarize(plain) };
  }

  @Post('translate')
  @UseGuards(CognitoAuthGuard)
  async translate(
    @Body() b: { text?: string; targetLang?: string; sourceLang?: string },
  ) {
    if (!b.text || !b.targetLang) {
      throw new BadRequestException('text and targetLang required');
    }
    return {
      success: true,
      translatedText: await this.ai.translate(b.text, b.targetLang, b.sourceLang),
    };
  }
}
