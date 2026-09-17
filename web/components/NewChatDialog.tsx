'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  Button,
  Avatar,
  Spinner,
} from '@heroui/react';
import { authApi, chatApi, type PublicUser } from '@/lib/api';
import { sealKeysForConversation } from '@/lib/keyx';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';
import type { Conversation } from '@/lib/types';

/**
 * Username / email search → encrypted 1:1 chat.
 * Web-native contact discovery: no phonebook, sub-millisecond server
 * lookup, automatic X25519 key exchange on open.
 */
export function NewChatDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const selfId = useAuthStore((s) => s.user?.userId);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setQ('');
      setResults([]);
      setError(null);
      setStarting(null);
    }
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    setError(null);
    timer.current = setTimeout(async () => {
      try {
        const users = await authApi.search(query);
        setResults(users);
      } catch {
        setError('Search is unavailable — check your connection and retry.');
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, open]);

  const startChat = async (peer: PublicUser) => {
    if (!selfId || starting) return;
    setStarting(peer.userId);
    setError(null);
    try {
      const conv: Conversation = await chatApi.directConversation(peer.userId);
      const store = useChatStore.getState();
      store.prependConversation(conv);
      store.setActive(conv.id);
      // Automatic client-side key exchange — zero prompts.
      sealKeysForConversation(conv.id, conv.participants, selfId).catch(() => {});
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not open the chat. Try again.');
    } finally {
      setStarting(null);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} placement="top-center">
      <ModalContent className="bg-[#E9EDF3] text-[#2F343D] rounded-3xl shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff]">
        <ModalHeader className="flex flex-col gap-1 text-[#2F343D]">
          <span>New chat</span>
          <span className="text-xs font-normal text-[#8A8F98]">
            Search by @username, name, or email — no phone number needed.
          </span>
        </ModalHeader>
        <ModalBody className="pb-6 space-y-3">
          <input
            autoFocus
            placeholder="@aveeck, sarah, or sarah@mail.com"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search by username, name, or email"
            className="w-full bg-[#E0E5EC] rounded-xl px-3 py-2.5 text-sm text-[#2F343D] outline-none placeholder:text-[#8A8F98] shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff] focus:ring-2 focus:ring-[#CC5500]/40 transition"
          />
          {searching && (
            <div className="flex items-center gap-2 text-xs text-[#8A8F98]">
              <Spinner size="sm" /> Searching…
            </div>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          {!searching && q.trim().length >= 2 && results.length === 0 && !error && (
            <p className="text-xs text-[#8A8F98]">
              No one found for “{q.trim()}”. Ask them to join with your invite link instead.
            </p>
          )}
          {q.trim().length < 2 && (
            <p className="text-xs text-[#8A8F98]">
              Type at least 2 characters. Usernames look like @username.
            </p>
          )}
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {results.map((u) => (
              <div
                key={u.userId}
                className="flex items-center gap-3 p-2 rounded-xl border border-transparent bg-[#E0E5EC] text-[#2F343D] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] hover:bg-white/60 transition"
              >
                <Avatar src={u.avatarUrl} name={u.name || u.username} size="sm" className="shrink-0" />
                <span className="flex-1 min-w-0">
                  <b className="block truncate text-sm text-[#2F343D]">{u.name || u.username}</b>
                  <span className="block truncate text-xs text-[#8A8F98]">@{u.username}</span>
                </span>
                <Button
                  size="sm"
                  className="bg-[#CC5500] text-white rounded-xl shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff]"
                  isLoading={starting === u.userId}
                  isDisabled={starting !== null}
                  onPress={() => startChat(u)}
                >
                  Start chat
                </Button>
              </div>
            ))}
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

