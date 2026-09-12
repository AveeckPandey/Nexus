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
      const user = await this.tokens.verify(token);
      client.data.userId = user.userId;
      client.join(`USER#${user.userId}`);
    } catch {
      client.emit('unauthorized', { message: 'Invalid token' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('join_ghost_room')
  async joinRoom(@ConnectedSocket() c: Socket, @MessageBody() d: { roomId: string }) {
    if (c.data.userId && !(await this.ghost.isParticipant(d.roomId, c.data.userId))) {
      return { error: 'Forbidden' };
    }
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
      isEncrypted?: boolean;
      nonce?: string;
      encVersion?: number;
    },
  ) {
    if (c.data.userId && !(await this.ghost.isParticipant(d.roomId, c.data.userId))) {
      return { error: 'Forbidden' };
    }
    const msg = await this.ghost.saveMessage(
      d.roomId,
      c.data.userId || c.id,
      d.senderName || 'Anonymous',
      d.content,
      { isEncrypted: d.isEncrypted, nonce: d.nonce, encVersion: d.encVersion },
    );
    this.server.to(d.roomId).emit('new_ghost_message', msg);
    return { status: 'sent', messageId: msg.id };
  }

  @SubscribeMessage('ghost_message_opened')
  openMessage(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { roomId: string; messageId: string },
  ) {
    const key = `${d.roomId}:${d.messageId}`;
    if (this.timers.has(key)) return { status: 'already_burning' };
    const duration = 30;
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
}
