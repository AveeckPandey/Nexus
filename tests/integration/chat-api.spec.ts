/**
 * tests/integration/chat-api.spec.ts — Conversations, messages, pagination,
 * direct 1:1 idempotency (TESTING_SPEC.md §3 `integration/chat-api.spec.ts`
 * and §5.6 Group Text & Fan-Out).
 *
 * Exercises the REAL ChatService + DynamoDbService (in-memory fallback, zero
 * network) with a mocked NotificationsService so push fan-out is observable
 * without AWS.
 */
import { ChatService } from '../../server/src/modules/chat/chat.service';
import { DynamoDbService } from '../../server/src/modules/dynamodb/dynamodb.service';

function makeService() {
  const db = new DynamoDbService();
  const sent: Array<{ memberId: string; title: string; body: string; data: any }> = [];
  const notifications = {
    sendPushNotification: jest.fn(
      async (memberId: string, title: string, body: string, data: any = {}) => {
        sent.push({ memberId, title, body, data });
      },
    ),
  } as any;
  const chat = new ChatService(db, notifications);
  return { db, chat, notifications, sent };
}

describe('chat-api: conversations', () => {
  test('creates a direct 1:1 conversation with admin/member roles', async () => {
    const { chat, db } = makeService();
    const conv = await chat.createConversation('alice', ['bob'], undefined, 'direct');
    expect(conv.type).toBe('direct');
    expect(new Set(conv.participants)).toEqual(new Set(['alice', 'bob']));
    const stored = await chat.getConversation(conv.id);
    expect(stored?.id).toBe(conv.id);
    expect(await chat.isMember(conv.id, 'alice')).toBe(true);
    expect(await chat.isMember(conv.id, 'bob')).toBe(true);
    expect(await chat.isMember(conv.id, 'mallory')).toBe(false);
    // Membership rows carry denormalized previews (no N+1 on list).
    const aliceRow = await db.get<any>(`USER#alice`, `CONV#${conv.id}`);
    expect(aliceRow.role).toBe('admin');
    expect(aliceRow.cachedTitle).toBeTruthy();
    const bobRow = await db.get<any>(`USER#bob`, `CONV#${conv.id}`);
    expect(bobRow.role).toBe('member');
  });

  test('findOrCreateDirectConversation is idempotent (invite-link double-tap safe)', async () => {
    const { chat } = makeService();
    const first = await chat.findOrCreateDirectConversation('alice', 'bob');
    const second = await chat.findOrCreateDirectConversation('alice', 'bob');
    const reversed = await chat.findOrCreateDirectConversation('bob', 'alice');
    expect(second.id).toBe(first.id);
    expect(reversed.id).toBe(first.id);
  });

  test('creates a 5-member group; every member receives fan-out push', async () => {
    const { chat, sent } = makeService();
    const members = ['m1', 'm2', 'm3', 'm4', 'm5'];
    const conv = await chat.createConversation('m1', members.slice(1), 'Study Group', 'group');
    expect(conv.type).toBe('group');
    expect(conv.participants).toHaveLength(5);
    await chat.saveMessage(conv.id, 'm1', 'M1', 'hello group');
    // Push fans out to the other 4 members only.
    const recipients = sent.map((s) => s.memberId).sort();
    expect(recipients).toEqual(['m2', 'm3', 'm4', 'm5']);
  });

  test('getUserConversations serves denormalized previews sorted newest-first', async () => {
    const { chat } = makeService();
    const c1 = await chat.createConversation('alice', ['bob'], 'Old', 'direct');
    await new Promise((r) => setTimeout(r, 5));
    const c2 = await chat.createConversation('alice', ['carol'], 'New', 'direct');
    await chat.saveMessage(c1.id, 'alice', 'Alice', 'first');
    await new Promise((r) => setTimeout(r, 5));
    await chat.saveMessage(c2.id, 'alice', 'Alice', 'second');
    const list = await chat.getUserConversations('alice');
    expect(list.map((c) => c.id)).toEqual([c2.id, c1.id]);
    expect(list[0].lastMessage?.content).toContain('second');
  });
});

