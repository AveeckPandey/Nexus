'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Button, Spinner, Avatar } from '@heroui/react';
import { Theme } from 'emoji-picker-react';
import { chatApi, aiApi } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { encryptText, decryptText, ensureConversationKey, exportConversationKey } from '@/lib/e2ee';
import { fetchAndImportKey, sealKeysForConversation } from '@/lib/keyx';
import { useChatStore } from '@/store/chat';
import { useAuthStore } from '@/store/auth';
import { usePeerStore, learnPeerFromMessage, ensurePeer } from '@/store/peers';
import { resolvePeer, displayTitle } from '@/lib/conversation';
import { buildAlbumIndex, type Album } from '@/lib/album';
import { Composer } from './Composer';
import {
  InfoIcon,
  ReplyIcon,
  CopyIcon,
  TranslateIcon,
  ForwardIcon,
  PinIcon,
  SparkleIcon,
  AlienIcon,
  StarIcon,
  SelectIcon,
  SaveIcon,
  ShareIcon,
  OpenIcon,
  TrashIcon,
  PlusIcon,
  DotsIcon,
  PhoneIcon,
  VideoIcon,
  SearchIcon,
  ImageIcon,
  KeyIcon,
  PlayIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CheckIcon,
  LockIcon,
  MicIcon,
  DocIcon,
  ClipIcon,
} from './MenuIcons';
import type { Message } from '@/lib/types';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => <div className="p-3 text-xs text-whatsapp-checkGray">Loading emojis…</div>,
});

const MISSING = '🔒 Encrypted — key missing on this device';
const SPEEDS = [1, 1.5, 2] as const;

function groupReactions(reactions: Message['reactions'], currentUserId?: string) {
  if (!reactions || reactions.length === 0) return [];
  const map = new Map<string, { emoji: string; count: number; users: string[]; hasReacted: boolean }>();
  for (const r of reactions) {
    const existing = map.get(r.emoji);
    if (existing) {
      existing.count += 1;
      existing.users.push(r.username);
      if (r.userId === currentUserId) existing.hasReacted = true;
    } else {
      map.set(r.emoji, {
        emoji: r.emoji,
        count: 1,
        users: [r.username],
        hasReacted: r.userId === currentUserId,
      });
    }
  }
  return Array.from(map.values());
}
function displayOf(convId: string, m: Message): Message {
  if (m.isEncrypted && m.nonce) {
    const plain = decryptText(convId, m.content, m.nonce);
    return { ...m, content: plain ?? MISSING };
  }
  return m;
}
/** Audio player with deterministic mini-waveform, progress and 1×/1.5×/2× speed. */
function AudioMessage({ src, seed }: { src: string; seed: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [progress, setProgress] = useState(0);
  const bars = useMemo(() => {
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return Array.from({ length: 28 }, (_, i) => {
      h = (h * 1103515245 + 12345) >>> 0;
      return 5 + (h % 24);
    });
  }, [seed]);

  return (
    <div className="flex items-center gap-2 min-w-[220px]">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          setProgress(a.duration ? a.currentTime / a.duration : 0);
        }}
        onEnded={() => setProgress(1)}
      />
      <button
        className="w-9 h-9 shrink-0 rounded-full bg-white/15 text-base flex items-center justify-center"
        aria-label="Play voice note"
        onClick={() => {
          const a = audioRef.current;
          if (!a) return;
          if (a.paused) a.play().catch(() => {});
          else a.pause();
        }}
      >
        <PlayIcon size={14} />
      </button>
      <div className="flex-1 flex items-center gap-[2px] h-7" aria-hidden>
        {bars.map((b, i) => (
          <span
            key={i}
            className={`flex-1 rounded ${i / bars.length <= progress ? 'bg-white' : 'bg-white/30'}`}
            style={{ height: `${b}px` }}
          />
        ))}
      </div>
      <div className="flex shrink-0">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => {
              setSpeed(s);
              if (audioRef.current) audioRef.current.playbackRate = s;
            }}
            className={`text-[10px] px-1.5 py-0.5 rounded ${speed === s ? 'bg-white/25 font-bold' : 'opacity-60'}`}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_TYPING_MAP: Record<string, string> = {};

