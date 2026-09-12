export interface User {
  userId: string;
  email: string;
  username: string;
  name?: string;
  avatarUrl?: string;
  preferredLanguage?: string;
}

export interface Reaction {
  emoji: string;
  userId: string;
  username: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  mediaType: 'text' | 'image' | 'video' | 'audio' | 'file';
  mediaUrl?: string;
  replyTo?: { id: string; senderName: string; content: string };
  reactions?: Reaction[];
  status?: 'sent' | 'delivered' | 'read';
  isEncrypted?: boolean;
  nonce?: string;
  encVersion?: number;
  createdAt: string;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  title: string;
  participants: string[];
  lastMessage?: { content: string; senderName: string; createdAt: string };
  updatedAt: string;
}

export interface GhostMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  burnDuration: number;
  isEncrypted?: boolean;
  nonce?: string;
  encVersion?: number;
  createdAt: string;
}
