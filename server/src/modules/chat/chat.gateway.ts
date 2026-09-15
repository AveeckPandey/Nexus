import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger, Optional } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { TokenService } from '../../common/auth/token.service';
import { AiService } from '../ai/ai.service';
import { RedisService } from '../../common/redis/redis.service';

const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

@WebSocketGateway({
  cors: {
    origin: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        callback(null, true);
      } else {
        callback(new Error('Origin not allowed'), false);
      }
    },
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chat: ChatService,
    private readonly tokens: TokenService,
    private readonly ai: AiService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const fwd = (client.handshake.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim();
      const ip = fwd || client.handshake.address || 'unknown';
      const hits = await this.redis?.incr(`throttle:ws:${ip}`);
      if (hits === 1) await this.redis?.expire(`throttle:ws:${ip}`, 60);
      if ((hits || 0) > 60) {
        client.emit('rate_limited', { message: 'Too many connections. Slow down.' });
        client.disconnect(true);
        return;
      }
    } catch {}
    try {
      const token = (client.handshake.auth?.token as string) || '';
      if (token && token.startsWith('guest')) {
        return;
      }
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
      senderAvatar?: string;
      content: string;
      tempId?: string;
      clientMessageId?: string;
      mediaType?: 'text' | 'image' | 'video' | 'audio' | 'file';
      mediaUrl?: string;
      replyTo?: any;
      isEncrypted?: boolean;
      nonce?: string;
      encVersion?: number;
      isBot?: boolean;
    },
  ) {
    const senderId = c.data.userId || 'anonymous';
    if (c.data.userId && !(await this.chat.isMember(d.conversationId, c.data.userId))) {
      return { error: 'Forbidden' };
    }

    const clientMsgId = d.clientMessageId || d.tempId;

    // 1. Sliding window per-socket message rate limit (max 15 msg/3sec -> 429)
    const nowTs = Date.now();
    const msgCount = (c.data.msgCount || 0) + 1;
    const windowStart = c.data.windowStart || nowTs;
    if (nowTs - windowStart < 3000) {
      if (msgCount > 15) {
        c.emit('rate_limited', {
          status: 'rate_limited',
          statusCode: 429,
          retryAfter: 3,
          message: 'Rate limit exceeded: maximum 15 messages per 3 seconds. Please slow down.',
        });
        return {
          status: 'rate_limited',
          statusCode: 429,
          retryAfter: 3,
          message: 'Rate limit exceeded: maximum 15 messages per 3 seconds. Please slow down.',
        };
      }
      c.data.msgCount = msgCount;
    } else {
      c.data.windowStart = nowTs;
      c.data.msgCount = 1;
    }

    // 2. Idempotent Deduplication (Reliability on flaky networks / airplane mode)
    if (clientMsgId && this.redis) {
      const idempKey = `idemp:msg:${senderId}:${clientMsgId}`;
      const existingMsgId = await this.redis.get(idempKey);
      if (existingMsgId) {
        this.logger.debug(`Idempotent hit for message ${clientMsgId} -> ${existingMsgId}`);
        return { status: 'sent', messageId: existingMsgId, tempId: d.tempId, clientMessageId: clientMsgId, deduplicated: true };
      }
    }

    const isFromAiOrBot = senderId === 'nexus-ai' || d.senderName === 'Nexus AI' || senderId.startsWith('bot_') || Boolean(d.isBot || d.senderAvatar?.includes('alien'));

    const msg = await this.chat.saveMessage(
      d.conversationId,
      senderId,
      d.senderName || c.data.username || 'User',
      d.content,
      d.mediaType || (d as any).type || 'text',
      d.mediaUrl,
      d.replyTo,
      { isEncrypted: d.isEncrypted, nonce: d.nonce, encVersion: d.encVersion },
      d.senderAvatar,
    );

    // Cache idempotency key for 60 seconds
    if (clientMsgId && this.redis) {
      await this.redis.set(`idemp:msg:${senderId}:${clientMsgId}`, msg.id, 'EX', 60);
    }

    this.server.to(d.conversationId).emit('new_message', msg);

    // AI Companion mention check (@nexus or @ai) - Redis distributed rate limiter
    if (!isFromAiOrBot && !d.isEncrypted && d.content && /@nexus|@ai/i.test(d.content)) {
      const lockKey = `ratelimit:ai:${d.conversationId}`;
      const acquired = this.redis ? await this.redis.set(lockKey, '1', 'EX', 3) : 'OK';
      if (acquired) {
        const callerName = d.senderName || c.data.username || 'User';
        (async () => {
          try {
            this.server.to(d.conversationId).emit('user_typing_start', {
              userId: 'nexus-ai',
              username: 'Nexus AI',
              conversationId: d.conversationId,
            });
            const replyText = await this.ai.chatReply(d.content, callerName);
            this.server.to(d.conversationId).emit('user_typing_stop', {
              userId: 'nexus-ai',
              conversationId: d.conversationId,
            });
            const aiMsg = await this.chat.saveMessage(
              d.conversationId,
              'nexus-ai',
              'Nexus AI',
              replyText,
              'text',
              undefined,
              { id: msg.id, senderName: msg.senderName, content: msg.content },
              { isEncrypted: false },
              '/assets/alien-svgrepo-com.svg',
            );
            this.server.to(d.conversationId).emit('new_message', aiMsg);
          } catch (err: any) {
            this.logger.error(`Nexus AI reply error: ${err?.message}`);
            this.server.to(d.conversationId).emit('user_typing_stop', {
              userId: 'nexus-ai',
              conversationId: d.conversationId,
            });
          }
        })();
      }
    }

    // Ack carries the server UUID so the client can swap its optimistic tempId.
    return { status: 'sent', messageId: msg.id, tempId: d.tempId, createdAt: msg.createdAt };
  }

  @SubscribeMessage('typing_start')
  typingStart(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { conversationId: string; username: string },
  ) {
    const now = Date.now();
    if (c.data.lastTyping && now - c.data.lastTyping < 1500) {
      return; // Skip duplicate typing events within 1.5s
    }
    c.data.lastTyping = now;
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

  @SubscribeMessage('network_ping')
  networkPing() {
    return { timestamp: Date.now() };
  }
}
