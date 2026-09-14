/**
 * tests/unit/auth.spec.ts — session token minting, validation, and loud
 * misconfiguration (TESTING_SPEC.md §3 `unit/auth.spec.ts`).
 * Exercises the REAL server TokenService with Cognito unconfigured, so the
 * HS256 dev/session path is under test with zero network access.
 */
import * as crypto from 'crypto';
import { TokenService } from '../../server/src/common/auth/token.service';

const SECRET = '0123456789abcdef0123456789abcdef-unit-test';

function craftExpiredToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      userId: 'u_expired',
      email: 'old@example.com',
      username: 'oldie',
      iat: Math.floor(Date.now() / 1000) - 86400 * 8,
      exp: Math.floor(Date.now() / 1000) - 10,
    }),
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

describe('TokenService session JWTs', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, SESSION_JWT_SECRET: SECRET };
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('mint→verify round-trip preserves identity fields', async () => {
    const svc = new TokenService();
    const token = svc.mintSessionToken({
      userId: 'u_1',
      email: 'alice@example.com',
      username: 'alice',
      name: 'Alice',
    });
    expect(token.split('.')).toHaveLength(3);
    const user = await svc.verify(token);
    expect(user.userId).toBe('u_1');
    expect(user.email).toBe('alice@example.com');
    expect(user.username).toBe('alice');
    expect(user.name).toBe('Alice');
  });

  test('username defaults to the email prefix when absent', async () => {
    const svc = new TokenService();
    const token = svc.mintSessionToken({ userId: 'u_2', email: 'bob@example.com', username: '' });
    const user = await svc.verify(token);
    expect(user.username).toBe('bob');
  });

  test('tampered payload is rejected', async () => {
    const svc = new TokenService();
    const token = svc.mintSessionToken({ userId: 'u_1', email: 'a@x.com', username: 'a' });
    const [h, b, s] = token.split('.');
    const forgedBody = b.slice(0, -2) + (b.slice(-2) === 'AA' ? 'BB' : 'AA');
    await expect(svc.verify(`${h}.${forgedBody}.${s}`)).rejects.toThrow();
  });

  test('forged signature is rejected', async () => {
    const svc = new TokenService();
    const token = svc.mintSessionToken({ userId: 'u_1', email: 'a@x.com', username: 'a' });
    const [h, b] = token.split('.');
    await expect(svc.verify(`${h}.${b}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).rejects.toThrow();
  });

  test('garbage and malformed tokens are rejected', async () => {
    const svc = new TokenService();
    await expect(svc.verify('')).rejects.toThrow();
    await expect(svc.verify('not-a-token')).rejects.toThrow();
    await expect(svc.verify('a.b')).rejects.toThrow();
  });

  test('expired session tokens are rejected', async () => {
    const svc = new TokenService();
    await expect(svc.verify(craftExpiredToken())).rejects.toThrow();
  });

  test('short/missing secret fails loudly on mint (no silent fallback)', () => {
    process.env.SESSION_JWT_SECRET = 'too-short';
    const svc = new TokenService();
    expect(() =>
      svc.mintSessionToken({ userId: 'u_9', email: 'z@x.com', username: 'z' }),
    ).toThrow(/SESSION_JWT_SECRET/);
  });
});
