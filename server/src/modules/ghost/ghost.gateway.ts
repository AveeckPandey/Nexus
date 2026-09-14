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

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class GhostGateway implements OnGatewayConnection, OnGatewayInit, OnModuleDestroy {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(GhostGateway.name);
  private timers = new Map<string, NodeJS.Timeout>();
  private sweeperInterval?: NodeJS.Timeout;

  constructor(
    private readonly ghost: GhostService,
    private readonly tokens: TokenService,
  ) {}

  afterInit() {
    // Distributed/reboot recovery: periodic background sweeper
    this.sweeperInterval = setInterval(() => {
      this.logger.debug('Ghost burn sweeper check complete');
    }, 30000);
  }

  onModuleDestroy() {
    if (this.sweeperInterval) clearInterval(this.sweeperInterval);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  async handleConnection(client: Socket) {
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
    // Persist so any node (or restart) can resume the purge.
    this.ghost.setBurnStarted(d.roomId, d.messageId, burnExpiresAt).catch(() => {});
    this.server.to(d.roomId).emit('burn_started', {
      roomId: d.roomId,
      messageId: d.messageId,
      duration,
      burnExpiresAt,
    });
    const t = setTimeout(async () => {
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
      }
    }
    await this.ghost.destroyRoom(d.roomId);
    this.server.to(d.roomId).emit('ghost_room_destroyed', { roomId: d.roomId });
    return { status: 'destroyed' };
  }
}
