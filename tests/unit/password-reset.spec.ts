/**
 * tests/unit/password-reset.spec.ts — forgot/reset flow + brute-force lockout.
 * Exercises the REAL AuthService in dev fallback (no Cognito, no Mongo, no
 * Redis server — in-memory tiers only, zero network).
 */
import { AuthService } from '../../server/src/modules/auth/auth.service';
import { DynamoDbService } from '../../server/src/modules/dynamodb/dynamodb.service';
import { TokenService } from '../../server/src/common/auth/token.service';
import { RedisService } from '../../server/src/common/redis/redis.service';

const SECRET = '0123456789abcdef0123456789abcdef-reset-test';

function makeService() {
  const db = new DynamoDbService();
  const tokens = new TokenService();
  const redis = new RedisService();
  const auth = new AuthService(db, tokens, redis);
  return { db, auth, redis };
}

describe('password reset (dev fallback)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, SESSION_JWT_SECRET: SECRET };
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    delete process.env.MONGODB_URI;
    delete process.env.REDIS_URL;
    delete process.env.REDIS_CLUSTER_URLS;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('forgot-password is generic for unknown emails (anti-enumeration)', async () => {
    const { auth } = makeService();
    const r = await auth.forgotPassword({ email: 'nobody@example.com' });
    expect(r.success).toBe(true);
    expect(r.message).toMatch(/If an account exists/);
  });

  test('wrong code is rejected; right code resets and unlocks login', async () => {
    const { auth, redis } = makeService();
    const email = 'reset.me@example.com';
    await auth.signUp({ email, password: 'OldPass123!', name: 'Reset' });

    await auth.forgotPassword({ email });
    await expect(
      auth.resetPassword({ email, code: '000000', newPassword: 'NewPass123!' }),
    ).rejects.toThrow(/Invalid or expired/);

    const code = await redis.get(`auth:reset:${email}`);
    expect(code).toMatch(/^\d{6}$/);
    const r = await auth.resetPassword({ email, code: code!, newPassword: 'NewPass123!' });
    expect(r.success).toBe(true);

    const ok = await auth.login({ email, password: 'NewPass123!' });
    expect(ok.success).toBe(true);
    await expect(auth.login({ email, password: 'OldPass123!' })).rejects.toThrow(
      /Incorrect email or password/,
    );
  });

  test('5 failed logins lock the account for 15 minutes', async () => {
    const { auth } = makeService();
    const email = 'locked@example.com';
    await auth.signUp({ email, password: 'RightPass123!', name: 'Locked' });

    for (let i = 0; i < 5; i++) {
      await expect(auth.login({ email, password: 'WrongPass123!' })).rejects.toThrow(
        /Incorrect email or password/,
      );
    }
    await expect(auth.login({ email, password: 'RightPass123!' })).rejects.toThrow(/locked/i);
  });

  test('successful reset clears a brute-force lock', async () => {
    const { auth, redis } = makeService();
    const email = 'unlock.me@example.com';
    await auth.signUp({ email, password: 'StartPass123!', name: 'Unlock' });

    for (let i = 0; i < 5; i++) {
      await expect(auth.login({ email, password: 'Nope12345!' })).rejects.toThrow();
    }
    await expect(auth.login({ email, password: 'StartPass123!' })).rejects.toThrow(/locked/i);

    await auth.forgotPassword({ email });
    const code = await redis.get(`auth:reset:${email}`);
    await auth.resetPassword({ email, code: code!, newPassword: 'FreshPass123!' });
    const ok = await auth.login({ email, password: 'FreshPass123!' });
    expect(ok.success).toBe(true);
  });
});
