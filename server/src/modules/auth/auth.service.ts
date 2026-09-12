import {
  Injectable,
  Logger,
  BadRequestException,
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
} from '@aws-sdk/client-cognito-identity-provider';
import { cognitoClient, AWS_CONFIG, cognitoSecretHash } from '../../config/aws.config';
import { DynamoDbService } from '../dynamodb/dynamodb.service';
import { TokenService } from '../../common/auth/token.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

export interface UserProfile {
  userId: string;
  email: string;
  username: string;
  name?: string;
  avatarUrl?: string;
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

function decodeJwt(token: string): any {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DynamoDbService,
    private readonly tokens: TokenService,
  ) {}

  async signUp(dto: { email: string; password: string; name?: string }) {
    const cleanEmail = dto.email.trim().toLowerCase();
    if (!hasCognito()) {
      this.logger.log(`Local dev sign up for ${cleanEmail}`);
      const existing = await this.db.get(`AUTH#${cleanEmail}`, 'CRED');
      if (existing) {
        throw new BadRequestException('Account exists already — sign in instead.');
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(dto.password, salt, 1000, 64, 'sha512').toString('hex');
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
        username: cleanEmail.split('@')[0],
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
      throw new BadRequestException(err.message || 'Sign up failed');
    }
  }

  async confirmSignUp(dto: { email: string; code: string }) {
    if (!hasCognito()) {
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
      throw new BadRequestException(err.message || 'Invalid confirmation code');
    }
  }

  async resendCode(dto: { email: string }) {
    if (!hasCognito()) {
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
      throw new BadRequestException(err.message || 'Resend failed');
    }
  }

  async login(dto: { email: string; password: string }) {
    const cleanEmail = dto.email.trim().toLowerCase();
    if (!hasCognito()) {
      this.logger.log(`Local dev login for ${cleanEmail}`);
      const cred = await this.db.get(`AUTH#${cleanEmail}`, 'CRED');
      if (!cred) {
        throw new UnauthorizedException('Incorrect email or password.');
      }
      const hash = crypto.pbkdf2Sync(dto.password, cred.salt, 1000, 64, 'sha512').toString('hex');
      if (hash !== cred.hash) {
        throw new UnauthorizedException('Incorrect email or password.');
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
      if (!idToken) throw new UnauthorizedException('Authentication failed');
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
      throw new UnauthorizedException(err.message || 'Invalid email or password');
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

  async refresh(refreshToken: string) {
    requireCognito();
    try {
      const r = await cognitoClient.send(
        new InitiateAuthCommand({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: AWS_CONFIG.cognitoClientId,
          AuthParameters: { REFRESH_TOKEN: refreshToken },
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

  async syncProfile(u: AuthenticatedUser): Promise<UserProfile> {
    const existing = await this.db.get<UserProfile>(`USER#${u.userId}`, 'PROFILE');
    if (existing) {
      const now = new Date().toISOString();
      await this.db.update(`USER#${u.userId}`, 'PROFILE', 'SET lastSeen = :n, isOnline = :o', {
        ':n': now,
        ':o': true,
      });
      return { ...existing, isOnline: true, lastSeen: now };
    }
    const now = new Date().toISOString();
    const profile: UserProfile = {
      userId: u.userId,
      email: u.email,
      username: u.username || u.email.split('@')[0],
      name: u.name || u.username,
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
      ...profile,
    });
    return profile;
  }

  getProfile(userId: string) {
    return this.db.get<UserProfile>(`USER#${userId}`, 'PROFILE');
  }

  /** Public directory entry for key exchange — public key and names only. */
  async getPublicEntry(userId: string) {
    const p = await this.getProfile(userId);
    if (!p) return null;
    return {
      userId: p.userId,
      username: p.username,
      name: p.name,
      x25519PublicKey: p.x25519PublicKey || null,
    };
  }

  async updateProfile(
    userId: string,
    patch: { language?: string; name?: string; x25519PublicKey?: string },
  ) {
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
    if (patch.x25519PublicKey) {
      const key = patch.x25519PublicKey.trim();
      if (!/^[A-Za-z0-9+/=]{40,48}$/.test(key)) {
        throw new BadRequestException('Invalid x25519PublicKey');
      }
      await this.db.update(`USER#${userId}`, 'PROFILE', 'SET x25519PublicKey = :k', {
        ':k': key,
      });
    }
  }

  async setLanguage(userId: string, language: string) {
    await this.updateProfile(userId, { language });
  }
}
