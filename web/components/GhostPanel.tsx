'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Card, CardBody, Tabs, Tab } from '@heroui/react';
import { ghostApi } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { encryptText, decryptText, ensureConversationKey, importConversationKey, exportConversationKey } from '@/lib/e2ee';
import { parseInviteLink, withKeyHash } from '@/lib/invite';
import { useGhostStore } from '@/store/ghost';
import { useAuthStore } from '@/store/auth';
import type { GhostMessage } from '@/lib/types';

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
    const socket = getSocket();
    socket?.emit('join_ghost_room', { roomId });
    const onNew = (msg: GhostMessage) => {
      const display =
        msg.isEncrypted && msg.nonce
          ? decryptText(roomId, msg.content, msg.nonce) ?? '🔒 Encrypted — key missing'
          : msg.content;
      addMessage({ ...msg, content: display });
      startBurn(msg.id, msg.burnDuration || 30);
      socket?.emit('ghost_message_opened', { roomId, messageId: msg.id });
    };
    const onBurn = (d: { messageId: string; duration: number }) => startBurn(d.messageId, d.duration);
    const onPurged = (d: { messageId: string }) => purge(d.messageId);
    socket?.on('new_ghost_message', onNew);
    socket?.on('burn_started', onBurn);
    socket?.on('ghost_message_purged', onPurged);
    return () => {
      socket?.off('new_ghost_message', onNew);
      socket?.off('burn_started', onBurn);
      socket?.off('ghost_message_purged', onPurged);
    };
  }, [roomId, addMessage, startBurn, purge]);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const inv = await ghostApi.createInvite();
      await ensureConversationKey(inv.roomId);
      const key = exportConversationKey(inv.roomId);
      setInviteLink(key ? withKeyHash(inv.inviteLink, key) : inv.inviteLink);
      setRoom(inv.roomId);
      try {
        await navigator.clipboard.writeText(key ? withKeyHash(inv.inviteLink, key) : inv.inviteLink);
      } catch {
        /* clipboard unavailable */
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not create invite.');
    } finally {
      setBusy(false);
    }
  };

  const join = async (rawInput?: string) => {
    const input = (rawInput ?? joinInput).trim();
    if (!input) return;
    setError(null);
    setBusy(true);
    try {
      const { token, key } = parseInviteLink(input);
      const res = await ghostApi.joinInvite(token);
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
    if (!plain || !roomId || !user) return;
    setText('');
    const enc = await encryptText(roomId, plain).catch(() => null);
    const socket = getSocket();
    if (enc) {
      socket?.emit('send_ghost_message', {
        roomId, senderName: user.name || user.username, content: enc.ciphertext,
        isEncrypted: true, nonce: enc.nonce, encVersion: enc.encVersion,
      });
      const local: GhostMessage = {
        id: `local_${Date.now()}`, roomId, senderId: user.userId, senderName: user.name || user.username,
        content: plain, burnDuration: 30, isEncrypted: true, nonce: enc.nonce, createdAt: new Date().toISOString(),
      };
      addMessage(local);
      startBurn(local.id, 30);
    } else {
      socket?.emit('send_ghost_message', { roomId, senderName: user.name || user.username, content: plain });
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-[#0F0E0E]">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[#1C1917] border-b border-amber-500/20">
        <Button size="sm" variant="light" onPress={() => { reset(); onBack(); }}>← Back</Button>
        <b className="text-sm">👻 Ghost chat</b>
        <span className="text-[11px] text-amber-200/70">30s burn · E2EE · {roomId ? `room ${roomId.slice(0, 8)}…` : 'no room'}</span>
      </div>

      <div className="m-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-[11px] text-amber-200/80">
        Messages self-destruct 30s after opening. Server stores ciphertext only; invites expire in 5 minutes and are one-time.
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
            <Input label="One-time invite link (copied)" value={inviteLink} readOnly onFocus={(e) => e.target.select()} />
          )}
          <Input label="Paste invite link or token to join" value={joinInput} onValueChange={setJoinInput} placeholder="https://nexus.app/ghost?token=…#k=…" />
          <Button variant="flat" isLoading={busy} isDisabled={!joinInput.trim()} onPress={() => join()}>Join room</Button>
          {error && <p className="text-xs text-danger">{error}</p>}
        </CardBody></Card>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {!roomId && <p className="text-center text-xs text-stone-500 py-16">Create an invite or join a room to start burning messages.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.senderId === user?.userId ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[75%] rounded-2xl px-3 py-2 text-sm bg-stone-900 border border-amber-500/30 text-amber-100">
              <p className="whitespace-pre-wrap break-words">{m.content}</p>
              <p className="text-[10px] opacity-60 mt-1">🔥 burns in {burnLeft[m.id] ?? m.burnDuration}s · 🔒 encrypted</p>
            </div>
          </div>
        ))}
      </div>

      {roomId && (
        <div className="p-3 bg-[#1C1917] border-t border-amber-500/20 flex gap-2">
          <Input
            placeholder="Send a disappearing secret…"
            value={text}
            onValueChange={setText}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            className="flex-1"
          />
          <Button color="warning" onPress={send} isDisabled={!text.trim()}>Send</Button>
        </div>
      )}
    </div>
  );
}
