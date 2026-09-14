import type { Conversation, Message } from './types';
import type { PublicUser } from './api';

export interface ResolvedPeer {
  userId: string;
  name: string;
  username?: string;
  avatarUrl?: string;
  about?: string;
}

const BOT_IDS = new Set(['nexus-ai']);

function isHuman(id: string) {
  return Boolean(id) && !BOT_IDS.has(id) && !id.startsWith('temp_') && !id.startsWith('bot_');
}

/**
 * Resolve the "other person" of a 1:1 direct chat.
 * The conversation list endpoint carries no avatars and often no
 * participant ids, so we reconcile (in priority order):
 *   1. participants[] (freshly created chats),
 *   2. distinct message senders (history carries senderId/Avatar),
 *   3. the peer directory (fetched public profiles).
 */
export function resolvePeer(
  conv: Conversation | undefined,
  messages: Pick<Message, 'senderId' | 'senderName' | 'senderAvatar'>[],
  selfId: string | undefined,
  peers: Record<string, PublicUser>,
): ResolvedPeer | null {
  if (!conv || conv.type !== 'direct') return null;

  const ids: string[] = [];
  const push = (id: string) => {
    if (id && id !== selfId && isHuman(id) && !ids.includes(id)) ids.push(id);
  };
  for (const p of conv.participants || []) push(p);
  for (const m of messages) push(m.senderId);

  const userId = ids[0];
  if (!userId) return null;

  const profile = peers[userId];
  const fromMsg = messages.find((m) => m.senderId === userId);
  // Any human photo in this conversation works as a last-resort fallback so
  // the row and the header never disagree (e.g. history not fully cached).
  const anyAvatar = messages.find(
    (m) => m.senderId !== selfId && isHuman(m.senderId) && m.senderAvatar,
  )?.senderAvatar;
  const name =
    profile?.name || profile?.username || fromMsg?.senderName || conv.title;
  const avatarUrl = profile?.avatarUrl || fromMsg?.senderAvatar || anyAvatar;
  return { userId, name, username: profile?.username, avatarUrl, about: profile?.about };
}

/** WhatsApp shows the contact name, never the "Direct Chat" placeholder. */
export function displayTitle(
  conv: Conversation | undefined,
  peer: ResolvedPeer | null,
): string {
  if (peer?.name) return peer.name;
  if (conv?.title && conv.title !== 'Direct Chat') return conv.title;
  if (conv?.type === 'direct') return 'Direct Chat';
  return conv?.title || 'Chat';
}
