'use client';

import { create } from 'zustand';

export interface PresenceInfo {
  status: 'online' | 'offline';
  lastSeen?: string;
}

interface PresenceState {
  presence: Record<string, PresenceInfo>;
  setPresence: (userId: string, status: 'online' | 'offline', lastSeen?: string) => void;
  setBatchPresence: (map: Record<string, 'online' | 'offline'>) => void;
  isOnline: (userId?: string) => boolean;
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  presence: {},
  setPresence: (userId, status, lastSeen) =>
    set((s) => ({
      presence: {
        ...s.presence,
        [userId]: {
          status,
          lastSeen: lastSeen || (status === 'offline' ? new Date().toISOString() : s.presence[userId]?.lastSeen),
        },
      },
    })),
  setBatchPresence: (map) =>
    set((s) => {
      const next = { ...s.presence };
      for (const [userId, status] of Object.entries(map)) {
        next[userId] = {
          status,
          lastSeen: next[userId]?.lastSeen,
        };
      }
      return { presence: next };
    }),
  isOnline: (userId) => {
    if (!userId) return false;
    return get().presence[userId]?.status === 'online';
  },
}));
