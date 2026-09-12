'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from '@heroui/react';
import { getSocket } from '@/lib/socket';
import { registerWebPush } from '@/lib/notify';
import { ensureIdentityPublished } from '@/lib/keyx';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';
import { useCallStore, type IncomingCall } from '@/store/call';
import { AuthForm } from '@/components/AuthForm';
import { Sidebar } from '@/components/Sidebar';
import { ChatWindow } from '@/components/ChatWindow';
import { GhostPanel } from '@/components/GhostPanel';
import { ProfilePanel } from '@/components/ProfilePanel';
import { CallPanel } from '@/components/CallPanel';

const Dither = dynamic(() => import('@/components/Dither'), { ssr: false });

type View = { kind: 'chat' } | { kind: 'ghost'; token?: string } | { kind: 'profile' };

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

  useEffect(() => {
    hydrate();
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const t = urlParams.get('token');
      if (urlParams.get('view') === 'ghost' || t) setView({ kind: 'ghost', token: t || undefined });
    } catch {
      /* ignore */
    }
  }, [hydrate]);

  useEffect(() => {
    if (!isAuthenticated) return;
    registerWebPush();
    ensureIdentityPublished().catch(() => {});
    const socket = getSocket();
    if (!socket) return;
    const onIncoming = (c: IncomingCall) => setIncoming(c);
    const onGlobalMsg = (m: any) => {
      addMessage(m.conversationId, m);
      if (m.conversationId !== activeId) {
        setToast({ from: m.senderName, text: m.isEncrypted ? '🔒 New encrypted message' : m.content });
        setTimeout(() => setToast(null), 4000);
      }
    };
    socket.on('incoming_call', onIncoming);
    socket.on('new_message', onGlobalMsg);
    return () => {
      socket.off('incoming_call', onIncoming);
      socket.off('new_message', onGlobalMsg);
    };
  }, [isAuthenticated, activeId, addMessage, setIncoming]);

  if (!hydrated || !isAuthenticated) return <AuthForm />;

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
        <Sidebar onGhost={() => setView({ kind: 'ghost' })} onProfile={() => setView({ kind: 'profile' })} />
        <div className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0">
        {toast && (
          <button onClick={() => setToast(null)} className="m-2 p-2.5 text-left text-xs bg-whatsapp-composer border border-white/10 rounded-xl">
            <b>{toast.from}</b>: <span className="truncate">{toast.text}</span>
          </button>
        )}
        {view.kind === 'ghost' ? (
          <GhostPanel initialToken={view.token} onBack={() => setView({ kind: 'chat' })} />
        ) : view.kind === 'profile' ? (
          <ProfilePanel />
        ) : activeId ? (
          <ChatWindow conversationId={activeId} onCall={startCall} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-whatsapp-checkGray gap-2">
            <p className="text-4xl">💬</p>
            <p className="text-sm">Select a conversation — or open a 👻 ghost chat.</p>
          </div>
        )}
        </div>
      </div>

      <Modal isOpen={!!incoming} onClose={() => setIncoming(null)}>
        <ModalContent>
          <ModalHeader>📞 Incoming {incoming?.callType} call</ModalHeader>
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

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-3 bg-whatsapp-panel border-t border-white/10 text-xs">
        {([
          { k: 'chat', label: '💬 Chats' },
          { k: 'ghost', label: '👻 Ghost' },
          { k: 'profile', label: '👤 Profile' },
        ] as const).map((t) => (
          <button
            key={t.k}
            onClick={() => setView({ kind: t.k })}
            className={`py-3 font-semibold ${view.kind === t.k ? 'text-secondary' : 'text-whatsapp-checkGray'}`}
          >
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
