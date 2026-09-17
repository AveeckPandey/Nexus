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
import { AuthService } from '../auth/auth.service';
import { CognitoAuthGuard } from '../../common/guards/cognito-auth.guard';
import { MemberGuard } from './guards/member.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

@Controller('api/chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly auth: AuthService,
  ) {}

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

  /**
   * One-click invite target: open (or create) the 1:1 chat with another
   * user. Idempotent — re-opening a share link returns the same room.
   */
  @Post('conversations/direct')
  @UseGuards(CognitoAuthGuard)
  async direct(
    @CurrentUser() u: AuthenticatedUser,
    @Body() b: { otherUserId?: string },
  ) {
    const otherId = b.otherUserId?.trim();
    if (!otherId) throw new BadRequestException('otherUserId required');
    if (otherId === u.userId) throw new BadRequestException('You cannot chat with yourself');
    const other = await this.auth.getProfile(otherId);
    if (!other) throw new BadRequestException('User not found');
    const existing = await this.chat.findDirectConversation(u.userId, otherId);
    if (existing) return { success: true, conversation: existing, created: false };
    const title = other.name || (other.username ? `@${other.username}` : 'Direct Chat');
    const conversation = await this.chat.createConversation(
      u.userId,
      [otherId],
      title,
      'direct',
    );
    return { success: true, conversation, created: true };
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

  /**
   * Read-receipt cursors (`userId → lastReadMessageId`) for a conversation.
   * Lets the author render ✓✓ after reloads, even when the read happened
   * while they were offline or in another room.
   */
  @Get('conversations/:id/read')
  @UseGuards(CognitoAuthGuard, MemberGuard)
  async readCursors(@Param('id') id: string) {
    return { success: true, cursors: await this.chat.getReadCursors(id) };
  }

  @Get('conversations/:id/key')
  @UseGuards(CognitoAuthGuard, MemberGuard)
  async getKey(@Param('id') id: string, @CurrentUser() u: AuthenticatedUser) {    const envelope = await this.chat.getKeyEnvelope(id, u.userId);
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

  @Get('presence/:userId')
  @UseGuards(CognitoAuthGuard)
  async getUserPresence(@Param('userId') userId: string) {
    const status = await this.chat.getPresence(userId);
    return { success: true, userId, status };
  }

  @Post('presence/batch')
  @UseGuards(CognitoAuthGuard)
  async getBatchPresence(@Body() b: { userIds: string[] }) {
    const presence = await this.chat.getBatchPresence(b?.userIds || []);
    return { success: true, presence };
  }

  @Get('sync')
  @UseGuards(CognitoAuthGuard)
  async getSyncQueue(
    @CurrentUser() u: AuthenticatedUser,
    @Query('limit') limit?: string,
  ) {
    const items = await this.chat.getSyncQueue(u.userId, limit ? parseInt(limit, 10) : 50);
    return { success: true, count: items.length, items };
  }

  @Post('sync/ack')
  @UseGuards(CognitoAuthGuard)
  async ackSyncQueue(
    @CurrentUser() u: AuthenticatedUser,
    @Body() b: { count: number },
  ) {
    await this.chat.ackSyncQueue(u.userId, b.count || 0);
    return { success: true };
  }
}
