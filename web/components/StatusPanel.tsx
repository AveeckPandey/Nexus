'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Avatar, Spinner } from '@heroui/react';
import { storiesApi, mediaApi, type StoryItem } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { PlusIcon, CloseIcon, EyeIcon, ChevronLeftIcon, ChevronRightIcon } from './MenuIcons';
import { useChatStore } from '@/store/chat';
import { usePeerStore } from '@/store/peers';
import { resolvePeer } from '@/lib/conversation';

interface OwnerStories {
  userId: string;
  name: string;
  avatarUrl?: string;
  items: StoryItem[];
}

const VIEW_SECONDS = 5;

/**
 * Status (24h stories): upload photo/video stories and browse contacts'
 * stories with auto-advance viewing + view receipts.
 */
export function StatusPanel() {
  const selfId = useAuthStore((s) => s.user?.userId);
  const selfName = useAuthStore((s) => s.user?.name || s.user?.username);
  const selfAvatar = useAuthStore((s) => s.user?.avatarUrl);
  const conversations = useChatStore((s) => s.conversations);
  const peers = usePeerStore((s) => s.peers);
  const [mine, setMine] = useState<StoryItem[]>([]);
  const [owners, setOwners] = useState<OwnerStories[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ owner: OwnerStories; index: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Candidate contacts: everyone we share a conversation with.
  const contacts = useMemo(() => {
    const map = new Map<string, { name: string; avatarUrl?: string }>();
    for (const c of conversations) {
      if (c.type === 'direct') {
        const peer = resolvePeer(c, [], selfId, peers);
        if (peer && !map.has(peer.userId)) {
          map.set(peer.userId, { name: peer.name || c.title, avatarUrl: peer.avatarUrl });
        }
      } else {
        for (const id of c.participants || []) {
          if (id === selfId || map.has(id) || id === 'nexus-ai') continue;
          const p = peers[id];
          map.set(id, { name: p?.name || p?.username || 'Contact', avatarUrl: p?.avatarUrl });
        }
      }
    }
    return Array.from(map.entries()).map(([userId, v]) => ({ userId, ...v }));
  }, [conversations, peers, selfId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [myStories, ...rest] = await Promise.all([
        storiesApi.mine(),
        ...contacts.slice(0, 25).map((c) =>
          storiesApi
            .byUser(c.userId)
            .then((items) => ({ ...c, items }))
            .catch(() => ({ ...c, items: [] as StoryItem[] })),
        ),
      ]);
      setMine(myStories);
      setOwners(
        (rest as OwnerStories[]).filter((o) => o.items.length > 0).sort((a, b) => {
          const at = (x: OwnerStories) => x.items[0]?.createdAt || '';
          return at(b).localeCompare(at(a));
        }),
      );
    } catch {
      setError('Could not load stories — check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }, [contacts]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) {
      setError('Stories support photos and videos only.');
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setError('Story file must be under 50MB.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const mediaUrl = await mediaApi.upload(f);
      await storiesApi.post(mediaUrl, f.type.startsWith('video/') ? 'video' : 'image');
      await refresh();
    } catch {
      setError('Upload failed — please try again.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Auto-advance + view receipts inside the viewer.
  const viewerItem = viewer ? viewer.owner.items[viewer.index] : null;
  useEffect(() => {
    if (!viewer || !viewerItem) return;
    storiesApi.recordView(viewer.owner.userId, viewerItem.SK).catch(() => {});
    const t = setTimeout(() => {
      if (viewer.index < viewer.owner.items.length - 1) {
        setViewer({ owner: viewer.owner, index: viewer.index + 1 });
      } else {
        setViewer(null);
        refresh();
      }
    }, VIEW_SECONDS * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer?.owner.userId, viewer?.index]);

  const ring = 'bg-gradient-to-tr from-amber-400 via-pink-500 to-secondary p-[2.5px] rounded-full';

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-whatsapp-dark overflow-y-auto">
      <div className="flex items-center gap-3 px-4 py-3 bg-whatsapp-panel border-b border-white/10 sticky top-0 z-10">
        <b className="text-[15px]">Status</b>
        <span className="text-[11px] text-whatsapp-checkGray">Stories disappear after 24h</span>
        <span className="flex-1" />
        <Button size="sm" color="secondary" isLoading={uploading} onPress={() => fileRef.current?.click()}>
          <span className="flex items-center gap-1"><PlusIcon size={12} /> Add status</span>
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => upload(e.target.files?.[0])}
        />
      </div>

      {error && <p className="mx-4 mt-3 text-xs text-danger">{error}</p>}

      <div className="p-4 space-y-5">
        {/* My status */}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-white/40 mb-2">My status</p>
          <button
            onClick={() => mine.length > 0 && setViewer({ owner: { userId: selfId || '', name: selfName || 'You', avatarUrl: selfAvatar, items: mine }, index: 0 })}
            className="flex items-center gap-3 w-full text-left p-2 rounded-2xl hover:bg-white/5 transition"
          >
            <span className={mine.length > 0 ? ring : 'p-[2.5px] rounded-full bg-white/10'}>
              <span className="block rounded-full border-2 border-whatsapp-dark">
                <Avatar src={selfAvatar} name={selfName} size="md" />
              </span>
            </span>
            <span className="flex-1 min-w-0">
              <b className="block text-sm">My status</b>
              <span className="block text-xs text-white/50">
                {mine.length > 0 ? `${mine.length} stor${mine.length === 1 ? 'y' : 'ies'} · tap to view` : 'Tap + to share a photo or video'}
              </span>
            </span>
          </button>
        </div>

        {/* Contacts' statuses */}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-white/40 mb-2">Recent updates</p>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : owners.length === 0 ? (
            <p className="text-xs text-white/40 py-6 text-center">
              No stories from your contacts yet — they appear here for 24 hours after posting.
            </p>
          ) : (
            <div className="space-y-1">
              {owners.map((o) => (
                <button
                  key={o.userId}
                  onClick={() => setViewer({ owner: o, index: 0 })}
                  className="flex items-center gap-3 w-full text-left p-2 rounded-2xl hover:bg-white/5 transition"
                >
                  <span className={ring}>
                    <span className="block rounded-full border-2 border-whatsapp-dark">
                      <Avatar src={o.avatarUrl} name={o.name} size="md" />
                    </span>
                  </span>
                  <span className="flex-1 min-w-0">
                    <b className="block truncate text-sm">{o.name}</b>
                    <span className="block text-xs text-white/50">
                      {o.items.length} stor{o.items.length === 1 ? 'y' : 'ies'} ·{' '}
                      {new Date(o.items[0].createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Story viewer */}
      {viewer && viewerItem && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4" onClick={() => { setViewer(null); refresh(); }}>
          <div
            className="relative w-full max-w-md h-[80vh] rounded-2xl overflow-hidden bg-whatsapp-panel border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-0 inset-x-0 z-10 p-3 space-y-2 bg-gradient-to-b from-black/70 to-transparent">
              <div className="flex gap-1">
                {viewer.owner.items.map((it, i) => (
                  <span key={it.SK} className="flex-1 h-1 rounded-full bg-white/25 overflow-hidden">
                    {i < viewer.index && <span className="block h-full w-full bg-white" />}
                    {i === viewer.index && (
                      <span
                        key={viewer.index}
                        className="block h-full bg-white origin-left"
                        style={{ animation: `statusfill ${VIEW_SECONDS}s linear forwards` }}
                      />
                    )}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Avatar src={viewer.owner.avatarUrl} name={viewer.owner.name} size="sm" />
                <b className="text-sm flex-1 truncate">{viewer.owner.name}</b>
                {viewer.owner.userId === selfId && (
                  <span className="text-[11px] text-white/60 flex items-center gap-1">
                    <EyeIcon size={12} /> {viewerItem.views?.length || 0}
                  </span>
                )}
                <button
                  aria-label="Close story"
                  onClick={() => { setViewer(null); refresh(); }}
                  className="w-8 h-8 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center"
                >
                  <CloseIcon size={14} />
                </button>
              </div>
            </div>
            {viewerItem.mediaType === 'video' ? (
              <video src={viewerItem.mediaUrl} controls autoPlay className="w-full h-full object-contain bg-black" />
            ) : (
              <img src={viewerItem.mediaUrl} alt="" className="w-full h-full object-contain bg-black" />
            )}
            <button
              aria-label="Previous story"
              onClick={() => viewer.index > 0 && setViewer({ owner: viewer.owner, index: viewer.index - 1 })}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/80 text-white disabled:opacity-30 flex items-center justify-center"
              disabled={viewer.index === 0}
            >
              <ChevronLeftIcon size={18} />
            </button>
            <button
              aria-label="Next story"
              onClick={() => {
                if (viewer.index < viewer.owner.items.length - 1) {
                  setViewer({ owner: viewer.owner, index: viewer.index + 1 });
                } else {
                  setViewer(null);
                  refresh();
                }
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center"
            >
              <ChevronRightIcon size={18} />
            </button>
          </div>
          <style>{`@keyframes statusfill { from { transform: scaleX(0); } to { transform: scaleX(1); } }`}</style>
        </div>
      )}
    </div>
  );
}
