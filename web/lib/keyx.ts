'use client';

import { authApi, chatApi } from './api';
import {
  getOrCreateIdentity,
  ensureConversationKey,
  exportConversationKey,
  sealConversationKey,
  unsealConversationKey,
  importUnsealedKey,
  getConversationKey,
} from './e2ee';
import { logger } from './logger';

const PUB_SENT_KEY = 'nexus_identity_pub_sent';

/**
 * Publish this device's X25519 public key to the profile (once per key).
 * Called after login and on app hydrate.
 */
export async function ensureIdentityPublished(): Promise<void> {
  try {
    const id = getOrCreateIdentity();
    let sent: string | null = null;
    try {
      sent = localStorage.getItem(PUB_SENT_KEY);
    } catch {
      /* ignore */
    }
    if (sent === id.publicKey) return;
    await authApi.profile({ x25519PublicKey: id.publicKey });
    try {
      localStorage.setItem(PUB_SENT_KEY, id.publicKey);
    } catch {
      /* ignore */
    }
  } catch (err) {
    logger.warn('Identity publish skipped:', err);
  }
}

/**
 * Creator side: seal the conversation key for every participant that has
 * published an identity public key. Zero prompts, failures are skipped
 * (those users see the missing-key notice until they log in on a device).
 */
export async function sealKeysForConversation(
  conversationId: string,
  participantIds: string[],
  selfUserId: string,
): Promise<void> {
  try {
    const convKey = await ensureConversationKey(conversationId);
    const me = getOrCreateIdentity();
    await Promise.all(
      participantIds
        .filter((p) => p && p !== selfUserId)
        .map(async (recipientId) => {
          try {
            const pub = await authApi.publicUser(recipientId);
            if (!pub?.x25519PublicKey) return;
            const sealed = sealConversationKey(convKey, pub.x25519PublicKey, me.secretKey);
            await chatApi.putKey(conversationId, { recipientId, ...sealed });
          } catch {
            /* one bad recipient must not break the rest */
          }
        }),
    );
  } catch (err) {
    logger.warn('Key sealing skipped:', err);
  }
}

/**
 * Joiner side: fetch my envelope and import the conversation key.
 * Returns true when this device can now decrypt.
 */
export async function fetchAndImportKey(conversationId: string): Promise<boolean> {
  if (getConversationKey(conversationId)) return true;
  try {
    const env = await chatApi.getKey(conversationId);
    if (!env?.encryptedKey) return false;
    const me = getOrCreateIdentity();
    const key = unsealConversationKey(env, me.secretKey);
    if (!key) return false;
    return importUnsealedKey(conversationId, key);
  } catch {
    return false;
  }
}

export { exportConversationKey };
