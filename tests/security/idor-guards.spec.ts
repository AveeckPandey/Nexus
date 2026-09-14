/**
 * tests/security/idor-guards.spec.ts — Asserts User C cannot eavesdrop on
 * User A/B conversations (TESTING_SPEC.md §3 `security/idor-guards.spec.ts`).
 *
 * Covers the REAL MemberGuard (HTTP) + ChatService.isMember + ChatGateway
 * join_room/send_message membership checks + GhostGateway participant gate.
 */
import { ChatService } from '../../server/src/modules/chat/chat.service';
import { MemberGuard } from '../../server/src/modules/chat/guards/member.guard';
import { ChatGateway } from '../../server/src/modules/chat/chat.gateway';
import { DynamoDbService } from '../../server/src/modules/dynamodb/dynamodb.service';
import { GhostService } from '../../server/src/modules/ghost/ghost.service';

// NOTE: do not import '@nestjs/common' directly here — root node_modules has
// no @nestjs scope (it lives under server/node_modules, resolved transitively
// from server files). Assert on the Forbidden contract instead of instanceof.

function makeChat() {
  const db = new DynamoDbService();
  const notifications = { sendPushNotification: jest.fn(async () => {}) } as any;
  const chat = new ChatService(db, notifications);
  return { db, chat };
}

function httpCtx(userId: string | undefined, params: any = {}, body: any = {}) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: userId ? { userId } : undefined, params, body }) }),
  } as any;
}

describe('idor-guards: MemberGuard (HTTP)', () => {
  test('member passes, outsider C is rejected with Forbidden', async () => {
    const { chat } = makeChat();
    const guard = new MemberGuard(chat);
    const conv = await chat.createConversation('alice', ['bob']);
    await expect(guard.canActivate(httpCtx('alice', { id: conv.id }))).resolves.toBe(true);
    await expect(guard.canActivate(httpCtx('carol', { id: conv.id }))).rejects.toThrow(/Forbidden/);
  });

  test('missing conversation id or missing user is Forbidden (fail closed)', async () => {
    const { chat } = makeChat();
    const guard = new MemberGuard(chat);
    const conv = await chat.createConversation('alice', ['bob']);
    await expect(guard.canActivate(httpCtx(undefined, { id: conv.id }))).rejects.toThrow(/Forbidden/);
    await expect(guard.canActivate(httpCtx('alice', {}, {}))).rejects.toThrow(/Forbidden/);
  });

  test('guard reads id from params.id, params.conversationId, or body.conversationId', async () => {
    const { chat } = makeChat();
    const guard = new MemberGuard(chat);
    const conv = await chat.createConversation('alice', ['bob']);
    await expect(
      guard.canActivate(httpCtx('bob', { conversationId: conv.id })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(httpCtx('bob', {}, { conversationId: conv.id })),
    ).resolves.toBe(true);
    await expect(guard.canActivate(httpCtx('carol', {}, { conversationId: conv.id }))).rejects.toThrow(
      /Forbidden/,
    );
  });
});

describe('idor-guards: ChatGateway socket room join + send', () => {
  function makeGateway(chat: ChatService) {
    const tokens = { verify: jest.fn() } as any;
    const ai = { chatReply: jest.fn() } as any;
    const gw = new ChatGateway(chat, tokens, ai);
    gw.server = { to: jest.fn(() => ({ emit: jest.fn() })) } as any;
    return gw;
  }

  function socket(userId: string) {
    return { data: { userId, username: userId }, join: jest.fn(), leave: jest.fn() } as any;
  }

  test('outsider join_room gets { error: Forbidden } and is not joined', async () => {
    const { chat } = makeChat();
    const gw = makeGateway(chat);
    const conv = await chat.createConversation('alice', ['bob']);
    const carol = socket('carol');
    await expect(gw.joinRoom(carol, { conversationId: conv.id })).resolves.toEqual({
      error: 'Forbidden',
    });
    expect(carol.join).not.toHaveBeenCalled();
  });

  test('member join_room succeeds', async () => {
    const { chat } = makeChat();
    const gw = makeGateway(chat);
    const conv = await chat.createConversation('alice', ['bob']);
    const alice = socket('alice');
    await expect(gw.joinRoom(alice, { conversationId: conv.id })).resolves.toMatchObject({
      status: 'joined',
    });
    expect(alice.join).toHaveBeenCalledWith(conv.id);
  });

  test('outsider send_message is blocked before persistence', async () => {
    const { chat } = makeChat();
    const gw = makeGateway(chat);
    const conv = await chat.createConversation('alice', ['bob']);
    const carol = socket('carol');
    await expect(
      gw.sendMessage(carol, { conversationId: conv.id, senderName: 'C', content: 'spy' }),
    ).resolves.toEqual({ error: 'Forbidden' });
    expect((await chat.getMessages(conv.id)).messages).toHaveLength(0);
  });
});

describe('idor-guards: ghost rooms isolate non-participants', () => {
  test('non-participant is not a participant; creator and claimer are', async () => {
    const db = new DynamoDbService();
    const ghost = new GhostService(db);
    const { roomId, token } = await ghost.createInvite('alice');
    expect(await ghost.isParticipant(roomId, 'alice')).toBe(true);
    expect(await ghost.isParticipant(roomId, 'mallory')).toBe(false);
    await ghost.claimInvite(token, 'bob');
    expect(await ghost.isParticipant(roomId, 'bob')).toBe(true);
    expect(await ghost.isParticipant(roomId, 'mallory')).toBe(false);
  });
});
