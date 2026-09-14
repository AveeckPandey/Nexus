/**
 * Pure user-directory helpers (no Nest, no DB, no I/O).
 * Kept side-effect free so `tests/unit/search.spec.ts` can verify handle
 * rules and result ranking without a database.
 */

/** Web-native invite handles: @aveeck — 3–20 chars, lowercase alnum + underscore. */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(input?: string | null): string | null {
  if (!input) return null;
  const clean = input.trim().toLowerCase().replace(/^@+/, '');
  if (!USERNAME_RE.test(clean)) return null;
  return clean;
}

/** Derive a valid handle base from an email prefix when no hint is given. */
export function baseFromEmail(email: string): string {
  let base = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
  if (base.length < 3) base = `${base}user`.slice(0, 20);
  return base;
}

export interface DirectoryProfile {
  userId: string;
  username?: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  about?: string;
  x25519PublicKey?: string | null;
}

export interface PublicUserEntry {
  userId: string;
  username: string;
  name?: string;
  avatarUrl?: string;
  about?: string;
  x25519PublicKey?: string | null;
}

export function toPublicEntry(p: DirectoryProfile): PublicUserEntry {
  return {
    userId: p.userId,
    username: p.username || '',
    name: p.name,
    avatarUrl: p.avatarUrl,
    about: p.about,
    x25519PublicKey: p.x25519PublicKey || null,
  };
}

/** Lower rank = better match. -1 means no match. */
export function scoreProfile(
  p: Pick<DirectoryProfile, 'username' | 'name' | 'email'>,
  query: string,
): number {
  const uname = (p.username || '').toLowerCase();
  const name = (p.name || '').toLowerCase();
  const email = (p.email || '').toLowerCase();
  if (uname === query || email === query) return 0;
  if (uname.startsWith(query)) return 1;
  if (name.startsWith(query)) return 2;
  if (uname.includes(query) || name.includes(query) || email.includes(query)) return 3;
  return -1;
}

/**
 * Rank a bounded profile list for a directory query. Exact handle/email
 * first, then prefix, then substring; ties broken alphabetically.
 * The caller (AuthService) handles the exact-email GSI fast path and the
 * profile scan — this function is the deterministic ranking core.
 */
export function searchDirectory<T extends DirectoryProfile>(
  profiles: T[],
  q: string,
  excludeUserId: string,
  limit = 10,
): PublicUserEntry[] {
  const query = q.trim().toLowerCase().replace(/^@+/, '');
  if (!query) return [];
  const cap = Math.min(Math.max(limit, 1), 20);
  const scored: { p: T; rank: number }[] = [];
  for (const p of profiles) {
    if (!p?.userId || p.userId === excludeUserId) continue;
    const rank = scoreProfile(p, query);
    if (rank >= 0) scored.push({ p, rank });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || (a.p.username || '').localeCompare(b.p.username || ''))
    .slice(0, cap)
    .map(({ p }) => toPublicEntry(p));
}
