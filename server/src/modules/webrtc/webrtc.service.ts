import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

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
  private calls = new Map<string, CallSession>();

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
    return session;
  }

  getCall(callId: string): CallSession | undefined {
    return this.calls.get(callId);
  }

  endCall(callId: string) {
    const call = this.calls.get(callId);
    if (call) call.status = 'ended';
    this.calls.delete(callId);
  }
}
