'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { parsePersonalInvite, savePendingInvite } from '@/lib/invite';
import { openInviteCode } from '@/lib/joinInvite';
import { useAuthStore } from '@/store/auth';

/**
 * Permanent personal invite link: /invite?u=<username|userId|email>.
 * Stashes the code and lands on the app shell, which opens (or creates)
 * the encrypted 1:1 chat — after signup when the friend is new.
 */
export default function InvitePage() {
  const router = useRouter();

  useEffect(() => {
    const handleInvite = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const raw =
          params.get('u') ||
          params.get('invite') ||
          params.get('code') ||
          window.location.pathname.split('/').filter(Boolean).slice(1).join('/');
        const code = raw ? parsePersonalInvite(raw) : null;
        if (code) {
          savePendingInvite(code);
          if (useAuthStore.getState().isAuthenticated) {
            try {
              await openInviteCode(code);
            } catch (e) {}
          }
        }
      } catch {}
      router.replace('/');
    };
    handleInvite();
  }, [router]);

  return (
    <main className="min-h-screen grid place-items-center bg-[#0A0618] text-white">
      <p className="text-sm text-[#9C92C0]">Opening your invite…</p>
    </main>
  );
}
