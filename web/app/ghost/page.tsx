'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Ephemeral ghost invite: /ghost?token=<token>#k=<key>.
 * The #k hash never reaches the server (RFC 3986 §3.5) — forward it
 * intact to the app shell, which claims the token and wipes the hash
 * from history after importing the key.
 */
export default function GhostPage() {
  const router = useRouter();

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token') || '';
      const hash = window.location.hash || '';
      const target = token
        ? `/?view=ghost&token=${encodeURIComponent(token)}${hash}`
        : `/?view=ghost${hash}`;
      router.replace(target);
    } catch {
      router.replace('/?view=ghost');
    }
  }, [router]);

  return (
    <main className="min-h-screen grid place-items-center bg-[#0F0E0E] text-amber-100">
      <p className="text-sm opacity-70">Opening your ghost chat…</p>
    </main>
  );
}
