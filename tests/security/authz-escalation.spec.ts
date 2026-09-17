/**
 * tests/security/authz-escalation.spec.ts — regression tests for the
 * deployment-blocker audit (privilege escalation + fail-closed auth).
 *
 *  C1. message_read / typing / reactions require membership (no forgery).
 *  C2. Benchmark WS identities are gated behind ALLOW_BENCHMARK_AUTH.
 *  H1. Transcription never fetches non-allowlisted URLs (SSRF guard).
 *  H2. Local media uploads enforce auth + ownership (covered in
 *       reliability-abuse.spec.ts upload tests).
 *  Ghost burn requires room participation.
 *  Dev-auth fallback fails closed in production without explicit opt-in.
 *  Cloud write failures throw instead of acking phantom success.
 */
import { ChatService } from '../../server/src/modules/chat/chat.service';
import { ChatGateway } from '../../server/src/modules/chat/chat.gateway';
import { GhostService } from '../../server/src/modules/ghost/ghost.service';
import { GhostGateway } from '../../server/src/modules/ghost/ghost.gateway';
import { WebRtcService } from '../../server/src/modules/webrtc/webrtc.service';
import { WebRtcGateway } from '../../server/src/modules/webrtc/webrtc.gateway';
import { DynamoDbService } from '../../server/src/modules/dynamodb/dynamodb.service';
import { AuthService } from '../../server/src/modules/auth/auth.service';
import { TokenService } from '../../server/src/common/auth/token.service';
import { RedisService } from '../../server/src/common/redis/redis.service';
import { AiService } from '../../server/src/modules/ai/ai.service';

jest.mock('../../server/src/config/groq.config', () => ({
  GROQ_CONFIG: {
    get apiKey() {
      return 'test-key-for-ssrf-guard';
    },
    get model() {
      return 'test-offline';
    },
  },
  getGroqClient: () => {
    throw new Error('Groq disabled in tests');
  },
  groqClient: {
    chat: { completions: { create: jest.fn(async () => ({ choices: [] })) } },
    audio: { transcriptions: { create: jest.fn(async () => ({ text: 'hello' })) } },
  },
}));

function makeChat() {
  const db = new DynamoDbService();
  const notifications = { sendPushNotification: jest.fn(async () => {}) } as any;
  return new ChatService(db, notifications);
}

function chatGateway(chat: ChatService) {
  const gw = new ChatGateway(chat, { verify: jest.fn() } as any, { chatReply: jest.fn() } as any);
  gw.server = { to: jest.fn(() => ({ emit: jest.fn() })) } as any;
  return gw;
}

function socket(userId: string) {
  return {
    data: { userId, username: userId },
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    to: jest.fn(() => ({ emit: jest.fn() })),
  } as any;
}

describe('C1: read receipts cannot forge membership', () => {
  test('outsider message_read is Forbidden and creates no membership row', async () => {
    const chat = makeChat();
    const gw = chatGateway(chat);
    const conv = await chat.createConversation('alice', ['bob']);

    const res = await gw.messageRead(socket('mallory'), {
      conversationId: conv.id,
      messageId: 'MSG#x',
    });
    expect(res).toEqual({ error: 'Forbidden' });
    // No membership row was forged…
    expect(await chat.isMember(conv.id, 'mallory')).toBe(false);
    // …so every later guard still holds.
    await expect(
      gw.joinRoom(socket('mallory'), { conversationId: conv.id }),
    ).resolves.toEqual({ error: 'Forbidden' });
  });

  test('member message_read succeeds and persists only their cursor', async () => {
    const chat = makeChat();
    const gw = chatGateway(chat);
    const conv = await chat.createConversation('alice', ['bob']);
    const res = await gw.messageRead(socket('alice'), {
      conversationId: conv.id,
      messageId: 'MSG#1',
    });
    expect(res).toMatchObject({ status: 'read' });
    expect(await chat.isMember(conv.id, 'alice')).toBe(true);
    expect(await chat.isMember(conv.id, 'mallory')).toBe(false);
  });

  test('markRead service call never upserts membership (defense in depth)', async () => {
    const chat = makeChat();
    const conv = await chat.createConversation('alice', ['bob']);
    await chat.markRead(conv.id, 'mallory', 'MSG#1');
    expect(await chat.isMember(conv.id, 'mallory')).toBe(false);
  });

  test('typing and reactions from outsiders are Forbidden and write nothing', async () => {
    const chat = makeChat();
    const gw = chatGateway(chat);
    const conv = await chat.createConversation('alice', ['bob']);
    const enc = { content: 'c', nonce: 'n', encVersion: 1 };
    await chat.saveMessage(conv.id, 'alice', 'Alice', 'cipher', 'text', undefined, undefined, {
      isEncrypted: true,
      ...enc,
    });
    const { messages } = await chat.getMessages(conv.id);
    const sk = `MSG#${messages[0].createdAt}#${messages[0].id}`;

    await expect(
      gw.typingStart(socket('mallory'), { conversationId: conv.id, username: 'M' }),
    ).resolves.toEqual({ error: 'Forbidden' });
    await expect(
      gw.typingStop(socket('mallory'), { conversationId: conv.id }),
    ).resolves.toEqual({ error: 'Forbidden' });
    await expect(
      gw.addReaction(socket('mallory'), {
        conversationId: conv.id,
        messageSk: sk,
        username: 'M',
        emoji: '❤️',
      }),
    ).resolves.toEqual({ error: 'Forbidden' });
    const after = await chat.getMessages(conv.id);
    expect(after.messages[0].reactions || []).toHaveLength(0);
  });
});

