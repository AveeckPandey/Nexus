import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Optional } from '@nestjs/common';
import { WebRtcService } from './webrtc.service';
import { ChatService } from '../chat/chat.service';
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
export class WebRtcGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  constructor(
    private readonly calls: WebRtcService,
    private readonly tokens: TokenService,
    private readonly chat: ChatService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  private async checkConnThrottle(client: Socket): Promise<boolean> {
    try {
      const fwd = (client.handshake.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim();
      const ip = fwd || client.handshake.address || 'unknown';
      // Per-gateway key (call) + operator-tunable limit (default 60).
      // See ChatGateway.handleConnection — one counter per gateway so a
      // single socket (3 gateway handlers) is not triple-counted.
      const wsThrottlePerMin = Math.max(
        1,
        parseInt(process.env.WS_THROTTLE_PER_MIN || '60', 10) || 60,
      );
      const hits = await this.redis?.incr(`throttle:ws:call:${ip}`);
      if (hits === 1) await this.redis?.expire(`throttle:ws:call:${ip}`, 60);
      if ((hits || 0) > wsThrottlePerMin) {
        client.emit('rate_limited', { message: 'Too many connections. Slow down.' });
        client.disconnect(true);
        return false;
      }
    } catch {}
    return true;
  }

  async handleConnection(client: Socket) {
    if (!(await this.checkConnThrottle(client))) return;
    try {
      // No guest bypass: placing or receiving calls requires a verified
      // identity. Ghost (anonymous) rooms have no calling surface.
      const token = (client.handshake.auth?.token as string) || '';
      if (!token) throw new Error('Missing token');
      const user = await this.tokens.verify(token);
      client.data.userId = user.userId;
      // Per-user notification room — rings regardless of open chat view.
      client.join(`USER#${user.userId}`);
    } catch {
      client.emit('unauthorized', { message: 'Invalid token' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('call_initiate')
  async initiate(
    @ConnectedSocket() c: Socket,
    @MessageBody()
    d: {
      conversationId: string;
      initiatorName: string;
      callType: 'video' | 'audio' | 'group';
      recipientIds: string[];
    },
  ) {
    // Authorization: only a verified conversation member may ring, and only
    // fellow members may be rung. Stops call spam to arbitrary user IDs.
    const callerId = c.data.userId as string | undefined;
    if (!callerId) return { error: 'Forbidden' };
    const conv = await this.chat.getConversation(d.conversationId);
    if (!conv || !conv.participants.includes(callerId)) {
      return { error: 'Forbidden' };
    }
    const recipients = (d.recipientIds || []).filter(
      (id) => id !== callerId && conv.participants.includes(id),
    );
    if (d.recipientIds?.length && !recipients.length) {
      return { error: 'Forbidden' };
    }
    const session = this.calls.initiateCall(
      d.conversationId,
      callerId,
      d.initiatorName,
      d.callType,
      recipients,
    );
    c.join(session.callId);
    const payload = {
      callId: session.callId,
      conversationId: d.conversationId,
      initiatorId: session.initiatorId,
      initiatorName: d.initiatorName,
      callType: d.callType,
    };
    // Ring each recipient directly; fall back to the conversation room.
    if (d.recipientIds?.length) {
      for (const id of d.recipientIds) {
        this.server.to(`USER#${id}`).emit('incoming_call', payload);
      }
    } else {
      c.to(d.conversationId).emit('incoming_call', payload);
    }
    return { status: 'initiated', callId: session.callId };
  }

  @SubscribeMessage('call_accept')
  async accept(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { callId: string; conversationId: string },
  ) {
    const userId = c.data.userId as string | undefined;
    if (!userId) return { error: 'Forbidden' };
    const call = await this.calls.getCall(d.callId);
    if (!call || call.status === 'ended') return { status: 'error', message: 'Call not found' };
    // Authorization: acceptor must belong to the conversation and — when the
    // call targeted specific recipients — be one of them (or the initiator).
    const conv = await this.chat.getConversation(call.conversationId);
    if (!conv || !conv.participants.includes(userId)) {
      return { error: 'Forbidden' };
    }
    if (
      call.recipientIds?.length &&
      call.initiatorId !== userId &&
      !call.recipientIds.includes(userId)
    ) {
      return { error: 'Forbidden' };
    }
    if (call.userIds.size >= 5) {
      c.emit('call_rejected', {
        callId: d.callId,
        reason: 'Call is full (maximum 5 participants for P2P mesh)',
      });
      return { status: 'full', message: 'Maximum 5 participants' };
    }
    c.join(d.callId);
    call.status = 'active';
    // Socket ids route the SDP/ICE relay; user ids authorize it. Capacity
    // counts verified humans (userIds), not sockets.
    call.participants.add(c.id);
    call.userIds.add(userId);
    this.calls.updateCall(call);

    this.server.to(d.callId).emit('call_started', {
      callId: d.callId,
      peerId: c.id,
      userId: c.data.userId,
    });
    return { status: 'accepted', callId: d.callId };
  }

  /** Only a call participant may end or reject it. */
  private async canControlCall(c: Socket, callId: string) {
    const userId = c.data.userId as string | undefined;
    if (!userId) return null;
    const call = await this.calls.getCall(callId);
    if (!call || call.status === 'ended') return null;
    const ok =
      call.initiatorId === userId ||
      call.recipientIds?.includes(userId) ||
      call.userIds.has(userId) ||
      call.participants.has(c.id);
    return ok ? call : null;
  }

  @SubscribeMessage('call_reject')
  async reject(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { callId: string; reason?: string },
  ) {
    const call = await this.canControlCall(c, d.callId);
    if (!call) return { error: 'Forbidden' };
    this.server.to(d.callId).emit('call_rejected', {
      callId: d.callId,
      peerId: c.id,
      reason: d.reason || 'declined',
    });
    this.calls.endCall(d.callId);
  }

  @SubscribeMessage('call_hangup')
  async hangup(@ConnectedSocket() c: Socket, @MessageBody() d: { callId: string }) {
    const call = await this.canControlCall(c, d.callId);
    if (!call) return { error: 'Forbidden' };
    this.server.to(d.callId).emit('call_ended', { callId: d.callId, endedBy: c.id });
    this.calls.endCall(d.callId);
  }

  /**
   * SDP/ICE relay guard: the sender must be a call participant and the
   * target must be a fellow participant (or invited recipient). Payloads are
   * size-capped — SDP/ICE are small; anything larger is a DoS probe.
   */
  private async canRelay(c: Socket, callId: string, targetId: string, payload: unknown) {
    if (!targetId || typeof targetId !== 'string') return null;
    try {
      if (JSON.stringify(payload)?.length > 65536) return null;
    } catch {
      return null;
    }
    const userId = c.data.userId as string | undefined;
    const call = await this.calls.getCall(callId);
    if (!call || call.status === 'ended' || !userId) return null;
    const senderOk = call.participants.has(c.id) || call.userIds.has(userId);
    const targetOk =
      call.participants.has(targetId) || call.recipientIds?.includes(targetId);
    return senderOk && targetOk ? call : null;
  }

  @SubscribeMessage('webrtc_offer')
  async offer(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { callId: string; targetSocketId: string; sdp: any },
  ) {
    if (!(await this.canRelay(c, d.callId, d.targetSocketId, d.sdp))) {
      return { error: 'Forbidden' };
    }
    this.server
      .to(d.targetSocketId)
      .emit('webrtc_offer', { callerSocketId: c.id, sdp: d.sdp });
  }

  @SubscribeMessage('webrtc_answer')
  async answer(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { callId: string; targetSocketId: string; sdp: any },
  ) {
    if (!(await this.canRelay(c, d.callId, d.targetSocketId, d.sdp))) {
      return { error: 'Forbidden' };
    }
    this.server
      .to(d.targetSocketId)
      .emit('webrtc_answer', { responderSocketId: c.id, sdp: d.sdp });
  }

  @SubscribeMessage('ice_candidate')
  async ice(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { callId: string; targetSocketId: string; candidate: any },
  ) {
    if (!(await this.canRelay(c, d.callId, d.targetSocketId, d.candidate))) {
      return { error: 'Forbidden' };
    }
    this.server
      .to(d.targetSocketId)
      .emit('ice_candidate', { senderSocketId: c.id, candidate: d.candidate });
  }
}
