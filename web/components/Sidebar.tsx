'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Avatar } from '@heroui/react';
import { chatApi } from '@/lib/api';
import { resolvePeer, displayTitle } from '@/lib/conversation';
import { sealKeysForConversation } from '@/lib/keyx';
import { useChatStore } from '@/store/chat';
import { useAuthStore } from '@/store/auth';
import { usePeerStore, learnPeerFromMessage, ensurePeer } from '@/store/peers';
import { usePresenceStore } from '@/store/presence';
import { NewChatDialog } from './NewChatDialog';
import { InviteDialog } from './InviteDialog';
import { SearchIcon, ComposeIcon, InviteIcon, GhostIcon } from './MenuIcons';
import type { Conversation } from '@/lib/types';

type Filter = 'all' | 'unread' | 'groups';

/** WhatsApp-style day label: time today, "Yesterday", weekday, else date. */
function formatChatTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days <= 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Peer photo + display name for one conversation row (real photo, not "DC" initials). */
function useConvPeer(conv: Conversation) {
  const selfId = useAuthStore((s) => s.user?.userId);
  const msgs = useChatStore((s) => s.messages[conv.id]);
  const peers = usePeerStore((s) => s.peers);
  const list = msgs || [];
  const peer = resolvePeer(conv, list, selfId, peers);
  return { peer, name: displayTitle(conv, peer) };
}

/** Warm the peer directory from cached history so rows show photos without opening chats. */
function useWarmPeers(conversations: Conversation[]) {
  const selfId = useAuthStore((s) => s.user?.userId);
  const allMessages = useChatStore((s) => s.messages);
  useEffect(() => {
    const cache = usePeerStore.getState().peers;
    for (const c of conversations) {
      if (c.type !== 'direct') continue;
      const msgs = allMessages[c.id] || [];
      for (const m of msgs) learnPeerFromMessage(m);
      const peer = resolvePeer(c, msgs, selfId, usePeerStore.getState().peers);
      if (peer && !cache[peer.userId]?.avatarUrl) ensurePeer(peer.userId);
    }
  }, [conversations, allMessages, selfId]);
}

/**
 * Client-side read tracking: opening a chat (or receiving while open)
 * marks it seen. Powers the Unread pill + row dots (no backend field).
 */
