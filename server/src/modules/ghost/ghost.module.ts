import { Module } from '@nestjs/common';
import { DynamoDbModule } from '../dynamodb/dynamodb.module';
import { AuthModule } from '../auth/auth.module';
import { GhostService } from './ghost.service';
import { GhostController } from './ghost.controller';
import { GhostGateway } from './ghost.gateway';

@Module({
  imports: [DynamoDbModule, AuthModule],
  controllers: [GhostController],
  providers: [GhostService, GhostGateway],
})
export class GhostModule {}
