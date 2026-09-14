'use client';

import type { SVGProps } from 'react';

function Base({ children, size = 16, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export function InfoIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.5v.5" />
    </Base>
  );
}

export function ReplyIcon() {
  return (
    <Base>
      <polyline points="9 17 4 12 9 7" />
      <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    </Base>
  );
}

export function CopyIcon() {
  return (
    <Base>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Base>
  );
}

export function TranslateIcon() {
  return (
    <Base>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a13.5 13.5 0 0 1 0 18" />
      <path d="M12 3a13.5 13.5 0 0 0 0 18" />
    </Base>
  );
}

export function ForwardIcon() {
  return (
    <Base>
      <polyline points="15 17 20 12 15 7" />
      <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
    </Base>
  );
}

export function PinIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M9 4h6l-1 7 3 3v2H7v-2l3-3z" />
      <path d="M12 16v5" />
    </Base>
  );
}

export function SparkleIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" />
    </Base>
  );
}

export function AlienIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8 16L3.54223 12.3383C1.93278 11.0162 1 9.04287 1 6.96005C1 3.11612 4.15607 0 8 0C11.8439 0 15 3.11612 15 6.96005C15 9.04287 14.0672 11.0162 12.4578 12.3383L8 16ZM3 6H5C6.10457 6 7 6.89543 7 8V9L3 7.5V6ZM11 6C9.89543 6 9 6.89543 9 8V9L13 7.5V6H11Z"
      />
    </svg>
  );
}

export function StarIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
    </Base>
  );
}

export function SelectIcon() {
  return (
    <Base>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M8 12.5l2.7 2.7L16 9.5" />
    </Base>
  );
}

export function SaveIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M12 3v12" />
      <polyline points="7 10 12 15 17 10" />
      <path d="M4 21h16" />
    </Base>
  );
}

export function ShareIcon() {
  return (
    <Base>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4" />
      <path d="M15.4 6.5l-6.8 4" />
    </Base>
  );
}

export function OpenIcon() {
  return (
    <Base>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </Base>
  );
}

export function TrashIcon() {
  return (
    <Base>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </Base>
  );
}

export function PlusIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Base>
  );
}

export function DotsIcon() {  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

export function PhoneIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.9z" />
    </Base>
  );
}

export function VideoIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="6" width="15" height="12" rx="2" />
    </Base>
  );
}

export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </Base>
  );
}

export function ImageIcon() {
  return (
    <Base>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </Base>
  );
}

export function KeyIcon() {
  return (
    <Base>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M11 12l10-10" />
      <path d="M15 6l3 3" />
    </Base>
  );
}

export function LockIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Base>
  );
}

export function UnlockIcon() {
  return (
    <Base>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
    </Base>
  );
}

export function ComposeIcon() {
  return (
    <Base>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Base>
  );
}

export function InviteIcon() {
  return (
    <Base>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6" />
      <path d="M22 11h-6" />
    </Base>
  );
}

export function CameraIcon() {
  return (
    <Base>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </Base>
  );
}

export function PencilIcon() {
  return (
    <Base>
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </Base>
  );
}

export function BackIcon() {
  return (
    <Base>
      <path d="M19 12H5" />
      <polyline points="12 19 5 12 12 5" />
    </Base>
  );
}

export function ChatIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-3-.4-4.2-1L3 20l1.1-5.1A8.5 8.5 0 1 1 21 11.5z" />
    </Base>
  );
}

export function GroupIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5a3.5 3.5 0 0 1 0 6.8" />
      <path d="M17.5 14.5a6.5 6.5 0 0 1 4 5.5" />
    </Base>
  );
}

export function StatusIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <circle cx="12" cy="12" r="9" strokeDasharray="4 2.5" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function GhostIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M12 2a7 7 0 0 0-7 7v12l2.5-2 2.5 2 2-2 2 2 2.5-2 2.5 2V9a7 7 0 0 0-7-7z" />
      <circle cx="9.5" cy="10" r="0.5" fill="currentColor" />
      <circle cx="14.5" cy="10" r="0.5" fill="currentColor" />
    </Base>
  );
}

export function PersonIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </Base>
  );
}

export function SendIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4z" />
    </Base>
  );
}

export function MicIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 19v3" />
    </Base>
  );
}

export function ClipIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M21 11l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8L13 3.4a3.7 3.7 0 0 1 5.2 5.2l-8.2 8.2a1.85 1.85 0 0 1-2.6-2.6L14.5 7" />
    </Base>
  );
}

export function DocIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </Base>
  );
}

export function PlayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <polyline points="6 9 12 15 18 9" />
    </Base>
  );
}

export function ChevronLeftIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <polyline points="15 18 9 12 15 6" />
    </Base>
  );
}

export function ChevronRightIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <polyline points="9 18 15 12 9 6" />
    </Base>
  );
}

export function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </Base>
  );
}

export function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size} strokeWidth={2.4}>
      <polyline points="20 6 9 17 4 12" />
    </Base>
  );
}

export function EyeIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M1 12s4-7.5 11-7.5S23 12 23 12s-4 7.5-11 7.5S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </Base>
  );
}

export function FlameIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M12 22c4.4 0 7.5-3 7.5-7.2 0-3.1-1.7-5.3-3.2-7C14.8 6.1 13.5 4.5 13.5 2c-3 2-4.5 4.2-5.4 6.5-.6-1-.9-2.1-1-3.5C5.4 6.6 4.5 9 4.5 11.4 4.5 18 8.4 22 12 22z" />
    </Base>
  );
}

export function SmileIcon({ size = 16 }: { size?: number }) {
  return (
    <Base size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.5 2.5 4 2.5 4-2.5 4-2.5" />
      <line x1="9" y1="9" x2="9.5" y2="9.5" strokeWidth={2.4} />
      <line x1="15" y1="9" x2="15.5" y2="9.5" strokeWidth={2.4} />
    </Base>
  );
}

