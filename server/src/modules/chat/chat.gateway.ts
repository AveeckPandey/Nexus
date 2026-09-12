import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { TokenService } from '../../common/auth/token.service';

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chat: ChatService,
    private readonly tokens: TokenService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token as string) || '';
      const user = await this.tokens.verify(token);
      client.data.userId = user.userId;
      client.data.username = user.username;
      client.join(`USER#${user.userId}`);
    } catch {
      client.emit('unauthorized', { message: 'Invalid token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Chat socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_room')
  async joinRoom(@ConnectedSocket() c: Socket, @MessageBody() d: { conversationId: string }) {
    const ok = c.data.userId ? await this.chat.isMember(d.conversationId, c.data.userId) : false;
    if (!ok) return { error: 'Forbidden' };
    c.join(d.conversationId);
    return { status: 'joined', conversationId: d.conversationId };
  }

  @SubscribeMessage('leave_room')
  leaveRoom(@ConnectedSocket() c: Socket, @MessageBody() d: { conversationId: string }) {
    c.leave(d.conversationId);
    return { status: 'left', conversationId: d.conversationId };
  }

  @SubscribeMessage('send_message')
  async sendMessage(
    @ConnectedSocket() c: Socket,
    @MessageBody()
    d: {
      conversationId: string;
      senderName: string;
      content: string;
      tempId?: string;
      mediaType?: 'text' | 'image' | 'video' | 'audio' | 'file';
      mediaUrl?: string;
      replyTo?: any;
      isEncrypted?: boolean;
      nonce?: string;
      encVersion?: number;
    },
  ) {
    const senderId = c.data.userId || 'anonymous';
    if (c.data.userId && !(await this.chat.isMember(d.conversationId, c.data.userId))) {
      return { error: 'Forbidden' };
    }
    const msg = await this.chat.saveMessage(
      d.conversationId,
      senderId,
      d.senderName || c.data.username || 'User',
      d.content,
      d.mediaType || 'text',
      d.mediaUrl,
      d.replyTo,
      { isEncrypted: d.isEncrypted, nonce: d.nonce, encVersion: d.encVersion },
    );
    this.server.to(d.conversationId).emit('new_message', msg);
    // Ack carries the server UUID so the client can swap its optimistic tempId.
    return { status: 'sent', messageId: msg.id, tempId: d.tempId, createdAt: msg.createdAt };
  }

  @SubscribeMessage('typing_start')
  typingStart(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { conversationId: string; username: string },
  ) {
    c.to(d.conversationId).emit('user_typing_start', {
      userId: c.data.userId,
      username: d.username,
      conversationId: d.conversationId,
    });
  }

  @SubscribeMessage('typing_stop')
  typingStop(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { conversationId: string },
  ) {
    c.to(d.conversationId).emit('user_typing_stop', {
      userId: c.data.userId,
      conversationId: d.conversationId,
    });
  }

  @SubscribeMessage('add_reaction')
  async addReaction(
    @ConnectedSocket() c: Socket,
    @MessageBody()
    d: { conversationId: string; messageSk: string; username: string; emoji: string },
  ) {
    const userId = c.data.userId || 'anonymous';
    await this.chat.toggleReaction(d.conversationId, d.messageSk, userId, d.username, d.emoji);
    this.server.to(d.conversationId).emit('reaction_updated', {
      conversationId: d.conversationId,
      messageSk: d.messageSk,
      userId,
      username: d.username,
      emoji: d.emoji,
    });
  }

  @SubscribeMessage('message_read')
  async messageRead(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { conversationId: string; messageId: string },
  ) {
    if (c.data.userId) {
      await this.chat.markRead(d.conversationId, c.data.userId, d.messageId);
    }
    c.to(d.conversationId).emit('message_status_update', {
      conversationId: d.conversationId,
      messageId: d.messageId,
      status: 'read',
      userId: c.data.userId,
    });
  }
}
