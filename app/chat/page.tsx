/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import {
  EllipsisVertical,
  ImagePlus,
  Languages,
  LogOut,
  Mic,
  Moon,
  Palette,
  Plus,
  Send,
  Sparkles,
  Square,
  SunMedium,
  Trash2,
  X,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useChatStore } from '@/store/useChatStore';
import {
  type BackgroundTheme,
  usePreferencesStore,
} from '@/store/usePreferencesStore';
import type { ChatMessage, ChatUser } from '@/types';

const emptySubscribe = () => () => {};

const backgroundThemes: Record<BackgroundTheme, string> = {
  sand:
    'bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.62),rgba(255,255,255,0.12)_35%,transparent_60%),linear-gradient(160deg,rgba(246,221,202,0.72),rgba(237,246,255,0.38))]',
  mint:
    'bg-[radial-gradient(circle_at_top_left,rgba(196,255,234,0.6),transparent_38%),linear-gradient(160deg,rgba(215,245,237,0.8),rgba(225,239,255,0.45))]',
  dusk:
    'bg-[radial-gradient(circle_at_top_left,rgba(194,160,255,0.34),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(120,196,255,0.25),transparent_30%),linear-gradient(180deg,rgba(245,241,255,0.82),rgba(226,220,255,0.48))]',
  graphite:
    'bg-[radial-gradient(circle_at_top_left,rgba(84,146,166,0.2),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(64,98,138,0.2),transparent_24%),linear-gradient(180deg,rgba(10,20,27,0.94),rgba(8,16,24,0.92))]',
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
};

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    SpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Failed to read file'));
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const avatarFallback = (name: string) => name.slice(0, 1).toUpperCase();

const getPreviewText = (message?: ChatMessage) => {
  if (!message) {
    return 'No messages yet';
  }
  if (message.deletedForEveryone) {
    return 'This message was deleted';
  }
  if (message.audioUrl) {
    return message.transcript || 'Voice message';
  }
  if (message.imageUrl && !message.content) {
    return 'Photo';
  }
  return message.content || 'Attachment';
};