function useLastSeen(): Record<string, string> {
  const activeId = useChatStore((s) => s.activeId);
  const activeLen = useChatStore((s) => (activeId ? s.messages[activeId]?.length || 0 : 0));
  const [lastSeen, setLastSeen] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('nexus_lastseen') || '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => {
    if (!activeId) return;
    const stamp = new Date().toISOString();
    setLastSeen((prev) => {
      const next = { ...prev, [activeId]: stamp };
      try {
        localStorage.setItem('nexus_lastseen', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [activeId, activeLen]);
  return lastSeen;
}

function useMyNames(): string[] {
  const user = useAuthStore((s) => s.user);
  return useMemo(
    () => [user?.name, user?.username].filter((x): x is string => Boolean(x)),
    [user?.name, user?.username],
  );
}

function isUnreadConv(c: Conversation, lastSeen: Record<string, string>, myNames: string[]): boolean {
  const lm = c.lastMessage;
  if (!lm) return false;
  if (myNames.includes(lm.senderName)) return false;
  const seen = lastSeen[c.id];
  if (!seen) return true;
  return new Date(lm.createdAt) > new Date(seen);
}

function matchesQuery(
  c: Conversation,
  q: string,
  selfId: string | undefined,
  peers: ReturnType<typeof usePeerStore.getState>['peers'],
  messages: Record<string, Parameters<typeof resolvePeer>[1]>,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (c.title.toLowerCase().includes(needle)) return true;
  // Match the resolved contact name too ("Direct Chat" rows search by person).
  const peer = resolvePeer(c, messages[c.id] || [], selfId, peers);
  return displayTitle(c, peer).toLowerCase().includes(needle);
}

function FilterPills({
  filter,
  onChange,
  unreadCount,
}: {
  filter: Filter;
  onChange: (f: Filter) => void;
  unreadCount: number;
}) {
  const pills: { k: Filter; label: string }[] = [
    { k: 'all', label: 'All' },
    { k: 'unread', label: unreadCount > 0 ? `Unread ${unreadCount}` : 'Unread' },
    { k: 'groups', label: 'Groups' },
  ];
  return (
    <div className="flex gap-2">
      {pills.map((p) => (
        <button
          key={p.k}
          onClick={() => onChange(p.k)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition ${
            filter === p.k
              ? 'bg-[#CC5500] text-white shadow-[4px_4px_8px_#b8bcc9,-4px_-4px_8px_#ffffff]'
              : 'bg-[#E0E5EC] text-[#6B7280] shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff] hover:text-[#2F343D]'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function ChatRow({
  c,
  active,
  onOpen,
  unread,
  mine,
}: {
  c: Conversation;
  active: boolean;
  onOpen: (id: string) => void;
  unread: boolean;
  mine: boolean;
}) {
  const { peer, name } = useConvPeer(c);
  const isOnline = usePresenceStore((s) => (peer?.userId ? s.presence[peer.userId]?.status === 'online' : false));
  return (
    <button
      onClick={() => onOpen(c.id)}
      className={`relative w-full flex items-center gap-3 px-3 py-2.5 text-left transition rounded-xl ${
        active
          ? 'bg-white/70 shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff]'
          : 'hover:bg-white/50'
      }`}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-[#CC5500]" aria-hidden />}
      <div className="relative shrink-0">
        <Avatar src={peer?.avatarUrl} name={name} size="md" className="shrink-0" />
        {c.type !== 'group' && isOnline && (
          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#22C55E] border-2 border-[#E0E5EC]" title="Online" />
        )}
      </div>
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline justify-between gap-2">
          <b className="truncate text-[15px] font-medium text-[#2F343D]">{name}</b>
          <span className={`text-[11px] shrink-0 ${unread ? 'text-[#CC5500]' : 'text-[#8A8F98]'}`}>
            {formatChatTime(c.lastMessage?.createdAt)}
          </span>
        </span>
        <span className="flex items-center justify-between gap-2 mt-0.5">
          <span className="flex-1 min-w-0 truncate text-[13px] text-[#6B7280]">
            {mine && c.lastMessage && <span className="text-[#8A8F98] mr-1">✓✓</span>}
            {c.lastMessage?.content || 'No messages yet'}
          </span>
          {unread && <span className="shrink-0 w-2 h-2 rounded-full bg-[#CC5500]" aria-label="Unread" />}
        </span>
      </span>
    </button>
  );
}

function EmptyState({
  filter,
  onNew,
  onInvite,
  onGroup,
}: {
  filter: Filter;
  onNew: () => void;
  onInvite: () => void;
  onGroup: () => void;
}) {
  if (filter === 'unread')
    return <p className="text-center text-xs text-[#6B7280] py-16 px-6">You&apos;re all caught up — no unread chats.</p>;
  if (filter === 'groups')
    return (
      <div className="text-center text-xs text-[#6B7280] py-16 px-6 space-y-3">
        <p>No groups yet.</p>
        <button className="underline opacity-70" onClick={onGroup}>Create a group…</button>
      </div>
    );
  return (
    <div className="text-center text-xs text-[#6B7280] py-16 space-y-3 px-6">
      <p>No conversations yet.</p>
      <div className="flex justify-center gap-2">
        <Button size="sm" color="secondary" onPress={onNew}>Search @username</Button>
        <Button size="sm" variant="flat" onPress={onInvite}>Invite a friend</Button>
      </div>
      <button className="underline opacity-70" onClick={onGroup}>or create a group…</button>
    </div>
  );
}

export function Sidebar({ onGhost }: { onGhost: () => void }) {
  const conversations = useChatStore((s) => s.conversations);
  const setConversations = useChatStore((s) => s.setConversations);
  const prepend = useChatStore((s) => s.prependConversation);
  const activeId = useChatStore((s) => s.activeId);
  const setActive = useChatStore((s) => s.setActive);
  const user = useAuthStore((s) => s.user);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [newOpen, setNewOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    chatApi.conversations().then(setConversations).catch(() => setConversations([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const peersSnapshot = usePeerStore((s) => s.peers);
  const cachedMessages = useChatStore((s) => s.messages);
  const lastSeen = useLastSeen();
  const myNames = useMyNames();
  useWarmPeers(conversations);

  // Pre-fetch presence for all direct chat peers in sidebar
  useEffect(() => {
    if (!conversations.length) return;
    const peerUserIds = conversations
      .filter((c) => c.type !== 'group')
      .map((c) => {
        const p = resolvePeer(c, cachedMessages[c.id] || [], user?.userId, peersSnapshot);
        return p?.userId;
      })
      .filter((id): id is string => Boolean(id));

    if (peerUserIds.length > 0) {
      chatApi.batchPresence(peerUserIds).then((res) => {
        if (res) usePresenceStore.getState().setBatchPresence(res);
      }).catch(() => {});
    }
  }, [conversations, user?.userId, peersSnapshot, cachedMessages]);

  const unreadCount = useMemo(
    () => conversations.filter((c) => isUnreadConv(c, lastSeen, myNames)).length,
    [conversations, lastSeen, myNames],
  );

  const visible = useMemo(
    () =>
      conversations.filter((c) => {
        if (filter === 'unread' && !isUnreadConv(c, lastSeen, myNames)) return false;
        if (filter === 'groups' && c.type !== 'group') return false;
        return matchesQuery(c, q, user?.userId, peersSnapshot, cachedMessages);
      }),
    [conversations, filter, q, lastSeen, myNames, user?.userId, peersSnapshot, cachedMessages],
  );

  /** Legacy group flow (kept): 1:1 chats go through username search. */
  const newGroup = async () => {
    const title = window.prompt('Group name:');
    if (!title?.trim()) return;
    try {
      const conv: Conversation = await chatApi.createConversation([], title.trim(), 'group');
      prepend(conv);
      setActive(conv.id);
      if (user) {
        sealKeysForConversation(conv.id, conv.participants, user.userId).catch(() => {});
      }
    } catch {
      /* validation error surfaces via empty state */
    }
  };

  return (
    <>
      {/* Desktop panel */}
      <div className="w-full h-full hidden md:flex flex-col bg-[#E0E5EC] overflow-hidden">
        <div className="px-4 pt-4 pb-2 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-[#2F343D]">Chats</h1>
            <div className="flex items-center gap-1">
              <button
                onClick={onGhost}
                title="Ghost chat"
                aria-label="Ghost chat"
                className="p-2 rounded-full text-[#8A8F98] bg-[#E0E5EC] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] hover:text-[#2F343D] transition flex items-center justify-center"
              >
                <GhostIcon />
              </button>
              <button
                onClick={() => setInviteOpen(true)}
                title="Invite a friend"
                aria-label="Invite a friend"
                className="p-2 rounded-full text-[#8A8F98] bg-[#E0E5EC] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] hover:text-[#2F343D] transition"
              >
                <InviteIcon />
              </button>
              <button
                onClick={() => setNewOpen(true)}
                title="New chat"
                aria-label="New chat"
                className="p-2 rounded-full bg-[#CC5500] text-white hover:bg-[#B34A00] shadow-[4px_4px_8px_#b8bcc9,-4px_-4px_8px_#ffffff] transition"
              >
                <ComposeIcon />
              </button>
            </div>
          </div>
          <label className="flex items-center gap-2 bg-[#E0E5EC] rounded-full px-3 py-1.5 text-[#8A8F98] shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff]">
            <SearchIcon />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search or start a new chat"
              aria-label="Search or start a new chat"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-[#8A8F98] text-[#2F343D]"
            />
          </label>
          <FilterPills filter={filter} onChange={setFilter} unreadCount={unreadCount} />
        </div>
        <div className="flex-1 overflow-y-auto pb-2">
          {visible.map((c) => (
            <ChatRow
              key={c.id}
              c={c}
              active={activeId === c.id}
              onOpen={setActive}
              unread={isUnreadConv(c, lastSeen, myNames)}
              mine={Boolean(c.lastMessage && myNames.includes(c.lastMessage.senderName))}
            />
          ))}
          {visible.length === 0 && (
            <EmptyState filter={filter} onNew={() => setNewOpen(true)} onInvite={() => setInviteOpen(true)} onGroup={newGroup} />
          )}
        </div>
      </div>

      {/* Mobile: conversations live under the Chats tab; actions stay reachable */}
      <div className="md:hidden">
        {/* rendered inline by the page shell when the chat tab is active */}
      </div>

      <NewChatDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </>
  );
}

/** Mobile conversation list + invite actions (rendered inside the Chats tab). */
export function MobileChats({ onGhost }: { onGhost: () => void }) {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const setActive = useChatStore((s) => s.setActive);
  const user = useAuthStore((s) => s.user);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [newOpen, setNewOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const peersSnapshot = usePeerStore((s) => s.peers);
  const cachedMessages = useChatStore((s) => s.messages);
  const lastSeen = useLastSeen();
  const myNames = useMyNames();
  useWarmPeers(conversations);

  const unreadCount = useMemo(
    () => conversations.filter((c) => isUnreadConv(c, lastSeen, myNames)).length,
    [conversations, lastSeen, myNames],
  );

  const visible = useMemo(
    () =>
      conversations.filter((c) => {
        if (filter === 'unread' && !isUnreadConv(c, lastSeen, myNames)) return false;
        if (filter === 'groups' && c.type !== 'group') return false;
        return matchesQuery(c, q, user?.userId, peersSnapshot, cachedMessages);
      }),
    [conversations, filter, q, lastSeen, myNames, user?.userId, peersSnapshot, cachedMessages],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 md:hidden bg-[#E0E5EC]">
      <div className="px-4 pt-4 pb-2 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-[#2F343D]">Chats</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={onGhost}
              title="Ghost chat"
              aria-label="Ghost chat"
              className="p-2 rounded-full text-[#8A8F98] bg-[#E0E5EC] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] hover:text-[#2F343D] transition flex items-center justify-center"
            >
              <GhostIcon />
            </button>
            <button
              onClick={() => setInviteOpen(true)}
              title="Invite a friend"
              aria-label="Invite a friend"
              className="p-2 rounded-full text-[#8A8F98] bg-[#E0E5EC] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] hover:text-[#2F343D] transition"
            >
              <InviteIcon />
            </button>
            <button
              onClick={() => setNewOpen(true)}
              title="New chat"
              aria-label="New chat"
              className="p-2 rounded-full bg-[#CC5500] text-white hover:bg-[#B34A00] shadow-[4px_4px_8px_#b8bcc9,-4px_-4px_8px_#ffffff] transition"
            >
              <ComposeIcon />
            </button>
          </div>
        </div>
        <label className="flex items-center gap-2 bg-[#E0E5EC] rounded-full px-3 py-1.5 text-[#8A8F98] shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff]">
          <SearchIcon />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search or start a new chat"
            aria-label="Search or start a new chat"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-[#8A8F98] text-[#2F343D]"
          />
        </label>
        <FilterPills filter={filter} onChange={setFilter} unreadCount={unreadCount} />
      </div>
      <div className="flex-1 overflow-y-auto pb-2">
        {visible.map((c) => (
          <ChatRow
            key={c.id}
            c={c}
            active={activeId === c.id}
            onOpen={setActive}
            unread={isUnreadConv(c, lastSeen, myNames)}
            mine={Boolean(c.lastMessage && myNames.includes(c.lastMessage.senderName))}
          />
        ))}
        {visible.length === 0 && (
          <p className="text-center text-xs text-[#6B7280] py-16 px-6">
            {filter === 'unread'
              ? "You're all caught up — no unread chats."
              : filter === 'groups'
                ? 'No groups yet.'
                : 'No conversations yet — invite a friend or start one with + New.'}
          </p>
        )}
      </div>
      <NewChatDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}

