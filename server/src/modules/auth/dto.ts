import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Web-native handle: 3–20 chars, lowercase alnum + underscore. */
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const X25519_RE = /^[A-Za-z0-9+/=]{40,48}$/;

export class SignUpDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @Matches(USERNAME_RE, { message: 'Username must be 3–20 characters: lowercase letters, numbers, underscore.' })
  username?: string;
}

export class ConfirmDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  code!: string;
}

export class ResendDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class GoogleDto {
  @IsString()
  @MinLength(1)
  credential!: string;
}

export class GithubDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @Matches(USERNAME_RE, { message: 'Username must be 3–20 characters: lowercase letters, numbers, underscore.' })
  username?: string;

  @IsOptional()
  @Matches(X25519_RE, { message: 'Invalid x25519PublicKey' })
  x25519PublicKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  about?: string;
}
