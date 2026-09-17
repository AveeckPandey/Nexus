'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { mediaApi } from '@/lib/api';
import { VoiceRecorder } from './VoiceRecorder';
import { ClipIcon, SendIcon, MicIcon, SmileIcon, CloseIcon } from './MenuIcons';

interface Props {
  onSend: (text: string, opts?: { mediaUrl?: string; mediaType?: 'image' | 'video' | 'audio' | 'file' }) => void;
  onTyping: (on: boolean) => void;
  replyPreview?: string | null;
  onCancelReply?: () => void;
}

const MAX_HEIGHT = 132; // ≈ 5 rows — then the field scrolls (WhatsApp behaviour)

const QUICK_EMOJIS = ['😀', '😂', '❤️', '👍', '🙏', '🎉', '🔥', '😮'];

export function Composer({ onSend, onTyping, replyPreview, onCancelReply }: Props) {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-grow / shrink like WhatsApp's "Type a message" bar.
  const autosize = () => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  };

  useEffect(() => {
    autosize();
  }, [text]);

  useEffect(() => {
    areaRef.current?.focus();
  }, [replyPreview]);

  const type = (v: string) => {
    setText(v);
    onTyping(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onTyping(false), 1500);
  };

  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    requestAnimationFrame(autosize);
    onTyping(false);
    setEmojiOpen(false);
    onSend(t);
  };

  const insertEmoji = (e: string) => {
    const el = areaRef.current;
    if (!el) {
      type(`${text}${e}`);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${e}${text.slice(end)}`;
    type(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + e.length;
      autosize();
    });
  };

  const pick = () => fileRef.current?.click();

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      // Sequential upload preserves the picked order; the composer's text
      // becomes the album caption on the last image (WhatsApp behaviour).
      const caption = text.trim();
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const mediaUrl = await mediaApi.upload(f);
        const kind = f.type.startsWith('image/')
          ? 'image'
          : f.type.startsWith('video/')
            ? 'video'
            : f.type.startsWith('audio/')
              ? 'audio'
              : 'file';
        const isLast = i === files.length - 1;
        const text0 = isLast ? caption || (kind === 'file' ? `📎 ${f.name}` : '') : '';
        onSend(text0, { mediaUrl, mediaType: kind as any });
      }
      setText('');
      requestAnimationFrame(autosize);
    } catch {
      /* upload errors surface as failed sends in the feed */
    } finally {
      setUploading(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    await onFiles([f]);
  };

  const hasText = text.trim().length > 0;

  return (
    <div className="p-3 bg-[#E0E5EC] border-t border-white/70">
      {replyPreview && (
        <div className="mb-2 flex items-center justify-between text-xs bg-white/70 text-[#2F343D] rounded-lg px-3 py-2 border-l-4 border-[#CC5500] shadow-[4px_4px_8px_#b8bcc9,-4px_-4px_8px_#ffffff]">
          <span className="truncate">{replyPreview}</span>
          <button className="text-[#8A8F98] hover:text-[#CC5500] ml-2 flex items-center" onClick={onCancelReply} aria-label="Cancel reply"><CloseIcon size={12} /></button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept="image/*,video/*,audio/*,.pdf"
          multiple
          onChange={(e) => {
            onFiles(Array.from(e.target.files || []));
            e.target.value = '';
          }}
        />
        {recording ? (
          <VoiceRecorder
            onSend={(t, opts) => onSend(t, opts)}
            onCancel={() => setRecording(false)}
            onBusy={setUploading}
          />
        ) : (
          <>
            <Button variant="flat" onPress={pick} isLoading={uploading} aria-label="Attach file" className="bg-[#E9EDF3] text-[#8A8F98] hover:text-[#CC5500] rounded-full min-w-0 w-10 h-10 p-0 shadow-[4px_4px_8px_#b8bcc9,-4px_-4px_8px_#ffffff]"><ClipIcon /></Button>
            {/* WhatsApp-style pill that expands/shrinks with content */}
            <div className="flex-1 flex items-end gap-1 bg-[#E0E5EC] border border-white/70 rounded-3xl pl-1 pr-2 py-1.5 shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff] transition-colors">
              <div className="relative">
                <Button variant="light" size="sm" className="min-w-0 px-2 text-[#8A8F98] hover:text-[#CC5500] bg-transparent" aria-label="Emoji" onPress={() => setEmojiOpen((v) => !v)}><SmileIcon /></Button>
                {emojiOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setEmojiOpen(false)} />
                    <div className="absolute bottom-full left-0 mb-2 z-50 flex gap-1 p-2 rounded-2xl bg-[#E9EDF3] border border-white/70 shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff]">
                      {QUICK_EMOJIS.map((e) => (
                        <button key={e} className="text-xl hover:scale-125 transition-transform" onClick={() => insertEmoji(e)}>
                          {e}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <textarea
                ref={areaRef}
                rows={1}
                value={text}
                onChange={(e) => type(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Type a message"
                aria-label="Type a message"
                className="flex-1 bg-transparent resize-none outline-none text-sm text-[#2F343D] placeholder:text-[#8A8F98] py-1.5 max-h-[132px] leading-5"
                style={{ height: 'auto', overflowY: 'hidden' }}
              />
            </div>
            {/* WhatsApp swaps mic ↔ send depending on input */}
            {hasText ? (
              <Button onPress={send} aria-label="Send message" className="bg-[#CC5500] hover:bg-[#B34A00] text-white font-bold rounded-full min-w-0 w-10 h-10 p-0 shadow-[4px_4px_8px_#b8bcc9,-4px_-4px_8px_#ffffff]"><SendIcon /></Button>
            ) : (
              <Button variant="flat" onPress={() => setRecording(true)} aria-label="Record voice note" className="bg-[#E9EDF3] text-[#8A8F98] hover:text-[#CC5500] rounded-full min-w-0 w-10 h-10 p-0 shadow-[4px_4px_8px_#b8bcc9,-4px_-4px_8px_#ffffff]"><MicIcon /></Button>
            )}
          </>
        )}
      </div>
      <p className="mt-1 text-[10px] text-[#8A8F98] hidden sm:block">
        Enter to send · Shift+Enter for a new line · mention @nexus for Nexus AI
      </p>
    </div>
  );
}

