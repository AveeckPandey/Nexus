import { Controller, Get, Post, Param, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { StoriesService } from './stories.service';
import { CognitoAuthGuard } from '../../common/guards/cognito-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Post()
  @UseGuards(CognitoAuthGuard)
  async post(@CurrentUser() u: AuthenticatedUser, @Body() b: { mediaUrl?: string; mediaType?: string }) {
    if (!b.mediaUrl) throw new BadRequestException('mediaUrl required');
    const story = await this.stories.postStory(u.userId, b.mediaUrl, b.mediaType || 'image');
    return { success: true, story };
  }

  @Get()
  @UseGuards(CognitoAuthGuard)
  async mine(@CurrentUser() u: AuthenticatedUser) {
    return { success: true, stories: await this.stories.getVisibleStories(u.userId) };
  }

  @Get(':userId')
  @UseGuards(CognitoAuthGuard)
  async byUser(@Param('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId required');
    return { success: true, stories: await this.stories.getVisibleStories(userId) };
  }

  @Post(':userId/views')
  @UseGuards(CognitoAuthGuard)
  async view(
    @CurrentUser() u: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() b: { itemSk?: string },
  ) {
    if (!b.itemSk) throw new BadRequestException('itemSk required');
    return { success: true, receipt: await this.stories.recordView(userId, b.itemSk, u.userId) };
  }
}
