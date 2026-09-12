import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DynamoDbModule } from './modules/dynamodb/dynamodb.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';
import { GhostModule } from './modules/ghost/ghost.module';
import { WebRtcModule } from './modules/webrtc/webrtc.module';
import { MediaModule } from './modules/media/media.module';
import { AiModule } from './modules/ai/ai.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DynamoDbModule,
    AuthModule,
    ChatModule,
    GhostModule,
    WebRtcModule,
    MediaModule,
    AiModule,
    NotificationsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
