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
  const [expired, setExpired] = useState(false);
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
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 401) {
        // Refresh already failed in the api layer — session is dead.
        setExpired(true);
        setMessages((prev) => [
          ...prev,
          {
            id: `e_${Date.now()}`,
            role: 'ai',
            text: 'Your session expired and could not be refreshed. Please sign in again, then retry.',
            at: new Date().toISOString(),
          },
        ]);
      } else if (status === 429) {
        setMessages((prev) => [
          ...prev,
          {
            id: `e_${Date.now()}`,
            role: 'ai',
            text: 'You hit the AI rate limit. Wait a minute and try again.',
            at: new Date().toISOString(),
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `e_${Date.now()}`,
            role: 'ai',
            text: 'Sorry — I could not reach the AI service. Check your connection and try again.',
            at: new Date().toISOString(),
          },
        ]);
      }
    } finally {
      setThinking(false);
    }
  };

  const signOut = () => {
    try {
      useAuthStore.getState().logout();
    } catch {
      /* ignore */
    }
    window.location.href = '/';
  };

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-[#E0E5EC] text-[#2F343D]">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[#E0E5EC] border-b border-[#b8bcc9]/50">
        <Avatar
          name="Nexus AI"
          src="/nexus-alien.png"
          size="sm"
          className="shrink-0 bg-[#E9EDF3] text-[#CC5500] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] border border-[#CC5500]/30"
        />
        <div className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5">
            <b className="truncate text-sm text-[#2F343D]">Nexus AI</b>
            <span className="text-[9px] px-1 py-0.2 rounded bg-[#CC5500] text-white font-mono">BOT</span>
          </span>
          <span className="block text-[11px] text-[#8A8F98] truncate">
            Dedicated assistant · history stays on this device
          </span>
        </div>
        <Button size="sm" variant="flat" className="bg-[#E9EDF3] text-[#2F343D] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] border border-white/60" onPress={() => setMessages((prev) => prev.slice(0, 1))}>
          Clear
        </Button>
      </div>

      <div
        className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#E0E5EC]"
      >
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end mb-2">
              <div className="max-w-[78%] rounded-2xl rounded-br-sm px-3 py-2 text-sm bg-[#CC5500] text-white shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff]">
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <p className="text-[10px] text-white/80 text-right mt-1">
                  {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-start mb-2">
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-3 py-2 text-sm bg-[#E9EDF3] text-[#2F343D] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] border border-white/60">
                <SummaryBody text={m.text} />
                <p className="text-[10px] text-[#8A8F98] text-right mt-1">
                  {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ),
        )}
        {thinking && (
          <div className="flex justify-start mb-2">
            <div className="rounded-2xl rounded-bl-sm px-4 py-3 bg-[#E9EDF3] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] border border-white/60">
              <span className="inline-flex items-center gap-1.5" aria-label="Nexus AI is thinking">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-2 h-2 rounded-full bg-[#CC5500]/70 animate-typing-bounce"
                    style={{ animationDelay: `${i * 0.18}s` }}
                  />
                ))}
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 bg-[#E0E5EC] border-t border-[#b8bcc9]/50">
        {expired && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-[#CC5500]/30 bg-[#CC5500]/10 px-3.5 py-2.5 text-[12.5px] text-[#2F343D]">
            <span>Session expired — sign in again to keep chatting.</span>
            <button
              onClick={signOut}
              className="shrink-0 rounded-lg bg-[#E9EDF3] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] border border-white/60 hover:text-[#CC5500] px-3 py-1.5 text-[12px] font-semibold transition text-[#2F343D]"
            >
              Sign in again
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1 flex items-center bg-[#E0E5EC] shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff] border border-white/50 rounded-3xl px-4 py-1.5 focus-within:border-[#CC5500]/40 transition-colors">
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
              className="flex-1 bg-transparent outline-none text-sm text-[#2F343D] placeholder:text-[#8A8F98] py-1.5"
            />
          </div>
          <Button className="font-bold rounded-full bg-[#CC5500] text-white hover:bg-[#B34A00] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff]" onPress={send} isLoading={thinking} aria-label="Send to Nexus AI">
            <SendIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}
