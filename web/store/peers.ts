'use client';

import { create } from 'zustand';
import { authApi, type PublicUser } from '@/lib/api';

interface PeerState {
  peers: Record<string, PublicUser>;
  setPeer: (p: PublicUser) => void;
  setPeers: (list: PublicUser[]) => void;
}

const STORAGE_KEY = 'nexus_peers';
const MAX_STORED = 200;

/** Rehydrate the contact directory so avatars/names survive reloads and chat switches. */
function loadStored(): Record<string, PublicUser> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PublicUser>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function persist(peers: Record<string, PublicUser>) {
  try {
    const entries = Object.entries(peers).slice(-MAX_STORED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* private mode / quota — memory cache still works */
  }
}

const inflight = new Set<string>();

export const usePeerStore = create<PeerState>((set) => ({
  peers: loadStored(),

  setPeer: (p) =>
    set((s) => {
      const prev = s.peers[p.userId];
      if (
        prev &&
        prev.avatarUrl === p.avatarUrl &&
        (prev.name || prev.username) === (p.name || p.username) &&
        (prev.about || '') === (p.about || '') &&
        (prev.verified || false) === (p.verified || false)
      ) {
        return s;
      }
      // Verified directory entries always win: message-derived data must
      // never overwrite them (senderName/senderAvatar are client-controlled
      // and therefore spoofable).
      const peers = {
        ...s.peers,
        [p.userId]: prev?.verified && !p.verified ? prev : { ...prev, ...p },
      };
      persist(peers);
      return { peers };
    }),

  setPeers: (list) =>
    set((s) => {
      const peers = { ...s.peers };
      for (const p of list) peers[p.userId] = { ...peers[p.userId], ...p };
      persist(peers);
      return { peers };
    }),
}));

/** Record what a message already tells us (no network needed). */
export function learnPeerFromMessage(m: { senderId: string; senderName: string; senderAvatar?: string }) {
  if (!m.senderId || m.senderId === 'nexus-ai') return;
  if (!m.senderAvatar && !m.senderName) return;
  // Unverified by construction: senderName/senderAvatar arrive inside a
  // client-controlled payload. Stored as a display placeholder only — never
  // an avatar (spoofed images must not render, even briefly), and never over
  // a verified directory entry (see setPeer). ensurePeer() resolves the truth.
  const existing = usePeerStore.getState().peers[m.senderId];
  if (existing) return;
  usePeerStore.getState().setPeer({
    userId: m.senderId,
    username: m.senderName,
    name: m.senderName,
    avatarUrl: undefined,
  });
}

/** Fetch the full public profile once per user (cached, deduped). */
export function ensurePeer(userId: string) {
  if (!userId || userId === 'nexus-ai' || inflight.has(userId)) return;
  inflight.add(userId);
  authApi
    .publicUser(userId)
    .then((u) => {
      if (u) usePeerStore.getState().setPeer({ ...(u as PublicUser), verified: true } as PublicUser);
    })
    .catch(() => {
      /* profile unavailable — keep message-derived fallback */
    })
    .finally(() => {
      inflight.delete(userId);
    });
}
