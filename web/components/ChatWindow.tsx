'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, Spinner, Avatar } from '@heroui/react';
import { chatApi, aiApi } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { encryptText, decryptText, ensureConversationKey, exportConversationKey } from '@/lib/e2ee';
import { fetchAndImportKey } from '@/lib/keyx';
import { useChatStore } from '@/store/chat';
import { useAuthStore } from '@/store/auth';
import { Composer } from './Composer';
import type { Message } from '@/lib/types';

const MISSING = '🔒 Encrypted — key missing on this device';
const SPEEDS = [1, 1.5, 2] as const;

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
        className="w-9 h-9 shrink-0 rounded-full bg-white/15 text-base"
        aria-label="Play voice note"
        onClick={() => {
          const a = audioRef.current;
          if (!a) return;
          if (a.paused) a.play().catch(() => {});
          else a.pause();
        }}
      >
        ▶
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

export function ChatWindow({ conversationId, onCall }: { conversationId: string; onCall: (type: 'video' | 'audio') => void }) {
  const user = useAuthStore((s) => s.user);
  const conversations = useChatStore((s) => s.conversations);
  const raw = useChatStore((s) => s.messages[conversationId] || []);
  const typing = useChatStore((s) => s.typing[conversationId] || []);
  const replyTo = useChatStore((s) => s.replyTo);
  const { setMessages, addMessage, replaceTemp, prependOlder, applyReaction, markReadLocal, setTyping, setReplyTo } = useChatStore.getState();
  const [loading, setLoading] = useState(true);
  const [encOn, setEncOn] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const conv = conversations.find((c) => c.id === conversationId);
  const messages = useMemo(() => raw.map((m) => displayOf(conversationId, m)), [raw, conversationId]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => m.content.toLowerCase().includes(q) || m.senderName.toLowerCase().includes(q));
  }, [messages, query]);
  const gallery = useMemo(() => messages.filter((m) => m.mediaUrl), [messages]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setCursor(null);
    setHasMore(false);
    setQuery('');
    // Envelope first (auto key exchange), local key as fallback for creators.
    fetchAndImportKey(conversationId)
      .catch(() => false)
      .then(() => ensureConversationKey(conversationId).catch(() => {}));
    const socket = getSocket();
    socket?.emit('join_room', { conversationId });

    chatApi
      .messages(conversationId, 50)
      .then(({ messages: history, nextCursor }) => {
        if (!alive) return;
        setMessages(conversationId, history as Message[]);
        setCursor(nextCursor);
        setHasMore(Boolean(nextCursor));
        const last = history[history.length - 1] as Message | undefined;
        if (last && last.senderId !== user?.userId) {
          socket?.emit('message_read', { conversationId, messageId: last.id });
        }
      })
      .catch(() => alive && setMessages(conversationId, []))
      .finally(() => alive && setLoading(false));

    const onNew = (msg: Message) => {
      addMessage(conversationId, msg);
      if (msg.senderId !== user?.userId) {
        socket?.emit('message_read', { conversationId, messageId: msg.id });
      }
    };
    const onTypingStart = (d: { username: string }) => setTyping(conversationId, d.username, true);
    const onTypingStop = (d: { userId: string }) =>
      setTyping(conversationId, d.userId, false);
    const onReaction = (d: { messageSk: string; userId: string; username: string; emoji: string }) =>
      applyReaction(conversationId, d.messageSk, d.userId, d.username, d.emoji);
    const onRead = (d: { messageId: string }) => markReadLocal(conversationId, d.messageId);

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

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
    if (encOn && !opts?.mediaUrl) {
      try {
        const enc = await encryptText(conversationId, text);
        const optimistic: Message = {
          ...base, content: text, mediaType: 'text',
          isEncrypted: true, nonce: enc.nonce, encVersion: enc.encVersion,
        };
        addMessage(conversationId, optimistic);
        socket?.emit('send_message', {
          conversationId, senderName: base.senderName, content: enc.ciphertext, mediaType: 'text',
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
        conversationId, senderName: base.senderName, content: text,
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
      <div className="flex items-center gap-3 px-4 py-2.5 bg-whatsapp-panel border-b border-white/10">
        <Avatar name={conv?.title} size="sm" />
        <div className="flex-1 min-w-0">
          <b className="block truncate text-sm">{conv?.title || 'Chat'}</b>
          <span className="text-[11px] text-whatsapp-checkGray">
            {typing.length > 0 ? `${typing.join(', ')} typing…` : encOn ? '🔒 End-to-end encrypted' : 'Encryption off'}
          </span>
        </div>
        <Button size="sm" variant="flat" onPress={() => onCall('audio')}>📞</Button>
        <Button size="sm" variant="flat" onPress={() => onCall('video')}>📹</Button>
        <Button size="sm" variant="flat" onPress={() => { setSearchOpen((v) => !v); setGalleryOpen(false); }}>🔍</Button>
        <Button size="sm" variant="flat" onPress={() => { setGalleryOpen((v) => !v); setSearchOpen(false); }}>🖼️</Button>
        <Button size="sm" variant="flat" onPress={shareKey}>🔑 Share key</Button>
        <Button size="sm" variant="flat" onPress={() => setEncOn((v) => !v)}>{encOn ? 'Unlock' : 'Lock'}</Button>
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 bg-whatsapp-panel/60 border-b border-white/5">
        <Button size="sm" variant="flat" onPress={summarize} isLoading={summarizing}>✨ Summarize</Button>
        {notice && <span className="text-[11px] text-warning truncate">{notice}</span>}
      </div>
      {summary && (
        <div className="m-3 p-3 bg-whatsapp-composer border border-secondary/40 rounded-xl text-xs relative">
          <button className="absolute top-2 right-2 text-whatsapp-checkGray" onClick={() => setSummary(null)}>✕</button>
          <b className="text-secondary">AI summary</b>
          <p className="mt-1 whitespace-pre-wrap">{summary}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
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
                  <span className="text-2xl">🎬</span>
                ) : m.mediaType === 'audio' ? (
                  <span className="text-2xl">🎙️</span>
                ) : (
                  <span className="text-2xl">📎</span>
                )}
              </a>
            ))}
            {gallery.length === 0 && <p className="col-span-3 text-center text-xs text-whatsapp-checkGray py-10">No shared media yet.</p>}
          </div>
        ) : (
          !loading && visible.map((m) => {
          const me = m.senderId === user?.userId;
          return (
            <div key={m.id} className={`flex ${me ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${me ? 'bg-whatsapp-outgoing rounded-br-sm' : 'bg-whatsapp-composer rounded-bl-sm'}`}>
                {!me && <p className="text-[11px] font-bold text-secondary">{m.senderName}</p>}
                {m.replyTo && <p className="text-[11px] opacity-70 border-l-2 border-secondary pl-2 mb-1">{m.replyTo.content}</p>}
                {m.mediaUrl && m.mediaType === 'image' && <img src={m.mediaUrl} alt="" className="rounded-lg mb-1 max-h-64" />}
                {m.mediaUrl && m.mediaType === 'video' && <video src={m.mediaUrl} controls className="rounded-lg mb-1 max-h-64" />}
                {m.mediaUrl && m.mediaType === 'audio' && (
                  <div className="mb-1"><AudioMessage src={m.mediaUrl} seed={m.id} /></div>
                )}
                {m.mediaUrl && m.mediaType === 'file' && <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="underline text-xs">📎 Open attachment</a>}
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                <div className="flex items-center justify-end gap-1 mt-1">
                  {m.isEncrypted && <span title="Encrypted">🔒</span>}
                  <span className="text-[10px] opacity-60">{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {me && <span className={`text-[10px] ${m.status === 'read' ? 'text-whatsapp-checkBlue' : 'opacity-60'}`}>{m.status === 'read' ? '✓✓' : '✓'}</span>}
                </div>
                {(m.reactions?.length || 0) > 0 && (
                  <div className="flex gap-1 mt-1">{m.reactions!.map((r, i) => <Chip key={i} size="sm">{r.emoji}</Chip>)}</div>
                )}
                <div className="flex gap-1 mt-1 opacity-70">
                  {['👍', '❤️', '😂'].map((e) => (
                    <button key={e} className="text-xs hover:scale-125" onClick={() => react(m, e)}>{e}</button>
                  ))}
                  <button className="text-[11px] ml-1" onClick={() => setReplyTo(m)}>Reply</button>
                  <button className="text-[11px]" onClick={() => translate(m)}>Translate</button>
                </div>
              </div>
            </div>
          );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <Composer
        onSend={send}
        onTyping={(on) => getSocket()?.emit(on ? 'typing_start' : 'typing_stop', { conversationId, username: user?.name || user?.username })}
        replyPreview={replyTo?.content}
        onCancelReply={() => setReplyTo(null)}
      />
    </div>
  );
}
