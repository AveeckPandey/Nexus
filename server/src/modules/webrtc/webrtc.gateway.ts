import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WebRtcService } from './webrtc.service';
import { TokenService } from '../../common/auth/token.service';

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class WebRtcGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  constructor(
    private readonly calls: WebRtcService,
    private readonly tokens: TokenService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token as string) || '';
      if (token && token.startsWith('guest')) {
        return;
      }
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
  initiate(
    @ConnectedSocket() c: Socket,
    @MessageBody()
    d: {
      conversationId: string;
      initiatorName: string;
      callType: 'video' | 'audio' | 'group';
      recipientIds: string[];
    },
  ) {
    const session = this.calls.initiateCall(
      d.conversationId,
      c.data.userId || c.id,
      d.initiatorName,
      d.callType,
      d.recipientIds,
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
  accept(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { callId: string; conversationId: string },
  ) {
    const call = this.calls.getCall(d.callId);
    if (!call) return { status: 'error', message: 'Call not found' };
    if (call.participants.size >= 5) {
      c.emit('call_rejected', {
        callId: d.callId,
        reason: 'Call is full (maximum 5 participants for P2P mesh)',
      });
      return { status: 'full', message: 'Maximum 5 participants' };
    }
    c.join(d.callId);
    call.status = 'active';
    call.participants.add(c.id);
    this.server.to(d.callId).emit('call_started', {
      callId: d.callId,
      peerId: c.id,
      userId: c.data.userId,
    });
    return { status: 'accepted', callId: d.callId };
  }

  @SubscribeMessage('call_reject')
  reject(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { callId: string; reason?: string },
  ) {
    this.server.to(d.callId).emit('call_rejected', {
      callId: d.callId,
      peerId: c.id,
      reason: d.reason || 'declined',
    });
    this.calls.endCall(d.callId);
  }

  @SubscribeMessage('call_hangup')
  hangup(@ConnectedSocket() c: Socket, @MessageBody() d: { callId: string }) {
    this.server.to(d.callId).emit('call_ended', { callId: d.callId, endedBy: c.id });
    this.calls.endCall(d.callId);
  }

  @SubscribeMessage('webrtc_offer')
  offer(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { callId: string; targetSocketId: string; sdp: any },
  ) {
    this.server
      .to(d.targetSocketId)
      .emit('webrtc_offer', { callerSocketId: c.id, sdp: d.sdp });
  }

  @SubscribeMessage('webrtc_answer')
  answer(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { callId: string; targetSocketId: string; sdp: any },
  ) {
    this.server
      .to(d.targetSocketId)
      .emit('webrtc_answer', { responderSocketId: c.id, sdp: d.sdp });
  }

  @SubscribeMessage('ice_candidate')
  ice(
    @ConnectedSocket() c: Socket,
    @MessageBody() d: { callId: string; targetSocketId: string; candidate: any },
  ) {
    this.server
      .to(d.targetSocketId)
      .emit('ice_candidate', { senderSocketId: c.id, candidate: d.candidate });
  }
}
