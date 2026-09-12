import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ChatService } from '../chat.service';

/**
 * IDOR protection: request.user must hold a membership row for the target
 * conversation (params.conversationId / params.id / body.conversationId).
 */
@Injectable()
export class MemberGuard implements CanActivate {
  constructor(private readonly chat: ChatService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const conversationId: string =
      req.params?.conversationId || req.params?.id || req.body?.conversationId;
    if (!conversationId || !req.user?.userId) {
      throw new ForbiddenException('Forbidden');
    }
    const ok = await this.chat.isMember(conversationId, req.user.userId);
    if (!ok) throw new ForbiddenException('Forbidden');
    return true;
  }
}
