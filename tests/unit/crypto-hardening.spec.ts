/**
 * tests/unit/crypto-hardening.spec.ts — TweetNaCl failure-mode hardening.
 *
 * Priority gap identified in security review: the base crypto.spec.ts proves
 * round-trip + single-tamper rejection, but never proves:
 *   1. nonces are never reused for the same key (nonce reuse destroys
 *      XSalsa20-Poly1305 / Curve25519-box security),
 *   2. keypairs are unique per device/session (key-reuse bug),
 *   3. nacl.box envelopes fail closed under tamper (not just secretbox).
 *
 * Exercises the REAL web/lib/e2ee.ts engine.
 */
import * as nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import {
  ensureConversationKey,
  encryptText,
  decryptText,
  getOrCreateIdentity,
  sealConversationKey,
  unsealConversationKey,
} from '../../web/lib/e2ee';

const CONV = 'hardening-conv';

function flipB64Char(b64: string, idx = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const pos = idx % b64.length;
  const cur = b64[pos];
  if (cur === '=') return b64.slice(0, pos) + 'A' + b64.slice(pos + 1);
  const alt = alphabet[(alphabet.indexOf(cur) + 1) % alphabet.length];
  return b64.slice(0, pos) + alt + b64.slice(pos + 1);
}

function flipByteB64(b64: string): string {
  const raw = Buffer.from(decodeBase64(b64));
  raw[0] ^= 0x01;
  return encodeBase64(new Uint8Array(raw));
}

beforeEach(() => localStorage.clear());

describe('nonce uniqueness — the #1 real-world NaCl bug class', () => {
  test('1000 encryptions under one key produce 1000 unique nonces', async () => {
    await ensureConversationKey(CONV);
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const enc = await encryptText(CONV, 'same plaintext every time');
      expect(enc.nonce).toHaveLength(32); // 24 bytes -> 32 b64 chars
      seen.add(enc.nonce);
    }
    expect(seen.size).toBe(1000);
  }, 30000);

  test('same plaintext encrypts to different ciphertexts (probabilistic encryption)', async () => {
    await ensureConversationKey(CONV);
    const a = await encryptText(CONV, 'meet at midnight');
    const b = await encryptText(CONV, 'meet at midnight');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.nonce).not.toBe(b.nonce);
    // …but both decrypt to the same plaintext.
    expect(decryptText(CONV, a.ciphertext, a.nonce)).toBe('meet at midnight');
    expect(decryptText(CONV, b.ciphertext, b.nonce)).toBe('meet at midnight');
  });

  test('each sealed envelope uses a fresh nonce', async () => {
    const convKey = await ensureConversationKey(CONV);
    const alice = getOrCreateIdentity();
    const bob = nacl.box.keyPair();
    const bobPub = encodeBase64(bob.publicKey);
    const e1 = sealConversationKey(convKey, bobPub, alice.secretKey);
    const e2 = sealConversationKey(convKey, bobPub, alice.secretKey);
    expect(e1.nonce).not.toBe(e2.nonce);
    expect(e1.encryptedKey).not.toBe(e2.encryptedKey);
  });
});

describe('keypair uniqueness — no silent key reuse across devices', () => {
  test('100 fresh X25519 keypairs are all distinct', () => {
    const pubs = new Set<string>();
    const secs = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const kp = nacl.box.keyPair();
      pubs.add(encodeBase64(kp.publicKey));
      secs.add(encodeBase64(kp.secretKey));
    }
    expect(pubs.size).toBe(100);
    expect(secs.size).toBe(100);
  });

  test('identity is stable on one device but fresh on a new device', () => {
    const deviceA = getOrCreateIdentity();
    expect(getOrCreateIdentity().publicKey).toBe(deviceA.publicKey);
    // New device (cleared storage) must NOT reuse the old keypair.
    localStorage.clear();
    const deviceB = getOrCreateIdentity();
    expect(deviceB.publicKey).not.toBe(deviceA.publicKey);
    expect(deviceB.secretKey).not.toBe(deviceA.secretKey);
  });

  test('two conversations get independent symmetric keys', async () => {
    const k1 = await ensureConversationKey('conv-A');
    const k2 = await ensureConversationKey('conv-B');
    expect(k1).not.toBe(k2);
    expect(decodeBase64(k1)).toHaveLength(nacl.secretbox.keyLength);
    expect(decodeBase64(k2)).toHaveLength(nacl.secretbox.keyLength);
  });
});

describe('envelope + ciphertext tamper fails closed (box.open / secretbox.open)', () => {
  test('single-bit flip in box envelope ciphertext rejects', async () => {
    const convKey = await ensureConversationKey(CONV);
    const alice = getOrCreateIdentity();
    const bob = nacl.box.keyPair();
    const sealed = sealConversationKey(convKey, encodeBase64(bob.publicKey), alice.secretKey);
    const bobSk = encodeBase64(bob.secretKey);
    expect(unsealConversationKey(sealed, bobSk)).toBe(convKey);
    expect(
      unsealConversationKey({ ...sealed, encryptedKey: flipByteB64(sealed.encryptedKey) }, bobSk),
    ).toBeNull();
  });

  test('single-bit flip in box nonce rejects', async () => {
    const convKey = await ensureConversationKey(CONV);
    const alice = getOrCreateIdentity();
    const bob = nacl.box.keyPair();
    const sealed = sealConversationKey(convKey, encodeBase64(bob.publicKey), alice.secretKey);
    expect(
      unsealConversationKey(
        { ...sealed, nonce: flipByteB64(sealed.nonce) },
        encodeBase64(bob.secretKey),
      ),
    ).toBeNull();
  });

  test('senderPub swap (MITM key substitution) rejects', async () => {
    const convKey = await ensureConversationKey(CONV);
    const alice = getOrCreateIdentity();
    const bob = nacl.box.keyPair();
    const sealed = sealConversationKey(convKey, encodeBase64(bob.publicKey), alice.secretKey);
    const malloryPub = encodeBase64(nacl.box.keyPair().publicKey);
    expect(
      unsealConversationKey(
        { ...sealed, senderPub: malloryPub },
        encodeBase64(bob.secretKey),
      ),
    ).toBeNull();
  });

  test('truncated / bit-flipped secretbox payloads reject (never garbage)', async () => {
    await ensureConversationKey(CONV);
    const enc = await encryptText(CONV, 'do not tamper');
    // Middle-of-buffer flip, not just last-char.
    expect(
      decryptText(CONV, flipB64Char(enc.ciphertext, 5), enc.nonce),
    ).toBeNull();
    // Truncation.
    expect(decryptText(CONV, enc.ciphertext.slice(0, -4), enc.nonce)).toBeNull();
    // Cross-key decryption fails.
    localStorage.clear();
    await ensureConversationKey('other-conv');
    expect(decryptText('other-conv', enc.ciphertext, enc.nonce)).toBeNull();
  });
});
