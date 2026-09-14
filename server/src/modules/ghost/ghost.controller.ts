import { Controller, Post, Get, Delete, Param, Req, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { GhostService } from './ghost.service';
import { CognitoAuthGuard } from '../../common/guards/cognito-auth.guard';
import { TokenService } from '../../common/auth/token.service';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

@Controller('api/ghost')
export class GhostController {
  constructor(
    private readonly ghost: GhostService,
    private readonly tokens: TokenService,
  ) {}

  @Post('invite')
  async create(@Req() req: any, @Query('guestId') queryGuestId?: string) {
    let userId: string | undefined;
    const authHeader: string | undefined = req.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = await this.tokens.verify(authHeader.slice('Bearer '.length));
        userId = payload.userId;
      } catch {
        // Fall back to guest
      }
    }
    if (!userId) {
      userId = queryGuestId || `guest_${uuidv4().slice(0, 8)}`;
    }
    return { success: true, ...(await this.ghost.createInvite(userId)), userId, isGuest: !authHeader };
  }

  @Get('join/:token')
  async join(
    @Param('token') token: string,
    @Req() req: any,
    @Query('guestId') queryGuestId?: string,
  ) {
    let userId: string | undefined;
    const authHeader: string | undefined = req.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = await this.tokens.verify(authHeader.slice('Bearer '.length));
        userId = payload.userId;
      } catch {
        // Fall back to guest session
      }
    }
    if (!userId) {
      userId = queryGuestId || `guest_${uuidv4().slice(0, 8)}`;
    }
    const result = await this.ghost.claimInvite(token, userId);
    return { success: true, ...result, userId, isGuest: !authHeader };
  }

  /** Wipe a whole ghost room (messages + members). Participant-only. */
  @Delete('room/:roomId')
  async destroy(
    @Param('roomId') roomId: string,
    @Req() req: any,
    @Query('guestId') queryGuestId?: string,
  ) {
    let userId: string | undefined;
    const authHeader: string | undefined = req.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = await this.tokens.verify(authHeader.slice('Bearer '.length));
        userId = payload.userId;
      } catch {
        // Fall back to guest session
      }
    }
    if (!userId) userId = queryGuestId;
    if (!userId || !(await this.ghost.isParticipant(roomId, userId))) {
      throw new ForbiddenException('Not a participant of this room.');
    }
    const { deleted } = await this.ghost.destroyRoom(roomId);
    return { success: true, deleted };
  }
}
