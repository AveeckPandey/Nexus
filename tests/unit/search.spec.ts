/**
 * tests/unit/search.spec.ts — username rules & directory ranking
 * (TESTING_SPEC.md §3 `unit/search.spec.ts`).
 * Exercises the REAL server/src/modules/auth/directory.util.ts ranking core
 * that AuthService.searchUsers delegates to.
 */
import {
  USERNAME_RE,
  normalizeUsername,
  baseFromEmail,
  scoreProfile,
  searchDirectory,
  toPublicEntry,
} from '../../server/src/modules/auth/directory.util';

describe('username handles', () => {
  test('normalizes @-prefix, case, and whitespace', () => {
    expect(normalizeUsername('@Alice')).toBe('alice');
    expect(normalizeUsername('  BOB  ')).toBe('bob');
    expect(normalizeUsername('user_name1')).toBe('user_name1');
  });

  test('rejects handles outside 3–20 lowercase alnum+underscore', () => {
    expect(normalizeUsername('ab')).toBeNull();
    expect(normalizeUsername('a!b')).toBeNull();
    expect(normalizeUsername('has space')).toBeNull();
    expect(normalizeUsername('UPPER-with-dash')).toBeNull();
    expect(normalizeUsername('x'.repeat(21))).toBeNull();
    expect(normalizeUsername('')).toBeNull();
    expect(normalizeUsername(undefined)).toBeNull();
    expect(USERNAME_RE.test('aveeck')).toBe(true);
  });

  test('derives a valid base from email prefixes', () => {
    expect(baseFromEmail('John.Doe@example.com')).toBe('john_doe');
    expect(baseFromEmail('a@example.com')).toBe('auser');
    expect(baseFromEmail('Mary-Jane+tag@example.com')).toMatch(USERNAME_RE);
  });
});

describe('match scoring', () => {
  test('exact handle/email outranks prefix, prefix outranks substring', () => {
    expect(scoreProfile({ username: 'ali' }, 'ali')).toBe(0);
    expect(scoreProfile({ email: 'ali@x.com' }, 'ali@x.com')).toBe(0);
    expect(scoreProfile({ username: 'alice' }, 'ali')).toBe(1);
    expect(scoreProfile({ username: 'zzz', name: 'Alice Smith' }, 'ali')).toBe(2);
    expect(scoreProfile({ username: 'xxali' }, 'ali')).toBe(3);
    expect(scoreProfile({ username: 'bob' }, 'ali')).toBe(-1);
  });
});

const FIXTURES = [
  { userId: 'u_contains', username: 'xxali', name: 'Contains', email: 'c@x.com' },
  { userId: 'u_name', username: 'zzz', name: 'Alice Smith', email: 'n@x.com' },
  { userId: 'u_prefix', username: 'alice', name: 'Alice', email: 'a@x.com' },
  { userId: 'u_exact', username: 'ali', name: 'Ali', email: 'ali@x.com' },
  { userId: 'u_self', username: 'aliself', name: 'Self', email: 's@x.com' },
  { userId: 'u_bob', username: 'bob', name: 'Bob', email: 'bob@x.com' },
];

describe('searchDirectory ranking core', () => {
  test('orders exact → handle-prefix → name-prefix → substring', () => {
    const out = searchDirectory(FIXTURES, 'ali', 'u_self', 10);
    expect(out.map((u) => u.userId)).toEqual(['u_exact', 'u_prefix', 'u_name', 'u_contains']);
  });

  test('accepts @-prefixed queries like the composer', () => {
    const out = searchDirectory(FIXTURES, '@alice', 'nobody', 10);
    expect(out[0]?.userId).toBe('u_prefix');
  });

  test('excludes the searching user', () => {
    const out = searchDirectory(FIXTURES, 'ali', 'u_exact', 10);
    expect(out.find((u) => u.userId === 'u_exact')).toBeUndefined();
  });

  test('blank queries return nothing (no full-directory dump)', () => {
    expect(searchDirectory(FIXTURES, '', 'nobody', 10)).toEqual([]);
    expect(searchDirectory(FIXTURES, '   ', 'nobody', 10)).toEqual([]);
  });

  test('results are capped (default 10, hard max 20)', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      userId: `u_${i}`,
      username: `testuser${i}`,
      name: `Test ${i}`,
      email: `t${i}@x.com`,
    }));
    expect(searchDirectory(many, 'test', 'nobody', 10)).toHaveLength(10);
    expect(searchDirectory(many, 'test', 'nobody', 99)).toHaveLength(20);
  });

  test('public entries expose handles, never emails', () => {
    const out = searchDirectory(FIXTURES, 'ali', 'nobody', 1);
    expect(out[0]).toEqual({
      userId: 'u_exact',
      username: 'ali',
      name: 'Ali',
      x25519PublicKey: null,
    });
    expect('email' in (out[0] as unknown as Record<string, unknown>)).toBe(false);
  });

  test('toPublicEntry defaults a missing public key to null', () => {
    expect(toPublicEntry({ userId: 'u', username: 'u' }).x25519PublicKey).toBeNull();
  });
});
