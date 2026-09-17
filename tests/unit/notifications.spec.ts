import { NotificationsService } from '../../server/src/modules/notifications/notifications.service';
import { RedisService } from '../../server/src/common/redis/redis.service';
import { DynamoDbService } from '../../server/src/modules/dynamodb/dynamodb.service';
import { ChatService } from '../../server/src/modules/chat/chat.service';
import { IdService } from '../../server/src/common/id/id.service';

describe('Notifications System Verification Suite', () => {
  let notificationsService: NotificationsService;
  let redisService: RedisService;
  let db: DynamoDbService;
  let chatService: ChatService;
  let idService: IdService;

  beforeEach(() => {
    redisService = new RedisService();
    redisService.onModuleInit();
    db = new DynamoDbService();
    notificationsService = new NotificationsService(db, redisService);
    idService = new IdService();
    chatService = new ChatService(db, notificationsService, redisService, idService);
  });

  afterEach(async () => {
    await redisService.onModuleDestroy();
  });

  describe('1. Token Registration & Caching', () => {
    test('registers mobile Expo push token and caches in Redis', async () => {
      const userId = 'user_notif_1';
      const fakeToken = 'ExponentPushToken[xxxxxx-yyyyyy-zzzzzz]';

      await notificationsService.registerToken(userId, 'ios', fakeToken);

      // Verify cached in Redis
      const cached = await redisService.getJson<any[]>(`push:tokens:${userId}`);
      // Cache was invalidated on register to ensure fresh read on dispatch
      expect(cached).toBeNull();

      // Calling testPushNotification pulls from DynamoDB and caches in Redis
      const result = await notificationsService.testPushNotification(userId);
      expect(result.success).toBe(true);
      expect(result.tokensCount).toBe(1);
      expect(result.platforms).toContain('ios');

      // Now it should be cached
      const cachedAfter = await redisService.getJson<any[]>(`push:tokens:${userId}`);
      expect(cachedAfter).not.toBeNull();
      expect(cachedAfter?.length).toBe(1);
      expect(cachedAfter?.[0].pushToken).toBe(fakeToken);
    });

    test('registers WebPush subscription for desktop/mobile browsers', async () => {
      const userId = 'user_web_push';
      const fakeSub = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint-123',
        keys: { p256dh: 'sample-p256dh-key', auth: 'sample-auth-key' },
      };

      await notificationsService.registerToken(userId, 'web', undefined, fakeSub);

      const result = await notificationsService.testPushNotification(userId);
      expect(result.success).toBe(true);
      expect(result.tokensCount).toBe(1);
      expect(result.platforms).toContain('web');
    });

    test('returns failure when user has zero registered devices', async () => {
      const result = await notificationsService.testPushNotification('non_existent_user');
      expect(result.success).toBe(false);
      expect(result.tokensCount).toBe(0);
      expect(result.message).toContain('No push tokens');
    });
  });

  describe('2. Smart Push Suppression (Online vs Offline)', () => {
    test('suppresses push notification when recipient is ONLINE', async () => {
      const sender = 'sender_online_test';
      const recipient = 'recipient_online_test';

      // Register device for recipient
      await notificationsService.registerToken(recipient, 'android', 'ExponentPushToken[mock-token-123]');

      // Mark recipient ONLINE in Redis
      await redisService.set(`presence:${recipient}`, 'online', 'EX', 60);

      const spySend = jest.spyOn(notificationsService, 'sendPushNotification');

      const conv = await chatService.createConversation(sender, [recipient], 'Online Chat');
      await chatService.saveMessage(conv.id, sender, 'Sender', 'Hello! Are you online?', 'text');

      // Allow background dispatch tick
      await new Promise((r) => setTimeout(r, 60));

      // Because recipient is ONLINE on WebSockets, push MUST be suppressed!
      expect(spySend).not.toHaveBeenCalled();
    });

    test('dispatches push notification when recipient is OFFLINE', async () => {
      const sender = 'sender_offline_test';
      const recipient = 'recipient_offline_test';

      // Register device for recipient
      await notificationsService.registerToken(recipient, 'android', 'ExponentPushToken[mock-token-456]');

      // Mark recipient OFFLINE (or absent) in Redis
      await redisService.del(`presence:${recipient}`);

      const spySend = jest.spyOn(notificationsService, 'sendPushNotification');

      const conv = await chatService.createConversation(sender, [recipient], 'Offline Chat');
      await chatService.saveMessage(conv.id, sender, 'Sender', 'Wake up, urgent message!', 'text');

      // Allow background dispatch tick
      await new Promise((r) => setTimeout(r, 60));

      // Because recipient is OFFLINE, push MUST be dispatched!
      expect(spySend).toHaveBeenCalledWith(
        recipient,
        'Sender',
        'Wake up, urgent message!',
        { conversationId: conv.id },
      );
    });
  });
});
