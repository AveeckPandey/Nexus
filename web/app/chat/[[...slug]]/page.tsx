'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { parsePersonalInvite, savePendingInvite } from '@/lib/invite';

/**
 * Alias for personal invites: /chat/<username> behaves like /invite?u=.
 * Kept for link-compatibility (nexus.app/chat/yourname).
 */
export default function ChatInvitePage({ params }: { params: { slug?: string[] } }) {
  const router = useRouter();

  useEffect(() => {
    try {
      const segs = params?.slug?.map((s) => decodeURIComponent(s)) || [];
      const fromPath = segs.join('/');
      const query = new URLSearchParams(window.location.search);
      const raw =
        query.get('u') || query.get('invite') || query.get('code') || fromPath;
      const code = raw ? parsePersonalInvite(raw) : null;
      if (code) savePendingInvite(code);
    } catch {
      /* ignore */
    }
    router.replace('/');
  }, [router, params]);

  return (
    <main className="min-h-screen grid place-items-center bg-[#0A0618] text-white">
      <p className="text-sm text-[#9C92C0]">Opening your invite…</p>
    </main>
  );
}
