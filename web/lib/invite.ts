/**
 * Invite link helpers. The E2EE key travels in the URL *hash* (`#k=...`)
 * which browsers never send to the server — only the token is claimed.
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
