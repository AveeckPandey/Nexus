/**
 * tests/unit/presence.spec.ts — Presence & Socket Mapping Architecture Test Suite
 *
 * Verifies:
 * 1. RedisService Hash operations (HSET, HGET, HDEL, HGETALL) and MGET fallback.
 * 2. Real-time online/offline presence tracking in Redis.
 * 3. ChatService presence querying and push notification suppression for online users.
 * 4. ChatGateway connection mapping and presence broadcast lifecycle.
 */
import { RedisService } from '../../server/src/common/redis/redis.service';
import { ChatService } from '../../server/src/modules/chat/chat.service';
import { DynamoDbService } from '../../server/src/modules/dynamodb/dynamodb.service';
import { ChatGateway } from '../../server/src/modules/chat/chat.gateway';

describe('Presence & Socket Mapping Architecture', () => {
  let redis: RedisService;
  let db: DynamoDbService;

  beforeEach(() => {
    redis = new RedisService();
    redis.onModuleInit();
    db = new DynamoDbService();
  });

  afterEach(async () => {
    await redis.onModuleDestroy();
  });

  describe('RedisService: Hash Operations (Replaces ZooKeeper)', () => {
    test('hset and hget store and retrieve socket mappings', async () => {
      await redis.hset('user:mapping', 'user_123', 'socket_abc');
      const socketId = await redis.hget('user:mapping', 'user_123');
      expect(socketId).toBe('socket_abc');
    });

    test('hdel removes socket mapping on disconnect', async () => {
      await redis.hset('user:mapping', 'user_456', 'socket_def');
      const removed = await redis.hdel('user:mapping', 'user_456');
      expect(removed).toBe(1);
      const after = await redis.hget('user:mapping', 'user_456');
      expect(after).toBeNull();
    });

    test('hgetall returns complete map of active socket connections', async () => {
      await redis.hset('user:mapping', 'u1', 'sock_1');
      await redis.hset('user:mapping', 'u2', 'sock_2');
      const all = await redis.hgetall('user:mapping');
      expect(all).toEqual(expect.objectContaining({ u1: 'sock_1', u2: 'sock_2' }));
    });

    test('mget retrieves multiple keys in parallel', async () => {
      await redis.set('presence:u1', 'online');
      await redis.set('presence:u2', 'offline');
      const results = await redis.mget('presence:u1', 'presence:u2', 'presence:missing');
      expect(results).toEqual(['online', 'offline', null]);
    });
  });

  describe('Presence & Smart Push Notification Suppression', () => {
    test('ChatService.getPresence reports accurate user state', async () => {
      const mockNotifications = { sendPushNotification: jest.fn() } as any;
      const chat = new ChatService(db, mockNotifications, redis);

      await redis.set('presence:alice', 'online', 'EX', 60);
      await redis.set('presence:bob', 'offline');

      expect(await chat.getPresence('alice')).toBe('online');
      expect(await chat.getPresence('bob')).toBe('offline');
      expect(await chat.getPresence('charlie')).toBe('offline');
    });

    test('ChatService.getBatchPresence returns status dictionary', async () => {
      const mockNotifications = { sendPushNotification: jest.fn() } as any;
      const chat = new ChatService(db, mockNotifications, redis);

      await redis.set('presence:alice', 'online');
      await redis.set('presence:bob', 'offline');

      const batch = await chat.getBatchPresence(['alice', 'bob', 'charlie']);
      expect(batch).toEqual({
        alice: 'online',
        bob: 'offline',
        charlie: 'offline',
      });
    });

    test('suppresses push notification if recipient is already online on WebSocket', async () => {
      const sentPush: any[] = [];
      const mockNotifications = {
        sendPushNotification: jest.fn(async (memberId, senderName, body, data) => {
          sentPush.push({ memberId, senderName, body, data });
        }),
      } as any;
      const chat = new ChatService(db, mockNotifications, redis);

      const conv = await chat.createConversation('alice', ['bob', 'charlie'], 'Presence Test', 'group');

      // bob is ONLINE; charlie is OFFLINE
      await redis.set('presence:bob', 'online', 'EX', 60);
      await redis.set('presence:charlie', 'offline');

      // Alice sends a message
      await chat.saveMessage(conv.id, 'alice', 'Alice', 'Hello everyone!');

      // Wait for dispatchPush setImmediate and Promise to settle
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 20));

      // ONLY charlie (who is offline) should receive push notification!
      const notifiedMembers = sentPush.map((p) => p.memberId);
      expect(notifiedMembers).toContain('charlie');
      expect(notifiedMembers).not.toContain('bob');
    });
  });

  describe('ChatGateway: Presence Lifecycle & Socket Registry', () => {
    test('handleConnection sets online presence and user:mapping', async () => {
      const mockChat = {} as any;
      const mockTokens = {
        verify: jest.fn().mockResolvedValue({ userId: 'user_live_1', username: 'LiveUser' }),
      } as any;
      const mockAi = {} as any;
      const gateway = new ChatGateway(mockChat, mockTokens, mockAi, redis);

      gateway.server = {
        emit: jest.fn(),
        in: jest.fn().mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([]) }),
      } as any;

      const mockSocket = {
        id: 'sock_live_99',
        handshake: { headers: {}, auth: { token: 'valid_jwt_token' }, address: '127.0.0.1' },
        data: {},
        join: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
      } as any;

      await gateway.handleConnection(mockSocket);

      const mappedSocket = await redis.hget('user:mapping', 'user_live_1');
      expect(mappedSocket).toBe('sock_live_99');

      const presence = await redis.get('presence:user_live_1');
      expect(presence).toBe('online');

      expect(gateway.server.emit).toHaveBeenCalledWith('presence:update', {
        userId: 'user_live_1',
        status: 'online',
      });
    });

    test('handleDisconnect marks user offline and cleans mapping when all sockets close', async () => {
      const mockChat = {} as any;
      const mockTokens = {} as any;
      const mockAi = {} as any;
      const gateway = new ChatGateway(mockChat, mockTokens, mockAi, redis);

      await redis.hset('user:mapping', 'user_closing_1', 'sock_1');
      await redis.set('presence:user_closing_1', 'online', 'EX', 60);

      gateway.server = {
        emit: jest.fn(),
        in: jest.fn().mockReturnValue({
          fetchSockets: jest.fn().mockResolvedValue([]),
        }),
      } as any;

      const mockSocket = {
        id: 'sock_1',
        data: { userId: 'user_closing_1' },
      } as any;

      await gateway.handleDisconnect(mockSocket);

      const mapping = await redis.hget('user:mapping', 'user_closing_1');
      expect(mapping).toBeNull();

      const presence = await redis.get('presence:user_closing_1');
      expect(presence).toBe('offline');

      expect(gateway.server.emit).toHaveBeenCalledWith(
        'presence:update',
        expect.objectContaining({
          userId: 'user_closing_1',
          status: 'offline',
        }),
      );
    });

    test('handlePresenceHeartbeat refreshes expiration', async () => {
      const gateway = new ChatGateway({} as any, {} as any, {} as any, redis);
      await redis.set('presence:user_hb', 'online', 'EX', 10);

      const mockSocket = { data: { userId: 'user_hb' } } as any;
      const res = await gateway.handlePresenceHeartbeat(mockSocket);
      expect(res.status).toBe('ok');

      const ttl = await redis.ttl('presence:user_hb');
      expect(ttl).toBeGreaterThan(10);
    });

    test('getPresence returns presence dictionary for requested userIds', async () => {
      const gateway = new ChatGateway({} as any, {} as any, {} as any, redis);
      await redis.set('presence:u_on', 'online');
      await redis.set('presence:u_off', 'offline');

      const mockSocket = {} as any;
      const res = await gateway.getPresence(mockSocket, { userIds: ['u_on', 'u_off', 'u_unknown'] });

      expect(res).toEqual({
        u_on: 'online',
        u_off: 'offline',
        u_unknown: 'offline',
      });
    });
  });
});
