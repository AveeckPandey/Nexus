import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { GhostService } from './ghost.service';
import { TokenService } from '../../common/auth/token.service';

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
export class GhostGateway implements OnGatewayConnection, OnGatewayInit, OnModuleDestroy {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(GhostGateway.name);
  private timers = new Map<string, NodeJS.Timeout>();
  private sweeperInterval?: NodeJS.Timeout;

  constructor(
    private readonly ghost: GhostService,
    private readonly tokens: TokenService,
    private readonly redis: RedisService,
  ) {}

  afterInit() {
    // Distributed cluster-wide recovery: periodic active background sweeper
    this.sweeperInterval = setInterval(async () => {
      try {
        const now = Date.now();
        const expired = await this.redis.zrangebyscore('ghost:burns', 0, now);
        for (const item of expired) {
          const removed = await this.redis.zrem('ghost:burns', item);
          if (removed > 0) {
            const [roomId, messageId] = item.split(':');
            if (roomId && messageId) {
              await this.ghost.purgeMessage(roomId, messageId);
              this.server.to(roomId).emit('ghost_message_purged', { roomId, messageId });
              this.timers.delete(item);
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(`Ghost burn sweeper error: ${err.message}`);
      }
    }, 5000);
  }

  onModuleDestroy() {
    if (this.sweeperInterval) clearInterval(this.sweeperInterval);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  async handleConnection(client: Socket) {
    try {
      const fwd = (client.handshake.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim();
      const ip = fwd || client.handshake.address || 'unknown';
      // Per-gateway key (ghost) + operator-tunable limit (default 60).
      // See ChatGateway.handleConnection — one counter per gateway so a
      // single socket (3 gateway handlers) is not triple-counted.
      const wsThrottlePerMin = Math.max(
        1,
        parseInt(process.env.WS_THROTTLE_PER_MIN || '60', 10) || 60,
      );
      const hits = await this.redis.incr(`throttle:ws:ghost:${ip}`);
      if (hits === 1) await this.redis.expire(`throttle:ws:ghost:${ip}`, 60);
      if ((hits || 0) > wsThrottlePerMin) {
        client.emit('rate_limited', { message: 'Too many connections. Slow down.' });
        client.disconnect(true);
        return;
      }
    } catch {}
    try {
      const token = (client.handshake.auth?.token as string) || '';
      if (token && !token.startsWith('guest')) {
        const user = await this.tokens.verify(token);
        client.data.userId = user.userId;
        client.data.username = user.username;
        client.join(`USER#${user.userId}`);
        return;
      }
    } catch {
      // Ignore token verification failure for ghost chat guests
    }

    // Ghost chat supports anonymous guest visitors
    const authGuestId = client.handshake.auth?.guestId as string;
    const authToken = client.handshake.auth?.token as string;
    const guestId =
      authGuestId ||
      (authToken && authToken.startsWith('guest:') ? authToken.slice('guest:'.length) : null) ||
      `guest_${client.id.slice(0, 8)}`;
    client.data.userId = guestId;
    client.data.username = (client.handshake.auth?.guestName as string) || `Guest_${guestId.slice(-4)}`;
    client.data.isGuest = true;
    client.join(`USER#${guestId}`);
  }

  @SubscribeMessage('join_ghost_room')
  async joinRoom(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { roomId: string; guestId?: string },
  ) {
    const userId = c.data.userId || d.guestId;
    if (userId && !(await this.ghost.isParticipant(d.roomId, userId))) {
      return { error: 'Forbidden' };
    }
    if (userId) c.data.userId = userId;
    c.join(d.roomId);
    c.to(d.roomId).emit('peer_joined_ghost_room', { peerId: c.id, userId: c.data.userId });
    return { status: 'joined_ghost', roomId: d.roomId };
  }

  @SubscribeMessage('send_ghost_message')
  async sendMessage(
    @ConnectedSocket() c: Socket,
    @MessageBody()
    d: {
      roomId: string;
      senderName: string;
      content: string;
      guestId?: string;
      isEncrypted?: boolean;
      nonce?: string;
      encVersion?: number;
      burnDuration?: number;
    },
  ) {
    const senderId = c.data.userId || d.guestId || c.id;
    if (c.data.userId && !(await this.ghost.isParticipant(d.roomId, c.data.userId))) {
      return { error: 'Forbidden' };
    }
    // Ciphertext-only: untrackable rooms never accept plaintext.
    if (!d.isEncrypted || !d.nonce) {
      return { error: 'Encryption required' };
    }
    let msg;
    try {
      msg = await this.ghost.saveMessage(
        d.roomId,
        senderId,
        d.senderName || 'Anonymous',
        d.content,
        { isEncrypted: d.isEncrypted, nonce: d.nonce, encVersion: d.encVersion },
        d.burnDuration,
      );
    } catch (err: any) {
      return { error: err?.message || 'Rejected' };
    }
    this.server.to(d.roomId).emit('new_ghost_message', msg);
    return { status: 'sent', messageId: msg.id };
  }

  @SubscribeMessage('ghost_message_opened')
  async openMessage(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { roomId: string; messageId: string },
  ) {
    // Membership gate: starting the burn destroys another user's message.
    // Mirrors send_ghost_message / destroy_ghost_room.
    const userId = c.data.userId as string | undefined;
    if (userId && !(await this.ghost.isParticipant(d.roomId, userId))) {
      return { error: 'Forbidden' };
    }
    const key = `${d.roomId}:${d.messageId}`;
    if (this.timers.has(key)) return { status: 'already_burning' };
    // Honor the per-message burn window chosen at send time (5s–5min).
    let duration = 30;
    try {
      const stored = await this.ghost.getMessage(d.roomId, d.messageId);
      if (stored?.burnDuration) duration = this.ghost.clampBurn(stored.burnDuration);
    } catch {
      /* fall back to default window */
    }
    const burnExpiresAt = Date.now() + duration * 1000;
    // Persist to Redis cluster and DynamoDB so any node (or restart) can resume the purge.
    await this.redis.zadd('ghost:burns', burnExpiresAt, key);
    this.ghost.setBurnStarted(d.roomId, d.messageId, burnExpiresAt).catch(() => {});
    this.server.to(d.roomId).emit('burn_started', {
      roomId: d.roomId,
      messageId: d.messageId,
      duration,
      burnExpiresAt,
    });
    const t = setTimeout(async () => {
      await this.redis.zrem('ghost:burns', key);
      await this.ghost.purgeMessage(d.roomId, d.messageId);
      this.server.to(d.roomId).emit('ghost_message_purged', {
        roomId: d.roomId,
        messageId: d.messageId,
      });
      this.timers.delete(key);
    }, duration * 1000);
    this.timers.set(key, t);
    return { status: 'burning', duration };
  }

  @SubscribeMessage('destroy_ghost_room')
  async destroyRoom(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { roomId: string; guestId?: string },
  ) {
    const userId = c.data.userId || d.guestId;
    if (userId && !(await this.ghost.isParticipant(d.roomId, userId))) {
      return { error: 'Forbidden' };
    }
    for (const [key, t] of Array.from(this.timers.entries())) {
      if (key.startsWith(`${d.roomId}:`)) {
        clearTimeout(t);
        this.timers.delete(key);
        this.redis.zrem('ghost:burns', key).catch(() => {});
      }
    }
    await this.ghost.destroyRoom(d.roomId);
    this.server.to(d.roomId).emit('ghost_room_destroyed', { roomId: d.roomId });
    return { status: 'destroyed' };
  }
}
