import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { WebRtcService } from './webrtc.service';
import { WebRtcGateway } from './webrtc.gateway';

@Module({
  imports: [AuthModule, ChatModule],
  providers: [WebRtcService, WebRtcGateway],
})
export class WebRtcModule {}