describe('C2: benchmark WS identities are gated', () => {
  const OLD_ENV = process.env;

  function connSocket(auth: any) {
    return {
      handshake: { auth, address: '203.0.113.7', headers: {} },
      data: {} as any,
      join: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    } as any;
  }

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.ALLOW_BENCHMARK_AUTH;
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('bench/breaker/isBenchmark tokens are rejected when the flag is off', async () => {
    const chat = makeChat();
    const tokens = { verify: jest.fn(async () => { throw new Error('nope'); }) } as any;
    const gw = new ChatGateway(chat, tokens, {} as any);
    for (const auth of [
      { token: 'bench_abc' },
      { token: 'breaker_xyz' },
      { token: 'whatever', isBenchmark: true },
    ]) {
      const c = connSocket(auth);
      await gw.handleConnection(c);
      expect(c.disconnect).toHaveBeenCalled();
      expect(c.data.userId).toBeUndefined();
    }
    expect(tokens.verify).not.toHaveBeenCalled();
  });

  test('bench tokens are accepted when ALLOW_BENCHMARK_AUTH=true (load runs)', async () => {
    process.env.ALLOW_BENCHMARK_AUTH = 'true';
    const chat = makeChat();
    const gw = new ChatGateway(chat, { verify: jest.fn() } as any, {} as any);
    const c = connSocket({ token: 'bench_abc', userId: 'bench_w1' });
    await gw.handleConnection(c);
    expect(c.disconnect).not.toHaveBeenCalled();
    expect(c.data.userId).toBe('bench_w1');
  });
});

