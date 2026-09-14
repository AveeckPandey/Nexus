'use client';

import { create } from 'zustand';

interface NetworkState {
  isOnline: boolean;
  isSlow: boolean;
  latency: number | null;
  effectiveType: string | null;
  reason: string | null;
  updateStatus: (patch: Partial<Omit<NetworkState, 'updateStatus'>>) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  isOnline: true,
  isSlow: false,
  latency: null,
  effectiveType: null,
  reason: null,
  updateStatus: (patch) => set((s) => ({ ...s, ...patch })),
}));
