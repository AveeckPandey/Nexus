'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from '@heroui/react';
import { getSocket } from '@/lib/socket';
import { registerWebPush } from '@/lib/notify';
import { ensureIdentityPublished } from '@/lib/keyx';
import { parsePersonalInvite, savePendingInvite, takePendingInvite } from '@/lib/invite';
import { openInviteCode } from '@/lib/joinInvite';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';
import { useCallStore, type IncomingCall } from '@/store/call';
import { AuthForm } from '@/components/AuthForm';
import { Sidebar, MobileChats } from '@/components/Sidebar';
import { ChatWindow } from '@/components/ChatWindow';
import { GhostPanel } from '@/components/GhostPanel';
import { ProfilePanel } from '@/components/ProfilePanel';
import { CallPanel } from '@/components/CallPanel';
import { NetworkBanner } from '@/components/NetworkBanner';
import { Rail, type RailView } from '@/components/Rail';
import { CreateGroupDialog } from '@/components/CreateGroupDialog';
import { AiChatPanel } from '@/components/AiChatPanel';
import { StatusPanel } from '@/components/StatusPanel';
import { NewChatDialog } from '@/components/NewChatDialog';
import { ChatIcon, StatusIcon, SparkleIcon, AlienIcon, GhostIcon, PersonIcon, PhoneIcon } from '@/components/MenuIcons';

const Dither = dynamic(() => import('@/components/Dither'), { ssr: false });

type View = { kind: 'chat' } | { kind: 'ghost'; token?: string } | { kind: 'profile' } | { kind: 'ai' } | { kind: 'status' };

