import {
  Controller,
  Post,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { MediaService } from './media.service';
import { CognitoAuthGuard } from '../../common/guards/cognito-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

@Controller('api/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('presigned-url')
  @UseGuards(CognitoAuthGuard)
  presigned(
    @CurrentUser() u: AuthenticatedUser,
    @Body() b: { fileType?: string; fileExtension?: string },
  ) {
    if (!b.fileType || !b.fileExtension) {
      throw new BadRequestException('fileType and fileExtension required');
    }
    return this.media.presignedPut(u.userId, b.fileType, b.fileExtension);
  }
}
