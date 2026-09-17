'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Avatar,
  Spinner,
  Chip,
} from '@heroui/react';
import { authApi, chatApi, type PublicUser } from '@/lib/api';
import { sealKeysForConversation } from '@/lib/keyx';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';
import type { Conversation } from '@/lib/types';

/**
 * Create Group: name the group, search @usernames, multi-select members,
 * then create an encrypted group conversation with automatic key sealing.
 */
export function CreateGroupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const selfId = useAuthStore((s) => s.user?.userId);
  const user = useAuthStore((s) => s.user);
  const [title, setTitle] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setQ('');
      setResults([]);
      setMembers([]);
      setError(null);
      setCreating(false);
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
    timer.current = setTimeout(async () => {
      try {
        const users = await authApi.search(query);
        setResults(users.filter((u) => u.userId !== selfId && !members.some((m) => m.userId === u.userId)));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);

  const toggle = (u: PublicUser) => {
    setMembers((prev) => (prev.some((m) => m.userId === u.userId) ? prev.filter((m) => m.userId !== u.userId) : [...prev, u]));
  };

  const create = async () => {
    if (!selfId || creating) return;
    const name = title.trim();
    if (!name) {
      setError('Give your group a name first.');
      return;
    }
    if (members.length === 0) {
      setError('Add at least one member to create a group.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const conv: Conversation = await chatApi.createConversation(
        members.map((m) => m.userId),
        name,
        'group',
      );
      const store = useChatStore.getState();
      store.prependConversation(conv);
      store.setActive(conv.id);
      if (user) sealKeysForConversation(conv.id, conv.participants, user.userId).catch(() => {});
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not create the group. Try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} placement="top-center">
      <ModalContent className="bg-[#E9EDF3] text-[#2F343D] rounded-3xl shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff]">
        <ModalHeader className="flex flex-col gap-1 text-[#2F343D]">
          <span>Create group</span>
          <span className="text-xs font-normal text-[#8A8F98]">
            Name it, add members — keys are sealed for everyone automatically.
          </span>
        </ModalHeader>
        <ModalBody className="pb-2 space-y-4">
          <div>
            <label htmlFor="group-name" className="block text-xs text-[#8A8F98] mb-1.5 px-1">
              Group name
            </label>
            <input
              id="group-name"
              autoFocus
              placeholder="Weekend squad"
              value={title}
              maxLength={60}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-[#E0E5EC] rounded-xl px-3 py-2.5 text-sm text-[#2F343D] outline-none placeholder:text-[#8A8F98] shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff] focus:ring-2 focus:ring-[#CC5500]/40 transition"
            />
          </div>
          {members.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <Chip key={m.userId} onClose={() => toggle(m)} variant="flat" size="sm" className="bg-[#F5D6C2] text-[#2F343D]">
                  @{m.username}
                </Chip>
              ))}
            </div>
          )}
          <div>
            <label htmlFor="group-members" className="block text-xs text-[#8A8F98] mb-1.5 px-1">
              Add members
            </label>
            <input
              id="group-members"
              placeholder="Search @username, name, or email"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full bg-[#E0E5EC] rounded-xl px-3 py-2.5 text-sm text-[#2F343D] outline-none placeholder:text-[#8A8F98] shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff] focus:ring-2 focus:ring-[#CC5500]/40 transition"
            />
          </div>
          {searching && (
            <div className="flex items-center gap-2 text-xs text-[#8A8F98]">
              <Spinner size="sm" /> Searching…
            </div>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {results.map((u) => {
              const selected = members.some((m) => m.userId === u.userId);
              return (
                <button
                  key={u.userId}
                  onClick={() => toggle(u)}
                  className={`w-full flex items-center gap-3 p-2 rounded-xl border text-left text-[#2F343D] transition ${
                    selected ? 'bg-[#F5D6C2] border-[#CC5500]/40 shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff]' : 'bg-[#E0E5EC] border-transparent shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] hover:bg-white/60'
                  }`}
                >
                  <Avatar src={u.avatarUrl} name={u.name || u.username} size="sm" className="shrink-0" />
                  <span className="flex-1 min-w-0">
                    <b className="block truncate text-sm text-[#2F343D]">{u.name || u.username}</b>
                    <span className="block truncate text-xs text-[#8A8F98]">@{u.username}</span>
                  </span>
                  <span
                    className={`w-5 h-5 rounded-md border flex items-center justify-center text-xs shrink-0 ${
                      selected ? 'bg-[#CC5500] border-[#CC5500] text-white' : 'bg-[#E0E5EC] border-[#8A8F98]/50 text-transparent'
                    }`}
                    aria-hidden
                  >
                    ✓
                  </span>
                </button>
              );
            })}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose} className="bg-[#E0E5EC] text-[#2F343D] rounded-xl shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff]">
            Cancel
          </Button>
          <Button className="bg-[#CC5500] text-white rounded-xl shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff]" isLoading={creating} isDisabled={!title.trim() || members.length === 0} onPress={create}>
            Create group ({members.length})
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
