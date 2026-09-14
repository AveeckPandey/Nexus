import { Injectable, Optional } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { RedisService } from '../../common/redis/redis.service';

export interface CallSession {
  callId: string;
  conversationId: string;
  initiatorId: string;
  initiatorName: string;
  callType: 'video' | 'audio' | 'group';
  recipientIds: string[];
  status: 'ringing' | 'active' | 'ended';
  participants: Set<string>;
  createdAt: string;
}

@Injectable()
export class WebRtcService {
  private readonly calls = new Map<string, CallSession>();

  constructor(@Optional() private readonly redis?: RedisService) {}

  initiateCall(
    conversationId: string,
    initiatorId: string,
    initiatorName: string,
    callType: CallSession['callType'],
    recipientIds: string[],
  ): CallSession {
    const callId = uuidv4();
    const session: CallSession = {
      callId,
      conversationId,
      initiatorId,
      initiatorName,
      callType,
      recipientIds,
      status: 'ringing',
      participants: new Set([initiatorId]),
      createdAt: new Date().toISOString(),
    };
    this.calls.set(callId, session);
    this.syncToRedis(session);
    return session;
  }

  async getCall(callId: string): Promise<CallSession | undefined> {
    const local = this.calls.get(callId);
    if (local) return local;
    if (!this.redis) return undefined;
    try {
      const raw = await this.redis.getJson<Omit<CallSession, 'participants'> & {
        participants: string[];
      }>(`call:${callId}`);
      if (!raw) return undefined;
      const session: CallSession = {
        ...raw,
        participants: new Set(raw.participants || []),
      };
      this.calls.set(callId, session);
      return session;
    } catch {
      return undefined;
    }
  }

  updateCall(session: CallSession) {
    this.calls.set(session.callId, session);
    this.syncToRedis(session);
  }

  endCall(callId: string) {
    const call = this.calls.get(callId);
    if (call) call.status = 'ended';
    this.calls.delete(callId);
    if (this.redis) {
      this.redis.del(`call:${callId}`).catch(() => {});
    }
  }

  private syncToRedis(session: CallSession) {
    if (!this.redis) return;
    const data = {
      ...session,
      participants: Array.from(session.participants),
    };
    this.redis.setJson(`call:${session.callId}`, data, 3600).catch(() => {});
  }
}

