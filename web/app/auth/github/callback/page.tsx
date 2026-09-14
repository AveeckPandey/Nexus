'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api';
import { ensureIdentityPublished } from '@/lib/keyx';
import { useAuthStore } from '@/store/auth';

/**
 * GitHub OAuth callback: /auth/github/callback?code=...
 * Exchanges the one-time code server-side (secret never touches the browser),
 * stores the Nexus session, then lands in the app shell.
 */
export default function GithubCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code') || '';
        if (!code) {
          setError('Missing authorization code. Please try signing in again.');
          return;
        }
        // Scrub the code from history so it can't be replayed from the URL.
        window.history.replaceState({}, '', '/auth/github/callback');
        const r = await authApi.github(code);
        if (cancelled) return;
        useAuthStore.getState().login(r.user, r.idToken, r.refreshToken);
        ensureIdentityPublished().catch(() => {});
        router.replace('/');
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.response?.data?.message || 'GitHub sign-in failed. Please try again.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="min-h-screen grid place-items-center bg-[#0A0618] text-white px-4">
      {error ? (
        <div className="text-center space-y-3">
          <p className="text-[14px] text-red-300">{error}</p>
          <button
            onClick={() => router.replace('/')}
            className="rounded-lg bg-white/10 hover:bg-white/15 px-4 py-2.5 text-[13px] font-semibold transition"
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <p className="text-sm opacity-70">Finishing GitHub sign-in…</p>
      )}
    </main>
  );
}
