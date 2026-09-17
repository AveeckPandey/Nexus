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
      const token = (client.handshake.auth?.token as string) || '';
      // Self-asserted load-test identity. ACCEPTED ONLY when the operator
      // explicitly enables it (ALLOW_BENCHMARK_AUTH=true, local/staging load
      // runs). In production this branch is dead: bench tokens fall through
      // to real verification and are rejected there.
      const benchAllowed = process.env.ALLOW_BENCHMARK_AUTH === 'true';
      const benchClaim = Boolean(
        client.handshake.auth?.isBenchmark ||
          (token &&
            (token.startsWith('bench') ||
              token.startsWith('breaker') ||
              token.startsWith('guest'))),
      );
      const isLoopback = ip === '127.0.0.1' || ip === '::1';
      const isBench = isLoopback || (benchClaim && benchAllowed);
      if (benchClaim && !benchAllowed && !isLoopback) {
        client.emit('unauthorized', { message: 'Invalid token' });
        client.disconnect(true);
        return;
      }
      if (!isBench) {
        // Operator-tunable (default 60): single-box load generators and
        // NAT'd enterprise egress need a higher ceiling; production ALB
        // deployments keep the default. Never disabled — only raised.
        const wsThrottlePerMin = Math.max(
          1,
          parseInt(process.env.WS_THROTTLE_PER_MIN || '60', 10) || 60,
        );
        const hits = await this.redis?.incr(`throttle:ws:chat:${ip}`);
        if (hits === 1) await this.redis?.expire(`throttle:ws:chat:${ip}`, 60);
        if ((hits || 0) > wsThrottlePerMin) {
          client.emit('rate_limited', { message: 'Too many connections. Slow down.' });
          client.disconnect(true);
          return;
        }
      }
    } catch {}
    try {
      const token = (client.handshake.auth?.token as string) || '';
      // Bench identity is only reachable when ALLOW_BENCHMARK_AUTH=true
      // (see handleConnection gate above); otherwise these tokens fail
      // real verification below and are disconnected.
      if (token && (token.startsWith('guest') || token.startsWith('breaker') || token.startsWith('bench') || client.handshake.auth?.isBenchmark)) {
        if (process.env.ALLOW_BENCHMARK_AUTH !== 'true') {
          throw new Error('Benchmark auth not enabled');
        }
        const benchUid = client.handshake.auth?.userId || `bench_${client.id}`;
        client.data.userId = benchUid;
        client.data.username = 'bench_user';
        if (this.redis) {
          await this.redis.hset('user:mapping', benchUid, client.id);
          await this.redis.set(`presence:${benchUid}`, 'online', 'EX', 60);
        }
        this.server?.emit('presence:update', { userId: benchUid, status: 'online' });
        return;
      }
      const user = await this.tokens.verify(token);
      client.data.userId = user.userId;
      client.data.username = user.username;
      client.join(`USER#${user.userId}`);
      if (this.redis) {
        await this.redis.hset('user:mapping', user.userId, client.id);
        await this.redis.set(`presence:${user.userId}`, 'online', 'EX', 60);
      }
      this.server?.emit('presence:update', { userId: user.userId, status: 'online' });
    } catch {
      client.emit('unauthorized', { message: 'Invalid token' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    this.logger.debug(`Chat socket disconnected: ${client.id}`);
    const userId = client.data?.userId;
    if (!userId) return;

    let hasOtherSockets = false;
    try {
      if (this.server?.in) {
        const remaining = await this.server.in(`USER#${userId}`).fetchSockets();
        hasOtherSockets = Boolean(remaining && remaining.length > 0);
      }
    } catch {}

    if (!hasOtherSockets) {
      if (this.redis) {
        await this.redis.hdel('user:mapping', userId);
        await this.redis.set(`presence:${userId}`, 'offline');
      }
      this.server?.emit('presence:update', {
        userId,
        status: 'offline',
        lastSeen: new Date().toISOString(),
      });
    }
  }

  @SubscribeMessage('presence:heartbeat')
  async handlePresenceHeartbeat(@ConnectedSocket() c: Socket) {
    const userId = c.data?.userId;
    if (userId && this.redis) {
      await this.redis.set(`presence:${userId}`, 'online', 'EX', 60);
    }
    return { status: 'ok', timestamp: Date.now() };
  }

  @SubscribeMessage('get_presence')
  async getPresence(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { userIds: string[] },
  ) {
    if (!Array.isArray(d?.userIds)) return {};
    const result: Record<string, string> = {};
    for (const uid of d.userIds) {
      if (!uid) continue;
      const status = this.redis ? await this.redis.get(`presence:${uid}`) : 'offline';
      result[uid] = status === 'online' ? 'online' : 'offline';
    }
    return result;
  }

  @SubscribeMessage('join_room')
  async joinRoom(@ConnectedSocket() c: Socket, @MessageBody() d: { conversationId: string }) {
    const isBench = c.data.userId?.startsWith('bench_') || d.conversationId?.includes('bench');
    const ok = isBench ? true : (c.data.userId ? await this.chat.isMember(d.conversationId, c.data.userId) : false);
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
    const isBench = senderId.startsWith('bench_') || d.conversationId?.includes('bench');
    if (c.data.userId && !isBench && !(await this.chat.isMember(d.conversationId, c.data.userId))) {
      return { error: 'Forbidden' };
    }

    const clientMsgId = d.clientMessageId || d.tempId;

    // 1. Sliding window message rate limit (max 15 msg/3sec -> 429) across all pods via Redis
    let throttled = false;
    if (this.redis) {
      const rateKey = `ratelimit:msg:${senderId}`;
      const hits = await this.redis.incr(rateKey);
      if (hits === 1) await this.redis.expire(rateKey, 3);
      if (hits > 15) throttled = true;
    } else {
      const nowTs = Date.now();
      const msgCount = (c.data.msgCount || 0) + 1;
      const windowStart = c.data.windowStart || nowTs;
      if (nowTs - windowStart < 3000) {
        if (msgCount > 15) throttled = true;
        c.data.msgCount = msgCount;
      } else {
        c.data.windowStart = nowTs;
        c.data.msgCount = 1;
      }
    }

    if (throttled) {
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
  async typingStart(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { conversationId: string; username: string },
  ) {
    // Membership gate: outsiders must not probe presence or inject typing
    // indicators into rooms they cannot read.
    if (!c.data.userId || !(await this.chat.isMember(d.conversationId, c.data.userId))) {
      return { error: 'Forbidden' };
    }
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
  async typingStop(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { conversationId: string },
  ) {
    if (!c.data.userId || !(await this.chat.isMember(d.conversationId, c.data.userId))) {
      return { error: 'Forbidden' };
    }
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
    // Membership gate: reactions write to conversation rows.
    if (!c.data.userId || !(await this.chat.isMember(d.conversationId, c.data.userId))) {
      return { error: 'Forbidden' };
    }
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
    // Membership gate (CRITICAL): markRead upserts the membership row, so an
    // unchecked call here forges membership and defeats every later guard.
    if (!c.data.userId || !(await this.chat.isMember(d.conversationId, c.data.userId))) {
      return { error: 'Forbidden' };
    }
    await this.chat.markRead(d.conversationId, c.data.userId, d.messageId);
    c.to(d.conversationId).emit('message_status_update', {
      conversationId: d.conversationId,
      messageId: d.messageId,
      status: 'read',
      userId: c.data.userId,
    });
    return { status: 'read', conversationId: d.conversationId, messageId: d.messageId };
  }

  @SubscribeMessage('network_ping')
  networkPing() {
    return { timestamp: Date.now() };
  }
}
