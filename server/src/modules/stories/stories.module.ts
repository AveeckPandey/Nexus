import { Module } from '@nestjs/common';
import { DynamoDbModule } from '../dynamodb/dynamodb.module';
import { AuthModule } from '../auth/auth.module';
import { StoriesService } from './stories.service';
import { StoriesController } from './stories.controller';

@Module({
  imports: [DynamoDbModule, AuthModule],
  controllers: [StoriesController],
  providers: [StoriesService],
  exports: [StoriesService],
})
export class StoriesModule {}
