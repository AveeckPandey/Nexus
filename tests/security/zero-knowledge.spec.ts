/**
 * tests/security/zero-knowledge.spec.ts — Asserts plaintext NEVER exists in
 * DynamoDB (TESTING_SPEC.md §3 `security/zero-knowledge.spec.ts`).
 *
 * Real flow: browser encrypts via web/lib/e2ee.ts → server persists the
 * opaque wire format → raw table scan must contain zero plaintext, redacted
 * previews, and redacted push bodies.
 */
import { ChatService } from '../../server/src/modules/chat/chat.service';
import { DynamoDbService } from '../../server/src/modules/dynamodb/dynamodb.service';
import { GhostService } from '../../server/src/modules/ghost/ghost.service';
import {
  ensureConversationKey,
  encryptText,
  decryptText,
} from '../../web/lib/e2ee';

const CONV = 'zk-conv-1';

beforeEach(() => localStorage.clear());

function makeChat() {
  const db = new DynamoDbService();
  const sent: Array<{ body: string }> = [];
  const notifications = {
    sendPushNotification: jest.fn(async (_id: string, _t: string, body: string) => {
      sent.push({ body });
    }),
  } as any;
  return { db, chat: new ChatService(db, notifications), sent };
}

describe('zero-knowledge: server never sees plaintext', () => {
  test('ciphertext at rest differs from plaintext and decrypts client-side', async () => {
    const { db, chat } = makeChat();
    const conv = await chat.createConversation('alice', ['bob']);
    await ensureConversationKey(CONV);
    const enc = await encryptText(CONV, 'meet at midnight');
    await chat.saveMessage(conv.id, 'alice', 'Alice', enc.ciphertext, 'text', undefined, undefined, {
      isEncrypted: true,
      nonce: enc.nonce,
      encVersion: enc.encVersion,
    });
    const rows = await db.queryByPk<any>(`CONV#${conv.id}`, 'MSG#');
    expect(rows).toHaveLength(1);
    expect(rows[0].content).not.toContain('meet at midnight');
    expect(rows[0].content).toBe(enc.ciphertext);
    // Client holding the key recovers the plaintext; DB alone cannot.
    expect(decryptText(CONV, rows[0].content, rows[0].nonce)).toBe('meet at midnight');
    localStorage.clear();
    expect(decryptText(CONV, rows[0].content, rows[0].nonce)).toBeNull();
  });

  test('conversation preview and push body are redacted for encrypted messages', async () => {
    const { chat, sent } = makeChat();
    const conv = await chat.createConversation('alice', ['bob']);
    await ensureConversationKey(CONV);
    const enc = await encryptText(CONV, 'secret plans');
    await chat.saveMessage(conv.id, 'alice', 'Alice', enc.ciphertext, 'text', undefined, undefined, {
      isEncrypted: true,
      nonce: enc.nonce,
      encVersion: 1,
    });
    const stored = await chat.getConversation(conv.id);
    expect(stored?.lastMessage?.content).toBe('🔒 Encrypted message');
    expect(stored?.lastMessage?.content).not.toContain('secret plans');
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toBe('🔒 Encrypted message');
  });

  test('ghost messages persist ciphertext only, with burn defaults', async () => {
    const db = new DynamoDbService();
    const ghost = new GhostService(db);
    const { roomId } = await ghost.createInvite('alice');
    await ensureConversationKey('zk-ghost');
    const enc = await encryptText('zk-ghost', 'burn after reading');
    const msg = await ghost.saveMessage(roomId, 'alice', 'Alice', enc.ciphertext, {
      isEncrypted: true,
      nonce: enc.nonce,
      encVersion: 1,
    });
    expect(msg.burnDuration).toBe(30);
    expect(msg.isBurnStarted).toBe(false);
    const raw = await db.get<any>(`GHOST#${roomId}`, `MSG#${msg.id}`);
    expect(raw.content).not.toContain('burn after reading');
    expect(raw.expire_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test('key envelopes hold sealed keys, never plaintext conversation keys', async () => {
    const { db, chat } = makeChat();
    const conv = await chat.createConversation('alice', ['bob']);
    const convKey = await ensureConversationKey(CONV);
    await chat.putKeyEnvelope(conv.id, 'bob', {
      encryptedKey: 'SEALED:' + convKey.slice(0, 8),
      nonce: 'n',
      senderPub: 'p',
      keyVersion: 1,
    });
    const env = await db.get<any>(`CONV#${conv.id}`, 'KEY#bob');
    expect(env.encryptedKey).not.toBe(convKey);
  });
});
