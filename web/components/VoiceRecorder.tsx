'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { mediaApi } from '@/lib/api';

interface Props {
  onSend: (text: string, opts: { mediaUrl: string; mediaType: 'audio' }) => void;
  onCancel: () => void;
  onBusy: (busy: boolean) => void;
}

/**
 * Voice note recorder: MediaRecorder (audio/webm) + live AnalyserNode
 * waveform bars + direct-to-S3 upload. Matches spec §8 VoiceRecorder.tsx.
 */
export function VoiceRecorder({ onSend, onCancel, onBusy }: Props) {
  const [secs, setSecs] = useState(0);
  const [bars, setBars] = useState<number[]>(new Array(24).fill(4));
  const recRef = useRef<{
    recorder: MediaRecorder;
    chunks: Blob[];
    stream: MediaStream;
    raf: number;
    clock: ReturnType<typeof setInterval>;
    ctx: AudioContext;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined;
        const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        const Ctx = window.AudioContext || (window as unknown as typeof AudioContext);
        const ctx: AudioContext = new Ctx();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const loop = () => {
          analyser.getByteFrequencyData(data);
          setBars(Array.from({ length: 24 }, (_, i) => 4 + Math.round((data[i] / 255) * 28)));
          const raf = requestAnimationFrame(loop);
          if (recRef.current) recRef.current.raf = raf;
        };
        const clock = setInterval(() => setSecs((s) => s + 1), 1000);
        recRef.current = { recorder, chunks, stream, raf: requestAnimationFrame(loop), clock, ctx };
        recorder.start();
      } catch {
        onCancel();
      }
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanup = () => {
    const r = recRef.current;
    if (!r) return;
    cancelAnimationFrame(r.raf);
    clearInterval(r.clock);
    r.ctx.close().catch(() => {});
    r.stream.getTracks().forEach((t) => t.stop());
    recRef.current = null;
  };

  const cancel = () => {
    cleanup();
    onCancel();
  };

  const stopAndSend = async () => {
    const r = recRef.current;
    if (!r) return;
    const duration = secs;
    const done = new Promise<Blob>((resolve) => {
      r.recorder.onstop = () =>
        resolve(new Blob(r.chunks, { type: r.recorder.mimeType || 'audio/webm' }));
      r.recorder.stop();
    });
    cleanup();
    onBusy(true);
    try {
      const blob = await done;
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
      const mediaUrl = await mediaApi.upload(file);
      onSend(`🎙️ Voice note (${duration}s)`, { mediaUrl, mediaType: 'audio' });
    } catch {
      /* upload failed — nothing sent */
    } finally {
      onBusy(false);
      onCancel();
    }
  };

  return (
    <div className="flex-1 flex items-center gap-2 bg-whatsapp-composer rounded-xl px-3 py-2">
      <span className="w-2.5 h-2.5 rounded-full bg-danger animate-pulse shrink-0" />
      <span className="text-xs font-mono w-10 shrink-0">
        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
      </span>
      <div className="flex-1 flex items-center gap-[2px] h-8" aria-hidden>
        {bars.map((h, i) => (
          <span key={i} className="flex-1 rounded bg-danger/80" style={{ height: `${h}px` }} />
        ))}
      </div>
      <Button size="sm" variant="light" onPress={cancel}>
        ✕
      </Button>
      <Button size="sm" color="danger" onPress={stopAndSend}>
        Send
      </Button>
    </div>
  );
}
