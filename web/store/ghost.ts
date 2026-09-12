'use client';

import { create } from 'zustand';
import type { GhostMessage } from '@/lib/types';

interface GhostState {
  roomId: string | null;
  messages: GhostMessage[];
  burnLeft: Record<string, number>;
  setRoom: (roomId: string | null) => void;
  addMessage: (m: GhostMessage) => void;
  startBurn: (id: string, duration: number) => void;
  tick: (id: string) => void;
  purge: (id: string) => void;
  reset: () => void;
}

export const useGhostStore = create<GhostState>((set) => ({
  roomId: null,
  messages: [],
  burnLeft: {},

  setRoom: (roomId) => set({ roomId, messages: [], burnLeft: {} }),
  addMessage: (m) =>
    set((s) => ({ messages: [...s.messages.filter((x) => x.id !== m.id), m] })),
  startBurn: (id, duration) => set((s) => ({ burnLeft: { ...s.burnLeft, [id]: duration } })),
  tick: (id) =>
    set((s) => {
      const cur = s.burnLeft[id];
      if (cur === undefined || cur <= 0) return s;
      return { burnLeft: { ...s.burnLeft, [id]: cur - 1 } };
    }),
  purge: (id) =>
    set((s) => {
      const burnLeft = { ...s.burnLeft };
      delete burnLeft[id];
      return { messages: s.messages.filter((m) => m.id !== id), burnLeft };
    }),
  reset: () => set({ roomId: null, messages: [], burnLeft: {} }),
}));
