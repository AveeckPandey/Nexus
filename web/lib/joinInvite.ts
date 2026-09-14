'use client';

import { authApi, chatApi } from './api';
import { sealKeysForConversation } from './keyx';
import { useChatStore } from '@/store/chat';
import { useAuthStore } from '@/store/auth';
import type { Conversation } from './types';

/**
 * Complete a personal invite: resolve @username/userId/email →
 * idempotent encrypted 1:1 chat with automatic key exchange.
 * Returns the conversation id, or throws a user-facing Error.
 */
export async function openInviteCode(code: string): Promise<string> {
  const selfId = useAuthStore.getState().user?.userId;
  if (!selfId) throw new Error('Please sign in to open this invite.');
  const clean = code.trim().replace(/^@+/, '').slice(0, 128);
  if (!clean) throw new Error('This invite link is empty.');
  let peer;
  try {
    peer = await authApi.resolveInvite(clean);
  } catch {
    throw new Error('No user found for this invite link.');
  }
  if (peer.userId === selfId) throw new Error('This is your own invite link.');
  let conv: Conversation;
  try {
    conv = await chatApi.directConversation(peer.userId);
  } catch {
    throw new Error('Could not open the chat. Try again.');
  }
  const store = useChatStore.getState();
  store.prependConversation(conv);
  store.setActive(conv.id);
  sealKeysForConversation(conv.id, conv.participants, selfId).catch(() => {});
  return conv.id;
}
