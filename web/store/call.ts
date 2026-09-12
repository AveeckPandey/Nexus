'use client';

import { create } from 'zustand';

export interface IncomingCall {
  callId: string;
  conversationId: string;
  initiatorId: string;
  initiatorName: string;
  callType: 'video' | 'audio' | 'group';
}

interface CallState {
  incoming: IncomingCall | null;
  activeCallId: string | null;
  activeConversationId: string | null;
  callType: 'video' | 'audio' | 'group';
  setIncoming: (c: IncomingCall | null) => void;
  startOutgoing: (callId: string, conversationId: string, callType: CallState['callType']) => void;
  accept: (callId: string) => void;
  end: () => void;
}

export const useCallStore = create<CallState>((set) => ({
  incoming: null,
  activeCallId: null,
  activeConversationId: null,
  callType: 'video',
  setIncoming: (incoming) => set({ incoming }),
  startOutgoing: (callId, conversationId, callType) =>
    set({ activeCallId: callId, activeConversationId: conversationId, callType, incoming: null }),
  accept: (callId) => set({ activeCallId: callId, incoming: null }),
  end: () => set({ activeCallId: null, activeConversationId: null, incoming: null }),
}));
