import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';

@Module({ imports: [AuthModule], controllers: [MediaController], providers: [MediaService] })
export class MediaModule {}
