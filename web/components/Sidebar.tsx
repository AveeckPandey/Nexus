'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Avatar } from '@heroui/react';
import { chatApi } from '@/lib/api';
import { sealKeysForConversation } from '@/lib/keyx';
import { useChatStore } from '@/store/chat';
import { useAuthStore } from '@/store/auth';
import type { Conversation } from '@/lib/types';

export function Sidebar({ onGhost, onProfile }: { onGhost: () => void; onProfile: () => void }) {
  const conversations = useChatStore((s) => s.conversations);
  const setConversations = useChatStore((s) => s.setConversations);
  const prepend = useChatStore((s) => s.prependConversation);
  const activeId = useChatStore((s) => s.activeId);
  const setActive = useChatStore((s) => s.setActive);
  const user = useAuthStore((s) => s.user);
  const [q, setQ] = useState('');

  useEffect(() => {
    chatApi.conversations().then(setConversations).catch(() => setConversations([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = conversations.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));

  const newChat = async () => {
    const title = window.prompt('Conversation name:');
    if (!title?.trim()) return;
    try {
      const conv: Conversation = await chatApi.createConversation([], title.trim());
      prepend(conv);
      setActive(conv.id);
      // Seal the fresh conversation key for every participant (auto key exchange).
      if (user) {
        sealKeysForConversation(conv.id, conv.participants, user.userId).catch(() => {});
      }
    } catch {
      /* validation error surfaces via empty state */
    }
  };

  return (
    <div className="w-80 shrink-0 h-full hidden md:flex flex-col bg-whatsapp-panel border-r border-white/10">
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-extrabold tracking-wide">Nexus</span>
          <div className="flex gap-2">
            <Button size="sm" color="warning" variant="flat" onPress={onGhost}>👻 Ghost</Button>
            <Button size="sm" color="secondary" onPress={newChat}>+ New</Button>
          </div>
        </div>
        <Input size="sm" placeholder="Search conversations…" value={q} onValueChange={setQ} />
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.map((c) => (
          <button
            key={c.id}
            onClick={() => setActive(c.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-white/5 hover:bg-whatsapp-composer ${activeId === c.id ? 'bg-whatsapp-composer' : ''}`}
          >
            <Avatar name={c.title} size="md" />
            <span className="flex-1 min-w-0">
              <span className="flex justify-between gap-2">
                <b className="truncate text-sm">{c.title}</b>
                <span className="text-[11px] text-whatsapp-checkGray shrink-0">
                  {c.lastMessage ? new Date(c.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
              </span>
              <span className="block truncate text-xs text-whatsapp-checkGray">{c.lastMessage?.content || 'No messages yet'}</span>
            </span>
          </button>
        ))}
        {filtered.length === 0 && <p className="text-center text-xs text-whatsapp-checkGray py-16">No conversations yet — start one with + New.</p>}
      </div>
      <button onClick={onProfile} className="p-3 border-t border-white/10 flex items-center gap-2 text-left hover:bg-whatsapp-composer">
        <Avatar name={user?.name || user?.username} size="sm" />
        <span className="flex-1 min-w-0 truncate text-xs">{user?.email}</span>
        <span className="text-[11px] text-whatsapp-checkGray">Profile ›</span>
      </button>
    </div>
  );
}
