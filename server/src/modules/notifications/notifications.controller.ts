import {
  Controller,
  Post,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CognitoAuthGuard } from '../../common/guards/cognito-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('register-token')
  @UseGuards(CognitoAuthGuard)
  async register(
    @CurrentUser() u: AuthenticatedUser,
    @Body()
    b: { platform?: 'ios' | 'android' | 'web'; pushToken?: string; subscription?: any },
  ) {
    if (!b.platform || !['ios', 'android', 'web'].includes(b.platform)) {
      throw new BadRequestException('Valid platform required');
    }
    await this.notifications.registerToken(u.userId, b.platform, b.pushToken, b.subscription);
    return { success: true };
  }
}
