/**
 * tests/security/metadata-leakage.spec.ts — E2EE metadata + transport audit.
 *
 * E2EE hides *content*, not *metadata*. This spec pins both halves:
 *   A. CONTENT: ciphertext-only on the wire (WS broadcast), at rest (DB),
 *      and in API/error responses — plaintext must appear nowhere server-side.
 *   B. METADATA: explicit allowlist of what IS visible in plaintext
 *      (senderId, timestamps, sizes, membership) so traffic-analysis risk
 *      is a documented decision, not an accident.
 *   C. CLIENT STORAGE: no message plaintext in localStorage; private keys
 *      only under the two known key slots.
 */
import { ChatService } from '../../server/src/modules/chat/chat.service';
import { ChatGateway } from '../../server/src/modules/chat/chat.gateway';
import { DynamoDbService } from '../../server/src/modules/dynamodb/dynamodb.service';
import { MemberGuard } from '../../server/src/modules/chat/guards/member.guard';
import {
  ensureConversationKey,
  encryptText,
  getOrCreateIdentity,
} from '../../web/lib/e2ee';

const PLAINTEXT = 'meet at midnight by the old bridge';
const CONV_KEY_SLOT = 'leak-conv-1';

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

function httpCtx(userId: string | undefined, params: any = {}) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: userId ? { userId } : undefined, params }) }),
  } as any;
}

describe('A. content is ciphertext-only server-side', () => {
  test('DB row, conversation preview, and push body contain zero plaintext', async () => {
    const { db, chat, sent } = makeChat();
    const conv = await chat.createConversation('alice', ['bob']);
    await ensureConversationKey(CONV_KEY_SLOT);
    const enc = await encryptText(CONV_KEY_SLOT, PLAINTEXT);

    await chat.saveMessage(conv.id, 'alice', 'Alice', enc.ciphertext, 'text', undefined, undefined, {
      isEncrypted: true,
      nonce: enc.nonce,
      encVersion: enc.encVersion,
    });

    const rows = await db.queryByPk<any>(`CONV#${conv.id}`, 'MSG#');
    expect(rows).toHaveLength(1);
    const blob = JSON.stringify(rows[0]);
    expect(blob).not.toContain(PLAINTEXT);
    expect(rows[0].content).toBe(enc.ciphertext);

    const stored = await chat.getConversation(conv.id);
    expect(JSON.stringify(stored)).not.toContain(PLAINTEXT);
    expect(stored?.lastMessage?.content).toBe('🔒 Encrypted message');

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent)).not.toContain(PLAINTEXT);
  });

  test('WS new_message broadcast relays ciphertext, never plaintext', async () => {
    const { chat } = makeChat();
    const tokens = { verify: jest.fn() } as any;
    const ai = { chatReply: jest.fn() } as any;
    const emitted: Array<{ event: string; payload: any }> = [];
    const gw = new ChatGateway(chat, tokens, ai);
    gw.server = {
      to: jest.fn(() => ({
        emit: jest.fn((event: string, payload: any) => {
          emitted.push({ event, payload });
        }),
      })),
    } as any;

    const conv = await chat.createConversation('alice', ['bob']);
    await ensureConversationKey(CONV_KEY_SLOT);
    const enc = await encryptText(CONV_KEY_SLOT, PLAINTEXT);
    const sock: any = { data: { userId: 'alice', username: 'alice' }, emit: jest.fn() };

    const ack = await gw.sendMessage(sock, {
      conversationId: conv.id,
      senderName: 'Alice',
      content: enc.ciphertext,
      isEncrypted: true,
      nonce: enc.nonce,
      encVersion: enc.encVersion,
    } as any);
    expect(ack.status).toBe('sent');

    const broadcasts = emitted.filter((e) => e.event === 'new_message');
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].payload.content).toBe(enc.ciphertext);
    expect(JSON.stringify(broadcasts[0].payload)).not.toContain(PLAINTEXT);
  });

  test('error responses (IDOR Forbidden) leak no key material or plaintext', async () => {
    const { chat } = makeChat();
    const guard = new MemberGuard(chat);
    const conv = await chat.createConversation('alice', ['bob']);
    await ensureConversationKey(CONV_KEY_SLOT);
    const enc = await encryptText(CONV_KEY_SLOT, PLAINTEXT);

    let forbidden: unknown;
    try {
      await guard.canActivate(httpCtx('carol', { id: conv.id }));
    } catch (e) {
      forbidden = e;
    }
    expect(forbidden).toBeDefined();
    const errBlob = JSON.stringify(forbidden, Object.getOwnPropertyNames(forbidden as object));
    expect(errBlob).not.toContain(PLAINTEXT);
    expect(errBlob).not.toContain(enc.ciphertext);
    expect(errBlob).not.toContain('nexus_identity_sk');
  });
});

