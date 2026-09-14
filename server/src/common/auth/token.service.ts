import { Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { AWS_CONFIG } from '../../config/aws.config';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { RedisService } from '../redis/redis.service';

function b64urlEncode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function b64urlDecode<T>(part: string): T {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
}

/**
 * Single place that decides what a valid token is:
 * 1) Cognito ID token (primary), 2) server-minted Google session JWT (HS256).
 * No demo/sandbox bypasses — misconfiguration throws loudly.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;
  private readonly verifiedCache = new Map<string, { user: AuthenticatedUser; expiresAt: number }>();

  constructor(@Optional() private readonly redis?: RedisService) {
    if (AWS_CONFIG.cognitoUserPoolId && AWS_CONFIG.cognitoClientId) {
      try {
        this.verifier = CognitoJwtVerifier.create({
          userPoolId: AWS_CONFIG.cognitoUserPoolId,
          tokenUse: 'id',
          clientId: AWS_CONFIG.cognitoClientId,
        });
      } catch (err: any) {
        this.logger.warn(`Cognito verifier init failed: ${err.message}`);
        this.verifier = null;
      }
    }
  }

  private sessionSecret(): string {
    const s = process.env.SESSION_JWT_SECRET || '';
    if (s.length < 32) {
      throw new UnauthorizedException(
        'Server misconfigured: SESSION_JWT_SECRET must be 32+ chars',
      );
    }
    return s;
  }

  /** Mint a 7-day session JWT for Google-verified users. */
  mintSessionToken(user: AuthenticatedUser): string {
    const header = b64urlEncode({ alg: 'HS256', typ: 'JWT' });
    const body = b64urlEncode({
      ...user,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400 * 7,
    });
    const sig = crypto
      .createHmac('sha256', this.sessionSecret())
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${sig}`;
  }

  private verifySessionToken(token: string): AuthenticatedUser | null {
    try {
      const [h, b, s] = token.split('.');
      if (!h || !b || !s) return null;
      const expected = crypto
        .createHmac('sha256', this.sessionSecret())
        .update(`${h}.${b}`)
        .digest('base64url');
      if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
      const payload = b64urlDecode<any>(b);
      if (!payload?.userId || !payload?.email) return null;
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return {
        userId: payload.userId,
        email: payload.email,
        username: payload.username || payload.email.split('@')[0],
        name: payload.name,
        avatarUrl: payload.avatarUrl,
      };
    } catch {
      return null;
    }
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    // Shared Redis cache first (multi-pod), then local LRU.
    try {
      const shared = await this.redis?.getJson<AuthenticatedUser>(`auth:cache:${tokenHash}`);
      if (shared?.userId && shared?.email) return shared;
    } catch {}
    const cached = this.verifiedCache.get(tokenHash);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }

    let user: AuthenticatedUser | null = null;
    if (this.verifier) {
      try {
        const p = await this.verifier.verify(token);
        user = {
          userId: p.sub,
          email: String(p.email),
          username: String(p['cognito:username'] || p.email),
          name: String((p as any).name || p.email),
          avatarUrl: (p as any).picture,
        };
      } catch {
        // fall through to session token
      }
    }

    if (!user) {
      user = this.verifySessionToken(token);
    }

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Bounded eviction: keep max 10,000 entries
    if (this.verifiedCache.size >= 10000) {
      const first = this.verifiedCache.keys().next().value;
      if (first) this.verifiedCache.delete(first);
    }
    this.verifiedCache.set(tokenHash, {
      user,
      expiresAt: Date.now() + 60_000,
    });
    try {
      await this.redis?.setJson(`auth:cache:${tokenHash}`, user, 60);
    } catch {}

    return user;
  }
}