function Shell() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const hydrate = useAuthStore((s) => s.hydrate);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const activeId = useChatStore((s) => s.activeId);
  const addMessage = useChatStore((s) => s.addMessage);
  const setIncoming = useCallStore((s) => s.setIncoming);
  const incoming = useCallStore((s) => s.incoming);
  const accept = useCallStore((s) => s.accept);
  const startOutgoing = useCallStore((s) => s.startOutgoing);
  const [view, setView] = useState<View>({ kind: 'chat' });
  const [toast, setToast] = useState<{ from: string; text: string } | null>(null);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const inviteClaimed = useRef(false);
  // Resizable sidebar (desktop): drag the divider between Chats and the
  // conversation. Clamped 260–480px, persisted, double-click resets.
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      if (typeof window === 'undefined') return 320;
      const v = Number(localStorage.getItem('nexus_sidebar_w'));
      if (Number.isFinite(v) && v >= 260 && v <= 480) return v;
    } catch {
      /* storage unavailable */
    }
    return 320;
  });
  const dragging = useRef(false);

  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const next = Math.min(480, Math.max(260, e.clientX));
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem('nexus_sidebar_w', String(sidebarWidthRef.current));
      } catch {
        /* storage unavailable */
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    hydrate();
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const t = urlParams.get('token');
      if (urlParams.get('view') === 'ghost' || t) setView({ kind: 'ghost', token: t || undefined });
      // Personal invite deep link: /?u=<code> (also written by /invite?u=).
      const rawInvite =
        urlParams.get('u') || urlParams.get('invite') || urlParams.get('code');
      const code = rawInvite ? parsePersonalInvite(rawInvite) : null;
      if (code) {
        // Logged-out friends sign up first; the chat auto-opens after.
        savePendingInvite(code);
        setView({ kind: 'chat' });
      }
    } catch {
      /* ignore */
    }
  }, [hydrate]);

  // Complete a friend's invite link right after sign-in (10-second onboarding).
  useEffect(() => {
    if (!isAuthenticated) return;
    const code = takePendingInvite();
    if (!code) return;
    setInviteStatus('Opening your invite…');
    openInviteCode(code)
      .then(() => {
        setView((prev) => (prev.kind === 'chat' ? prev : { kind: 'chat' }));
        setInviteStatus(null);
      })
      .catch((e: Error) => {
        setInviteStatus(e.message);
        setTimeout(() => setInviteStatus(null), 6000);
      });
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    registerWebPush();
    ensureIdentityPublished().catch(() => {});
    const socket = getSocket();
    if (!socket) return;
    const onIncoming = (c: IncomingCall) => setIncoming(c);
    const onGlobalMsg = (m: any) => {
      addMessage(m.conversationId, m);
      // Sender is no longer typing once their message lands (any view).
      if (m?.senderId) {
        try {
          useChatStore.getState().clearTyping(m.conversationId, m.senderId);
        } catch {
          /* store unavailable */
        }
      }
      if (m.conversationId !== activeId) {
        setToast({ from: m.senderName, text: m.isEncrypted ? '🔒 New encrypted message' : m.content });
        setTimeout(() => setToast(null), 4000);
      }
    };
    // Read receipts also arrive while another chat is open — apply globally
    // (the room listener in ChatWindow covers the open conversation).
    const onGlobalRead = (d: { conversationId: string; messageId: string; userId: string }) => {
      const selfId = useAuthStore.getState().user?.userId;
      if (!selfId || !d?.conversationId || !d?.messageId) return;
      const st = useChatStore.getState();
      const others = st.conversations.find((c) => c.id === d.conversationId)?.participants;
      st.applyRemoteRead(d.conversationId, d.userId, d.messageId, selfId, others);
    };
    socket.on('incoming_call', onIncoming);
    socket.on('new_message', onGlobalMsg);
    socket.on('message_status_update', onGlobalRead);
    return () => {
      socket.off('incoming_call', onIncoming);
      socket.off('new_message', onGlobalMsg);
      socket.off('message_status_update', onGlobalRead);
    };
  }, [isAuthenticated, activeId, addMessage, setIncoming]);

  if (!hydrated) return null;

  if (!isAuthenticated) {
    if (view.kind === 'ghost') {
      return (
        <main className="h-[100dvh] flex flex-col bg-[#0F0E0E] text-white">
          <NetworkBanner />
          <GhostPanel initialToken={view.token} onBack={() => setView({ kind: 'chat' })} />
        </main>
      );
    }
    return <AuthForm />;
  }

  const startCall = (type: 'video' | 'audio') => {
    const socket = getSocket();
    if (!socket || !activeId) return;
    const conv = useChatStore.getState().conversations.find((c) => c.id === activeId);
    socket.emit(
      'call_initiate',
      {
        conversationId: activeId,
        initiatorName: user?.name || user?.username,
        callType: type,
        // USER# routing rings every participant, whatever view they have open.
        recipientIds: (conv?.participants || []).filter((p) => p !== user?.userId),
      },
      (res: { callId: string }) => {
        if (res?.callId) startOutgoing(res.callId, activeId, type);
      },
    );
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      <NetworkBanner />
      {/* App-wide Dither background */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-black">
        <div className="absolute inset-0 w-full h-full opacity-60">
          <Dither
            waveColor={[0.48627450980392156, 0.22745098039215686, 0.9294117647058824]}
            disableAnimation={false}
            enableMouseInteraction
            mouseRadius={0.3}
            colorNum={4}
            waveAmplitude={0.3}
            waveFrequency={3}
            waveSpeed={0.05}
            backgroundColor={[0, 0, 0]}
          />
        </div>
        <div className="absolute inset-0 bg-[#0A0618]/60" />
      </div>
      <div className="flex-1 flex min-h-0 relative z-10">
        <Rail
          view={view.kind as RailView}
          onNavigate={(v) => setView({ kind: v })}
          onNewChat={() => {
            setView({ kind: 'chat' });
            setNewChatOpen(true);
          }}
          onCreateGroup={() => setGroupOpen(true)}
        />
        <div className="hidden md:block shrink-0 h-full" style={{ width: sidebarWidth }}>
          <Sidebar onGhost={() => setView({ kind: 'ghost' })} />
        </div>
        {/* Draggable divider — drag to resize Chats, double-click to reset */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Drag to resize · double-click to reset"
          onMouseDown={(e) => {
            e.preventDefault();
            dragging.current = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
          onDoubleClick={() => {
            setSidebarWidth(320);
            try {
              localStorage.setItem('nexus_sidebar_w', '320');
            } catch {
              /* storage unavailable */
            }
          }}
          className="hidden md:block w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-secondary/60 active:bg-secondary transition-colors"
        />
        <div className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0">
        {toast && (
          <button onClick={() => setToast(null)} className="m-2 p-2.5 text-left text-xs bg-whatsapp-composer border border-white/10 rounded-xl">
            <b>{toast.from}</b>: <span className="truncate">{toast.text}</span>
          </button>
        )}
        {inviteStatus && (
          <p className="m-2 p-2.5 text-xs bg-secondary/15 border border-secondary/40 rounded-xl">{inviteStatus}</p>
        )}
        {view.kind === 'ghost' ? (
          <GhostPanel initialToken={view.token} onBack={() => setView({ kind: 'chat' })} />
        ) : view.kind === 'profile' ? (
          <ProfilePanel onBack={() => setView({ kind: 'chat' })} />
        ) : view.kind === 'ai' ? (
          <AiChatPanel />
        ) : view.kind === 'status' ? (
          <StatusPanel />
        ) : activeId ? (
          <>
            <button
              className="md:hidden mx-3 mt-2 self-start text-xs text-whatsapp-checkGray"
              onClick={() => useChatStore.getState().setActive(null)}
            >
              ← All chats
            </button>
            <ChatWindow conversationId={activeId} onCall={startCall} />
          </>
        ) : (
          <>
            {/* Mobile conversation list with invite actions */}
            <MobileChats onGhost={() => setView({ kind: 'ghost' })} />
            <div className="hidden md:flex flex-1 flex-col items-center justify-center text-whatsapp-checkGray gap-2">
              <span aria-hidden className="text-white/25 [&>svg]:w-12 [&>svg]:h-12"><ChatIcon /></span>
              <p className="text-sm">Select a conversation — or open a ghost chat.</p>
            </div>
          </>
        )}
        </div>
      </div>

      <Modal isOpen={!!incoming} onClose={() => setIncoming(null)}>
        <ModalContent>
          <ModalHeader><span className="flex items-center gap-1.5"><PhoneIcon size={14} /> Incoming {incoming?.callType} call</span></ModalHeader>
          <ModalBody><p className="text-sm">{incoming?.initiatorName} is calling…</p></ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              onPress={() => {
                if (incoming) getSocket()?.emit('call_reject', { callId: incoming.callId });
                setIncoming(null);
              }}
            >
              Decline
            </Button>
            <Button
              color="secondary"
              onPress={() => {
                if (!incoming) return;
                getSocket()?.emit('call_accept', { callId: incoming.callId, conversationId: incoming.conversationId });
                accept(incoming.callId);
              }}
            >
              Accept
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <CallPanel />

      <CreateGroupDialog open={groupOpen} onClose={() => setGroupOpen(false)} />
      <NewChatDialog open={newChatOpen} onClose={() => setNewChatOpen(false)} />

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 bg-whatsapp-panel border-t border-white/10 text-[10px]">
        {([
          { k: 'chat', label: 'Chats', icon: <ChatIcon /> },
          { k: 'status', label: 'Status', icon: <StatusIcon /> },
          { k: 'ai', label: 'AI', icon: <AlienIcon /> },
          { k: 'ghost', label: 'Ghost', icon: <GhostIcon /> },
          { k: 'profile', label: 'Profile', icon: <PersonIcon /> },
        ] as const).map((t) => (
          <button
            key={t.k}
            onClick={() => setView({ kind: t.k })}
            className={`py-2.5 font-semibold flex flex-col items-center gap-0.5 ${view.kind === t.k ? 'text-secondary' : 'text-whatsapp-checkGray'}`}
          >
            <span aria-hidden className="flex items-center justify-center [&>svg]:w-5 [&>svg]:h-5">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function Page() {
  return <Shell />;
}