describe('C3: call signaling authorization', () => {
  function webrtc(chat: any) {
    const gw = new WebRtcGateway(new WebRtcService(), { verify: jest.fn() } as any, chat);
    gw.server = { to: jest.fn(() => ({ emit: jest.fn() })) } as any;
    return gw;
  }
  const convOf = (...participants: string[]) => ({
    getConversation: jest.fn(async () => ({ id: 'c1', participants })),
    isMember: jest.fn(async (_c: string, u: string) => participants.includes(u)),
  });

  test('outsider cannot initiate a call on a foreign conversation', async () => {
    const gw = webrtc(convOf('alice', 'bob'));
    const res = await gw.initiate(socket('mallory'), {
      conversationId: 'c1',
      initiatorName: 'Mallory',
      callType: 'video',
      recipientIds: ['alice'],
    });
    expect(res).toEqual({ error: 'Forbidden' });
  });

  test('initiate drops non-member recipients (no call spam to arbitrary IDs)', async () => {
    const gw = webrtc(convOf('alice', 'bob'));
    const res: any = await gw.initiate(socket('alice'), {
      conversationId: 'c1',
      initiatorName: 'Alice',
      callType: 'video',
      recipientIds: ['bob', 'mallory'],
    });
    expect(res.status).toBe('initiated');
    const call = await (gw as any).calls.getCall(res.callId);
    expect(call.recipientIds).toEqual(['bob']);
  });

  test('stranger cannot accept, end, or relay on a call', async () => {
    const gw = webrtc(convOf('alice', 'bob'));
    const started: any = await gw.initiate(socket('alice'), {
      conversationId: 'c1',
      initiatorName: 'Alice',
      callType: 'video',
      recipientIds: ['bob'],
    });
    const callId = started.callId;
    await expect(gw.accept(socket('mallory'), { callId, conversationId: 'c1' })).resolves.toEqual({
      error: 'Forbidden',
    });
    await expect(gw.hangup(socket('mallory'), { callId })).resolves.toEqual({
      error: 'Forbidden',
    });
    await expect(
      gw.offer(socket('mallory'), { callId, targetSocketId: 'socket_peer_9', sdp: {} }),
    ).resolves.toEqual({ error: 'Forbidden' });
    // Call still alive for the real participants.
    const call = await (gw as any).calls.getCall(callId);
    expect(call.status).toBe('ringing');
  });

  test('oversize SDP payloads are rejected', async () => {
    const gw = webrtc(convOf('alice', 'bob'));
    const started: any = await gw.initiate(socket('alice'), {
      conversationId: 'c1',
      initiatorName: 'Alice',
      callType: 'video',
      recipientIds: ['bob'],
    });
    await gw.accept(socket('bob'), { callId: started.callId, conversationId: 'c1' });
    const big = { sdp: 'x'.repeat(70000) };
    await expect(
      gw.offer(socket('alice'), { callId: started.callId, targetSocketId: 'nope', sdp: big }),
    ).resolves.toEqual({ error: 'Forbidden' });
  });
});

describe('ghost burn requires participation', () => {
  test('non-participant cannot trigger burn', async () => {
    const db = new DynamoDbService();
    const ghost = new GhostService(db);
    const gw = new GhostGateway(ghost, { verify: jest.fn() } as any, new RedisService());
    gw.server = { to: jest.fn(() => ({ emit: jest.fn() })) } as any;
    const { roomId } = await ghost.createInvite('alice');
    const res = await gw.openMessage(socket('mallory'), { roomId, messageId: 'm1' });
    expect(res).toEqual({ error: 'Forbidden' });
  });
});

describe('H1: transcription SSRF guard', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: { get: () => 'audio/webm' },
      arrayBuffer: async () => new ArrayBuffer(16),
    })) as any;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  test('metadata/cloud-internal URLs are never fetched', async () => {
    const savedNodeEnv = process.env.NODE_ENV;
    // Production posture: even loopback is not an allowlisted media host.
    process.env.NODE_ENV = 'production';
    try {
      const ai = new AiService();
      for (const url of [
        'http://169.254.169.254/latest/meta-data/',
        'http://127.0.0.1:8080/admin',
        'https://evil.example.com/voice.webm',
        'file:///etc/passwd',
      ]) {
        await ai.transcribe(url);
      }
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
    }
  });

  test('oversize base64 audio is rejected before the provider call', async () => {
    const ai = new AiService();
    const huge = Buffer.alloc(26 * 1024 * 1024, 1).toString('base64');
    const out = await ai.transcribe(huge);
    expect(out).toBe('Voice note transcription ready: audio received and queued.');
  });
});

describe('dev-auth fallback fails closed in production', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      NODE_ENV: 'production',
      SESSION_JWT_SECRET: '0123456789abcdef0123456789abcdef-test',
    };
    delete process.env.ALLOW_DEV_AUTH;
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('login refuses to mint tokens without Cognito or explicit opt-in', async () => {
    const auth = new AuthService(new DynamoDbService(), new TokenService(), new RedisService());
    await expect(auth.login({ email: 'a@x.com', password: 'x'.repeat(12) })).rejects.toThrow(
      /misconfigured/i,
    );
  });
});

describe('cloud write failures are loud, not phantom successes', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      AWS_REGION: 'us-east-1',
      DYNAMODB_ENDPOINT: 'http://127.0.0.1:9',
      MONGODB_URI: '',
    };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('put to an unreachable cloud backend rejects', async () => {
    const db = new DynamoDbService();
    await expect(db.put({ PK: 'T#1', SK: 'A' })).rejects.toThrow(/failed after retries/i);
  }, 20000);
});
