import { create } from 'zustand';
import type { ChatMessage } from '@/types';

interface ChatState {
  activeChatId: string | null;
  messages: ChatMessage[];
  summary: string | null;
  setActiveChatId: (chatId: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  removeMessage: (messageId: string) => void;
  replaceMessage: (message: ChatMessage) => void;
  setSummary: (summary: string | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeChatId: null,
  messages: [],
  summary: null,
  setActiveChatId: (activeChatId) => set({ activeChatId }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => {
      if (state.messages.some((existing) => existing.id === message.id)) {
        return state;
      }

      return { messages: [...state.messages, message] };
    }),
  removeMessage: (messageId) =>
    set((state) => ({
      messages: state.messages.filter((message) => message.id !== messageId),
    })),
  replaceMessage: (message) =>
    set((state) => ({
      messages: state.messages.map((existing) =>
        existing.id === message.id ? message : existing
      ),
    })),
  setSummary: (summary) => set({ summary }),
}));
