'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Avatar } from '@heroui/react';
import { aiApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { SummaryBody } from './ChatWindow';
import { SendIcon } from './MenuIcons';

interface AiMsg {
  id: string;
  role: 'user' | 'ai';
  text: string;
  at: string;
}

/**
 * Dedicated Nexus AI chat — a clearly identifiable, separate interface for
 * interacting with the AI assistant. Session history lives only on this
 * device and never touches conversation storage.
 */
export function AiChatPanel() {
  const user = useAuthStore((s) => s.user);
  const [messages, setMessages] = useState<AiMsg[]>([
    {
      id: 'hello',
      role: 'ai',
      text: `Hey ${user?.name || user?.username || 'there'}! I'm **Nexus AI** — ask me anything, or use the Summarize button in any chat for a recap.`,
      at: new Date().toISOString(),
    },
  ]);
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, thinking]);

  const send = async () => {
    const q = text.trim();
    if (!q || thinking) return;
    setText('');
    const mine: AiMsg = { id: `u_${Date.now()}`, role: 'user', text: q, at: new Date().toISOString() };
    setMessages((prev) => [...prev, mine]);
    setThinking(true);
    try {
      const reply = await aiApi.chat(q, user?.name || user?.username);
      setMessages((prev) => [
        ...prev,
        { id: `a_${Date.now()}`, role: 'ai', text: reply || '…', at: new Date().toISOString() },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `e_${Date.now()}`,
          role: 'ai',
          text: 'Sorry — I could not reach the AI service. Check your connection and try again.',
          at: new Date().toISOString(),
        },
      ]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-whatsapp-dark">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-whatsapp-panel border-b border-white/10">
        <Avatar
          name="Nexus AI"
          src="/assets/alien-svgrepo-com.svg"
          size="sm"
          className="shrink-0 bg-white [&_img]:p-1"
        />
        <div className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5">
            <b className="truncate text-sm">Nexus AI</b>
            <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-mono">BOT</span>
          </span>
          <span className="block text-[11px] text-whatsapp-checkGray truncate">
            Dedicated assistant · history stays on this device
          </span>
        </div>
        <Button size="sm" variant="flat" onPress={() => setMessages((prev) => prev.slice(0, 1))}>
          Clear
        </Button>
      </div>

      <div
        className="flex-1 overflow-y-auto p-4 space-y-2"
        style={{
          backgroundImage:
            'linear-gradient(rgba(20, 9, 43, 0.88), rgba(20, 9, 43, 0.88)), url(/assets/y10n_fpni_211014.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end mb-2">
              <div className="max-w-[78%] rounded-2xl rounded-br-sm px-3 py-2 text-sm shadow-sm bg-whatsapp-outgoing">
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <p className="text-[10px] opacity-60 text-right mt-1">
                  {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-start mb-2">
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-3 py-2 text-sm shadow-md bg-gradient-to-br from-[#0c1a24] to-[#1b1226] border border-cyan-500/40 text-cyan-50">
                <SummaryBody text={m.text} />
                <p className="text-[10px] opacity-60 text-right mt-1">
                  {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ),
        )}
        {thinking && (
          <div className="flex justify-start mb-2">
            <div className="rounded-2xl rounded-bl-sm px-4 py-3 bg-gradient-to-br from-[#0c1a24] to-[#1b1226] border border-cyan-500/40">
              <span className="inline-flex items-center gap-1.5" aria-label="Nexus AI is thinking">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-2 h-2 rounded-full bg-cyan-300/80 animate-typing-bounce"
                    style={{ animationDelay: `${i * 0.18}s` }}
                  />
                ))}
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 bg-whatsapp-panel border-t border-white/10">
        <div className="flex items-end gap-2">
          <div className="flex-1 flex items-center bg-whatsapp-composer border border-white/10 rounded-3xl px-4 py-1.5 focus-within:border-secondary/60 transition-colors">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask Nexus AI anything…"
              aria-label="Ask Nexus AI anything"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-whatsapp-checkGray py-1.5"
            />
          </div>
          <Button color="secondary" className="font-bold rounded-full" onPress={send} isLoading={thinking} aria-label="Send to Nexus AI">
            <SendIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}
