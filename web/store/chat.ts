'use client';

import { create } from 'zustand';
import type { Conversation, Message } from '@/lib/types';

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  messages: Record<string, Message[]>;
  typing: Record<string, string[]>;
  replyTo: Message | null;
  setConversations: (c: Conversation[]) => void;
  prependConversation: (c: Conversation) => void;
  setActive: (id: string | null) => void;
  setMessages: (convId: string, m: Message[]) => void;
  addMessage: (convId: string, m: Message) => void;
  /** Swap an optimistic temp message for the server-acknowledged real one. */
  replaceTemp: (convId: string, tempId: string, real: Message) => void;
  /** Prepend an older page (cursor pagination), deduped. */
  prependOlder: (convId: string, older: Message[]) => void;
  applyReaction: (convId: string, messageSk: string, userId: string, username: string, emoji: string) => void;
  markReadLocal: (convId: string, messageId: string) => void;
  setTyping: (convId: string, username: string, on: boolean) => void;
  setReplyTo: (m: Message | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  activeId: null,
  messages: {},
  typing: {},
  replyTo: null,

  setConversations: (conversations) => set({ conversations }),
  prependConversation: (c) =>
    set((s) => ({ conversations: [c, ...s.conversations.filter((x) => x.id !== c.id)] })),
  setActive: (id) => set({ activeId: id, replyTo: null }),

  setMessages: (convId, m) =>
    set((s) => ({ messages: { ...s.messages, [convId]: m } })),

  addMessage: (convId, m) =>
    set((s) => {
      const cur = s.messages[convId] || [];
      if (cur.some((x) => x.id === m.id)) return s;
      return { messages: { ...s.messages, [convId]: [...cur, m] } };
    }),

  replaceTemp: (convId, tempId, real) =>
    set((s) => {
      const cur = s.messages[convId] || [];
      if (cur.some((x) => x.id === real.id)) {
        // Broadcast arrived first — drop the temp, keep the real.
        return { messages: { ...s.messages, [convId]: cur.filter((x) => x.id !== tempId) } };
      }
      return {
        messages: {
          ...s.messages,
          [convId]: cur.map((x) => (x.id === tempId ? real : x)),
        },
      };
    }),

  prependOlder: (convId, older) =>
    set((s) => {
      const cur = s.messages[convId] || [];
      const known = new Set(cur.map((x) => x.id));
      const fresh = older.filter((x) => !known.has(x.id));
      if (!fresh.length) return s;
      return { messages: { ...s.messages, [convId]: [...fresh, ...cur] } };
    }),

  applyReaction: (convId, messageSk, userId, username, emoji) =>
    set((s) => {
      const list = s.messages[convId] || [];
      // messageSk from gateway is `MSG#<iso>#<uuid>`; match by id suffix
      const id = messageSk.split('#').pop() || messageSk;
      return {
        messages: {
          ...s.messages,
          [convId]: list.map((m) => {
            if (m.id !== id && m.id !== messageSk) return m;
            const reactions = [...(m.reactions || [])];
            const i = reactions.findIndex((r) => r.userId === userId && r.emoji === emoji);
            if (i >= 0) reactions.splice(i, 1);
            else reactions.push({ emoji, userId, username });
            return { ...m, reactions };
          }),
        },
      };
    }),

  markReadLocal: (convId, messageId) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [convId]: (s.messages[convId] || []).map((m) =>
          m.id === messageId ? { ...m, status: 'read' as const } : m,
        ),
      },
    })),

  setTyping: (convId, username, on) =>
    set((s) => {
      const cur = s.typing[convId] || [];
      return {
        typing: {
          ...s.typing,
          [convId]: on ? Array.from(new Set([...cur, username])) : cur.filter((u) => u !== username),
        },
      };
    }),

  setReplyTo: (replyTo) => set({ replyTo }),
}));
