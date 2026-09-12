import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

@Module({ imports: [AuthModule], controllers: [AiController], providers: [AiService] })
export class AiModule {}
