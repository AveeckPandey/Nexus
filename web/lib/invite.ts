/**
 * Invite link helpers.
 *
 * Ghost invites: the E2EE key travels in the URL *hash* (`#k=...`) which
 * browsers never send to the server — only the token is claimed.
 *
 * Personal invites: `https://<origin>/invite?u=<username>` — a permanent,
 * zero-download deep link into an encrypted 1:1 chat. No phonebook access;
 * the link is shared through the OS share sheet instead.
 */
export function parseInviteLink(input: string): { token: string; key?: string } {
  const raw = input.trim();
  const hashIndex = raw.indexOf('#');
  let key: string | undefined;
  let head = raw;
  if (hashIndex >= 0) {
    const hash = raw.slice(hashIndex + 1);
    head = raw.slice(0, hashIndex);
    const m = hash.match(/(?:^|&)k=([^&]+)/);
    if (m) key = decodeURIComponent(m[1]);
  }
  const tokenMatch = head.match(/token=([A-Za-z0-9]+)/) || head.match(/([A-Fa-f0-9]{32})/);
  return { token: tokenMatch ? tokenMatch[1] : head, key };
}

export function withKeyHash(inviteLink: string, keyB64: string): string {
  return `${inviteLink}#k=${encodeURIComponent(keyB64)}`;
}

// ---------------------------------------------------------------------------
// Personal (one-click share) invites: /invite?u=<username|userId|email>
// ---------------------------------------------------------------------------

function origin(): string {
  try {
    if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  } catch {
    /* ssr */
  }
  return '';
}

/** Permanent personal link for the OS share sheet / QR code. */
export function buildPersonalInviteLink(usernameOrId: string): string {
  return `${origin()}/invite?u=${encodeURIComponent(usernameOrId.trim().replace(/^@+/, ''))}`;
}

/**
 * Extract a personal invite code from anything a friend might paste:
 * full /invite?u= URL, /chat/<name> path, @handle, email, or raw userId.
 */
export function parsePersonalInvite(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) {
      const url = new URL(raw, origin() || 'https://nexus.app');
      for (const key of ['u', 'invite', 'code', 'username']) {
        const v = url.searchParams.get(key);
        if (v?.trim()) return v.trim().replace(/^@+/, '');
      }
      const parts = url.pathname.split('/').filter(Boolean);
      // /invite/<code>, /chat/<code>, /u/<code>
      if (parts.length >= 2 && ['invite', 'chat', 'u', 'user'].includes(parts[0].toLowerCase())) {
        return decodeURIComponent(parts[parts.length - 1]).replace(/^@+/, '') || null;
      }
    }
  } catch {
    /* fall through to bare-code handling */
  }
  const bare = raw.replace(/^@+/, '').split(/\s+/)[0];
  return bare || null;
}

/** Copy helper with a legacy fallback for non-secure contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export type ShareOutcome = 'shared' | 'copied' | 'failed';

/**
 * One-click share: native OS sheet (WhatsApp, SMS, email…) via
 * navigator.share, clipboard fallback elsewhere. Returns what happened
 * so the UI can toast accurately.
 */
export async function sharePersonalInvite(opts: {
  url: string;
  username?: string;
  name?: string;
}): Promise<ShareOutcome> {
  const title = 'Chat with me on Nexus';
  const text = `Chat with ${opts.name || (opts.username ? `@${opts.username}` : 'me')} on Nexus — encrypted, no download needed:`;
  try {
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
    if (typeof nav.share === 'function') {
      await nav.share({ title, text, url: opts.url });
      return 'shared';
    }
  } catch {
    // User dismissed the sheet — treat as done, not as failure.
    return 'shared';
  }
  return (await copyText(opts.url)) ? 'copied' : 'failed';
}

// ---------------------------------------------------------------------------
// Pending invite: a friend's link opened while logged out. Stash the code,
// complete the encrypted chat right after signup/login (10-second onboarding).
// ---------------------------------------------------------------------------

const PENDING_KEY = 'nexus_pending_invite';

export function savePendingInvite(code: string): void {
  try {
    if (code.trim()) {
      sessionStorage.setItem(PENDING_KEY, code.trim());
      localStorage.setItem(PENDING_KEY, code.trim());
    }
  } catch {
    /* storage unavailable */
  }
}

export function takePendingInvite(): string | null {
  try {
    const v = sessionStorage.getItem(PENDING_KEY) || localStorage.getItem(PENDING_KEY);
    if (v) {
      sessionStorage.removeItem(PENDING_KEY);
      localStorage.removeItem(PENDING_KEY);
    }
    return v || null;
  } catch {
    return null;
  }
}
