'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Card, CardBody, Tabs, Tab, Chip } from '@heroui/react';
import { ghostApi } from '@/lib/api';
import { getSocket, connectSocket } from '@/lib/socket';
import { encryptText, decryptText, ensureConversationKey, importConversationKey, exportConversationKey } from '@/lib/e2ee';
import { parseInviteLink, withKeyHash } from '@/lib/invite';
import { useGhostStore } from '@/store/ghost';
import { useAuthStore } from '@/store/auth';
import { GhostIcon, FlameIcon, LockIcon } from './MenuIcons';
import type { GhostMessage } from '@/lib/types';

/** Burn window options (seconds). Max 5 minutes — enforced server-side too. */
const BURN_OPTIONS = [
  { s: 30, label: '30s' },
  { s: 60, label: '1m' },
  { s: 120, label: '2m' },
  { s: 300, label: '5m' },
] as const;

function formatBurn(s: number): string {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
}

export function GhostPanel({ initialToken, onBack }: { initialToken?: string; onBack: () => void }) {
  const user = useAuthStore((s) => s.user);
  const roomId = useGhostStore((s) => s.roomId);
  const messages = useGhostStore((s) => s.messages);
  const burnLeft = useGhostStore((s) => s.burnLeft);
  const { setRoom, addMessage, startBurn, tick, purge, reset } = useGhostStore.getState();
  const [tab, setTab] = useState<'chat' | 'join'>('chat');
  const [text, setText] = useState('');
  const [joinInput, setJoinInput] = useState(initialToken || '');
  const [inviteLink, setInviteLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Per-message burn window (default 30s, max 5min). Sent with every message.
  const [burnSecs, setBurnSecs] = useState<number>(30);

  // Ephemeral guest identity for unregistered visitors
  const [guestInfo] = useState(() => {
    if (typeof window === 'undefined') return { id: 'guest_init', name: 'Guest' };
    try {
      let gid = localStorage.getItem('nexus_guest_id');
      if (!gid) {
        gid = 'guest_' + Math.random().toString(36).substring(2, 10);
        localStorage.setItem('nexus_guest_id', gid);
      }
      let gname = localStorage.getItem('nexus_guest_name');
      if (!gname) {
        gname = `Guest_${gid.slice(-4)}`;
        localStorage.setItem('nexus_guest_name', gname);
      }
      return { id: gid, name: gname };
    } catch {
      const gid = 'guest_' + Math.random().toString(36).substring(2, 10);
      return { id: gid, name: `Guest_${gid.slice(-4)}` };
    }
  });

  const currentUserId = user?.userId || guestInfo.id;
  const currentUserName = user?.name || user?.username || guestInfo.name;

  // Ensure socket is connected
  useEffect(() => {
    const socket = getSocket();
    if (!socket?.connected) {
      const authState = useAuthStore.getState();
      if (authState.token) {
        connectSocket(authState.token);
      } else {
        connectSocket(`guest:${guestInfo.id}`);
      }
    }
  }, [guestInfo.id]);

  // Countdown loop
  useEffect(() => {
    const t = setInterval(() => messages.forEach((m) => tick(m.id)), 1000);
    return () => clearInterval(t);
  }, [messages, tick]);

  // Auto-burn + purge at zero
  useEffect(() => {
    Object.entries(burnLeft).forEach(([id, left]) => {
      if (left <= 0) purge(id);
    });
  }, [burnLeft, purge]);

  useEffect(() => {
    if (!initialToken) return;
    // Reattach the ephemeral #k= key (never sent to the server) if present.
    let input = initialToken;
    try {
      if (typeof window !== 'undefined' && window.location.hash) {
        input += window.location.hash;
      }
    } catch {
      /* ignore */
    }
    join(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!roomId) return;
    const socket =
      getSocket() ||
      (() => {
        const authState = useAuthStore.getState();
        return connectSocket(authState.token || `guest:${guestInfo.id}`);
      })();
    socket?.emit('join_ghost_room', { roomId, guestId: currentUserId });
    const onNew = (msg: GhostMessage) => {
      const st = useGhostStore.getState();
      // Server echoes our own send back to the room (we joined it), but send()
      // already rendered an optimistic local_* copy — swap it for the confirmed
      // server copy (matched by unique nonce) instead of showing both bubbles.
      if (msg.senderId === currentUserId && msg.nonce) {
        const pending = st.messages.find(
          (m) => m.roomId === msg.roomId && m.id.startsWith('local_') && m.nonce === msg.nonce,
        );
        if (pending) st.purge(pending.id);
      }
      const display =
        msg.isEncrypted && msg.nonce
          ? decryptText(roomId, msg.content, msg.nonce) ?? '🔒 Encrypted — key missing'
          : '🔒 Encrypted — key missing';
      addMessage({ ...msg, content: display });
      startBurn(msg.id, msg.burnDuration || 30);
      socket?.emit('ghost_message_opened', { roomId, messageId: msg.id });
    };
    const onBurn = (d: { messageId: string; duration: number }) => startBurn(d.messageId, d.duration);
    const onPurged = (d: { messageId: string }) => purge(d.messageId);
    const onDestroyed = () => {
      reset();
      setInviteLink('');
      setJoinInput('');
      setTab('join');
    };
    socket?.on('new_ghost_message', onNew);
    socket?.on('burn_started', onBurn);
    socket?.on('ghost_message_purged', onPurged);
    socket?.on('ghost_room_destroyed', onDestroyed);
    return () => {
      socket?.off('new_ghost_message', onNew);
      socket?.off('burn_started', onBurn);
      socket?.off('ghost_message_purged', onPurged);
      socket?.off('ghost_room_destroyed', onDestroyed);
    };
  }, [roomId, currentUserId, addMessage, startBurn, purge, reset]);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const inv = await ghostApi.createInvite(currentUserId);
      await ensureConversationKey(inv.roomId);
      const key = exportConversationKey(inv.roomId);
      // Origin-based link so localhost / preview deploys work, not just nexus.app.
      let baseLink: string = inv.inviteLink;
      try {
        const { token } = parseInviteLink(inv.inviteLink);
        if (token && typeof window !== 'undefined' && window.location?.origin) {
          baseLink = `${window.location.origin}/ghost?token=${token}`;
        }
      } catch {
        /* keep server link */
      }
      const full = key ? withKeyHash(baseLink, key) : baseLink;
      setInviteLink(full);
      setRoom(inv.roomId);
      try {
        await navigator.clipboard.writeText(full);
      } catch {
        /* clipboard unavailable */
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not create invite.');
    } finally {
      setBusy(false);
    }
  };

  const shareGhost = async () => {
    if (!inviteLink) return;
    try {
      const nav = navigator as Navigator & {
        share?: (d: { title: string; text: string; url: string }) => Promise<void>;
      };
      if (typeof nav.share === 'function') {
        await nav.share({
          title: 'Ghost chat invite',
          text: 'One-time encrypted ghost chat (burns after opening, expires in 5 min):',
          url: inviteLink,
        });
      } else {
        await navigator.clipboard.writeText(inviteLink);
      }
    } catch {
      /* dismissed or unavailable */
    }
  };

  const join = async (rawInput?: string) => {
    const input = (rawInput ?? joinInput).trim();
    if (!input) return;
    setError(null);
    setBusy(true);
    try {
      const { token, key } = parseInviteLink(input);
      const res = await ghostApi.joinInvite(token, currentUserId);
      if (key) importConversationKey(res.roomId, key);
      else await ensureConversationKey(res.roomId);
      setRoom(res.roomId);
      setTab('chat');
      setJoinInput('');
      // Ephemeral hash keys never linger in history (RFC 3986 §3.5).
      try {
        if (typeof window !== 'undefined' && window.location.hash) {
          history.replaceState(null, '', window.location.pathname + window.location.search);
        }
      } catch {
        /* history unavailable */
      }
    } catch (e: any) {
      const msg: string = e?.response?.data?.message || 'Invalid invite link.';
      setError(/expired/i.test(msg) ? 'Link expired — ask for a fresh one (5-minute limit).' : /already been used/i.test(msg) ? 'Link already used — invites are one-time only.' : msg);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const plain = text.trim();
    if (!plain || !roomId) return;
    setText('');
    setError(null);
    // Mandatory E2EE: never fall back to plaintext — fail loudly instead.
    const enc = await encryptText(roomId, plain).catch(() => null);
    if (!enc) {
      setError('Encryption failed — message not sent. Rejoin with a fresh invite link.');
      return;
    }
    const socket = getSocket() || connectSocket(`guest:${currentUserId}`);
    socket?.emit('send_ghost_message', {
      roomId,
      senderName: currentUserName,
      content: enc.ciphertext,
      guestId: currentUserId,
      isEncrypted: true,
      nonce: enc.nonce,
      encVersion: enc.encVersion,
      burnDuration: burnSecs,
    });
    const local: GhostMessage = {
      id: `local_${Date.now()}`,
      roomId,
      senderId: currentUserId,
      senderName: currentUserName,
      content: plain,
      burnDuration: burnSecs,
      isEncrypted: true,
      nonce: enc.nonce,
      createdAt: new Date().toISOString(),
    };
    addMessage(local);
    startBurn(local.id, burnSecs);
  };

  /** End this ghost room now: wipe every message + membership server-side, clear local state. */
  const wipeRoom = async () => {
    if (!roomId) return;
    setError(null);
    try {
      getSocket()?.emit('destroy_ghost_room', { roomId, guestId: currentUserId });
      await ghostApi.destroyRoom(roomId, currentUserId).catch(() => null);
    } finally {
      reset();
      setInviteLink('');
      setJoinInput('');
      setTab('join');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-[#0F0E0E]">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[#1C1917] border-b border-amber-500/20">
        <Button size="sm" variant="light" onPress={() => { reset(); onBack(); }}>← Back</Button>
        <b className="text-sm flex items-center gap-1.5"><GhostIcon size={14} /> Ghost chat</b>
        <span className="text-[11px] text-amber-200/70">
          {formatBurn(burnSecs)} burn · E2EE · {!user ? `Guest (${currentUserName})` : user.username} · {roomId ? `room ${roomId.slice(0, 8)}…` : 'no room'}
        </span>
        {!user && (
          <Chip size="sm" variant="flat" color="warning" className="text-[10px]">
            Anonymous Guest
          </Chip>
        )}
        <span className="flex-1" />
        {roomId && (
          <Button size="sm" variant="flat" color="danger" onPress={wipeRoom} title="Delete every message and membership now">
            End & wipe
          </Button>
        )}
      </div>

      <div className="m-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-[11px] text-amber-200/80">
        Messages self-destruct {formatBurn(burnSecs)} after opening and are encrypted end-to-end. Server stores ciphertext only, keeps no chat logs, and wipes the room on burn or End & wipe. Invites expire in 5 minutes and are one-time. No registration required!
      </div>

      <div className="px-4">
        <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as 'chat' | 'join')}>
          <Tab key="chat" title="Chat" />
          <Tab key="join" title="Create / Join" />
        </Tabs>
      </div>

      {tab === 'join' && (
        <Card className="m-4 bg-[#1C1917]"><CardBody className="space-y-3">
          <Button color="warning" isLoading={busy} onPress={create}>Create 5-minute invite</Button>
          {inviteLink && (
            <>
              <Input label="One-time invite link (copied)" value={inviteLink} readOnly onFocus={(e) => e.target.select()} />
              <Button variant="flat" onPress={shareGhost}>Share… (SMS, WhatsApp, email)</Button>
            </>
          )}
          <Input label="Paste invite link or token to join" value={joinInput} onValueChange={setJoinInput} placeholder="https://nexus.app/ghost?token=…#k=…" />
          <Button variant="flat" isLoading={busy} isDisabled={!joinInput.trim()} onPress={() => join()}>Join room</Button>
          {error && <p className="text-xs text-danger">{error}</p>}
        </CardBody></Card>
      )}

      {/* Message feed — hidden on the join tab when there is no room yet,
          so no empty box renders below the invite card. */}
      {(tab === 'chat' || roomId || messages.length > 0) && (
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {!roomId && <p className="text-center text-xs text-stone-500 py-16">Create an invite or join a room to start burning messages.</p>}
        {messages.map((m) => {
          const me = m.senderId === currentUserId;
          return (
            <div key={m.id} className={`flex ${me ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${me ? 'bg-amber-950/60 border border-amber-500/40 text-amber-100 rounded-br-sm' : 'bg-stone-900 border border-amber-500/30 text-amber-100 rounded-bl-sm'}`}>
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                <p className="text-[10px] opacity-60 mt-1 flex items-center gap-1"><FlameIcon size={10} /> burns in {burnLeft[m.id] ?? m.burnDuration}s · <LockIcon size={10} /> encrypted</p>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {roomId && (
        <div className="p-3 bg-[#1C1917] border-t border-amber-500/20 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] text-amber-200/70">
            <span className="mr-1 flex items-center gap-1"><FlameIcon size={11} /> Burn after opening:</span>
            {BURN_OPTIONS.map((o) => (
              <button
                key={o.s}
                onClick={() => setBurnSecs(o.s)}
                aria-pressed={burnSecs === o.s}
                className={`px-2.5 py-1 rounded-full font-medium transition ${
                  burnSecs === o.s
                    ? 'bg-amber-500 text-black'
                    : 'bg-white/10 text-amber-100/80 hover:bg-white/15'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center bg-amber-500/10 border border-amber-500/40 rounded-full px-4 py-1.5 focus-within:border-amber-400 focus-within:bg-amber-500/15 transition-colors">
              <input
                type="text"
                placeholder={`Disappearing secret as ${currentUserName}…`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                className="flex-1 bg-transparent border-none outline-none shadow-none text-sm text-amber-50 placeholder:text-amber-200/40 py-1 focus:ring-0 focus:outline-none"
              />
            </div>
            <Button color="warning" radius="full" className="font-semibold" onPress={send} isDisabled={!text.trim()}>Send</Button>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}

