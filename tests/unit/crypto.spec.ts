/**
 * tests/unit/crypto.spec.ts — TweetNaCl XSalsa20-Poly1305 & X25519 key
 * exchange (TESTING_SPEC.md §3 `unit/crypto.spec.ts`).
 * Exercises the REAL web/lib/e2ee.ts engine, not a re-implementation.
 */
import * as nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import {
  ENC_VERSION,
  ensureConversationKey,
  exportConversationKey,
  importConversationKey,
  encryptText,
  decryptText,
  getOrCreateIdentity,
  sealConversationKey,
  unsealConversationKey,
} from '../../web/lib/e2ee';

const CONV = 'unit-conv-1';

function flipLastChar(b64: string): string {
  const last = b64[b64.length - 1];
  const alt = last === 'A' ? 'B' : 'A';
  return b64.slice(0, -1) + alt;
}

beforeEach(() => {
  localStorage.clear();
});

describe('secretbox message privacy (IMPLEMENTATION.md §5)', () => {
  test('encrypt→decrypt round-trip preserves plaintext', async () => {
    await ensureConversationKey(CONV);
    const enc = await encryptText(CONV, 'hello nexus 🔒');
    expect(typeof enc.ciphertext).toBe('string');
    expect(typeof enc.nonce).toBe('string');
    expect(enc.encVersion).toBe(ENC_VERSION);
    expect(decryptText(CONV, enc.ciphertext, enc.nonce)).toBe('hello nexus 🔒');
  });

  test('wire format pins encVersion 1 with 24-byte nonces', async () => {
    await ensureConversationKey(CONV);
    const enc = await encryptText(CONV, 'version check');
    expect(enc.encVersion).toBe(1);
    expect(ENC_VERSION).toBe(1);
    // 24 random bytes → 32 base64 chars; ciphertext must differ from plaintext.
    expect(enc.nonce).toMatch(/^[A-Za-z0-9+/=]{32}$/);
    expect(enc.ciphertext).not.toContain('version check');
  });

  test('unknown conversation (missing key) decrypts to null — fail-safe UI path', async () => {
    await ensureConversationKey(CONV);
    const enc = await encryptText(CONV, 'secret');
    localStorage.clear();
    expect(decryptText(CONV, enc.ciphertext, enc.nonce)).toBeNull();
  });

  test('tampered ciphertext fails closed (Poly1305 MAC)', async () => {
    await ensureConversationKey(CONV);
    const enc = await encryptText(CONV, 'do not tamper');
    expect(decryptText(CONV, flipLastChar(enc.ciphertext), enc.nonce)).toBeNull();
  });

  test('tampered nonce fails closed', async () => {
    await ensureConversationKey(CONV);
    const enc = await encryptText(CONV, 'do not tamper');
    expect(decryptText(CONV, enc.ciphertext, flipLastChar(enc.nonce))).toBeNull();
  });

  test('ghost-style export/import: second device decrypts only after import', async () => {
    await ensureConversationKey(CONV);
    const enc = await encryptText(CONV, 'ephemeral hello');
    const exported = exportConversationKey(CONV);
    expect(exported).toBeTruthy();
    // Fresh device without the key sees nothing…
    localStorage.clear();
    expect(decryptText(CONV, enc.ciphertext, enc.nonce)).toBeNull();
    // …until the out-of-band key (invite #k= hash) is imported.
    expect(importConversationKey(CONV, exported as string)).toBe(true);
    expect(decryptText(CONV, enc.ciphertext, enc.nonce)).toBe('ephemeral hello');
  });

  test('import rejects malformed keys', () => {
    expect(importConversationKey(CONV, 'not-base64!!!')).toBe(false);
    expect(importConversationKey(CONV, encodeBase64(nacl.randomBytes(16)))).toBe(false);
  });
});

describe('X25519 conversation-key envelopes (nacl.box)', () => {
  test('device identity keypair is stable across calls', () => {
    const a = getOrCreateIdentity();
    const b = getOrCreateIdentity();
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.secretKey).toBe(b.secretKey);
  });

  test('seal→unseal round-trip recovers the conversation key', async () => {
    const convKey = await ensureConversationKey(CONV);
    const alice = getOrCreateIdentity();
    const bob = nacl.box.keyPair();
    const bobPub = encodeBase64(bob.publicKey);
    const sealed = sealConversationKey(convKey, bobPub, alice.secretKey);
    expect(sealed.keyVersion).toBe(1);
    const bobSk = encodeBase64(bob.secretKey);
    expect(unsealConversationKey(sealed, bobSk)).toBe(convKey);
  });

  test('envelope opened with the wrong secret key yields null', async () => {
    const convKey = await ensureConversationKey(CONV);
    const alice = getOrCreateIdentity();
    const bob = nacl.box.keyPair();
    const sealed = sealConversationKey(convKey, encodeBase64(bob.publicKey), alice.secretKey);
    const mallorySk = encodeBase64(nacl.box.keyPair().secretKey);
    expect(unsealConversationKey(sealed, mallorySk)).toBeNull();
  });
});