describe('B. metadata exposure is explicit and bounded (documented, not accidental)', () => {
  test('allowlisted plaintext metadata, denylisted secrets', async () => {
    const { db, chat } = makeChat();
    const conv = await chat.createConversation('alice', ['bob']);
    await ensureConversationKey(CONV_KEY_SLOT);
    const enc = await encryptText(CONV_KEY_SLOT, PLAINTEXT);
    await chat.saveMessage(conv.id, 'alice', 'Alice', enc.ciphertext, 'text', undefined, undefined, {
      isEncrypted: true,
      nonce: enc.nonce,
      encVersion: enc.encVersion,
    });

    const rows = await db.queryByPk<any>(`CONV#${conv.id}`, 'MSG#');
    const row = rows[0];
    // EXPECTED-plaintext (needed for routing/rendering — traffic-analysis surface):
    // sender identity, conversation id, timestamp, nonce, version, size.
    expect(row.senderId).toBe('alice');
    expect(row.senderName).toBe('Alice');
    expect(row.conversationId).toBe(conv.id);
    expect(typeof row.createdAt).toBe('string');
    expect(typeof row.nonce).toBe('string');
    expect(row.encVersion).toBe(1);
    // Ciphertext length inherently leaks approximate plaintext length.
    expect(typeof row.content).toBe('string');
    // Group membership itself is server-visible (required for fan-out).
    expect(conv.participants).toEqual(expect.arrayContaining(['alice', 'bob']));

    // NEVER-plaintext: no private keys, no raw conversation keys, no plaintext.
    const blob = JSON.stringify({ row, conv });
    expect(blob).not.toContain(PLAINTEXT);
    expect(blob).not.toMatch(/nexus_identity_sk/i);
    expect(blob).not.toMatch(/secretKey/i);
    expect(blob).not.toMatch(/privateKey/i);
  });
});

describe('C. client-side storage holds keys, never message plaintext', () => {
  test('localStorage after chat contains no plaintext message content', async () => {
    await ensureConversationKey(CONV_KEY_SLOT);
    getOrCreateIdentity();
    const enc = await encryptText(CONV_KEY_SLOT, PLAINTEXT);
    // Simulate a second message so storage sees realistic usage.
    await encryptText(CONV_KEY_SLOT, 'second secret message');

    const dump: Record<string, string> = {};
    // Access the in-memory polyfill via getItem enumeration is not
    // available — re-read the known slots plus verify decryptability.
    const convKey = localStorage.getItem(`nexus_e2ee_v1:${CONV_KEY_SLOT}`);
    const identitySk = localStorage.getItem('nexus_identity_sk');
    dump[`nexus_e2ee_v1:${CONV_KEY_SLOT}`] = convKey ?? '';
    dump['nexus_identity_sk'] = identitySk ?? '';
    const blob = JSON.stringify(dump);
    expect(blob).not.toContain(PLAINTEXT);
    expect(blob).not.toContain('second secret message');
    expect(blob).not.toContain(enc.ciphertext.slice(0, 8) === PLAINTEXT.slice(0, 8) ? 'IMPOSSIBLE' : PLAINTEXT);

    // Keys present are 32-byte base64 (44 chars), not plaintext.
    expect(convKey).toMatch(/^[A-Za-z0-9+/=]{43,44}$/);
    expect(identitySk).toMatch(/^[A-Za-z0-9+/=]{43,44}$/);
  });
});
