'use client';

import { create } from 'zustand';
import { setTokens } from '@/lib/api';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import type { User } from '@/lib/types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  hydrated: boolean;
  hydrate: () => void;
  login: (user: User, token: string, refreshToken?: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  hydrated: false,

  hydrate: () => {
    try {
      const user = localStorage.getItem('nexus_user');
      const token = localStorage.getItem('nexus_token');
      const refresh = localStorage.getItem('nexus_refresh');
      if (user && token) {
        setTokens(token, refresh);
        connectSocket(token);
        const parsed = JSON.parse(user);
        try {
          // Backfill for sessions stored before email persistence (refresh needs it).
          if (parsed?.email && !localStorage.getItem('nexus_email')) {
            localStorage.setItem('nexus_email', parsed.email);
          }
        } catch {
          /* private mode */
        }
        set({ user: parsed, token, isAuthenticated: true, hydrated: true });
        return;
      }
    } catch {
      /* no stored session */
    }
    set({ hydrated: true });
  },

  login: (user, token, refreshToken) => {
    setTokens(token, refreshToken);
    try {
      localStorage.setItem('nexus_user', JSON.stringify(user));
      localStorage.setItem('nexus_token', token);
      if (user?.email) localStorage.setItem('nexus_email', user.email);
      if (refreshToken) localStorage.setItem('nexus_refresh', refreshToken);
    } catch {
      /* private mode */
    }
    connectSocket(token);
    set({ user, token, isAuthenticated: true });
  },

  logout: () => {
    setTokens(null, null);
    disconnectSocket();
    try {
      localStorage.removeItem('nexus_user');
      localStorage.removeItem('nexus_token');
      localStorage.removeItem('nexus_email');
      localStorage.removeItem('nexus_refresh');
    } catch {
      /* ignore */
    }
    set({ user: null, token: null, isAuthenticated: false });
  },
}));
