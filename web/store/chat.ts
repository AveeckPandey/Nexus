'use client';

import { create } from 'zustand';
import type { Conversation, Message } from '@/lib/types';

/** True when both string records hold identical entries. */
function sameRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => b[k] === a[k]);
}

/**
 * Mark my messages 'read' once every other member's cursor has passed them.
 * Returns the original array when nothing changes (keeps zustand cheap).
 * ISO timestamps compare chronologically as plain strings.
 */
function deriveRead(
  list: Message[],
  cursors: Record<string, string>,
  selfId: string,
  otherIds: string[] = [],
): Message[] {
  const others = (otherIds.length > 0 ? otherIds : Object.keys(cursors)).filter((u) => u !== selfId);
  if (others.length === 0 || list.length === 0) return list;
  const timeOf = new Map(list.map((m) => [m.id, m.createdAt] as const));
  let threshold: string | null = null;
  for (const uid of others) {
    const t = timeOf.get(cursors[uid]);
    if (!t) return list; // cursor outside loaded history — can't confirm
    if (threshold === null || t < threshold) threshold = t;
  }
  let changed = false;
  const next = list.map((m) => {
    if (m.senderId === selfId && m.status !== 'read' && m.createdAt <= threshold!) {
      changed = true;
      return { ...m, status: 'read' as const };
    }
    return m;
  });
  return changed ? next : list;
}

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  messages: Record<string, Message[]>;
  /** convId -> (userId -> display name) — keyed by userId so stop events clear correctly. */
  typing: Record<string, Record<string, string>>;
  replyTo: Message | null;
  /** Read-receipt cursors: convId → (userId → lastReadMessageId). */
  readCursors: Record<string, Record<string, string>>;
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
  removeMessage: (convId: string, messageId: string) => void;
  /**
   * Derive ✓✓ from read cursors: my messages at or before the point every
   * *other* member has read become 'read'. Conservative — any cursor that
   * can't be resolved inside loaded history blocks the upgrade.
   */
  applyReadCursors: (convId: string, cursors: Record<string, string>, selfId: string, otherIds?: string[]) => void;
  /** Merge one live `message_status_update` into the cursor map and re-derive. */
  applyRemoteRead: (convId: string, userId: string, messageId: string, selfId: string, otherIds?: string[]) => void;
  setTyping: (convId: string, userId: string, username: string, on: boolean) => void;
  clearTyping: (convId: string, userId?: string) => void;
  setReplyTo: (m: Message | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  activeId: null,
  messages: {},
  typing: {},
  replyTo: null,
  readCursors: {},

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
      // Keep the conversation list live: preview + recency follow every message.
      // Optimistic (temp_) messages still carry local plaintext; persisted
      // ciphertext must never leak into previews (server shows 🔒 instead).
      const preview = m.id.startsWith('temp_')
        ? m.mediaType === 'text'
          ? m.content
          : `📎 ${m.mediaType}`
        : m.isEncrypted
          ? '🔒 Encrypted message'
          : m.mediaType === 'text'
            ? m.content
            : `📎 ${m.mediaType}`;
      const conversations = s.conversations
        .map((c) =>
          c.id === convId
            ? {
                ...c,
                lastMessage: { content: preview, senderName: m.senderName, createdAt: m.createdAt },
                updatedAt: m.createdAt,
              }
            : c,
        )
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
      return { messages: { ...s.messages, [convId]: [...cur, m] }, conversations };
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

  removeMessage: (convId, messageId) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [convId]: (s.messages[convId] || []).filter((m) => m.id !== messageId),
      },
    })),

  applyReadCursors: (convId, cursors, selfId, otherIds = []) =>
    set((s) => {
      const merged = { ...(s.readCursors[convId] || {}), ...cursors };
      const next = deriveRead(s.messages[convId] || [], merged, selfId, otherIds);
      if (next === s.messages[convId]) {
        // Cursors still worth keeping for later pages/live events.
        if (sameRecord(merged, s.readCursors[convId] || {})) return s;
        return { readCursors: { ...s.readCursors, [convId]: merged } };
      }
      return {
        messages: { ...s.messages, [convId]: next },
        readCursors: { ...s.readCursors, [convId]: merged },
      };
    }),

  applyRemoteRead: (convId, userId, messageId, selfId, otherIds = []) =>
    set((s) => {
      const prev = s.readCursors[convId] || {};
      const list = s.messages[convId] || [];
      const timeOf = new Map(list.map((m) => [m.id, m.createdAt] as const));
      // Cursors only move forward — ignore stale/out-of-order events.
      const keep = prev[userId] && timeOf.get(prev[userId]!) && timeOf.get(messageId);
      const merged =
        keep && timeOf.get(prev[userId]!)! > timeOf.get(messageId)!
          ? prev
          : { ...prev, [userId]: messageId };
      const next = deriveRead(list, merged, selfId, otherIds);
      if (next === list && merged === prev) return s;
      return {
        messages: { ...s.messages, [convId]: next },
        readCursors: { ...s.readCursors, [convId]: merged },
      };
    }),

  setTyping: (convId, userId, username, on) =>
    set((s) => {
      const cur = s.typing[convId] || {};
      if (!userId) return s;
      if (on) {
        const name = username || userId;
        if (cur[userId] === name) return s;
        return { typing: { ...s.typing, [convId]: { ...cur, [userId]: name } } };
      }
      if (!cur[userId]) return s;
      const next = { ...cur };
      delete next[userId];
      return { typing: { ...s.typing, [convId]: next } };
    }),

  clearTyping: (convId, userId) =>
    set((s) => {
      if (!s.typing[convId]) return s;
      if (!userId) {
        if (Object.keys(s.typing[convId]).length === 0) return s;
        return { typing: { ...s.typing, [convId]: {} } };
      }
      if (!s.typing[convId][userId]) return s;
      const next = { ...s.typing[convId] };
      delete next[userId];
      return { typing: { ...s.typing, [convId]: next } };
    }),

  setReplyTo: (replyTo) => set({ replyTo }),
}));
