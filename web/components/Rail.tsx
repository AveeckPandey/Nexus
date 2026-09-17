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
      className={`relative w-11 h-11 rounded-full flex items-center justify-center transition ${
        active
          ? 'bg-[#CC5500] text-white shadow-[4px_4px_8px_#b8bcc9,-4px_-4px_8px_#ffffff]'
          : accent
            ? 'bg-[#E0E5EC] text-[#CC5500] shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff]'
            : 'text-[#8A8F98] hover:text-[#2F343D] hover:bg-[#E0E5EC] hover:shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff]'
      }`}
    >
      {active && <span className="absolute -left-[13px] w-1 h-6 rounded-full bg-[#CC5500]" aria-hidden />}
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
      className="hidden md:flex flex-col items-center gap-1.5 w-[60px] shrink-0 h-full py-3 bg-[#E0E5EC] border-r border-white/60 shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff]"
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
        className={`relative rounded-full transition ring-2 ring-offset-2 ring-offset-[#E0E5EC] ${
          view === 'profile' ? 'ring-[#CC5500]' : 'ring-[#E0E5EC] hover:ring-white/60'
        }`}
      >
        <Avatar src={user?.avatarUrl} name={user?.name || user?.username} size="md" />
        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#22C55E] border-2 border-[#E0E5EC]" aria-hidden />
      </button>
    </nav>
  );
}