/** Inline rich text: **bold** and `code` without any markdown dependency. */
function RichLine({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**') && p.length > 4) {
          return (
            <b key={i} className="font-semibold text-white">
              {p.slice(2, -2)}
            </b>
          );
        }
        if (p.startsWith('`') && p.endsWith('`') && p.length > 2) {
          return (
            <code key={i} className="px-1 py-0.5 rounded bg-black/40 border border-white/10 font-mono text-[11px] text-cyan-200">
              {p.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

/** Polished AI-summary body: real bullets, bold topics, breathing room. */
export function SummaryBody({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="mt-1.5 space-y-1.5 text-[13px] leading-relaxed text-white/85">
      {lines.map((raw, i) => {
        const line = raw.trim();
        if (!line) return null;
        const bullet = line.match(/^([-*•])\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2.5">
              <span className="mt-[7px] w-1.5 h-1.5 shrink-0 rounded-full bg-secondary" aria-hidden />
              <p className="flex-1 min-w-0">
                <RichLine text={bullet[2]} />
              </p>
            </div>
          );
        }
        const ordered = line.match(/^(\d+[.)])\s+(.*)$/);
        if (ordered) {
          return (
            <div key={i} className="flex gap-2.5">
              <span className="shrink-0 font-semibold text-secondary" aria-hidden>
                {ordered[1]}
              </span>
              <p className="flex-1 min-w-0">
                <RichLine text={ordered[2]} />
              </p>
            </div>
          );
        }
        const heading = line.match(/^#{1,4}\s+(.*)$/);
        return (
          <p key={i} className={heading ? 'font-semibold text-white pt-1' : ''}>
            <RichLine text={heading ? heading[1] : line} />
          </p>
        );
      })}
    </div>
  );
}

/** Animated three-dot typing indicator. */
function TypingDots({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-end gap-[3px] ml-1 align-middle ${className}`} aria-label="typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[5px] h-[5px] rounded-full bg-current opacity-60 animate-typing-bounce"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}

/** WhatsApp-style photo album: consecutive same-sender images in one grid. */
function AlbumView({
  album,
  me,
  time,
  status,
  encrypted,
  starred,
  pinned,
  selectMode,
  allSelected,
  onToggleSelect,
  onTileContext,
  onTileChevron,
  onOpen,
  onReact,
  currentUserId,
}: {
  album: Album;
  me: boolean;
  time: string;
  status?: Message['status'];
  encrypted: boolean;
  starred: boolean;
  pinned: boolean;
  selectMode: boolean;
  allSelected: boolean;
  onToggleSelect: () => void;
  onTileContext: (e: React.MouseEvent, m: Message) => void;
  onTileChevron: (e: React.MouseEvent, m: Message) => void;
  onOpen: (urls: string[], i: number) => void;
  onReact: (m: Message, emoji: string) => void;
  currentUserId?: string;
}) {
  const first = album.msgs[0];
  const urls = album.msgs.map((t) => t.mediaUrl!);
  const shown = album.msgs.slice(0, 4);
  const extra = album.msgs.length - shown.length;
  const wideFirst = album.msgs.length === 3;
  return (
    <div key={first.id} id={`msg-${first.id}`} className={`flex items-end gap-2 mb-2 ${me ? 'justify-end' : 'justify-start'}`}>
      {selectMode && (
        <button
          onClick={onToggleSelect}
          aria-label="Select album"
          className={`shrink-0 w-5 h-5 mb-2 rounded-md border flex items-center justify-center text-xs ${
            allSelected ? 'bg-secondary border-secondary text-white' : 'border-white/30 text-transparent'
          }`}
        >
          ✓
        </button>
      )}
      <div
        onContextMenu={(e) => onTileContext(e, first)}
        className={`relative w-[300px] max-w-[72vw] rounded-2xl overflow-hidden p-1 shadow-sm ${
          me ? 'bg-whatsapp-outgoing rounded-br-sm' : 'bg-whatsapp-composer rounded-bl-sm'
        }`}
      >
        {(starred || pinned) && (
          <div className="flex items-center gap-1.5 px-2 pt-1.5 text-[10px] text-amber-300/90">
            {starred && <span title="Starred" className="flex items-center gap-0.5"><StarIcon size={10} /> starred</span>}
            {pinned && <span title="Pinned" className="flex items-center gap-0.5"><PinIcon size={10} /> pinned</span>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-0.5 rounded-xl overflow-hidden mt-1">
          {shown.map((t, idx) => {
            const chips = groupReactions(t.reactions, currentUserId);
            return (
              <div
                key={t.id}
                onContextMenu={(e) => {
                  e.stopPropagation();
                  onTileContext(e, t);
                }}
                className={`relative group/tile overflow-hidden bg-black/20 ${wideFirst && idx === 0 ? 'col-span-2 aspect-[2/1]' : 'aspect-square'}`}
              >
                <img
                  src={t.mediaUrl}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover cursor-pointer hover:brightness-105 transition"
                  onClick={() => onOpen(urls, album.msgs.indexOf(t))}
                />
                <button
                  aria-label="Photo options"
                  onClick={(e) => onTileChevron(e, t)}
                  className="absolute top-0 right-0 z-10 pl-6 pr-1.5 py-0.5 text-white/80 leading-none transition-opacity bg-gradient-to-l from-black/60 to-transparent opacity-0 group-hover/tile:opacity-100 hover:text-white flex items-center"
                >
                  <ChevronDownIcon size={14} />
                </button>
                {chips.length > 0 && (
                  <div className="absolute bottom-1 left-1 flex gap-1">
                    {chips.map((g) => (
                      <button
                        key={g.emoji}
                        onClick={(e) => {
                          e.stopPropagation();
                          onReact(t, g.emoji);
                        }}
                        title={`${g.users.join(', ')} reacted with ${g.emoji}`}
                        className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-black/65 border border-white/20"
                      >
                        <span>{g.emoji}</span>
                        <span>{g.count}</span>
                      </button>
                    ))}
                  </div>
                )}
                {extra > 0 && idx === shown.length - 1 && (
                  <button
                    className="absolute inset-0 bg-black/60 text-white text-2xl font-bold flex items-center justify-center"
                    onClick={() => onOpen(urls, album.msgs.indexOf(t))}
                    aria-label={`Show ${extra} more photos`}
                  >
                    +{extra}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {album.caption && <p className="whitespace-pre-wrap break-words text-sm px-2 pt-1.5">{album.caption}</p>}
        <div className="flex items-center justify-end gap-1 px-2 pb-1 pt-0.5">
  {encrypted && <span title="Encrypted" className="flex items-center opacity-70"><LockIcon size={10} /></span>}
          <span className="text-[10px] opacity-60">{time}</span>
          {me && (
            <span className={`text-[10px] ${status === 'read' ? 'text-whatsapp-checkBlue' : 'opacity-60'}`}>
              {status === 'read' ? '✓✓' : '✓'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChatWindow({ conversationId, onCall }: { conversationId: string; onCall: (type: 'video' | 'audio') => void }) {
  const user = useAuthStore((s) => s.user);
  const conversations = useChatStore((s) => s.conversations);
  const raw = useChatStore((s) => s.messages[conversationId]) || EMPTY_MESSAGES;
  const typingMap = useChatStore((s) => s.typing[conversationId]) || EMPTY_TYPING_MAP;
  const typingNames = useMemo(() => {
    const selfId = user?.userId;
    return Object.entries(typingMap)
      .filter(([uid]) => uid !== selfId)
      .map(([, name]) => name);
  }, [typingMap, user?.userId]);
  const replyTo = useChatStore((s) => s.replyTo);
  const { setMessages, addMessage, replaceTemp, prependOlder, applyReaction, setTyping, clearTyping, setReplyTo, removeMessage, applyReadCursors, applyRemoteRead } = useChatStore.getState();
  const [loading, setLoading] = useState(true);
  // E2EE is mandatory — every text message is encrypted from the start (no off switch).
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [transcriptions, setTranscriptions] = useState<Record<string, string>>({});
  const [transcribingId, setTranscribingId] = useState<string | null>(null);
  const [pickerForMessage, setPickerForMessage] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ urls: string[]; i: number } | null>(null);
  const openLightbox = (urls: string[], i: number) => setLightbox({ urls, i });

  // Arrow-key navigation inside the lightbox.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
      else if (e.key === 'ArrowRight') setLightbox((lb) => (lb && lb.i < lb.urls.length - 1 ? { ...lb, i: lb.i + 1 } : lb));
      else if (e.key === 'ArrowLeft') setLightbox((lb) => (lb && lb.i > 0 ? { ...lb, i: lb.i - 1 } : lb));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);
  // WhatsApp-style message context menu (right-click / ⌄ chevron).
  const [menu, setMenu] = useState<{ msg: Message; x: number; y: number } | null>(null);
  const [headerMenu, setHeaderMenu] = useState(false);
  const [peerOpen, setPeerOpen] = useState(false);
  const [infoMsg, setInfoMsg] = useState<Message | null>(null);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => {
    setMenu(null);
    setHeaderMenu(false);
  };

  useEffect(() => {
    if (!menu && !headerMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, headerMenu]);

  // Load per-conversation stars/pins (local-only, like WhatsApp starred messages).
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(`nexus_star_${conversationId}`) || '[]') as string[];
      setStarredIds(new Set(s));
      const p = JSON.parse(localStorage.getItem(`nexus_pin_${conversationId}`) || '[]') as string[];
      setPinnedIds(p);
    } catch {
      setStarredIds(new Set());
      setPinnedIds([]);
    }
    setSelectMode(false);
    setSelectedIds(new Set());
    setMenu(null);
    setHeaderMenu(false);
    setPeerOpen(false);
  }, [conversationId]);

  const persistSet = (key: string, set: Set<string>) => {
    try {
      localStorage.setItem(key, JSON.stringify(Array.from(set)));
    } catch {
      /* storage unavailable */
    }
  };

  const openMenuFor = (msg: Message, x: number, y: number) => {
    const w = 240;
    const h = msg.mediaUrl ? 620 : 580;
    setPickerForMessage(null);
    setMenu({
      msg,
      x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
    });
  };

  const onBubbleContext = (e: React.MouseEvent, msg: Message) => {
    e.preventDefault();
    e.stopPropagation();
    openMenuFor(msg, e.clientX, e.clientY);
  };

  const onChevronClick = (e: React.MouseEvent, msg: Message) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenuFor(msg, r.left - 220, r.bottom + 4);
  };

  const conv = conversations.find((c) => c.id === conversationId);
  const messages = useMemo(() => raw.map((m) => displayOf(conversationId, m)), [raw, conversationId]);
  const peers = usePeerStore((s) => s.peers);
  const peer = useMemo(
    () => resolvePeer(conv, messages, user?.userId, peers),
    [conv, messages, user?.userId, peers],
  );
  const title = useMemo(() => displayTitle(conv, peer), [conv, peer]);
  const fallbackAvatar = useMemo(() => {
    const other = messages.find((m) => m.senderId !== user?.userId && m.senderAvatar);
    return other?.senderAvatar;
  }, [messages, user?.userId]);
  const convAvatar = peer?.avatarUrl || fallbackAvatar;

  // Learn real profile photos from message history, then refresh via public profiles.
  useEffect(() => {
    const seen = new Set<string>();
    for (const m of raw) {
      if (!m.senderId || m.senderId === user?.userId || seen.has(m.senderId)) continue;
      seen.add(m.senderId);
      learnPeerFromMessage(m);
      ensurePeer(m.senderId);
    }
  }, [raw, user?.userId]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => m.content.toLowerCase().includes(q) || m.senderName.toLowerCase().includes(q));
  }, [messages, query]);
  const gallery = useMemo(() => messages.filter((m) => m.mediaUrl), [messages]);
  const albumIndex = useMemo(() => buildAlbumIndex(visible), [visible]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setCursor(null);
    setHasMore(false);
    setQuery('');
    // Envelope first (auto key exchange), local key as fallback for creators.
    fetchAndImportKey(conversationId)
      .catch(() => false)
      .then(() => ensureConversationKey(conversationId).catch(() => {}))
      .then(() => {
        const c = useChatStore.getState().conversations.find((x) => x.id === conversationId);
        const self = useAuthStore.getState().user?.userId;
        if (c && self && c.participants) {
          sealKeysForConversation(conversationId, c.participants, self).catch(() => {});
        }
      });
    const socket = getSocket();
    socket?.emit('join_room', { conversationId });

    chatApi
      .messages(conversationId, 50)
      .then(({ messages: history, nextCursor }) => {
        if (!alive) return;
        setMessages(conversationId, history as Message[]);
        setCursor(nextCursor);
        setHasMore(Boolean(nextCursor));
        const selfId = useAuthStore.getState().user?.userId;
        // Receipt for the newest message from anyone else (covers the case
        // where the last message is our own or the AI's — those need no ack,
        // but earlier unseen messages still do).
        const latestOther = [...(history as Message[])]
          .reverse()
          .find((m) => m.senderId !== selfId);
        if (latestOther) {
          socket?.emit('message_read', { conversationId, messageId: latestOther.id });
        }
        // Re-derive ✓✓ from server cursors so reads survive reloads and
        // offline periods (live events only reach members inside the room).
        chatApi
          .readCursors(conversationId)
          .then((cursors) => {
            if (!alive || !selfId || !cursors) return;
            const others = useChatStore
              .getState()
              .conversations.find((c) => c.id === conversationId)?.participants;
            applyReadCursors(conversationId, cursors, selfId, others);
          })
          .catch(() => {
            /* receipts stay live-only */
          });
      })
      .catch(() => alive && setMessages(conversationId, []))
      .finally(() => alive && setLoading(false));

    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const armExpiry = (uid: string) => {
      const prev = typingTimers.get(uid);
      if (prev) clearTimeout(prev);
      // Safety net: a missed `typing_stop` (disconnect, AI error) must never
      // leave a permanent "X typing…" — force-clear after 8s.
      typingTimers.set(
        uid,
        setTimeout(() => {
          useChatStore.getState().clearTyping(conversationId, uid);
          typingTimers.delete(uid);
        }, 8000),
      );
    };

    const onNew = (msg: Message) => {
      addMessage(conversationId, msg);
      // Whoever just sent a message is no longer typing.
      if (msg.senderId) {
        const t = typingTimers.get(msg.senderId);
        if (t) {
          clearTimeout(t);
          typingTimers.delete(msg.senderId);
        }
        clearTyping(conversationId, msg.senderId);
      }
      if (msg.senderId !== user?.userId) {
        socket?.emit('message_read', { conversationId, messageId: msg.id });
      }
    };
    const onTypingStart = (d: { userId: string; username?: string }) => {
      const uid = d?.userId;
      if (!uid || uid === useAuthStore.getState().user?.userId) return;
      setTyping(conversationId, uid, d.username || uid, true);
      armExpiry(uid);
    };
    const onTypingStop = (d: { userId: string; username?: string }) => {
      const uid = d?.userId;
      // Legacy payloads sometimes carry only a username — clear by value then.
      if (!uid && d?.username) {
        const map = useChatStore.getState().typing[conversationId] || {};
        const hit = Object.entries(map).find(([, n]) => n === d.username);
        if (hit) {
          const t = typingTimers.get(hit[0]);
          if (t) {
            clearTimeout(t);
            typingTimers.delete(hit[0]);
          }
          clearTyping(conversationId, hit[0]);
        }
        return;
      }
      if (!uid) return;
      const t = typingTimers.get(uid);
      if (t) {
        clearTimeout(t);
        typingTimers.delete(uid);
      }
      setTyping(conversationId, uid, d.username || uid, false);
    };
    const onReaction = (d: { messageSk: string; userId: string; username: string; emoji: string }) =>
      applyReaction(conversationId, d.messageSk, d.userId, d.username, d.emoji);
    // A live read upgrades ALL of my messages up to that point — not just
    // the single id (readers ack only their newest message).
    const onRead = (d: { messageId: string; userId: string }) => {
      const selfId = useAuthStore.getState().user?.userId;
      if (!selfId) return;
      const others = useChatStore
        .getState()
        .conversations.find((c) => c.id === conversationId)?.participants;
      applyRemoteRead(conversationId, d.userId, d.messageId, selfId, others);
    };

    socket?.on('new_message', onNew);
    socket?.on('user_typing_start', onTypingStart);
    socket?.on('user_typing_stop', onTypingStop);
    socket?.on('reaction_updated', onReaction);
    socket?.on('message_status_update', onRead);
    return () => {
      alive = false;
      socket?.emit('leave_room', { conversationId });
      socket?.off('new_message', onNew);
      socket?.off('user_typing_start', onTypingStart);
      socket?.off('user_typing_stop', onTypingStop);
      socket?.off('reaction_updated', onReaction);
      socket?.off('message_status_update', onRead);
      for (const t of Array.from(typingTimers.values())) clearTimeout(t);
      typingTimers.clear();
      useChatStore.getState().clearTyping(conversationId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, typingNames.length]);

  const loadOlder = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { messages: older, nextCursor } = await chatApi.messages(conversationId, 50, cursor);
      prependOlder(conversationId, older as Message[]);
      setCursor(nextCursor);
      setHasMore(Boolean(nextCursor));
    } catch {
      /* keep existing history */
    } finally {
      setLoadingMore(false);
    }
  };

  const send = async (text: string, opts?: { mediaUrl?: string; mediaType?: 'image' | 'video' | 'audio' | 'file' }) => {
    if (!user) return;
    const socket = getSocket();
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const base = {
      id: tempId,
      conversationId,
      senderId: user.userId,
      senderName: user.name || user.username,
      senderAvatar: user.avatarUrl,
      mediaUrl: opts?.mediaUrl,
      replyTo: replyTo ? { id: replyTo.id, senderName: replyTo.senderName, content: replyTo.content } : undefined,
      reactions: [],
      status: 'sent' as const,
      createdAt: new Date().toISOString(),
    };
    // Ack swaps the optimistic tempId for the server UUID (spec §8).
    const ack = (optimistic: Message) => (res: { messageId?: string; createdAt?: string } | undefined) => {
      if (res?.messageId) {
        replaceTemp(conversationId, tempId, {
          ...optimistic,
          id: res.messageId,
          createdAt: res.createdAt || optimistic.createdAt,
          status: 'sent',
        });
      }
    };
    const isAiPrompt = !opts?.mediaUrl && /@nexus|@ai/i.test(text);
    // Mandatory E2EE: all text is encrypted client-side before emit.
    // Exceptions (plaintext by necessity): media payloads (S3 URLs) and
    // @nexus/@ai prompts (the AI engine cannot read ciphertext).
    if (!opts?.mediaUrl && !isAiPrompt) {
      try {
        const enc = await encryptText(conversationId, text);
        const optimistic: Message = {
          ...base, content: text, mediaType: 'text',
          isEncrypted: true, nonce: enc.nonce, encVersion: enc.encVersion,
        };
        addMessage(conversationId, optimistic);
        socket?.emit('send_message', {
          conversationId, senderName: base.senderName, senderAvatar: user.avatarUrl, content: enc.ciphertext, mediaType: 'text',
          tempId, replyTo: base.replyTo, isEncrypted: true, nonce: enc.nonce, encVersion: enc.encVersion,
        }, ack(optimistic));
      } catch {
        setNotice('Encryption failed — message not sent.');
        setTimeout(() => setNotice(null), 3000);
        return;
      }
    } else {
      const optimistic: Message = { ...base, content: text, mediaType: opts?.mediaType || 'text' };
      addMessage(conversationId, optimistic);
      socket?.emit('send_message', {
        conversationId, senderName: base.senderName, senderAvatar: user.avatarUrl, content: text,
        tempId, mediaType: opts?.mediaType || 'text', mediaUrl: opts?.mediaUrl, replyTo: base.replyTo,
      }, ack(optimistic));
    }
    setReplyTo(null);
  };

  const react = (m: Message, emoji: string) => {
    getSocket()?.emit('add_reaction', {
      conversationId,
      messageSk: `MSG#${m.createdAt}#${m.id}`,
      username: user?.name || user?.username || 'User',
      emoji,
    });
  };

  // ---- WhatsApp-style menu actions ----
  const copyText = async (m: Message) => {
    try {
      await navigator.clipboard.writeText(m.content || m.mediaUrl || '');
      setNotice('Copied to clipboard.');
    } catch {
      setNotice('Copy failed.');
    }
    setTimeout(() => setNotice(null), 2500);
  };

  const toggleStar = (m: Message) => {
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(m.id)) next.delete(m.id);
      else next.add(m.id);
      persistSet(`nexus_star_${conversationId}`, next);
      return next;
    });
    setNotice(starredIds.has(m.id) ? 'Removed from starred.' : 'Starred — find it under pinned/starred.');
    setTimeout(() => setNotice(null), 2500);
  };

  const togglePin = (m: Message) => {
    setPinnedIds((prev) => {
      const next = prev.includes(m.id) ? prev.filter((id) => id !== m.id) : [m.id, ...prev].slice(0, 5);
      try {
        localStorage.setItem(`nexus_pin_${conversationId}`, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const askNexusAI = (m: Message) => {
    const q = (m.content || '').slice(0, 500) || 'Summarize this conversation';
    send(`@nexus ${q}`);
    setNotice('Asked Nexus AI…');
    setTimeout(() => setNotice(null), 2500);
  };

  const forwardTo = async (targetId: string) => {
    const m = forwardMsg;
    if (!m || !user) return;
    const socket = getSocket();
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    // Forwarded text is re-encrypted for the target room (E2EE mandatory).
    // Media forwards keep the S3 URL with a plaintext caption, as in send().
    let content = m.content;
    let isEncrypted = false;
    let nonce: string | undefined;
    let encVersion: number | undefined;
    if (!m.mediaUrl && m.mediaType === 'text') {
      try {
        const enc = await encryptText(targetId, m.content);
        content = enc.ciphertext;
        nonce = enc.nonce;
        encVersion = enc.encVersion;
        isEncrypted = true;
      } catch {
        setNotice('Encryption failed — message not forwarded.');
        setTimeout(() => setNotice(null), 3000);
        return;
      }
    }
    const optimistic: Message = {
      id: tempId,
      conversationId: targetId,
      senderId: user.userId,
      senderName: user.name || user.username,
      senderAvatar: user.avatarUrl,
      content: m.content,
      mediaType: m.mediaType,
      mediaUrl: m.mediaUrl,
      reactions: [],
      status: 'sent',
      isEncrypted,
      nonce,
      encVersion,
      createdAt: new Date().toISOString(),
    };
    addMessage(targetId, optimistic);
    socket?.emit(
      'send_message',
      {
        conversationId: targetId,
        senderName: optimistic.senderName,
        senderAvatar: user.avatarUrl,
        content,
        tempId,
        mediaType: m.mediaType,
        mediaUrl: m.mediaUrl,
        isEncrypted,
        nonce,
        encVersion,
      },
      (res: { messageId?: string; createdAt?: string } | undefined) => {
        if (res?.messageId) {
          replaceTemp(targetId, tempId, {
            ...optimistic,
            id: res.messageId,
            createdAt: res.createdAt || optimistic.createdAt,
          });
        }
      },
    );
    setForwardMsg(null);
    setNotice('Forwarded');
    setTimeout(() => setNotice(null), 2500);
  };

  const saveAs = async (m: Message) => {
    try {
      if (m.mediaUrl) {
        const a = document.createElement('a');
        a.href = m.mediaUrl;
        a.download = m.mediaUrl.split('/').pop() || 'attachment';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        const blob = new Blob([`${m.senderName} · ${m.createdAt}\n\n${m.content}`], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nexus-message-${m.id.slice(0, 8)}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      setNotice('Saved');
    } catch {
      setNotice('Save failed.');
    }
    setTimeout(() => setNotice(null), 2500);
  };

  const shareMsg = async (m: Message) => {
    const text = m.content || m.mediaUrl || '';
    try {
      if (navigator.share) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        setNotice('Copied — ready to share.');
        setTimeout(() => setNotice(null), 2500);
      }
    } catch {
      /* dismissed */
    }
  };

  const deleteMsg = (m: Message) => {
    removeMessage(conversationId, m.id);
    setSelectMode(false);
    setSelectedIds(new Set());
    setNotice('Message deleted (this device).');
    setTimeout(() => setNotice(null), 2500);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copySelected = async () => {
    const texts = visible
      .filter((m) => selectedIds.has(m.id))
      .map((m) => `${m.senderName}: ${m.content}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(texts);
      setNotice(`Copied ${selectedIds.size} message(s).`);
    } catch {
      setNotice('Copy failed.');
    }
    setTimeout(() => setNotice(null), 2500);
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const summarize = async () => {
    setSummarizing(true);
    try {
      const s = await aiApi.summarize(messages.filter((m) => !m.content.startsWith('🔒')).map((m) => ({ sender: m.senderName, content: m.content })));
      setSummary(s);
    } catch {
      setSummary('Summarization failed.');
    } finally {
      setSummarizing(false);
    }
  };

  const translate = async (m: Message) => {
    try {
      const t = await aiApi.translate(m.content, user?.preferredLanguage || 'en');
      setNotice(`Translation: ${t}`);
      setTimeout(() => setNotice(null), 5000);
    } catch {
      /* translate unavailable */
    }
  };

  const handleTranscribe = async (msg: Message) => {
    if (!msg.mediaUrl || transcribingId) return;
    setTranscribingId(msg.id);
    try {
      const res = await aiApi.transcribe(msg.mediaUrl);
      setTranscriptions((prev) => ({ ...prev, [msg.id]: res || 'Transcription ready.' }));
    } catch {
      setTranscriptions((prev) => ({ ...prev, [msg.id]: 'Transcription service unavailable.' }));
    } finally {
      setTranscribingId(null);
    }
  };

  const shareKey = async () => {
    const key = exportConversationKey(conversationId);
    if (!key) return;
    try {
      await navigator.clipboard.writeText(`nexus://e2ee/${conversationId}#${key}`);
      setNotice('Decryption key copied — share it securely.');
    } catch {
      setNotice(`Key: ${key}`);
    }
    setTimeout(() => setNotice(null), 4000);
  };

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-whatsapp-dark">
      <div className="relative flex items-center gap-3 px-4 py-2.5 bg-whatsapp-panel border-b border-white/10">
        <button
          onClick={() => setPeerOpen(true)}
          aria-label="View profile"
          title="View profile"
          className="flex items-center gap-3 flex-1 min-w-0 text-left rounded-lg hover:bg-white/5 p-1 -m-1 transition"
        >
          <Avatar src={convAvatar} name={title} size="sm" />
          <span className="flex-1 min-w-0">
            <b className="block truncate text-sm">{title}</b>
            {typingNames.length > 0 ? (
              <span className="flex items-center text-[11px] text-emerald-300 truncate">
                <span className="truncate">
                  {typingNames.slice(0, 2).join(', ')}
                  {typingNames.length > 2 ? ` +${typingNames.length - 2}` : ''} typing
                </span>
                <TypingDots />
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] text-whatsapp-checkGray truncate">
              <LockIcon size={10} /> End-to-end encrypted
            </span>
            )}
          </span>
        </button>
        {/* WhatsApp-style ⋮ overflow — all header actions live in here */}
        <button
          aria-label="Chat options"
          title="Chat options"
          onClick={() => {
            setMenu(null);
            setPickerForMessage(null);
            setHeaderMenu((v) => !v);
          }}
          className={`p-2 rounded-full transition ${headerMenu ? 'bg-white/15 text-white' : 'text-whatsapp-checkGray hover:text-white hover:bg-white/10'}`}
        >
          <DotsIcon />
        </button>
        {headerMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setHeaderMenu(false)} />
            <div className="absolute right-2 top-full mt-1 z-50 w-56 rounded-2xl overflow-hidden bg-whatsapp-panel/95 border border-white/10 shadow-2xl backdrop-blur text-[13px] py-1">
              {([
                { k: 'audio', icon: <PhoneIcon />, label: 'Voice call' },
                { k: 'video', icon: <VideoIcon />, label: 'Video call' },
                { k: 'search', icon: <SearchIcon />, label: searchOpen ? 'Hide search' : 'Search in chat' },
                { k: 'media', icon: <ImageIcon />, label: galleryOpen ? 'Hide shared media' : 'Shared media' },
                { k: 'key', icon: <KeyIcon />, label: 'Share key' },
              ] as const).map((item) => (
                <button
                  key={item.k}
                  onClick={() => {
                    const k = item.k;
                    setHeaderMenu(false);
                    if (k === 'audio') onCall('audio');
                    else if (k === 'video') onCall('video');
                    else if (k === 'search') { setSearchOpen((v) => !v); setGalleryOpen(false); }
                    else if (k === 'media') { setGalleryOpen((v) => !v); setSearchOpen(false); }
                    else if (k === 'key') shareKey();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-white/90 hover:bg-white/10 transition"
                >
                  <span className="w-5 flex items-center justify-center opacity-80 shrink-0">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-1.5 bg-whatsapp-panel/60 border-b border-white/5 text-xs">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="flat" onPress={summarize} isLoading={summarizing}><span className="flex items-center gap-1"><SparkleIcon size={12} /> Summarize</span></Button>
          {notice && <span className="text-[11px] text-warning truncate">{notice}</span>}
        </div>
        <span className="text-[10px] text-white/50 hidden sm:flex items-center gap-1">
          <InfoIcon size={10} /> Mention <span className="text-cyan-400 font-mono font-bold">@nexus</span> or <span className="text-cyan-400 font-mono font-bold">@ai</span> for AI assistant
        </span>
      </div>
      {summary && (
        <div className="m-3 rounded-2xl border border-secondary/40 bg-gradient-to-br from-whatsapp-composer to-whatsapp-panel shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-secondary/25 bg-secondary/10">
            <span aria-hidden className="flex items-center text-secondary"><SparkleIcon size={14} /></span>
            <b className="text-[13px] font-semibold text-secondary">AI summary</b>
            <span className="flex-1" />
            <button
              aria-label="Dismiss summary"
              onClick={() => setSummary(null)}
              className="w-6 h-6 rounded-full text-whatsapp-checkGray hover:text-white hover:bg-white/10 flex items-center justify-center transition"
            >
              <CloseIcon size={12} />
            </button>
          </div>
          <div className="px-4 py-3 max-h-64 overflow-y-auto">
            <SummaryBody text={summary} />
          </div>
        </div>
      )}

      <div
        className="flex-1 overflow-y-auto p-4 space-y-2"
        onScroll={closeMenu}
        style={{
          backgroundImage:
            'linear-gradient(rgba(20, 9, 43, 0.88), rgba(20, 9, 43, 0.88)), url(/assets/y10n_fpni_211014.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {loading && <div className="flex justify-center py-10"><Spinner /></div>}
        {!loading && hasMore && !galleryOpen && (
          <div className="flex justify-center">
            <Button size="sm" variant="flat" onPress={loadOlder} isLoading={loadingMore}>
              Load older messages
            </Button>
          </div>
        )}
        {searchOpen && (
          <div className="sticky top-0 z-10 bg-whatsapp-dark/95 pb-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search in this conversation…"
              className="w-full text-sm bg-whatsapp-composer rounded-xl px-3 py-2 outline-none border border-white/10"
            />
            {query.trim() && <p className="text-[11px] text-whatsapp-checkGray mt-1">{visible.length} match{visible.length === 1 ? '' : 'es'}</p>}
          </div>
        )}
        {galleryOpen ? (
          <div className="grid grid-cols-3 gap-2">
            {gallery.map((m) => (
              <a key={m.id} href={m.mediaUrl} target="_blank" rel="noreferrer" title={`${m.senderName}: ${m.content}`} className="aspect-square rounded-lg overflow-hidden bg-whatsapp-composer flex items-center justify-center">
                {m.mediaType === 'image' ? (
                  <img src={m.mediaUrl} alt="" className="w-full h-full object-cover" />
                ) : m.mediaType === 'video' ? (
                  <span className="text-white/70 flex items-center"><VideoIcon size={26} /></span>
                ) : m.mediaType === 'audio' ? (
                  <span className="text-white/70 flex items-center"><MicIcon size={26} /></span>
                ) : (
                  <span className="text-white/70 flex items-center"><DocIcon size={26} /></span>
                )}
              </a>
            ))}
            {gallery.length === 0 && <p className="col-span-3 text-center text-xs text-whatsapp-checkGray py-10">No shared media yet.</p>}
          </div>
        ) : (
          !loading && visible.map((m) => {
            const me = m.senderId === user?.userId;
            const isAi = m.senderId === 'nexus-ai';
            const grouped = groupReactions(m.reactions, user?.userId);
            const isImage =
              Boolean(m.mediaUrl) &&
              (m.mediaType === 'image' ||
                /\.(jpe?g|png|gif|webp|svg|bmp)(\?.*)?$/i.test(m.mediaUrl || '') ||
                (m.mediaUrl!.includes('/api/media/') &&
                  m.mediaType !== 'video' &&
                  m.mediaType !== 'audio' &&
                  m.mediaType !== 'file'));

            // Album tiles render as one grid at the run start.
            if (albumIndex.members.has(m.id) && !albumIndex.starts.has(m.id)) return null;
            const album = albumIndex.starts.get(m.id);
            if (album) {
              const last = album.msgs[album.msgs.length - 1];
              const allSel = album.msgs.every((t) => selectedIds.has(t.id));
              return (
                <AlbumView
                  album={album}
                  me={me}
                  time={new Date(last.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  status={last.status}
                  encrypted={album.msgs.some((t) => t.isEncrypted)}
                  starred={album.msgs.some((t) => starredIds.has(t.id))}
                  pinned={album.msgs.some((t) => pinnedIds.includes(t.id))}
                  selectMode={selectMode}
                  allSelected={allSel}
                  onToggleSelect={() => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (allSel) album.msgs.forEach((t) => next.delete(t.id));
                      else album.msgs.forEach((t) => next.add(t.id));
                      return next;
                    });
                  }}
                  onTileContext={onBubbleContext}
                  onTileChevron={onChevronClick}
                  onOpen={openLightbox}
                  onReact={react}
                  currentUserId={user?.userId}
                />
              );
            }

            return (
              <div key={m.id} id={`msg-${m.id}`} className={`group flex items-end gap-2 mb-2 ${me ? 'justify-end' : 'justify-start'}`}>
                {selectMode && (
                  <button
                    onClick={() => toggleSelect(m.id)}
                    aria-label="Select message"
                    className={`shrink-0 w-5 h-5 mb-2 rounded-md border flex items-center justify-center ${
                      selectedIds.has(m.id)
                        ? 'bg-secondary border-secondary text-white'
                        : 'border-white/30 text-transparent'
                    }`}
                  >
                    <CheckIcon size={12} />
                  </button>
                )}                <div
                  onContextMenu={(e) => onBubbleContext(e, m)}
                  className={`relative max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                    me
                      ? 'bg-whatsapp-outgoing rounded-br-sm'
                      : isAi
                      ? 'bg-gradient-to-br from-[#0c1a24] to-[#1b1226] border border-cyan-500/40 text-cyan-50 rounded-bl-sm shadow-md'
                      : 'bg-whatsapp-composer rounded-bl-sm'
                  }`}
                >
                  {/* WhatsApp-style arrow — hidden until hover, click expands the menu */}
                  <button
                    aria-label="Message options"
                    onClick={(e) => onChevronClick(e, m)}
                    className={`absolute top-0 right-0 z-10 pl-6 pr-1.5 py-0.5 rounded-bl-xl rounded-tr-2xl text-white/80 leading-none transition-opacity bg-gradient-to-l from-black/60 to-transparent ${
                      menu?.msg.id === m.id || pickerForMessage === m.id
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100'
                    } hover:text-white flex items-center`}
                  >
                    <ChevronDownIcon size={14} />
                  </button>
                  {(starredIds.has(m.id) || pinnedIds.includes(m.id)) && (
                    <div className="flex items-center gap-1.5 mb-1 text-[10px] text-amber-300/90">
                      {starredIds.has(m.id) && <span title="Starred" className="flex items-center gap-0.5"><StarIcon size={10} /> starred</span>}
                      {pinnedIds.includes(m.id) && <span title="Pinned" className="flex items-center gap-0.5"><PinIcon size={10} /> pinned</span>}
                    </div>
                  )}
                  {isAi && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-mono">BOT</span>
                    </div>
                  )}
                  {m.replyTo && (
                    <p className="text-[11px] opacity-70 border-l-2 border-secondary pl-2 mb-1 truncate">
                      {m.replyTo.content}
                    </p>
                  )}

                  {/* Inline Image Rendering */}
                  {isImage && (
                    <div className="relative mb-1.5 rounded-xl overflow-hidden bg-black/20 group/img">
                      <img
                        src={m.mediaUrl}
                        alt={m.content || 'Image'}
                        className="rounded-xl max-h-80 w-auto max-w-full object-contain cursor-pointer hover:brightness-105 transition shadow-sm"
                        onClick={() => openLightbox([m.mediaUrl!], 0)}
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openLightbox([m.mediaUrl!], 0);
                        }}
                        className="absolute bottom-2 right-2 bg-black/70 hover:bg-black/90 text-white text-[10px] px-2 py-1 rounded-md opacity-0 group-hover/img:opacity-100 transition backdrop-blur-sm flex items-center gap-1"
                        title="Click to view full image"
                      >
                        <SearchIcon size={10} /> Full view
                      </button>
                    </div>
                  )}

                  {m.mediaUrl && m.mediaType === 'video' && (
                    <video src={m.mediaUrl} controls className="rounded-lg mb-1 max-h-64" />
                  )}

                  {m.mediaUrl && m.mediaType === 'audio' && (
                    <div className="mb-1">
                      <AudioMessage src={m.mediaUrl} seed={m.id} />
                      <div className="mt-1 flex flex-col gap-1">
                        <button
                          className="text-[10px] text-cyan-400/90 hover:text-cyan-300 hover:underline self-start flex items-center gap-1 font-medium"
                          onClick={() => handleTranscribe(m)}
                          disabled={transcribingId === m.id}
                        >
                          {transcribingId === m.id ? (
                            'Transcribing…'
                          ) : (
                            <>
                              <MicIcon size={10} /> Transcribe
                            </>
                          )}
                        </button>
                        {transcriptions[m.id] && (
                          <p className="text-[11px] text-cyan-200/90 italic bg-black/40 border-l-2 border-cyan-400 pl-2 py-1 rounded">
                            "{transcriptions[m.id]}"
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {m.mediaUrl && m.mediaType === 'file' && (
                    <a
                      href={m.mediaUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-xs flex items-center gap-1 my-1 text-secondary"
                    >
                      <DocIcon size={12} /> Open attachment
                    </a>
                  )}

                  {/* Text content (hide placeholder file name if image rendered cleanly) */}
                  {m.content &&
                    (!isImage ||
                      (m.content !== `📎 ${m.mediaUrl?.split('/').pop()}` && m.content !== '📎 image')) && (
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  )}

                  <div className="flex items-center justify-end gap-1 mt-1">
                    {m.isEncrypted && <span title="Encrypted" className="flex items-center opacity-70"><LockIcon size={10} /></span>}
                    <span className="text-[10px] opacity-60">
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {me && (
                      <span className={`text-[10px] ${m.status === 'read' ? 'text-whatsapp-checkBlue' : 'opacity-60'}`}>
                        {m.status === 'read' ? '✓✓' : '✓'}
                      </span>
                    )}
                  </div>

                  {/* Aggregated reaction badges */}
                  {grouped.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5 items-center">
                      {grouped.map((g) => (
                        <button
                          key={g.emoji}
                          onClick={() => react(m, g.emoji)}
                          className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-all ${
                            g.hasReacted
                              ? 'bg-secondary/20 border-secondary text-secondary font-medium'
                              : 'bg-white/10 border-white/15 hover:bg-white/20 text-white/90'
                          }`}
                          title={`${g.users.join(', ')} reacted with ${g.emoji}`}
                        >
                          <span>{g.emoji}</span>
                          <span className="text-[10px]">{g.count}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Full emoji picker (opened from the menu's ＋ button), anchored to the bubble */}
                  {pickerForMessage === m.id && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setPickerForMessage(null)} />
                      <div
                        className={`absolute z-50 bottom-full mb-2 ${
                          me ? 'right-0' : 'left-0'
                        } shadow-2xl rounded-2xl overflow-hidden border border-white/20 bg-whatsapp-panel`}
                      >
                        <div className="relative">
                          <button
                            onClick={() => setPickerForMessage(null)}
                            aria-label="Close emoji picker"
                            className="absolute top-2 right-2 z-50 bg-black/60 hover:bg-black/90 text-white rounded-full w-6 h-6 flex items-center justify-center"
                          >
                            <CloseIcon size={12} />
                          </button>
                          <EmojiPicker
                            theme={Theme.DARK}
                            lazyLoadEmojis
                            width={320}
                            height={380}
                            onEmojiClick={(emojiData) => {
                              react(m, emojiData.emoji);
                              setPickerForMessage(null);
                            }}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
        {/* Live typing bubble — animated dots while anyone else types */}
        {typingNames.length > 0 && !galleryOpen && (
          <div className="flex items-end gap-2 mb-2 justify-start">
            <div className="relative max-w-[78%] rounded-2xl rounded-bl-sm px-4 py-3 text-sm shadow-sm bg-whatsapp-composer">
              <p className="text-[11px] font-bold text-secondary mb-1">{typingNames[0]}</p>
              <span className="inline-flex items-center gap-1.5" aria-label={`${typingNames[0]} is typing`}>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-2 h-2 rounded-full bg-white/70 animate-typing-bounce"
                    style={{ animationDelay: `${i * 0.18}s` }}
                  />
                ))}
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Pinned strip (WhatsApp-style) */}
      {pinnedIds.length > 0 && !galleryOpen && (
        <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-1.5 bg-whatsapp-composer/80 border border-white/10 rounded-xl text-xs">
          <span className="flex items-center text-amber-300/90"><PinIcon size={12} /></span>
          <span className="flex-1 truncate text-white/80">
            {pinnedIds.length} pinned: {(messages.find((x) => x.id === pinnedIds[0])?.content || 'message').slice(0, 80)}
          </span>
          <button
            className="text-whatsapp-checkGray hover:text-white"
            onClick={() => {
              const el = document.getElementById(`msg-${pinnedIds[0]}`);
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
          >
            Jump
          </button>
          <button className="text-whatsapp-checkGray hover:text-white flex items-center" aria-label="Dismiss pinned" onClick={() => {
            setPinnedIds([]);
            try { localStorage.removeItem(`nexus_pin_${conversationId}`); } catch { /* ignore */ }
          }}>
            <CloseIcon size={12} />
          </button>
        </div>
      )}

      {/* Select-mode action bar */}
      {selectMode && (
        <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 bg-whatsapp-panel border border-white/10 rounded-xl text-xs">
          <b>{selectedIds.size} selected</b>
          <span className="flex-1" />
          <button className="hover:underline" onClick={copySelected} disabled={selectedIds.size === 0}>Copy</button>
          <button className="hover:underline" onClick={() => {
            const first = visible.find((m) => selectedIds.has(m.id));
            if (first) { setForwardMsg(first); }
          }} disabled={selectedIds.size === 0}>Forward</button>
          <button className="hover:underline text-red-400" onClick={() => {
            visible.filter((m) => selectedIds.has(m.id)).forEach((m) => removeMessage(conversationId, m.id));
            setSelectMode(false);
            setSelectedIds(new Set());
          }} disabled={selectedIds.size === 0}>Delete</button>
          <button className="text-whatsapp-checkGray hover:text-white" onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}>Cancel</button>
        </div>
      )}

      {/* WhatsApp-style floating context menu + quick reactions */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
          <div
            ref={menuRef}
            className="fixed z-50 w-[232px] select-none"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Quick-reaction strip */}
            <div className="flex items-center justify-between px-2 py-1.5 mb-1 rounded-full bg-whatsapp-panel/95 border border-white/10 shadow-2xl backdrop-blur">
              {['👍', '❤️', '😂', '😮', '😢', '🙏'].map((e) => (
                <button
                  key={e}
                  className="text-xl hover:scale-125 transition-transform px-0.5"
                  onClick={() => { react(menu.msg, e); closeMenu(); }}
                  title={`React ${e}`}
                >
                  {e}
                </button>
              ))}
              <button
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
                onClick={() => { const id = menu.msg.id; closeMenu(); setPickerForMessage(id); }}
                title="More emojis"
              >
                <PlusIcon />
              </button>
            </div>
            {/* Menu list */}
            <div className="rounded-2xl overflow-hidden bg-whatsapp-panel/95 border border-white/10 shadow-2xl backdrop-blur text-[13px]">
              {([
                { k: 'info', icon: <InfoIcon />, label: 'Message info' },
                { k: 'reply', icon: <ReplyIcon />, label: 'Reply' },
                { k: 'copy', icon: <CopyIcon />, label: 'Copy' },
                { k: 'translate', icon: <TranslateIcon />, label: 'Translate' },
                { k: 'forward', icon: <ForwardIcon />, label: 'Forward' },
                { k: 'pin', icon: <PinIcon />, label: pinnedIds.includes(menu.msg.id) ? 'Unpin' : 'Pin' },
                { k: 'nexus', icon: <AlienIcon />, label: 'Ask Nexus AI' },
                { k: 'star', icon: <StarIcon />, label: starredIds.has(menu.msg.id) ? 'Unstar' : 'Star' },
                { k: 'select', icon: <SelectIcon />, label: 'Select' },
                { k: 'save', icon: <SaveIcon />, label: 'Save as' },
                { k: 'share', icon: <ShareIcon />, label: 'Share' },
                ...(menu.msg.mediaUrl ? [{ k: 'open', icon: <OpenIcon />, label: 'Open with' }] : []),
                { k: 'delete', icon: <TrashIcon />, label: 'Delete' },
              ]).map((item) => (
                <button
                  key={item.k}
                  onClick={() => {
                    const m = menu.msg;
                    const k = item.k;
                    closeMenu();
                    if (k === 'info') setInfoMsg(m);
                    else if (k === 'reply') setReplyTo(m);
                    else if (k === 'copy') copyText(m);
                    else if (k === 'translate') translate(m);
                    else if (k === 'forward') setForwardMsg(m);
                    else if (k === 'pin') togglePin(m);
                    else if (k === 'nexus') askNexusAI(m);
                    else if (k === 'star') toggleStar(m);
                    else if (k === 'select') { setSelectMode(true); setSelectedIds(new Set([m.id])); }
                    else if (k === 'save') saveAs(m);
                    else if (k === 'share') shareMsg(m);
                    else if (k === 'open' && m.mediaUrl) window.open(m.mediaUrl, '_blank', 'noopener');
                    else if (k === 'delete') deleteMsg(m);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 transition ${
                    item.k === 'delete' ? 'text-red-400' : item.k === 'nexus' ? 'text-cyan-300 font-semibold' : 'text-white/90'
                  }`}
                >
                  <span className="w-5 flex items-center justify-center opacity-80 shrink-0">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Message info modal */}
      {infoMsg && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setInfoMsg(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-whatsapp-panel border border-white/10 p-4 text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <b>Message info</b>
              <button aria-label="Close message info" className="text-whatsapp-checkGray hover:text-white flex items-center" onClick={() => setInfoMsg(null)}><CloseIcon size={14} /></button>
            </div>
            <p className="text-xs text-whatsapp-checkGray">From</p>
            <p className="mb-2">{infoMsg.senderName}</p>
            <p className="text-xs text-whatsapp-checkGray">Sent at</p>
            <p className="mb-2">{new Date(infoMsg.createdAt).toLocaleString()}</p>
            <p className="text-xs text-whatsapp-checkGray">Status</p>
            <p className="mb-2">{infoMsg.status === 'read' ? '✓✓ Read' : infoMsg.status === 'delivered' ? '✓✓ Delivered' : '✓ Sent'}</p>
            <p className="text-xs text-whatsapp-checkGray">Security</p>
            <p className="mb-2 flex items-center gap-1">{infoMsg.isEncrypted ? (<><LockIcon size={12} /> End-to-end encrypted</>) : 'Plaintext (AI-visible)'}</p>
            <p className="text-xs text-whatsapp-checkGray">Content</p>
            <p className="whitespace-pre-wrap break-words bg-black/30 rounded-lg p-2 max-h-40 overflow-y-auto">{infoMsg.content || '(media)'}</p>
          </div>
        </div>
      )}

      {/* Forward picker */}
      {forwardMsg && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setForwardMsg(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-whatsapp-panel border border-white/10 p-4 text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <b>Forward to…</b>
              <button aria-label="Close forward picker" className="text-whatsapp-checkGray hover:text-white flex items-center" onClick={() => setForwardMsg(null)}><CloseIcon size={14} /></button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {conversations.filter((c) => c.id !== conversationId).map((c) => (
                <button
                  key={c.id}
                  onClick={() => forwardTo(c.id)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 truncate"
                >
                  {c.title}
                </button>
              ))}
              {conversations.filter((c) => c.id !== conversationId).length === 0 && (
                <p className="text-xs text-whatsapp-checkGray py-6 text-center">No other conversations yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox / Zoom Image Modal (album-aware: arrows navigate) */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative flex items-center">
              {lightbox.urls.length > 1 && (
                <button
                  onClick={() => setLightbox((lb) => (lb && lb.i > 0 ? { ...lb, i: lb.i - 1 } : lb))}
                  disabled={lightbox.i === 0}
                  aria-label="Previous photo"
                  className="absolute left-2 z-10 w-9 h-9 rounded-full bg-black/60 hover:bg-black/90 text-white disabled:opacity-30 flex items-center justify-center"
                >
                  <ChevronLeftIcon size={18} />
                </button>
              )}
              <img
                key={lightbox.urls[lightbox.i]}
                src={lightbox.urls[lightbox.i]}
                alt=""
                className="max-w-full max-h-[80vh] rounded-xl object-contain shadow-2xl"
              />
              {lightbox.urls.length > 1 && (
                <button
                  onClick={() => setLightbox((lb) => (lb && lb.i < lb.urls.length - 1 ? { ...lb, i: lb.i + 1 } : lb))}
                  disabled={lightbox.i === lightbox.urls.length - 1}
                  aria-label="Next photo"
                  className="absolute right-2 z-10 w-9 h-9 rounded-full bg-black/60 hover:bg-black/90 text-white disabled:opacity-30 flex items-center justify-center"
                >
                  <ChevronRightIcon size={18} />
                </button>
              )}
            </div>
            {lightbox.urls.length > 1 && (
              <p className="mt-2 text-xs text-white/70">
                {lightbox.i + 1} / {lightbox.urls.length}
              </p>
            )}
            <div className="mt-3 flex items-center gap-3">
              <a
                href={lightbox.urls[lightbox.i]}
                target="_blank"
                rel="noreferrer"
                className="text-xs bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition"
              >
                <SaveIcon size={12} /> Open in new tab
              </a>
              <button
                onClick={() => setLightbox(null)}
                aria-label="Close viewer"
                className="text-xs bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg transition flex items-center gap-1.5"
              >
                <CloseIcon size={12} /> Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Peer / group profile — shows the other user's photo, name and About status */}
      {peerOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPeerOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-whatsapp-panel border border-white/10 p-6 text-sm text-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <b>{conv?.type === 'group' ? 'Group info' : 'Contact info'}</b>
              <button aria-label="Close contact info" className="text-whatsapp-checkGray hover:text-white flex items-center" onClick={() => setPeerOpen(false)}><CloseIcon size={14} /></button>
            </div>
            <div className="flex justify-center mb-3">
              <Avatar src={convAvatar} name={title} size="lg" className="w-24 h-24 text-2xl" />
            </div>
            <p className="font-semibold text-base truncate">{title}</p>
            {conv?.type === 'direct' && peer ? (
              <>
                {(peers[peer.userId]?.username || peer.username) && (
                  <p className="text-xs text-whatsapp-checkGray mt-0.5">
                    @{(peers[peer.userId]?.username || peer.username || '').replace(/^@+/, '')}
                  </p>
                )}
                <p className="text-xs text-whatsapp-checkGray mt-4 text-left">About</p>
                <p className="text-sm mt-0.5 text-left bg-black/30 rounded-lg p-2.5 min-h-[40px]">
                  {peers[peer.userId]?.about || peer.about || "What's happening?"}
                </p>
              </>
            ) : (
              <>
                <p className="text-xs text-whatsapp-checkGray mt-1">
                  {(conv?.participants?.length || 0)} members · End-to-end encrypted
                </p>
                <div className="mt-4 space-y-1.5 text-left max-h-56 overflow-y-auto">
                  {(conv?.participants || []).map((id) => {
                    const p = peers[id];
                    if (!p) return null;
                    return (
                      <div key={id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg bg-black/20">
                        <Avatar src={p.avatarUrl} name={p.name || p.username} size="sm" />
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-[13px]">{p.name || p.username}</span>
                          {p.about && <span className="block truncate text-[11px] text-white/50">{p.about}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <Composer
        onSend={send}
        onTyping={(on) =>
          getSocket()?.emit(on ? 'typing_start' : 'typing_stop', {
            conversationId,
            username: user?.name || user?.username,
          })
        }
        replyPreview={replyTo?.content}
        onCancelReply={() => setReplyTo(null)}
      />
    </div>
  );
}

