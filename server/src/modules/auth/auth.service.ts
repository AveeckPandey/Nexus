import {
  Injectable,
  Logger,
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { cognitoClient, AWS_CONFIG, cognitoSecretHash } from '../../config/aws.config';
import { DynamoDbService } from '../dynamodb/dynamodb.service';
import { TokenService } from '../../common/auth/token.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

export interface UserProfile {
  userId: string;
  email: string;
  username: string;
  name?: string;
  avatarUrl?: string;
  /** Short status line shown on the profile screen ("What's happening?"). */
  about?: string;
  /** X25519 public key (base64) for conversation-key envelopes. */
  x25519PublicKey?: string;
  preferredLanguage: string;
  isOnline: boolean;
  lastSeen: string;
  createdAt: string;
}

function hasCognito(): boolean {
  return Boolean(AWS_CONFIG.cognitoUserPoolId && AWS_CONFIG.cognitoClientId);
}

function requireCognito() {
  if (!hasCognito()) {
    throw new BadRequestException(
      'Server misconfigured: COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID required',
    );
  }
}

/**
 * Local-development auth fallback (no Cognito). This path mints real session
 * tokens, so it must never silently activate in a deployed environment:
 * production requires an explicit ALLOW_DEV_AUTH=true opt-in.
 */
function devAuthAllowed(): boolean {
  if (process.env.ALLOW_DEV_AUTH === 'true') return true;
  if (process.env.ALLOW_DEV_AUTH === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

function requireDevAuth() {
  if (!devAuthAllowed()) {
    throw new BadRequestException(
      'Server misconfigured: COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID required (local-dev auth is disabled; set ALLOW_DEV_AUTH=true only for development)',
    );
  }
}

function decodeJwt(token: string): any {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Map AWS/Cognito errors to safe client messages. Raw `err.message` leaks
 * internals ("UserNotFoundException", pool IDs) and enables enumeration.
 */
function cognitoErrorMessage(err: any, fallback: string): string {
  const name = err?.name || '';
  if (name.includes('UsernameExists')) return 'Account exists already — sign in instead.';
  if (name.includes('InvalidPassword')) return 'Password does not meet requirements.';
  if (name.includes('CodeMismatch') || name.includes('ExpiredCode'))
    return 'Invalid or expired confirmation code.';
  if (name.includes('TooManyRequests') || name.includes('LimitExceeded'))
    return 'Too many attempts. Please try again later.';
  return fallback;
}

/** Web-native invite handles: @aveeck — 3–20 chars, lowercase alnum + underscore. */
import {
  USERNAME_RE,
  normalizeUsername,
  baseFromEmail,
  searchDirectory,
  toPublicEntry as toEntry,
  type PublicUserEntry,
} from './directory.util';
export { USERNAME_RE, normalizeUsername, baseFromEmail };
export type { PublicUserEntry } from './directory.util';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DynamoDbService,
    private readonly tokens: TokenService,
    private readonly redis: RedisService,
  ) {}

  async signUp(dto: { email: string; password: string; name?: string; username?: string }) {
    const cleanEmail = dto.email.trim().toLowerCase();
    if (dto.username !== undefined && normalizeUsername(dto.username) === null) {
      throw new BadRequestException(
        'Username must be 3–20 characters: lowercase letters, numbers, underscore.',
      );
    }
    if (!hasCognito()) {
      requireDevAuth();
      this.logger.log(`Local dev sign up for ${cleanEmail}`);
      const existing = await this.db.get(`AUTH#${cleanEmail}`, 'CRED');
      if (existing) {
        throw new BadRequestException('Account exists already — sign in instead.');
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = AuthService.hashPassword(dto.password, salt);
      const userId = uuidv4();
      await this.db.put({
        PK: `AUTH#${cleanEmail}`,
        SK: 'CRED',
        userId,
        email: cleanEmail,
        salt,
        hash,
        createdAt: new Date().toISOString(),
      });
      const user = await this.syncProfile({
        userId,
        email: cleanEmail,
        username: normalizeUsername(dto.username) || cleanEmail.split('@')[0],
        name: dto.name || cleanEmail.split('@')[0],
      });
      return {
        success: true,
        userSub: userId,
        isConfirmed: true,
        message: 'Account created successfully.',
      };
    }

    requireCognito();
    try {
      const r = await cognitoClient.send(
        new SignUpCommand({
          ClientId: AWS_CONFIG.cognitoClientId,
          Username: dto.email,
          Password: dto.password,
          SecretHash: cognitoSecretHash(dto.email),
          UserAttributes: [
            { Name: 'email', Value: dto.email },
            { Name: 'name', Value: dto.name || dto.email.split('@')[0] },
          ],
        }),
      );
      return {
        success: true,
        userSub: r.UserSub,
        isConfirmed: r.UserConfirmed || false,
        message: r.UserConfirmed
          ? 'Account created and confirmed.'
          : 'Verification code sent to your email address.',
      };
    } catch (err: any) {
      throw new BadRequestException(cognitoErrorMessage(err, 'Sign up failed. Please try again.'));
    }
  }

  async confirmSignUp(dto: { email: string; code: string }) {
    if (!hasCognito()) {
      requireDevAuth();
      return { success: true, message: 'Account verified. You may now sign in.' };
    }
    requireCognito();
    try {
      await cognitoClient.send(
        new ConfirmSignUpCommand({
          ClientId: AWS_CONFIG.cognitoClientId,
          Username: dto.email,
          ConfirmationCode: dto.code,
          SecretHash: cognitoSecretHash(dto.email),
        }),
      );
      return { success: true, message: 'Account verified. You may now sign in.' };
    } catch (err: any) {
      throw new BadRequestException(
        cognitoErrorMessage(err, 'Invalid confirmation code. Please try again.'),
      );
    }
  }

  /** Start password reset. Always returns the same message (anti-enumeration). */
  async forgotPassword(dto: { email: string }) {
    const cleanEmail = dto.email.trim().toLowerCase();
    const done = { success: true, message: 'If an account exists for this email, a reset code was sent.' };
    if (!hasCognito()) {
      requireDevAuth();
      const cred = await this.db.get(`AUTH#${cleanEmail}`, 'CRED');
      if (!cred) return done;
      const code = String(crypto.randomInt(100000, 1000000));
      try {
        await this.redis.set(`auth:reset:${cleanEmail}`, code, 'EX', 900);
        await this.redis.del(`auth:resetfail:${cleanEmail}`);
      } catch {}
      // Dev-only: no mailer configured — surface via server log, never the API.
      this.logger.log(`Password reset code for ${cleanEmail} (dev fallback, expires in 15 min)`);
      return done;
    }
    requireCognito();
    try {
      await cognitoClient.send(
        new ForgotPasswordCommand({
          ClientId: AWS_CONFIG.cognitoClientId,
          Username: cleanEmail,
          SecretHash: cognitoSecretHash(cleanEmail),
        }),
      );
    } catch (err: any) {
      // UserNotFound included: identical response whether the account exists.
      const name = err?.name || '';
      if (!name.includes('UserNotFound')) {
        throw new BadRequestException(cognitoErrorMessage(err, 'Could not start password reset.'));
      }
    }
    return done;
  }

  /** Confirm reset code + set new password. Generic errors (anti-enumeration). */
  async resetPassword(dto: { email: string; code: string; newPassword: string }) {
    const cleanEmail = dto.email.trim().toLowerCase();
    const code = dto.code.trim();
    if (!hasCognito()) {
      requireDevAuth();
      let stored: string | null = null;
      try {
        stored = await this.redis.get(`auth:reset:${cleanEmail}`);
      } catch {}
      if (!stored) {
        throw new BadRequestException('Invalid or expired reset code.');
      }
      let ok = false;
      try {
        const a = Buffer.from(code);
        const b = Buffer.from(stored);
        ok = a.length === b.length && crypto.timingSafeEqual(a, b);
      } catch {
        ok = false;
      }
      if (!ok) {
        try {
          const hits = await this.redis.incr(`auth:resetfail:${cleanEmail}`);
          if (hits === 1) await this.redis.expire(`auth:resetfail:${cleanEmail}`, 900);
          if (hits >= 5) await this.redis.del(`auth:reset:${cleanEmail}`);
        } catch {}
        throw new BadRequestException('Invalid or expired reset code.');
      }
      const cred = await this.db.get<any>(`AUTH#${cleanEmail}`, 'CRED');
      if (!cred) throw new BadRequestException('Invalid or expired reset code.');
      const salt = crypto.randomBytes(16).toString('hex');
      await this.db.put({
        PK: `AUTH#${cleanEmail}`,
        SK: 'CRED',
        userId: cred.userId,
        email: cleanEmail,
        salt,
        hash: AuthService.hashPassword(dto.newPassword, salt),
        createdAt: cred.createdAt || new Date().toISOString(),
      });
      try {
        await this.redis.del(`auth:reset:${cleanEmail}`);
        await this.redis.del(`auth:resetfail:${cleanEmail}`);
      } catch {}
      await this.clearLoginFails(cleanEmail);
      return { success: true, message: 'Password updated. Please sign in with your new password.' };
    }
    requireCognito();
    try {
      await cognitoClient.send(
        new ConfirmForgotPasswordCommand({
          ClientId: AWS_CONFIG.cognitoClientId,
          Username: cleanEmail,
          ConfirmationCode: code,
          Password: dto.newPassword,
          SecretHash: cognitoSecretHash(cleanEmail),
        }),
      );
    } catch (err: any) {
      throw new BadRequestException(cognitoErrorMessage(err, 'Password reset failed.'));
    }
    await this.clearLoginFails(cleanEmail);
    return { success: true, message: 'Password updated. Please sign in with your new password.' };
  }

  async resendCode(dto: { email: string }) {
    if (!hasCognito()) {
      requireDevAuth();
      return { success: true, message: 'Fresh code sent (dev mode).' };
    }
    requireCognito();
    try {
      await cognitoClient.send(
        new ResendConfirmationCodeCommand({
          ClientId: AWS_CONFIG.cognitoClientId,
          Username: dto.email,
          SecretHash: cognitoSecretHash(dto.email),
        }),
      );
      return { success: true, message: 'Confirmation code resent.' };
    } catch (err: any) {
      throw new BadRequestException(cognitoErrorMessage(err, 'Resend failed. Please try again.'));
    }
  }

  async login(dto: { email: string; password: string }) {
    const cleanEmail = dto.email.trim().toLowerCase();
    await this.checkLoginLock(cleanEmail);
    if (!hasCognito()) {
      requireDevAuth();
      this.logger.log(`Local dev login for ${cleanEmail}`);
      let cred = await this.db.get(`AUTH#${cleanEmail}`, 'CRED');
      if (!cred) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = AuthService.hashPassword(dto.password, salt);
        const userId = uuidv4();
        await this.db.put({
          PK: `AUTH#${cleanEmail}`,
          SK: 'CRED',
          userId,
          email: cleanEmail,
          salt,
          hash,
          createdAt: new Date().toISOString(),
        });
        await this.syncProfile({
          userId,
          email: cleanEmail,
          username: cleanEmail.split('@')[0],
          name: cleanEmail.split('@')[0],
        });
        cred = { userId, salt, hash };
      } else {
        if (!this.verifyPassword(dto.password, cred.salt, cred.hash)) {
          // Transparent upgrade: accounts hashed with legacy 1,000 iterations.
          if (this.verifyPasswordLegacy(dto.password, cred.salt, cred.hash)) {
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = AuthService.hashPassword(dto.password, salt);
            await this.db.put({
              PK: `AUTH#${cleanEmail}`,
              SK: 'CRED',
              userId: cred.userId,
              email: cleanEmail,
              salt,
              hash,
              createdAt: cred.createdAt || new Date().toISOString(),
            });
            cred = { ...cred, salt, hash };
          } else {
            await this.recordLoginFail(cleanEmail);
            throw new UnauthorizedException('Incorrect email or password.');
          }
        }
        await this.clearLoginFails(cleanEmail);
      }
      let user = await this.getProfile(cred.userId);
      if (!user) {
        user = await this.syncProfile({
          userId: cred.userId,
          email: cleanEmail,
          username: cleanEmail.split('@')[0],
        });
      }
      const sessionToken = this.tokens.mintSessionToken({
        userId: user.userId,
        email: user.email,
        username: user.username,
        name: user.name,
        avatarUrl: user.avatarUrl,
      });
      return {
        success: true,
        idToken: sessionToken,
        accessToken: sessionToken,
        refreshToken: sessionToken,
        user,
      };
    }

    requireCognito();
    try {
      const params: Record<string, string> = {
        USERNAME: dto.email,
        PASSWORD: dto.password,
      };
      const sh = cognitoSecretHash(dto.email);
      if (sh) params.SECRET_HASH = sh;
      const r = await cognitoClient.send(
        new InitiateAuthCommand({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: AWS_CONFIG.cognitoClientId,
          AuthParameters: params,
        }),
      );
      const idToken = r.AuthenticationResult?.IdToken;
      if (!idToken) {
        await this.recordLoginFail(cleanEmail);
        throw new UnauthorizedException('Invalid email or password.');
      }
      const d = decodeJwt(idToken);
      const user = await this.syncProfile({
        userId: d?.sub,
        email: d?.email || dto.email,
        username: d?.['cognito:username'] || dto.email.split('@')[0],
        name: d?.name,
        avatarUrl: d?.picture,
      });
      return {
        success: true,
        idToken,
        accessToken: r.AuthenticationResult?.AccessToken || idToken,
        refreshToken: r.AuthenticationResult?.RefreshToken,
        user,
      };
    } catch (err: any) {
      if (err instanceof UnauthorizedException) throw err;
      // Never leak AWS/Cognito internals (user-enumeration + impl details).
      this.logger.warn(`Cognito login failed for ${cleanEmail}: ${err?.name || 'AuthError'}`);
      await this.recordLoginFail(cleanEmail);
      throw new UnauthorizedException('Invalid email or password.');
    }
  }

  // --- Brute-force lockout (5 fails → 15-min lock, shared across pods) ---
  private static readonly LOGIN_MAX_FAILS = 5;
  private static readonly LOGIN_LOCK_TTL = 900;

  private async checkLoginLock(email: string): Promise<void> {
    try {
      const locked = await this.redis.get(`auth:lock:${email}`);
      if (locked) {
        throw new HttpException(
          'Account temporarily locked after too many failed attempts. Try again in 15 minutes.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
    }
  }

  private async recordLoginFail(email: string): Promise<void> {
    try {
      const hits = await this.redis.incr(`auth:fail:${email}`);
      if (hits === 1) await this.redis.expire(`auth:fail:${email}`, AuthService.LOGIN_LOCK_TTL);
      if (hits >= AuthService.LOGIN_MAX_FAILS) {
        await this.redis.set(`auth:lock:${email}`, '1', 'EX', AuthService.LOGIN_LOCK_TTL);
        await this.redis.del(`auth:fail:${email}`);
      }
    } catch {}
  }

  private async clearLoginFails(email: string): Promise<void> {
    try {
      await this.redis.del(`auth:fail:${email}`);
      await this.redis.del(`auth:lock:${email}`);
    } catch {}
  }

  // --- Password hashing (dev fallback only; Cognito handles prod) ---
  private static readonly PBKDF2_ITERATIONS = 210_000;

  private static hashPassword(password: string, salt: string): string {
    return crypto
      .pbkdf2Sync(password, salt, AuthService.PBKDF2_ITERATIONS, 64, 'sha512')
      .toString('hex');
  }

  /** Timing-safe compare — plain `!==` leaks prefix info via short-circuit. */
  private verifyPassword(password: string, salt: string, expectedHex: string): boolean {
    try {
      const actual = Buffer.from(AuthService.hashPassword(password, salt), 'hex');
      const expected = Buffer.from(expectedHex, 'hex');
      if (actual.length !== expected.length) return false;
      return crypto.timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  /** Pre-hardening hashes (1,000 iterations). Verify-only; callers re-hash. */
  private verifyPasswordLegacy(password: string, salt: string, expectedHex: string): boolean {
    try {
      const actual = Buffer.from(
        crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex'),
        'hex',
      );
      const expected = Buffer.from(expectedHex, 'hex');
      if (actual.length !== expected.length) return false;
      return crypto.timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  /** Verify a Google ID token, sync profile, mint a server session JWT. */
  async googleLogin(dto: { credential?: string }) {
    if (!dto.credential) throw new BadRequestException('Google credential required');
    let email = '';
    let name = '';
    let sub = '';
    let picture: string | undefined;
    let audience: string | undefined;
    try {
      const r = await axios.get(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${dto.credential}`,
        { timeout: 5000 },
      );
      email = r.data.email;
      name = r.data.name;
      sub = r.data.sub;
      picture = r.data.picture;
      audience = r.data.aud;
    } catch {
      throw new UnauthorizedException('Invalid Google credential');
    }
    if (!email || !sub) throw new UnauthorizedException('Invalid Google credential');
    // Strict audience check — unverified fallbacks are not accepted.
    if (AWS_CONFIG.googleClientId && audience !== AWS_CONFIG.googleClientId) {
      throw new UnauthorizedException('Google credential audience mismatch');
    }
    const userId = `google_${sub}`;
    const user = await this.syncProfile({
      userId,
      email,
      username: email.split('@')[0],
      name: name || email.split('@')[0],
      avatarUrl: picture,
    });
    const idToken = this.tokens.mintSessionToken({
      userId: user.userId,
      email: user.email,
      username: user.username,
      name: user.name,
      avatarUrl: user.avatarUrl,
    });
    return { success: true, idToken, accessToken: idToken, user };
  }

  /** Verify a GitHub OAuth code, sync profile, mint a server session JWT. */
  async githubLogin(dto: { code?: string }) {
    if (!dto.code) throw new BadRequestException('GitHub code required');
    const clientId = process.env.GITHUB_CLIENT_ID || '';
    const clientSecret = process.env.GITHUB_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) {
      throw new BadRequestException('GitHub login is not configured on this server');
    }
    let accessToken = '';
    try {
      const t = await axios.post(
        'https://github.com/login/oauth/access_token',
        { client_id: clientId, client_secret: clientSecret, code: dto.code },
        { headers: { Accept: 'application/json' }, timeout: 5000 },
      );
      accessToken = t.data?.access_token;
    } catch {
      throw new UnauthorizedException('Invalid GitHub code');
    }
    if (!accessToken) throw new UnauthorizedException('Invalid GitHub code');
    let id = '';
    let login = '';
    let name = '';
    let avatarUrl: string | undefined;
    let email = '';
    try {
      const u = await axios.get('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
        timeout: 5000,
      });
      id = String(u.data.id || '');
      login = u.data.login || '';
      name = u.data.name || '';
      avatarUrl = u.data.avatar_url;
      email = u.data.email || '';
      if (!email) {
        const e = await axios.get('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
          timeout: 5000,
        });
        email = e.data?.find((x: any) => x.primary)?.email || e.data?.[0]?.email || '';
      }
    } catch {
      throw new UnauthorizedException('Invalid GitHub code');
    }
    if (!id || !email) throw new UnauthorizedException('GitHub email unavailable');
    const userId = `github_${id}`;
    const user = await this.syncProfile({
      userId,
      email,
      username: login || email.split('@')[0],
      name: name || login || email.split('@')[0],
      avatarUrl,
    });
    const idToken = this.tokens.mintSessionToken({
      userId: user.userId,
      email: user.email,
      username: user.username,
      name: user.name,
      avatarUrl: user.avatarUrl,
    });
    return { success: true, idToken, accessToken: idToken, user };
  }

  async refresh(refreshToken: string, email?: string) {
    // Dev fallback: the "refresh token" is a session JWT — re-mint if valid.
    if (!hasCognito()) {
      requireDevAuth();
      try {
        const session = await this.tokens.verify(refreshToken);
        const idToken = this.tokens.mintSessionToken(session);
        return { success: true, idToken, accessToken: idToken };
      } catch {
        throw new UnauthorizedException('Invalid refresh token');
      }
    }
    requireCognito();
    try {
      const params: Record<string, string> = { REFRESH_TOKEN: refreshToken };
      // App clients with a secret reject unsigned refresh calls — same hash as login.
      if (email) {
        const sh = cognitoSecretHash(email.trim().toLowerCase());
        if (sh) params.SECRET_HASH = sh;
      }
      const r = await cognitoClient.send(
        new InitiateAuthCommand({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: AWS_CONFIG.cognitoClientId,
          AuthParameters: params,
        }),
      );
      return {
        success: true,
        idToken: r.AuthenticationResult?.IdToken || '',
        accessToken: r.AuthenticationResult?.AccessToken || '',
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  getPublicConfig() {
    return {
      cognitoConfigured: Boolean(
        AWS_CONFIG.cognitoUserPoolId && AWS_CONFIG.cognitoClientId,
      ),
      userPoolId: AWS_CONFIG.cognitoUserPoolId,
      clientId: AWS_CONFIG.cognitoClientId,
      region: AWS_CONFIG.region,
      googleClientId: AWS_CONFIG.googleClientId,
    };
  }

  async syncProfile(u: AuthenticatedUser & { username?: string }): Promise<UserProfile> {
    const existing = await this.db.get<UserProfile>(`USER#${u.userId}`, 'PROFILE');
    if (existing) {
      const now = new Date().toISOString();
      await this.db.update(`USER#${u.userId}`, 'PROFILE', 'SET lastSeen = :n, isOnline = :o', {
        ':n': now,
        ':o': true,
      });
      // Backfill a unique handle + lookup row for pre-username accounts.
      if (!normalizeUsername(existing.username)) {
        const claimed = await this.ensureUniqueUsername(
          u.userId,
          normalizeUsername(u.username) || baseFromEmail(existing.email),
        );
        await this.db.update(`USER#${u.userId}`, 'PROFILE', 'SET username = :un', {
          ':un': claimed,
        });
        return { ...existing, username: claimed, isOnline: true, lastSeen: now };
      }
      return { ...existing, isOnline: true, lastSeen: now };
    }
    const now = new Date().toISOString();
    const username = await this.ensureUniqueUsername(
      u.userId,
      normalizeUsername(u.username) || baseFromEmail(u.email),
    );
    const profile: UserProfile = {
      userId: u.userId,
      email: u.email,
      username,
      name: u.name || u.username || username,
      preferredLanguage: 'en',
      isOnline: true,
      lastSeen: now,
      createdAt: now,
    };
    await this.db.put({
      PK: `USER#${u.userId}`,
      SK: 'PROFILE',
      GSI1PK: `EMAIL#${u.email}`,
      GSI1SK: `USER#${u.userId}`,
      GSI2PK: 'USER',
      GSI2SK: `${username.toLowerCase()}#${u.userId}`,
      ...profile,
    });
    await this.redis.setJson(`user:profile:${u.userId}`, profile, 300);
    await this.redis.del('cache:directory_profiles');
    return profile;
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    const cached = await this.redis.getJson<UserProfile>(`user:profile:${userId}`);
    if (cached) return cached;
    const p = await this.db.get<UserProfile>(`USER#${userId}`, 'PROFILE');
    if (p) {
      await this.redis.setJson(`user:profile:${userId}`, p, 300);
    }
    return p;
  }

  /** Public directory entry for key exchange — public key and names only. */
  async getPublicEntry(userId: string) {
    const p = await this.getProfile(userId);
    if (!p) return null;
    return {
      userId: p.userId,
      username: p.username,
      name: p.name,
      avatarUrl: (p as { avatarUrl?: string }).avatarUrl,
      about: p.about,
      x25519PublicKey: p.x25519PublicKey || null,
    };
  }

  /**
   * Claim the USERNAME#<name> lookup row for a user (exact-match directory).
   * Appends a numeric suffix on collision: aveeck, aveeck_1, aveeck_2 …
   */
  async ensureUniqueUsername(userId: string, base: string): Promise<string> {
    for (let i = 0; i < 100; i++) {
      const candidate = i === 0 ? base : `${base.slice(0, 18)}_${i}`.slice(0, 20);
      if (!USERNAME_RE.test(candidate)) continue;
      const taken = await this.db.get<{ userId: string }>(`USERNAME#${candidate}`, 'PROFILE');
      if (!taken || taken.userId === userId) {
        await this.db.put({
          PK: `USERNAME#${candidate}`,
          SK: 'PROFILE',
          username: candidate,
          userId,
          claimedAt: new Date().toISOString(),
        });
        await this.redis.set(`username:${candidate}`, userId, 'EX', 600);
        return candidate;
      }
    }
    // Statistically impossible — fall back to a userId-derived handle.
    const fallback = `user_${userId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 14)}`;
    await this.db.put({
      PK: `USERNAME#${fallback}`,
      SK: 'PROFILE',
      username: fallback,
      userId,
      claimedAt: new Date().toISOString(),
    });
    await this.redis.set(`username:${fallback}`, userId, 'EX', 600);
    return fallback;
  }

  /** Exact handle lookup with Redis cache and bounded fallback. */
  async getByUsername(username: string): Promise<UserProfile | null> {
    const clean = normalizeUsername(username);
    if (!clean) return null;

    const cachedUserId = await this.redis.get(`username:${clean}`);
    if (cachedUserId) {
      const p = await this.getProfile(cachedUserId);
      if (p) return p;
    }

    const hit = await this.db.get<{ userId: string }>(`USERNAME#${clean}`, 'PROFILE');
    if (hit?.userId) {
      await this.redis.set(`username:${clean}`, hit.userId, 'EX', 600);
      const p = await this.getProfile(hit.userId);
      if (p) return p;
    }

    const profiles = await this.getCachedDirectoryProfiles();
    const match = profiles.find(
      (p) => typeof p.username === 'string' && p.username.toLowerCase() === clean,
    );
    return (match as UserProfile) || null;
  }

  /** Sub-millisecond exact email lookup via GSI1PK = EMAIL#<email> (spec §4). */
  async findByEmail(email: string): Promise<UserProfile | null> {
    const clean = email.trim().toLowerCase();
    if (!clean) return null;
    const hits = await this.db.queryGsi<UserProfile>(`EMAIL#${clean}`, undefined, 1);
    if (hits.length) return hits[0];
    return null;
  }

  /**
   * Resolve a personal invite code to a profile. Accepts a userId,
   * @username, username, or email address.
   */
  async resolveInviteCode(code: string): Promise<UserProfile | null> {
    const raw = code.trim();
    if (!raw) return null;
    if (raw.includes('@') && raw.includes('.')) {
      const byEmail = await this.findByEmail(raw.replace(/^@+/, ''));
      if (byEmail) return byEmail;
    }
    const direct = await this.getProfile(raw);
    if (direct) return direct;
    return this.getByUsername(raw);
  }

  /** Helper to cache directory profiles for 5min to prevent DynamoDB scans */
  private async getCachedDirectoryProfiles(): Promise<UserProfile[]> {
    const cached = await this.redis.getJson<UserProfile[]>('cache:directory_profiles');
    if (cached && Array.isArray(cached)) return cached;
    const profiles = (await this.db.scanProfiles(200)) as UserProfile[];
    await this.redis.setJson('cache:directory_profiles', profiles, 300);
    return profiles;
  }

  /**
   * Authenticated directory search: exact-email fast path, exact USERNAME#
   * lookup, GSI2 prefix query (no Scan), then cached substring fallback.
   * Per-query Redis cache (60s) prevents a DynamoDB read per keystroke.
   */
  async searchUsers(q: string, excludeUserId: string, limit = 10): Promise<PublicUserEntry[]> {
    const query = q.trim().toLowerCase().replace(/^@+/, '');
    if (!query || query.length < 2) return [];
    if (query.length > 64) return [];
    const cacheKey = `search:${query}:${limit}`;
    try {
      const hit = await this.redis.getJson<PublicUserEntry[]>(cacheKey);
      if (hit) return hit.filter((u) => u.userId !== excludeUserId);
    } catch {}
    if (query.includes('@')) {
      const exact = await this.findByEmail(query);
      if (exact && exact.userId !== excludeUserId) return [this.toPublicEntry(exact)];
    }
    // O(1) exact handle lookup before any scan (covers invite/mention fast path).
    const byHandle = await this.getByUsername(query);
    if (byHandle && byHandle.userId !== excludeUserId) {
      const out = [this.toPublicEntry(byHandle)];
      await this.redis.setJson(cacheKey, out, 60).catch(() => {});
      return out;
    }
    // GSI2 prefix query — zero Scans at 10k+ scale (falls back if backfilling).
    try {
      const gsi2 = await this.db.queryGsi2<UserProfile>(query, limit);
      if (gsi2.length) {
        const out = gsi2
          .filter((p) => p.userId !== excludeUserId)
          .slice(0, limit)
          .map((p) => this.toPublicEntry(p));
        if (out.length) {
          await this.redis.setJson(cacheKey, out, 60).catch(() => {});
          return out;
        }
      }
    } catch {}
    const profiles = await this.getCachedDirectoryProfiles();
    const out = searchDirectory(profiles, q, excludeUserId, limit);
    await this.redis.setJson(cacheKey, out, 60).catch(() => {});
    return out;
  }

  toPublicEntry(p: UserProfile): PublicUserEntry {
    return toEntry(p);
  }

  /** User-initiated handle claim from Profile settings. */
  async claimUsername(userId: string, username: string): Promise<string> {
    const clean = normalizeUsername(username);
    if (!clean) {
      throw new BadRequestException(
        'Username must be 3–20 characters: lowercase letters, numbers, underscore.',
      );
    }
    const taken = await this.db.get<{ userId: string }>(`USERNAME#${clean}`, 'PROFILE');
    if (taken && taken.userId !== userId) {
      throw new BadRequestException('Username is taken — try another.');
    }
    const profile = await this.getProfile(userId);
    if (!profile) throw new BadRequestException('Profile not found');
    if (normalizeUsername(profile.username) === clean) return clean;
    if (normalizeUsername(profile.username)) {
      await this.db.delete(`USERNAME#${(profile.username as string).toLowerCase()}`, 'PROFILE');
      await this.redis.del(`username:${(profile.username as string).toLowerCase()}`);
    }
    await this.db.put({
      PK: `USERNAME#${clean}`,
      SK: 'PROFILE',
      username: clean,
      userId,
      claimedAt: new Date().toISOString(),
    });
    await this.db.update(`USER#${userId}`, 'PROFILE', 'SET username = :un, GSI2PK = :gpk, GSI2SK = :gsk', {
      ':un': clean,
      ':gpk': 'USER',
      ':gsk': `${clean}#${userId}`,
    });
    await this.redis.set(`username:${clean}`, userId, 'EX', 600);
    await this.redis.del(`user:profile:${userId}`);
    await this.redis.del('cache:directory_profiles');
    return clean;
  }

  async updateProfile(
    userId: string,
    patch: { language?: string; name?: string; username?: string; x25519PublicKey?: string; avatarUrl?: string; about?: string },
  ) {
    if (patch.username) {
      await this.claimUsername(userId, patch.username);
    }
    if (patch.language) {
      await this.db.update(`USER#${userId}`, 'PROFILE', 'SET preferredLanguage = :l', {
        ':l': patch.language,
      });
    }
    if (patch.name) {
      const name = patch.name.trim().slice(0, 80);
      if (!name) throw new BadRequestException('Name must not be empty');
      await this.db.update(`USER#${userId}`, 'PROFILE', 'SET #n = :name', { ':name': name }, { '#n': 'name' });
    }
    if (patch.avatarUrl) {
      const avatarUrl = patch.avatarUrl.trim();
      await this.db.update(`USER#${userId}`, 'PROFILE', 'SET avatarUrl = :a', {
        ':a': avatarUrl,
      });
    }
    if (patch.about !== undefined) {
      const about = patch.about.trim().slice(0, 140);
      await this.db.update(`USER#${userId}`, 'PROFILE', 'SET about = :ab', {
        ':ab': about,
      });
    }
    if (patch.x25519PublicKey) {
      const key = patch.x25519PublicKey.trim();
      if (!/^[A-Za-z0-9+/=]{40,48}$/.test(key)) {
        throw new BadRequestException('Invalid x25519PublicKey');
      }
      await this.db.update(`USER#${userId}`, 'PROFILE', 'SET x25519PublicKey = :k', {
        ':k': key,
      });
    }
    await this.redis.del(`user:profile:${userId}`);
    await this.redis.del('cache:directory_profiles');
  }

  async setLanguage(userId: string, language: string) {
    await this.updateProfile(userId, { language });
  }
}
