import { Injectable, Logger, Optional } from '@nestjs/common';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import * as webpush from 'web-push';
import { DynamoDbService } from '../dynamodb/dynamodb.service';
import { RedisService } from '../../common/redis/redis.service';
import { VAPID_CONFIG } from '../../config/vapid.config';

export interface DeviceTokenItem {
  PK: string;
  SK: string;
  userId: string;
  platform: 'ios' | 'android' | 'web';
  pushToken?: string;
  webPushSubscription?: { endpoint: string; keys: { p256dh: string; auth: string } };
  updatedAt: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly expo = new Expo();

  constructor(
    private readonly db: DynamoDbService,
    @Optional() private readonly redis?: RedisService,
  ) {
    if (VAPID_CONFIG.publicKey && VAPID_CONFIG.privateKey) {
      webpush.setVapidDetails(VAPID_CONFIG.subject, VAPID_CONFIG.publicKey, VAPID_CONFIG.privateKey);
    }
  }

  private tokensCacheKey(userId: string): string {
    return `push:tokens:${userId}`;
  }

  private async getTokens(recipientId: string): Promise<DeviceTokenItem[]> {
    try {
      const hit = await this.redis?.getJson<DeviceTokenItem[]>(this.tokensCacheKey(recipientId));
      if (hit) return hit;
    } catch {}
    const tokens = await this.db.queryByPk<DeviceTokenItem>(`USER#${recipientId}`, 'TOKEN#');
    try {
      await this.redis?.setJson(this.tokensCacheKey(recipientId), tokens, 300);
    } catch {}
    return tokens;
  }

  async registerToken(
    userId: string,
    platform: 'ios' | 'android' | 'web',
    pushToken?: string,
    webPushSubscription?: DeviceTokenItem['webPushSubscription'],
  ) {
    const keyId = pushToken || webPushSubscription?.endpoint || 'default';
    await this.db.put({
      PK: `USER#${userId}`,
      SK: `TOKEN#${keyId}`,
      userId,
      platform,
      pushToken,
      webPushSubscription,
      updatedAt: new Date().toISOString(),
    });
    try {
      await this.redis?.del(this.tokensCacheKey(userId));
    } catch {}
  }

  async sendPushNotification(
    recipientId: string,
    title: string,
    body: string,
    data: Record<string, any> = {},
  ) {
    try {
      const tokens = await this.getTokens(recipientId);
      if (!tokens.length) return;
      const expoMessages: ExpoPushMessage[] = [];
      for (const t of tokens) {
        if (t.platform !== 'web' && t.pushToken && Expo.isExpoPushToken(t.pushToken)) {
          expoMessages.push({
            to: t.pushToken,
            sound: 'default',
            title,
            body,
            data,
            badge: 1,
          });
        } else if (t.platform === 'web' && t.webPushSubscription) {
          webpush
            .sendNotification(
              t.webPushSubscription as any,
              JSON.stringify({ title, body, data, icon: '/icon.png' }),
            )
            .catch((err) => this.logger.warn(`WebPush failed: ${err.message}`));
        }
      }
      for (const chunk of this.expo.chunkPushNotifications(expoMessages)) {
        await this.expo.sendPushNotificationsAsync(chunk);
      }
    } catch (err: any) {
      this.logger.error(`Push dispatch failed: ${err.message}`);
    }
  }

  async testPushNotification(
    userId: string,
  ): Promise<{ tokensCount: number; platforms: string[]; success: boolean; message: string }> {
    const tokens = await this.getTokens(userId);
    if (!tokens.length) {
      return {
        tokensCount: 0,
        platforms: [],
        success: false,
        message: 'No push tokens or subscriptions registered for this user.',
      };
    }
    await this.sendPushNotification(
      userId,
      'Nexus Notification Test',
      '🔔 Nexus notifications are active and working!',
      { test: true, timestamp: Date.now() },
    );
    return {
      tokensCount: tokens.length,
      platforms: tokens.map((t) => t.platform),
      success: true,
      message: `Test notification dispatched to ${tokens.length} device(s) [${tokens.map((t) => t.platform).join(', ')}]`,
    };
  }
}
