import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';import { AuthService } from './auth.service';
import { CognitoAuthGuard } from '../../common/guards/cognito-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('config')
  config() {
    return { success: true, ...this.auth.getPublicConfig() };
  }

  @Post('signup')
  signup(@Body() b: { email?: string; password?: string; name?: string }) {
    if (!b.email || !EMAIL_RE.test(b.email)) throw new BadRequestException('Valid email required');
    if (!b.password || b.password.length < 8)
      throw new BadRequestException('Password must be 8+ characters');
    return this.auth.signUp({ email: b.email.toLowerCase(), password: b.password, name: b.name });
  }

  @Post('confirm')
  confirm(@Body() b: { email?: string; code?: string }) {
    if (!b.email || !b.code) throw new BadRequestException('Email and code required');
    return this.auth.confirmSignUp({ email: b.email.toLowerCase(), code: b.code });
  }

  @Post('resend-code')
  resend(@Body() b: { email?: string }) {
    if (!b.email) throw new BadRequestException('Email required');
    return this.auth.resendCode({ email: b.email.toLowerCase() });
  }

  @Post('login')
  login(@Body() b: { email?: string; password?: string }) {
    if (!b.email || !b.password) throw new BadRequestException('Email and password required');
    return this.auth.login({ email: b.email.toLowerCase(), password: b.password });
  }

  @Post('google')
  google(@Body() b: { credential?: string }) {
    return this.auth.googleLogin({ credential: b.credential });
  }

  @Post('refresh')
  refresh(@Body() b: { refreshToken?: string }) {
    if (!b.refreshToken) throw new BadRequestException('refreshToken required');
    return this.auth.refresh(b.refreshToken);
  }

  @Get('me')
  @UseGuards(CognitoAuthGuard)
  async me(@CurrentUser() u: AuthenticatedUser) {
    const profile = await this.auth.getProfile(u.userId);
    return { success: true, profile: profile || u };
  }

  @Get('users/:id')
  @UseGuards(CognitoAuthGuard)
  async publicEntry(@Param('id') id: string) {
    const entry = await this.auth.getPublicEntry(id);
    if (!entry) throw new BadRequestException('Unknown user');
    return { success: true, user: entry };
  }

  @Patch('profile')
  @UseGuards(CognitoAuthGuard)
  async profile(
    @CurrentUser() u: AuthenticatedUser,
    @Body() b: { language?: string; name?: string; x25519PublicKey?: string },
  ) {
    if (!b.language && !b.name && !b.x25519PublicKey) {
      throw new BadRequestException('Nothing to update');
    }
    await this.auth.updateProfile(u.userId, b);
    return { success: true };
  }

  @Patch('language')
  @UseGuards(CognitoAuthGuard)
  async language(
    @CurrentUser() u: AuthenticatedUser,
    @Body() b: { language?: string },
  ) {
    if (!b.language) throw new BadRequestException('language required');
    await this.auth.setLanguage(u.userId, b.language);
    return { success: true };
  }
}
