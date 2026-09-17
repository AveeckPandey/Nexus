import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { RedisModule } from './common/redis/redis.module';
import { RedisService } from './common/redis/redis.service';
import { RedisThrottlerStorage } from './common/throttle/redis-throttler.storage';
import { IdModule } from './common/id/id.module';
import { DynamoDbModule } from './modules/dynamodb/dynamodb.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';
import { GhostModule } from './modules/ghost/ghost.module';
import { WebRtcModule } from './modules/webrtc/webrtc.module';
import { MediaModule } from './modules/media/media.module';
import { StoriesModule } from './modules/stories/stories.module';
import { AiModule } from './modules/ai/ai.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    IdModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ name: 'default', ttl: 60000, limit: 120 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    DynamoDbModule,
    AuthModule,
    ChatModule,
    GhostModule,
    WebRtcModule,
    MediaModule,
    StoriesModule,
    AiModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

