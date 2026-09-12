import { Controller, Post, Get, Param, UseGuards } from '@nestjs/common';
import { GhostService } from './ghost.service';
import { CognitoAuthGuard } from '../../common/guards/cognito-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

@Controller('api/ghost')
export class GhostController {
  constructor(private readonly ghost: GhostService) {}

  @Post('invite')
  @UseGuards(CognitoAuthGuard)
  async create(@CurrentUser() u: AuthenticatedUser) {
    return { success: true, ...(await this.ghost.createInvite(u.userId)) };
  }

  @Get('join/:token')
  @UseGuards(CognitoAuthGuard)
  async join(@Param('token') token: string, @CurrentUser() u: AuthenticatedUser) {
    return { success: true, ...(await this.ghost.claimInvite(token, u.userId)) };
  }
}
