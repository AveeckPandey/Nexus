import * as nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';

/**
 * E2EE: per-conversation NaCl secretbox. Keys live in localStorage only.
 * Wire format must match IMPLEMENTATION.md §5 (content/nonce/encVersion).
 */
export const ENC_VERSION = 1;
const PREFIX = 'nexus_e2ee_v1:';

function get(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function set(key: string, value: string) {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* private mode — keys are session-only */
  }
}

export async function generateConversationKey(): Promise<string> {
  return encodeBase64(nacl.randomBytes(nacl.secretbox.keyLength));
}

export function getConversationKey(id: string): string | null {
  return get(id);
}

export async function ensureConversationKey(id: string): Promise<string> {
  const existing = get(id);
  if (existing) return existing;
  const fresh = await generateConversationKey();
  set(id, fresh);
  return fresh;
}

/** Import a key shared out-of-band (invite hash `#k=`). */
export function importConversationKey(id: string, base64Key: string): boolean {
  try {
    const raw = decodeBase64(base64Key.trim());
    if (raw.length !== nacl.secretbox.keyLength) return false;
    set(id, encodeBase64(raw));
    return true;
  } catch {
    return false;
  }
}

export function exportConversationKey(id: string): string | null {
  return get(id);
}

export interface EncryptedPayload {
  ciphertext: string;
  nonce: string;
  encVersion: number;
}

export async function encryptText(id: string, plaintext: string): Promise<EncryptedPayload> {
  const key = decodeBase64(await ensureConversationKey(id));
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const boxed = nacl.secretbox(decodeUTF8(plaintext), nonce, key);
  return { ciphertext: encodeBase64(boxed), nonce: encodeBase64(nonce), encVersion: ENC_VERSION };
}

/** Returns null when the key is missing or authentication fails (tamper). */
export function decryptText(id: string, ciphertext: string, nonce: string): string | null {
  try {
    const keyB64 = get(id);
    if (!keyB64) return null;
    const opened = nacl.secretbox.open(decodeBase64(ciphertext), decodeBase64(nonce), decodeBase64(keyB64));
    if (!opened) return null;
    return encodeUTF8(opened);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// X25519 identity keys + conversation-key envelopes (nacl.box).
// Identity: localStorage['nexus_identity_sk'] (secret, never leaves device).
// Envelopes live server-side at CONV#<id>/KEY#<userId> and hold ONLY the
// sealed conversation key — the server can never read it.
// ---------------------------------------------------------------------------

const IDENTITY_SK_KEY = 'nexus_identity_sk';
const IDENTITY_PUB_CACHE = 'nexus_identity_pub';

export interface Identity {
  publicKey: string;
  secretKey: string;
}

/** Get or create this device's X25519 identity keypair. */
export function getOrCreateIdentity(): Identity {
  try {
    const sk = localStorage.getItem(IDENTITY_SK_KEY);
    if (sk) {
      const secretKey = decodeBase64(sk);
      if (secretKey.length === nacl.box.secretKeyLength) {
        const kp = nacl.box.keyPair.fromSecretKey(secretKey);
        return { publicKey: encodeBase64(kp.publicKey), secretKey: sk };
      }
    }
  } catch {
    /* corrupted entry — regenerate below */
  }
  const kp = nacl.box.keyPair();
  const secretKey = encodeBase64(kp.secretKey);
  try {
    localStorage.setItem(IDENTITY_SK_KEY, secretKey);
    localStorage.setItem(IDENTITY_PUB_CACHE, encodeBase64(kp.publicKey));
  } catch {
    /* private mode — session-only identity */
  }
  return { publicKey: encodeBase64(kp.publicKey), secretKey };
}

export interface SealedEnvelope {
  encryptedKey: string;
  nonce: string;
  senderPub: string;
  keyVersion: number;
}

/** Seal a conversation key for one recipient. */
export function sealConversationKey(
  convKeyB64: string,
  recipientPubB64: string,
  senderSkB64: string,
): SealedEnvelope {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const sealed = nacl.box(
    decodeBase64(convKeyB64),
    nonce,
    decodeBase64(recipientPubB64),
    decodeBase64(senderSkB64),
  );
  const senderPub = encodeBase64(nacl.box.keyPair.fromSecretKey(decodeBase64(senderSkB64)).publicKey);
  return { encryptedKey: encodeBase64(sealed), nonce: encodeBase64(nonce), senderPub, keyVersion: 1 };
}

/** Open a sealed envelope with our identity secret key. Returns conv key or null. */
export function unsealConversationKey(env: SealedEnvelope, mySkB64: string): string | null {
  try {
    const opened = nacl.box.open(
      decodeBase64(env.encryptedKey),
      decodeBase64(env.nonce),
      decodeBase64(env.senderPub),
      decodeBase64(mySkB64),
    );
    if (!opened || opened.length !== nacl.secretbox.keyLength) return null;
    return encodeBase64(opened);
  } catch {
    return null;
  }
}

/** Import an unsealed conversation key (used after envelope fetch). */
export function importUnsealedKey(conversationId: string, convKeyB64: string): boolean {
  try {
    const raw = decodeBase64(convKeyB64.trim());
    if (raw.length !== nacl.secretbox.keyLength) return false;
    set(conversationId, encodeBase64(raw));
    return true;
  } catch {
    return false;
  }
}
