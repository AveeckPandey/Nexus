'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Textarea } from '@heroui/react';
import { mediaApi } from '@/lib/api';
import { VoiceRecorder } from './VoiceRecorder';

interface Props {
  onSend: (text: string, opts?: { mediaUrl?: string; mediaType?: 'image' | 'video' | 'audio' | 'file' }) => void;
  onTyping: (on: boolean) => void;
  replyPreview?: string | null;
  onCancelReply?: () => void;
}

export function Composer({ onSend, onTyping, replyPreview, onCancelReply }: Props) {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    onTyping(false);
    onSend(t);
  };

  const pick = () => fileRef.current?.click();

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      const mediaUrl = await mediaApi.upload(f);
      const kind = f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'file';
      onSend(text.trim() || `📎 ${f.name}`, { mediaUrl, mediaType: kind as 'image' });
      setText('');
    } catch {
      /* upload errors surface as failed sends in the feed */
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-3 bg-whatsapp-panel border-t border-white/10">
      {replyPreview && (
        <div className="mb-2 flex items-center justify-between text-xs bg-whatsapp-composer rounded-lg px-3 py-2 border-l-2 border-secondary">
          <span className="truncate">{replyPreview}</span>
          <button className="text-whatsapp-checkGray ml-2" onClick={onCancelReply}>✕</button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept="image/*,video/*,audio/*,.pdf"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <Button variant="flat" onPress={pick} isLoading={uploading} aria-label="Attach file">📎</Button>
        {recording ? (
          <VoiceRecorder
            onSend={(t, opts) => onSend(t, opts)}
            onCancel={() => setRecording(false)}
            onBusy={setUploading}
          />
        ) : (
          <>
            <Textarea
              minRows={1}
              maxRows={4}
              placeholder="Type an encrypted message…"
              value={text}
              onValueChange={type}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              className="flex-1"
            />
            <Button variant="flat" onPress={() => setRecording(true)} aria-label="Record voice note">🎙️</Button>
          </>
        )}
        {!recording && (
          <Button color="secondary" className="font-bold" onPress={send} isDisabled={!text.trim()}>Send</Button>
        )}
      </div>
    </div>
  );
}
