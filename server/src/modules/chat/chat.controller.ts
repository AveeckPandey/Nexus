import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { CognitoAuthGuard } from '../../common/guards/cognito-auth.guard';
import { MemberGuard } from './guards/member.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

@Controller('api/chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('conversations')
  @UseGuards(CognitoAuthGuard)
  async list(@CurrentUser() u: AuthenticatedUser) {
    return { success: true, conversations: await this.chat.getUserConversations(u.userId) };
  }

  @Post('conversations')
  @UseGuards(CognitoAuthGuard)
  async create(
    @CurrentUser() u: AuthenticatedUser,
    @Body() b: { participantIds?: string[]; title?: string; type?: 'direct' | 'group' },
  ) {
    const conversation = await this.chat.createConversation(
      u.userId,
      b.participantIds || [],
      b.title,
      b.type || 'direct',
    );
    return { success: true, conversation };
  }

  @Get('messages/:conversationId')
  @UseGuards(CognitoAuthGuard, MemberGuard)
  async messages(
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    if (!conversationId) throw new BadRequestException('conversationId required');
    const { messages, nextCursor } = await this.chat.getMessages(
      conversationId,
      Number(limit) || 50,
      cursor,
    );
    return { success: true, messages, nextCursor };
  }

  @Get('conversations/:id/key')
  @UseGuards(CognitoAuthGuard, MemberGuard)
  async getKey(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser) {
    const envelope = await this.chat.getKeyEnvelope(id, u.userId);
    return { success: true, envelope: envelope || null };
  }

  @Post('conversations/:id/key')
  @UseGuards(CognitoAuthGuard, MemberGuard)
  async putKey(
    @Param('id') id: string,
    @Body()
    b: { recipientId?: string; encryptedKey?: string; nonce?: string; senderPub?: string; keyVersion?: number },
  ) {
    if (!b.recipientId || !b.encryptedKey || !b.nonce || !b.senderPub) {
      throw new BadRequestException('recipientId, encryptedKey, nonce, senderPub required');
    }
    const ok = await this.chat.isMember(id, b.recipientId);
    if (!ok) throw new BadRequestException('Recipient is not a member');
    await this.chat.putKeyEnvelope(id, b.recipientId, {
      encryptedKey: b.encryptedKey,
      nonce: b.nonce,
      senderPub: b.senderPub,
      keyVersion: b.keyVersion || 1,
    });
    return { success: true };
  }
}
