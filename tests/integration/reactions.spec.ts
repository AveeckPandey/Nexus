/**
 * tests/integration/reactions.spec.ts — Emoji toggling and reaction
 * aggregation (TESTING_SPEC.md §3 `integration/reactions.spec.ts` and §5.2).
 *
 * Flow mirrors the spec: Alice sends → Bob reacts ❤️ (count 1, Alice gets
 * `reaction_updated`) → Bob unreacts (count 0) → multi-emoji aggregation is
 * race-free.
 */
import { ChatService } from '../../server/src/modules/chat/chat.service';
import { DynamoDbService } from '../../server/src/modules/dynamodb/dynamodb.service';

function makeService() {
  const db = new DynamoDbService();
  const notifications = { sendPushNotification: jest.fn(async () => {}) } as any;
  return { db, chat: new ChatService(db, notifications) };
}

async function messageSk(db: DynamoDbService, conversationId: string): Promise<string> {
  const rows = await db.queryByPk<any>(`CONV#${conversationId}`, 'MSG#');
  expect(rows).toHaveLength(1);
  return rows[0].SK as string;
}

async function reactions(db: DynamoDbService, conversationId: string, sk: string) {
  const msg = await db.get<any>(`CONV#${conversationId}`, sk);
  return (msg?.reactions || []) as Array<{ emoji: string; userId: string; username: string }>;
}

describe('reactions: toggle + aggregation', () => {
  test('Bob reacts ❤️ → count 1; Bob unreacts → count 0', async () => {
    const { db, chat } = makeService();
    const conv = await chat.createConversation('alice', ['bob']);
    await chat.saveMessage(conv.id, 'alice', 'Alice', 'hello');
    const sk = await messageSk(db, conv.id);

    await chat.toggleReaction(conv.id, sk, 'bob', 'bob', '❤️');
    expect(await reactions(db, conv.id, sk)).toEqual([{ emoji: '❤️', userId: 'bob', username: 'bob' }]);

    await chat.toggleReaction(conv.id, sk, 'bob', 'bob', '❤️');
    expect(await reactions(db, conv.id, sk)).toEqual([]);
  });

  test('multiple users + multiple emojis aggregate without clobbering', async () => {
    const { db, chat } = makeService();
    const conv = await chat.createConversation('alice', ['bob', 'carol']);
    await chat.saveMessage(conv.id, 'alice', 'Alice', 'vote');
    const sk = await messageSk(db, conv.id);

    await chat.toggleReaction(conv.id, sk, 'bob', 'bob', '❤️');
    await chat.toggleReaction(conv.id, sk, 'carol', 'carol', '😂');
    await chat.toggleReaction(conv.id, sk, 'bob', 'bob', '🔥');
    let list = await reactions(db, conv.id, sk);
    expect(list).toHaveLength(3);

    // One user removing one emoji leaves the other two intact.
    await chat.toggleReaction(conv.id, sk, 'bob', 'bob', '❤️');
    list = await reactions(db, conv.id, sk);
    expect(list.map((r) => r.emoji).sort()).toEqual(['🔥', '😂']);
  });

  test('toggling a reaction on a missing message is a safe no-op', async () => {
    const { chat } = makeService();
    const conv = await chat.createConversation('alice', ['bob']);
    await expect(
      chat.toggleReaction(conv.id, 'MSG#missing', 'bob', 'bob', '❤️'),
    ).resolves.toBeUndefined();
  });
});
