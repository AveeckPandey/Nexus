import { Module } from '@nestjs/common';
import { DynamoDbModule } from '../dynamodb/dynamodb.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiModule } from '../ai/ai.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { MemberGuard } from './guards/member.guard';

@Module({
  imports: [DynamoDbModule, AuthModule, NotificationsModule, AiModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, MemberGuard],
  exports: [ChatService, MemberGuard],
})
export class ChatModule {}