describe('chat-api: messages, pagination, E2EE envelope', () => {
  test('saveMessage persists ciphertext opaquely and redacts previews', async () => {
    const { chat, db } = makeService();
    const conv = await chat.createConversation('alice', ['bob']);
    const msg = await chat.saveMessage(conv.id, 'alice', 'Alice', '7b4c91d-cipher', 'text', undefined, undefined, {
      isEncrypted: true,
      nonce: 'd84f-nonce',
      encVersion: 1,
    });
    expect(msg.isEncrypted).toBe(true);
    expect(msg.nonce).toBe('d84f-nonce');
    expect(msg.encVersion).toBe(1);
    const raw = await db.queryByPk<any>(`CONV#${conv.id}`, 'MSG#');
    expect(raw).toHaveLength(1);
    expect(raw[0].content).toBe('7b4c91d-cipher');
    const stored = await chat.getConversation(conv.id);
    expect(stored?.lastMessage?.content).toBe('🔒 Encrypted message');
  });

  test('getMessages paginates with Base64 cursor (newest page first in store, ascending to UI)', async () => {
    const { chat } = makeService();
    const conv = await chat.createConversation('alice', ['bob']);
    for (let i = 0; i < 5; i++) {
      await chat.saveMessage(conv.id, 'alice', 'Alice', `msg-${i}`);
      await new Promise((r) => setTimeout(r, 2));
    }
    const page1 = await chat.getMessages(conv.id, 2);
    expect(page1.messages).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    // Cursor is Base64-encoded LastEvaluatedKey.
    expect(() => JSON.parse(Buffer.from(page1.nextCursor as string, 'base64').toString('utf8'))).not.toThrow();
    const page2 = await chat.getMessages(conv.id, 2, page1.nextCursor as string);
    expect(page2.messages).toHaveLength(2);
    const page3 = await chat.getMessages(conv.id, 2, page2.nextCursor as string);
    expect(page3.messages).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();
    // Store iterates newest-first, so pages arrive newest-chunk-first; each
    // page is returned ascending for the UI. Union must equal the full set.
    const all = [...page1.messages, ...page2.messages, ...page3.messages].map((m) => m.content).sort();
    expect(all).toEqual(['msg-0', 'msg-1', 'msg-2', 'msg-3', 'msg-4']);
    // Newest message is in the first page served.
    expect(page1.messages.map((m) => m.content)).toContain('msg-4');
  });

  test('key envelopes round-trip per recipient (X25519 sealed conversation key)', async () => {
    const { chat } = makeService();
    const conv = await chat.createConversation('alice', ['bob']);
    await chat.putKeyEnvelope(conv.id, 'bob', {
      encryptedKey: 'sealed-key-b64',
      nonce: 'nonce-b64',
      senderPub: 'alice-pub-b64',
      keyVersion: 1,
    });
    const env = await chat.getKeyEnvelope(conv.id, 'bob');
    expect(env?.encryptedKey).toBe('sealed-key-b64');
    expect(env?.keyVersion).toBe(1);
  });

  test('markRead records per-member read cursor', async () => {
    const { chat, db } = makeService();
    const conv = await chat.createConversation('alice', ['bob']);
    const msg = await chat.saveMessage(conv.id, 'alice', 'Alice', 'hi');
    await chat.markRead(conv.id, 'bob', msg.id);
    const row = await db.get<any>(`USER#bob`, `CONV#${conv.id}`);
    expect(row.lastReadMessageId).toBe(msg.id);
  });

  test('enforces 1024-member maximum group capacity limit', async () => {
    const { chat } = makeService();
    // 1 initiator + 1024 other participants = 1025 members -> must throw BadRequestException
    const tooManyMembers = Array.from({ length: 1024 }, (_, i) => `user_${i}`);
    await expect(
      chat.createConversation('admin', tooManyMembers, 'Large Group', 'group'),
    ).rejects.toThrow('Group chat maximum capacity reached (max 1024 members)');

    // Exactly 1024 members (admin + 1023) should succeed
    const maxMembers = Array.from({ length: 1023 }, (_, i) => `user_${i}`);
    const validConv = await chat.createConversation('admin', maxMembers, 'Max Capacity Group', 'group');
    expect(validConv.participants).toHaveLength(1024);

    // Adding a 1025th member should be rejected
    await expect(
      chat.addParticipant(validConv.id, 'one_too_many'),
    ).rejects.toThrow('Group chat maximum capacity reached (max 1024 members)');
  });
});
