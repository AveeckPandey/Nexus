'use client';

import type { ReactNode } from 'react';
import { Avatar } from '@heroui/react';
import { useAuthStore } from '@/store/auth';
import { ChatIcon, PlusIcon, GroupIcon, StatusIcon, SparkleIcon, AlienIcon, GhostIcon } from './MenuIcons';

export type RailView = 'chat' | 'ghost' | 'profile' | 'ai' | 'status';

function RailButton({
  icon,
  title,
  active,
  onClick,
  accent,
}: {
  icon: ReactNode;
  title: string;
  active?: boolean;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`relative w-11 h-11 rounded-2xl flex items-center justify-center transition ${
        active
          ? 'bg-whatsapp-outgoing text-white shadow-lg'
          : accent
            ? 'bg-gradient-to-br from-cyan-500/25 to-secondary/30 text-cyan-200 hover:from-cyan-500/35 hover:to-secondary/45 border border-cyan-500/30'
            : 'text-white/60 hover:text-white hover:bg-white/10'
      }`}
    >
      {active && <span className="absolute -left-[13px] w-1 h-6 rounded-full bg-secondary" aria-hidden />}
      <span aria-hidden className="flex items-center justify-center [&>svg]:w-5 [&>svg]:h-5">{icon}</span>
    </button>
  );
}

/**
 * Slim desktop icon rail (reference layout): Chats · New · Groups ·
 * Status · Nexus AI · Ghost, with the user profile anchored at the bottom.
 */
export function Rail({
  view,
  onNavigate,
  onNewChat,
  onCreateGroup,
}: {
  view: RailView;
  onNavigate: (v: RailView) => void;
  onNewChat: () => void;
  onCreateGroup: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  return (
    <nav
      aria-label="Primary"
      className="hidden md:flex flex-col items-center gap-1.5 w-[60px] shrink-0 h-full py-3 bg-whatsapp-panel border-r border-white/10"
    >
      <RailButton icon={<ChatIcon />} title="Chats" active={view === 'chat'} onClick={() => onNavigate('chat')} />
      <RailButton icon={<PlusIcon />} title="New chat" onClick={onNewChat} />
      <RailButton icon={<GroupIcon />} title="Create group" onClick={onCreateGroup} />
      <RailButton
        icon={<StatusIcon />}
        title="Status"
        active={view === 'status'}
        onClick={() => onNavigate('status')}
      />
      <RailButton icon={<AlienIcon />} title="Nexus AI" active={view === 'ai'} onClick={() => onNavigate('ai')} accent />
      <RailButton icon={<GhostIcon />} title="Ghost chat" active={view === 'ghost'} onClick={() => onNavigate('ghost')} />
      <span className="flex-1" />
      <button
        onClick={() => onNavigate('profile')}
        title="Profile"
        aria-label="Profile"
        className={`relative rounded-full transition ring-2 ring-offset-2 ring-offset-whatsapp-panel ${
          view === 'profile' ? 'ring-secondary' : 'ring-transparent hover:ring-white/20'
        }`}
      >
        <Avatar src={user?.avatarUrl} name={user?.name || user?.username} size="md" />
        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-whatsapp-panel" aria-hidden />
      </button>
    </nav>
  );
}
