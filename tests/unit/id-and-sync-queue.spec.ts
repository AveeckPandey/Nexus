import { IdService } from '../../server/src/common/id/id.service';
import { RedisService } from '../../server/src/common/redis/redis.service';
import { ChatService } from '../../server/src/modules/chat/chat.service';
import { DynamoDbService } from '../../server/src/modules/dynamodb/dynamodb.service';
import { NotificationsService } from '../../server/src/modules/notifications/notifications.service';

describe('IdService & Sync Queues (Enterprise Chat Architecture)', () => {
  let idService: IdService;
  let redisService: RedisService;
  let chatService: ChatService;
  let db: DynamoDbService;
  let notifications: NotificationsService;

  beforeEach(() => {
    idService = new IdService();
    redisService = new RedisService();
    redisService.onModuleInit();
    db = new DynamoDbService();
    notifications = new NotificationsService(db, redisService);
    chatService = new ChatService(db, notifications, redisService, idService);
  });

  afterEach(async () => {
    await redisService.onModuleDestroy();
  });

  describe('IdService (Distributed Monotonic ULID Generator)', () => {
    test('generates 26-character Crockford Base32 IDs', () => {
      const id = idService.generate();
      expect(typeof id).toBe('string');
      expect(id.length).toBe(26);
      expect(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/.test(id)).toBe(true);
    });

    test('generates strictly monotonic lexicographically increasing IDs', () => {
      const ids: string[] = [];
      for (let i = 0; i < 500; i++) {
        ids.push(idService.generate());
      }
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i] > ids[i - 1]).toBe(true);
      }
    });
  });

  describe('Redis Sync Queues (Per-Client Inboxes)', () => {
    const testUser = 'user-test-sync-1';

    test('buffers items in sync queue via lpush and retrieves via lrange', async () => {
      await redisService.del(`sync:inbox:${testUser}`);
      await redisService.lpush(`sync:inbox:${testUser}`, JSON.stringify({ id: '1', msg: 'first' }));
      await redisService.lpush(`sync:inbox:${testUser}`, JSON.stringify({ id: '2', msg: 'second' }));

      const items = await chatService.getSyncQueue(testUser, 10);
      expect(items.length).toBe(2);
      expect(items[0].id).toBe('2'); // Newest first
      expect(items[1].id).toBe('1');
    });

    test('acknowledges and trims processed items', async () => {
      await redisService.del(`sync:inbox:${testUser}`);
      await redisService.lpush(`sync:inbox:${testUser}`, JSON.stringify({ id: '1', msg: 'first' }));
      await redisService.lpush(`sync:inbox:${testUser}`, JSON.stringify({ id: '2', msg: 'second' }));

      await chatService.ackSyncQueue(testUser, 1);
      const remaining = await chatService.getSyncQueue(testUser, 10);
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe('1');
    });

    test('fans out sync queue items to recipients on message save', async () => {
      const conv = await chatService.createConversation('sync-sender', ['sync-recipient'], 'Sync Test');
      const msg = await chatService.saveMessage(
        conv.id,
        'sync-sender',
        'Sender Name',
        'Hello Sync Queue!',
        'text',
      );

      // Verify ID was generated via IdService (26 characters Crockford base32)
      expect(msg.id.length).toBe(26);

      // Give setImmediate background task a tick to populate sync queue
      await new Promise((r) => setTimeout(r, 60));

      const recipientQueue = await chatService.getSyncQueue('sync-recipient', 10);
      expect(recipientQueue.length).toBeGreaterThanOrEqual(1);
      expect(recipientQueue[0].id).toBe(msg.id);
      expect(recipientQueue[0].content).toBe('Hello Sync Queue!');
    });
  });
});