const formatMessageTime = (createdAt?: string, fallback?: string) => {
  if (!createdAt) {
    return fallback || '';
  }

  const date = new Date(createdAt);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export default function ChatPage() {
  const router = useRouter();
  const { user, setProfileImage, logout } = useAuthStore();
  const { messages, setMessages, addMessage, replaceMessage, removeMessage, summary, setSummary, activeChatId, setActiveChatId } =
    useChatStore();
  const { colorMode, backgroundTheme, toggleColorMode, setBackgroundTheme } =
    usePreferencesStore();

  const [contacts, setContacts] = useState<ChatUser[]>([]);
  const [conversationPreview, setConversationPreview] = useState<Record<string, ChatMessage>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [input, setInput] = useState('');
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingAudio, setPendingAudio] = useState<string | null>(null);
  const [pendingTranscript, setPendingTranscript] = useState('');
  const [transcriptStatus, setTranscriptStatus] = useState<string | null>(null);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [translatingIndex, setTranslatingIndex] = useState<number | null>(null);
  const [isAvatarBusy, setIsAvatarBusy] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [activeMessageMenuId, setActiveMessageMenuId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');

  const imageInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<Record<string, ChatMessage>>({});
  const activeChatIdRef = useRef<string | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isHydrated = useSyncExternalStore(emptySubscribe, () => true, () => false);

  const currentUser = isHydrated ? user : null;
  const currentUserId = currentUser?.id ?? '';
  const currentUserName = currentUser?.username ?? 'Guest';
  const currentUserImage = currentUser?.image ?? '';
  const isDarkUi = isHydrated ? colorMode === 'dark' : false;
  const activeContact = contacts.find((contact) => contact.id === activeChatId) ?? contacts[0] ?? null;

  const sortedContacts = useMemo(
    () =>
      [...contacts].sort((a, b) => {
        const aPreview = conversationPreview[a.id] ?? a.lastMessage;
        const bPreview = conversationPreview[b.id] ?? b.lastMessage;
        const aTime = aPreview?.createdAt ?? '';
        const bTime = bPreview?.createdAt ?? '';

        if (aTime && bTime) {
          return bTime.localeCompare(aTime);
        }
        if (aTime) {
          return -1;
        }
        if (bTime) {
          return 1;
        }
        return a.username.localeCompare(b.username);
      }),
    [contacts, conversationPreview]
  );

  const totalUnreadCount = useMemo(
    () => Object.values(unreadCounts).reduce((sum, count) => sum + count, 0),
    [unreadCounts]
  );

  const pageTone = isDarkUi
    ? 'bg-[radial-gradient(circle_at_top,#183548_0%,#081018_42%,#05090e_100%)] text-[#eaf6fb]'
    : 'bg-[radial-gradient(circle_at_top,#f7fbff_0%,#edf4ff_40%,#e7edf7_100%)] text-[#11202a]';
  const shellTone = isDarkUi
    ? 'border border-white/10 bg-white/6 text-[#eaf6fb] shadow-[0_28px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl'
    : 'border border-white/60 bg-white/55 text-[#11202a] shadow-[0_32px_90px_rgba(103,132,168,0.22)] backdrop-blur-2xl';
  const sidebarTone = isDarkUi ? 'bg-black/12' : 'bg-white/24';
  const cardTone = isDarkUi
    ? 'border border-white/8 bg-white/6 backdrop-blur-xl'
    : 'border border-white/70 bg-white/58 backdrop-blur-xl';
  const activeContactTone = isDarkUi
    ? 'border border-cyan-300/18 bg-cyan-300/10 backdrop-blur-xl'
    : 'border border-white/80 bg-white/72 backdrop-blur-xl';
  const subtleText = isDarkUi ? 'text-[#98aebc]' : 'text-[#5f7382]';
  const bubbleMine = isDarkUi
    ? 'border border-cyan-300/15 bg-[linear-gradient(160deg,rgba(0,124,145,0.88),rgba(0,84,110,0.92))] text-white'
    : 'border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.82),rgba(212,247,239,0.9))] text-[#10232e]';
  const bubbleOther = isDarkUi
    ? 'border border-white/8 bg-white/8 text-[#eaf6fb]'
    : 'border border-white/75 bg-white/68 text-[#11202a]';
  const composerTone = isDarkUi
    ? 'border border-white/10 bg-white/7 backdrop-blur-2xl'
    : 'border border-white/80 bg-white/62 backdrop-blur-2xl';
  const floatingMenuTone = isDarkUi
    ? 'bg-[#0f1b24]/92 border-white/10 backdrop-blur-2xl'
    : 'bg-white/90 border-white/80 backdrop-blur-2xl';

  useEffect(() => {
    previewRef.current = conversationPreview;
  }, [conversationPreview]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, summary, pendingAudio, pendingImage]);

  const syncConversations = async (preserveSelection = true) => {
    try {
      setSyncStatus('syncing');
      const res = await fetch('/api/conversations', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error('Failed to fetch conversations');
      }

      const data = await res.json();
      if (!Array.isArray(data)) {
        return;
      }

      const nextPreview = data.reduce<Record<string, ChatMessage>>((acc, contact) => {
        if (contact.lastMessage) {
          acc[contact.id] = contact.lastMessage;
        }
        return acc;
      }, {});

      setUnreadCounts((prev) => {
        const nextCounts = { ...prev };
        for (const contact of data) {
          const latestMessage = contact.lastMessage;
          const previousMessage = previewRef.current[contact.id];
          const hasNewMessage = latestMessage?.id && latestMessage.id !== previousMessage?.id;
          const isIncoming = latestMessage?.senderId && latestMessage.senderId !== currentUserId;
          if (
            hasNewMessage &&
            isIncoming &&
            (activeChatIdRef.current !== contact.id || document.hidden)
          ) {
            nextCounts[contact.id] = (nextCounts[contact.id] ?? 0) + 1;
          }
        }
        return nextCounts;
      });

      setContacts(data);
      setConversationPreview(nextPreview);

      if ((!preserveSelection || !activeChatIdRef.current) && data[0]?.id) {
        setActiveChatId(data[0].id);
      }

      setSyncStatus('idle');
    } catch (error) {
      console.error('Conversation sync failed:', error);
      setSyncStatus('error');
    }
  };

  const syncThread = async (contactId: string) => {
    try {
      const res = await fetch(`/api/messages?recipientId=${contactId}`, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error('Failed to fetch messages');
      }

      const data = await res.json();
      if (!Array.isArray(data)) {
        return;
      }

      if (activeChatIdRef.current === contactId) {
        setMessages(data);
        setSummary(null);
      }

      setConversationPreview((prev) => {
        const next = { ...prev };
        if (data.length > 0) {
          next[contactId] = data[data.length - 1];
        } else {
          delete next[contactId];
        }
        return next;
      });
    } catch (error) {
      console.error('Thread sync failed:', error);
    }
  };

  const runConversationSync = useEffectEvent(async (preserveSelection = true) => {
    await syncConversations(preserveSelection);
  });

  const runThreadSync = useEffectEvent(async (contactId: string) => {
    await syncThread(contactId);
  });

  useEffect(() => {
    queueMicrotask(() => {
      void runConversationSync(false);
    });
  }, []);

  useEffect(() => {
    if (!activeContact) {
      setMessages([]);
      return;
    }

    queueMicrotask(() => {
      setUnreadCounts((prev) => ({ ...prev, [activeContact.id]: 0 }));
      void runThreadSync(activeContact.id);
    });
  }, [activeContact, setMessages]);

  useEffect(() => {
    const syncLoop = () => {
      void runConversationSync(true);
      if (activeChatIdRef.current) {
        void runThreadSync(activeChatIdRef.current);
      }
    };

    syncLoop();
    intervalRef.current = setInterval(syncLoop, document.hidden ? 5000 : 2500);

    const handleVisibility = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      intervalRef.current = setInterval(syncLoop, document.hidden ? 5000 : 2500);
      if (!document.hidden && activeChatIdRef.current) {
        setUnreadCounts((prev) => ({ ...prev, [activeChatIdRef.current as string]: 0 }));
        syncLoop();
      }
    };

    window.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      window.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [currentUserId]);

  const handleTyping = (value: string) => {
    setInput(value);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    if (!activeContact) {
      return;
    }
    setTypingUser('Typing...');
    typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 900);
  };

  const persistMessage = async ({
    content,
    imageUrl,
    audioUrl,
    transcript,
  }: {
    content: string;
    imageUrl?: string;
    audioUrl?: string;
    transcript?: string;
  }) => {
    if (!activeContact) {
      throw new Error('Select a user to chat with');
    }

    const res = await fetch('/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        content,
        imageUrl,
        audioUrl,
        transcript,
        receiverId: activeContact.id,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to send message');
    }

    addMessage(data);
    setConversationPreview((prev) => ({ ...prev, [activeContact.id]: data }));
    setUnreadCounts((prev) => ({ ...prev, [activeContact.id]: 0 }));
    return data;
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = input.trim();

    if (!content && !pendingImage && !pendingAudio) {
      return;
    }

    try {
      await persistMessage({
        content,
        imageUrl: pendingImage ?? undefined,
        audioUrl: pendingAudio ?? undefined,
        transcript: pendingTranscript || undefined,
      });

      setInput('');
      setPendingImage(null);
      setPendingAudio(null);
      setPendingTranscript('');
      setTranscriptStatus(null);
      setIsActionMenuOpen(false);
    } catch (error) {
      console.error('Send message failed:', error);
      alert(error instanceof Error ? error.message : 'Failed to send message');
    }
  };

  // translating the chats
  const handleTranslate = async (text: string, index: number) => {
    if (!text.trim()) {
      return;
    }

    setTranslatingIndex(index);
    try {
      const res = await fetch('/api/ai/translate', {
        method: 'POST',
        body: JSON.stringify({ text, targetLanguage: 'English' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Translation failed');
      }

      const updatedMessages = [...messages];
      updatedMessages[index] = { ...updatedMessages[index], content: data.translatedText };
      setMessages(updatedMessages);
    } catch (error) {
      console.error('Translation failed:', error);
      alert(error instanceof Error ? error.message : 'Translation failed');
    } finally {
      setTranslatingIndex(null);
    }
  };

  // summarizing the chats
  const handleSummarize = async () => {
    if (messages.length < 2) {
      alert('Need more messages to summarize');
      return;
    }

    setIsSummarizing(true);
    try {
      const aiMessages = messages
        .slice(-20)
        .map((message) => ({
          sender: message.sender,
          content:
            message.content ||
            message.transcript ||
            (message.audioUrl ? 'Voice message' : '') ||
            (message.imageUrl ? 'Image message' : ''),
        }))
        .filter((message) => message.content.trim());

      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        body: JSON.stringify({ messages: aiMessages }),
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Summarization failed');
      }

      setSummary(data.summary);
      setIsActionMenuOpen(false);
    } catch (error) {
      console.error('Summarization failed:', error);
      alert(error instanceof Error ? error.message : 'Summarization failed');
    } finally {
      setIsSummarizing(false);
    }
  };

  // deleting the chats
  const handleDeleteMessage = async (message: ChatMessage, scope: 'me' | 'everyone') => {
    try {
      const res = await fetch('/api/messages', {
        method: 'DELETE',
        body: JSON.stringify({ messageId: message.id, scope }),
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete message');
      }

      if (scope === 'me') {
        removeMessage(message.id);
        if (activeContact) {
          void syncThread(activeContact.id);
        }
      } else if (data.message) {
        replaceMessage(data.message);
        setConversationPreview((prev) => ({
          ...prev,
          [data.message.receiverId === currentUserId ? data.message.senderId : data.message.receiverId]:
            data.message,
        }));
      }
    } catch (error) {
      console.error('Delete message failed:', error);
      alert(error instanceof Error ? error.message : 'Delete failed');
    } finally {
      setActiveMessageMenuId(null);
    }
  };

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const imageUrl = await fileToDataUrl(file);
      setPendingImage(imageUrl);
      setPendingAudio(null);
      setPendingTranscript('');
      setTranscriptStatus(null);
      setIsActionMenuOpen(false);
    } catch {
      alert('Could not read selected image');
    } finally {
      e.target.value = '';
    }
  };

  const handleProfilePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    setIsAvatarBusy(true);
    try {
      const imageUrl = await fileToDataUrl(file);
      setProfileImage(imageUrl);
    } catch {
      alert('Could not update profile picture');
    } finally {
      setIsAvatarBusy(false);
      e.target.value = '';
    }
  };

  const startVoiceRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Voice recording is not supported in this browser');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      audioChunksRef.current = [];
      finalTranscriptRef.current = '';
      setPendingAudio(null);
      setPendingTranscript('');
      setTranscriptStatus(null);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioFile = new File([blob], 'voice-note.webm', { type: 'audio/webm' });
        const audioUrl = await fileToDataUrl(audioFile);
        setPendingAudio(audioUrl);
        if (finalTranscriptRef.current.trim()) {
          setPendingTranscript(finalTranscriptRef.current.trim());
        }
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
      };

      const SpeechRecognitionCtor =
        window.SpeechRecognition || window.webkitSpeechRecognition;

      if (SpeechRecognitionCtor) {
        const recognition = new SpeechRecognitionCtor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.onresult = (event) => {
          let interimTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            const chunk = result[0]?.transcript || '';
            if (result.isFinal) {
              finalTranscriptRef.current += `${chunk} `;
            } else {
              interimTranscript += chunk;
            }
          }
          setPendingTranscript(`${finalTranscriptRef.current} ${interimTranscript}`.trim());
        };
        recognition.onerror = () => {
          setTranscriptStatus('Live transcript is unavailable in this browser session.');
          speechRecognitionRef.current = null;
        };
        recognition.onend = () => {
          speechRecognitionRef.current = null;
        };
        recognition.start();
        speechRecognitionRef.current = recognition;
      } else {
        setTranscriptStatus('Speech-to-text is not supported in this browser.');
      }

      recorder.start();
      recorderRef.current = recorder;
      setPendingImage(null);
      setIsRecording(true);
      setIsActionMenuOpen(false);
    } catch (error) {
      console.error('Voice recording failed:', error);
      alert('Could not start voice recording');
    }
  };

  const stopVoiceRecording = () => {
    recorderRef.current?.stop();
    speechRecognitionRef.current?.stop();
    speechRecognitionRef.current = null;
    setIsRecording(false);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      logout();
      router.push('/login');
      router.refresh();
    }
  };

  return (
    <div className={`h-[100dvh] overflow-hidden ${pageTone} p-0 md:p-4`}>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImagePick}
      />
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleProfilePhotoPick}
      />

      <div className={`mx-auto flex h-[100dvh] max-w-[1500px] overflow-hidden md:h-[calc(100dvh-2rem)] md:rounded-[32px] ${shellTone}`}>
        <aside className={`flex min-h-0 w-full max-w-[330px] flex-col border-r border-white/10 ${sidebarTone}`}>
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-[#f5d7cb] text-[#bf5d36]"
              >
                {currentUserImage ? (
                  <img src={currentUserImage} alt="Profile" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-lg font-semibold">{avatarFallback(currentUserName)}</span>
                )}
                {isAvatarBusy ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-xs text-white">
                    ...
                  </span>
                ) : null}
              </button>
              <div>
                <p className="font-semibold">{currentUserName}</p>
                <p className={`text-sm ${subtleText}`}>
                  {totalUnreadCount > 0
                    ? `${totalUnreadCount} unread message${totalUnreadCount > 1 ? 's' : ''}`
                    : syncStatus === 'error'
                      ? 'Sync issue'
                      : 'Personal profile'}
                </p>
              </div>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setIsProfileMenuOpen((open) => !open);
                  setIsThemeMenuOpen(false);
                }}
                className={`rounded-full p-2 ${isDarkUi ? 'bg-white/10' : 'bg-white/70'}`}
              >
                <EllipsisVertical size={18} />
              </button>

              {isProfileMenuOpen ? (
                <div className={`absolute right-0 top-12 z-20 w-60 rounded-[24px] border p-2 shadow-2xl ${floatingMenuTone}`}>
                  <button
                    type="button"
                    onClick={toggleColorMode}
                    className="flex w-full items-center gap-3 rounded-[18px] px-4 py-3 text-left transition hover:bg-black/5 dark:hover:bg-white/8"
                  >
                    {isDarkUi ? <SunMedium size={18} /> : <Moon size={18} />}
                    <div>
                      <p className="text-sm font-medium">{isDarkUi ? 'Light mode' : 'Dark mode'}</p>
                      <p className={`text-xs ${subtleText}`}>Switch the chat appearance</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsThemeMenuOpen((open) => !open)}
                    className="flex w-full items-center gap-3 rounded-[18px] px-4 py-3 text-left transition hover:bg-black/5 dark:hover:bg-white/8"
                  >
                    <Palette size={18} />
                    <div>
                      <p className="text-sm font-medium">Themes</p>
                      <p className={`text-xs ${subtleText}`}>Change the chat background</p>
                    </div>
                  </button>
                  {isThemeMenuOpen ? (
                    <div className="grid grid-cols-2 gap-2 px-2 py-2">
                      {Object.keys(backgroundThemes).map((themeKey) => (
                        <button
                          key={themeKey}
                          type="button"
                          onClick={() => {
                            setBackgroundTheme(themeKey as BackgroundTheme);
                            setIsProfileMenuOpen(false);
                            setIsThemeMenuOpen(false);
                          }}
                          className={`rounded-2xl px-3 py-3 text-sm ${
                            backgroundTheme === themeKey
                              ? 'bg-[#25d366] text-[#052313]'
                              : isDarkUi
                                ? 'bg-white/10'
                                : 'bg-white/70'
                          }`}
                        >
                          {themeKey}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleLogout()}
                    className="flex w-full items-center gap-3 rounded-[18px] px-4 py-3 text-left text-[#d64545] transition hover:bg-black/5 dark:hover:bg-white/8"
                  >
                    <LogOut size={18} />
                    <div>
                      <p className="text-sm font-medium">Logout</p>
                      <p className="text-xs opacity-80">Return to the login page</p>
                    </div>
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="px-4 py-5">
            <h1 className="text-[2rem] font-semibold tracking-tight">Chats</h1>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4">
            {sortedContacts.map((contact) => {
              const preview = conversationPreview[contact.id] ?? contact.lastMessage;
              const unreadCount = unreadCounts[contact.id] ?? 0;
              const isActive = contact.id === activeContact?.id;

              return (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => {
                    setActiveChatId(contact.id);
                    setUnreadCounts((prev) => ({ ...prev, [contact.id]: 0 }));
                  }}
                  className={`flex w-full items-center gap-3 rounded-[26px] px-4 py-4 text-left transition duration-200 hover:translate-y-[-1px] ${
                    isActive ? activeContactTone : cardTone
                  }`}
                >
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-[#f5d7cb] text-[#bf5d36]">
                    {contact.image ? (
                      <img src={contact.image} alt={contact.username} className="h-full w-full object-cover" />
                    ) : (
                      <span className="font-semibold">{avatarFallback(contact.username)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-base font-semibold">{contact.username}</p>
                      <div className="flex items-center gap-2">
                        {unreadCount > 0 ? (
                          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#25d366] px-1.5 py-0.5 text-[11px] font-semibold text-[#052313]">
                            {unreadCount}
                          </span>
                        ) : null}
                        <span className={`text-xs ${subtleText}`}>
                          {formatMessageTime(preview?.createdAt, preview?.timestamp)}
                        </span>
                      </div>
                    </div>
                    <p className={`mt-1 truncate text-sm ${subtleText}`}>{getPreviewText(preview)}</p>
                  </div>
                </button>
              );
            })}

            {sortedContacts.length === 0 ? (
              <div className={`rounded-[26px] px-4 py-5 text-sm ${cardTone} ${subtleText}`}>
                No other users yet. Register another account to start 1:1 messaging.
              </div>
            ) : null}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="border-b border-white/10 px-5 py-4">
            {activeContact ? (
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-[#f5d7cb] text-[#bf5d36]">
                  {activeContact.image ? (
                    <img src={activeContact.image} alt={activeContact.username} className="h-full w-full object-cover" />
                  ) : (
                    <span className="font-semibold">{avatarFallback(activeContact.username)}</span>
                  )}
                </div>
                <div>
                  <p className="font-semibold">{activeContact.username}</p>
                  <p className={`text-sm ${subtleText}`}>
                    {typingUser || activeContact.email}
                  </p>
                </div>
              </div>
            ) : (
              <p className={`text-sm ${subtleText}`}>Choose a user to start chatting</p>
            )}
          </div>

          <div className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5 md:py-5 ${backgroundThemes[backgroundTheme]}`}>
            <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-3">
              <div className="flex-1" />
              {messages.map((message, index) => {
                const isMine = message.senderId === currentUserId;
                const canDeleteForEveryone = isMine && !message.deletedForEveryone;

                return (
                  <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                    <div className="relative max-w-[78%]">
                      <div className={`max-w-full rounded-[28px] px-4 py-3 shadow-[0_18px_50px_rgba(15,23,42,0.08)] ${isMine ? bubbleMine : bubbleOther}`}>
                        <div className="mb-2 flex items-start justify-between gap-3">
                          {!isMine ? (
                            <p className="text-xs font-semibold opacity-70">{message.sender}</p>
                          ) : (
                            <span />
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setActiveMessageMenuId((current) =>
                                current === message.id ? null : message.id
                              )
                            }
                            className="rounded-full p-1 opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                          >
                            <EllipsisVertical size={14} />
                          </button>
                        </div>

                        {message.deletedForEveryone ? (
                          <p className="text-[15px] italic opacity-75">This message was deleted.</p>
                        ) : (
                          <>
                            {message.imageUrl ? (
                              <img
                                src={message.imageUrl}
                                alt="Shared in chat"
                                className="mb-2 max-h-72 w-full rounded-2xl object-cover"
                              />
                            ) : null}
                            {message.audioUrl ? (
                              <div className="mb-2">
                                <audio controls className="max-w-full">
                                  <source src={message.audioUrl} type="audio/webm" />
                                </audio>
                              </div>
                            ) : null}
                            {message.content ? (
                              <p className="whitespace-pre-wrap text-[15px]">{message.content}</p>
                            ) : null}
                            {message.transcript ? (
                              <p className="mt-2 text-xs opacity-75">Transcript: {message.transcript}</p>
                            ) : null}
                          </>
                        )}

                        <div className="mt-2 flex items-center justify-between gap-4">
                          <span className="text-[11px] opacity-60">{message.timestamp}</span>
                          {message.content && !message.deletedForEveryone ? (
                            <button
                              type="button"
                              onClick={() => handleTranslate(message.content, index)}
                              disabled={translatingIndex === index}
                              className="inline-flex items-center gap-1 text-[11px] font-medium opacity-70 transition hover:opacity-100 disabled:opacity-40"
                            >
                              <Languages size={12} />
                              {translatingIndex === index ? 'Translating' : 'Translate'}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {activeMessageMenuId === message.id ? (
                        <div className={`absolute ${isMine ? 'right-0' : 'left-0'} top-full z-10 mt-2 min-w-44 rounded-2xl border p-2 shadow-xl ${floatingMenuTone}`}>
                          <button
                            type="button"
                            onClick={() => void handleDeleteMessage(message, 'me')}
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/8"
                          >
                            <Trash2 size={14} />
                            Delete for me
                          </button>
                          {canDeleteForEveryone ? (
                            <button
                              type="button"
                              onClick={() => void handleDeleteMessage(message, 'everyone')}
                              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-[#d64545] transition hover:bg-black/5 dark:hover:bg-white/8"
                            >
                              <Trash2 size={14} />
                              Delete for everyone
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {summary ? (
                <div className="flex justify-center pt-2">
                  <div className="max-w-xl rounded-[28px] border border-white/60 bg-white/72 px-4 py-3 text-center text-sm text-[#32424c] shadow-[0_18px_50px_rgba(88,115,150,0.18)] backdrop-blur-xl">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="inline-flex rounded-full bg-[#25d366]/20 px-2 py-0.5 text-xs font-semibold text-[#128c7e]">
                        AI Catch Up
                      </span>
                      <button
                        type="button"
                        onClick={() => setSummary(null)}
                        className="rounded-full p-1 text-[#32424c] transition hover:bg-black/5"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    {summary}
                  </div>
                </div>
              ) : null}

              <div ref={bottomRef} />
            </div>
          </div>

          <div className="border-t border-white/10 px-4 py-4 md:px-5">
            {(pendingImage || pendingAudio) ? (
              <div className={`mb-3 inline-flex rounded-[22px] border p-3 ${composerTone}`}>
                {pendingImage ? (
                  <div className="relative">
                    <img src={pendingImage} alt="Pending upload" className="h-24 w-24 rounded-2xl object-cover" />
                    <button
                      type="button"
                      onClick={() => setPendingImage(null)}
                      className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/80 text-xs text-white"
                    >
                      x
                    </button>
                  </div>
                ) : null}

                {pendingAudio ? (
                  <div className="space-y-2">
                    <audio controls className="max-w-full">
                      <source src={pendingAudio} type="audio/webm" />
                    </audio>
                    {pendingTranscript ? (
                      <p className={`max-w-md text-xs ${subtleText}`}>{pendingTranscript}</p>
                    ) : null}
                    {transcriptStatus ? (
                      <p className="max-w-md text-xs text-amber-500">{transcriptStatus}</p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setPendingAudio(null);
                        setPendingTranscript('');
                        setTranscriptStatus(null);
                      }}
                      className={`rounded-full px-3 py-1 text-xs ${isDarkUi ? 'bg-white/10' : 'bg-white/70'}`}
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <form onSubmit={sendMessage} className="relative">
              {isActionMenuOpen ? (
                <div className={`absolute bottom-16 left-0 z-10 w-72 rounded-[24px] border p-2 shadow-2xl ${composerTone}`}>
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="flex w-full items-center gap-3 rounded-[18px] px-4 py-3 text-left transition hover:bg-black/5 dark:hover:bg-white/8"
                  >
                    <ImagePlus size={18} />
                    <div>
                      <p className="text-sm font-medium">Send picture</p>
                      <p className={`text-xs ${subtleText}`}>Attach an image to this chat</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSummarize()}
                    className="flex w-full items-center gap-3 rounded-[18px] px-4 py-3 text-left transition hover:bg-black/5 dark:hover:bg-white/8"
                  >
                    <Sparkles size={18} />
                    <div>
                      <p className="text-sm font-medium">{isSummarizing ? 'Analyzing...' : 'AI catch up'}</p>
                      <p className={`text-xs ${subtleText}`}>Summarize this thread</p>
                    </div>
                  </button>
                </div>
              ) : null}

              <div className={`flex items-center gap-3 rounded-[28px] border px-4 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.08)] ${composerTone}`}>
                <button
                  type="button"
                  onClick={() => setIsActionMenuOpen((open) => !open)}
                  className={`flex h-11 w-11 items-center justify-center rounded-full ${isDarkUi ? 'bg-white/10' : 'bg-white/70'}`}
                >
                  <Plus size={20} />
                </button>
                <input
                  value={input}
                  onChange={(e) => handleTyping(e.target.value)}
                  placeholder={activeContact ? 'Type a message' : 'Select a user to start chatting'}
                  disabled={!activeContact}
                  className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#667781] disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={isRecording ? stopVoiceRecording : () => void startVoiceRecording()}
                  disabled={!activeContact}
                  className={`flex h-11 w-11 items-center justify-center rounded-full ${
                    isRecording ? 'bg-[#ff6b6b] text-white' : isDarkUi ? 'bg-white/10' : 'bg-white/70'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {isRecording ? <Square size={18} /> : <Mic size={18} />}
                </button>
                <button
                  type="submit"
                  disabled={!activeContact || (!input.trim() && !pendingImage && !pendingAudio)}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-[#25d366] text-[#052313] transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send size={18} />
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
