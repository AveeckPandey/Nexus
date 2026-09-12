import { Module } from '@nestjs/common';
import { DynamoDbModule } from '../dynamodb/dynamodb.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { CognitoAuthGuard } from '../../common/guards/cognito-auth.guard';
import { TokenService } from '../../common/auth/token.service';

@Module({
  imports: [DynamoDbModule],
  controllers: [AuthController],
  providers: [AuthService, CognitoAuthGuard, TokenService],
  exports: [AuthService, CognitoAuthGuard, TokenService],
})
export class AuthModule {}
