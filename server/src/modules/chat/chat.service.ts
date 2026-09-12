import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { DynamoDbService } from '../dynamodb/dynamodb.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  mediaType: 'text' | 'image' | 'video' | 'audio' | 'file';
  mediaUrl?: string;
  replyTo?: { id: string; senderName: string; content: string };
  reactions?: { emoji: string; userId: string; username: string }[];
  status: 'sent' | 'delivered' | 'read';
  /** E2EE: content is client ciphertext opaque to the server. */
  isEncrypted?: boolean;
  nonce?: string;
  encVersion?: number;
  createdAt: string;
}

export interface ConversationItem {
  id: string;
  type: 'direct' | 'group';
  title: string;
  participants: string[];
  lastMessage?: { content: string; senderName: string; createdAt: string };
  updatedAt: string;
}

export interface MembershipItem {
  PK: string;
  SK: string;
  conversationId: string;
  role: string;
  joinedAt: string;
  isMuted: boolean;
  lastReadMessageId?: string;
  /** Denormalized preview — avoids N+1 METADATA reads on list. */
  cachedTitle?: string;
  cachedType?: string;
  cachedUpdatedAt?: string;
  cachedLastMessage?: ConversationItem['lastMessage'];
}

export interface KeyEnvelope {
  PK: string;
  SK: string;
  conversationId: string;
  userId: string;
  /** Conversation key sealed with the recipient's X25519 public key (base64). */
  encryptedKey: string;
  nonce: string;
  senderPub: string;
  keyVersion: number;
  updatedAt: string;
}

const REDACTED = '🔒 Encrypted message';

@Injectable()
export class ChatService {
  constructor(
    private readonly db: DynamoDbService,
    private readonly notifications: NotificationsService,
  ) {}

  async createConversation(
    initiatorId: string,
    participantIds: string[],
    title?: string,
    type: 'direct' | 'group' = 'direct',
  ): Promise<ConversationItem> {
    const id = uuidv4();
    const participants = Array.from(new Set([initiatorId, ...participantIds]));
    const now = new Date().toISOString();
    const conv: ConversationItem = {
      id,
      type,
      title: title?.trim() || (type === 'direct' ? 'Direct Chat' : 'New Group'),
      participants,
      updatedAt: now,
    };
    await this.db.put({
      PK: `CONV#${id}`,
      SK: 'METADATA',
      GSI1PK: `TYPE#${type}`,
      GSI1SK: `UPDATED#${now}`,
      ...conv,
      createdAt: now,
    });
    await Promise.all(
      participants.map((userId) =>
        this.db.put({
          PK: `USER#${userId}`,
          SK: `CONV#${id}`,
          conversationId: id,
          role: userId === initiatorId ? 'admin' : 'member',
          joinedAt: now,
          isMuted: false,
          cachedTitle: conv.title,
          cachedType: type,
          cachedUpdatedAt: now,
        }),
      ),
    );
    return conv;
  }

  async getConversation(conversationId: string): Promise<ConversationItem | null> {
    return this.db.get<ConversationItem>(`CONV#${conversationId}`, 'METADATA');
  }

  async isMember(conversationId: string, userId: string): Promise<boolean> {
    const m = await this.db.get<MembershipItem>(`USER#${userId}`, `CONV#${conversationId}`);
    return Boolean(m);
  }

  /** O(1) per conversation: previews come from denormalized membership rows. */
  async getUserConversations(userId: string): Promise<ConversationItem[]> {
    const memberships = await this.db.queryByPk<MembershipItem>(`USER#${userId}`, 'CONV#', 100);
    const out: ConversationItem[] = [];
    for (const m of memberships) {
      if (m.cachedTitle && m.cachedUpdatedAt) {
        out.push({
          id: m.conversationId,
          type: (m.cachedType as 'direct' | 'group') || 'direct',
          title: m.cachedTitle,
          participants: [],
          lastMessage: m.cachedLastMessage,
          updatedAt: m.cachedUpdatedAt,
        });
      } else {
        // Stale row without cache — single fallback read.
        const conv = await this.db.get<ConversationItem>(`CONV#${m.conversationId}`, 'METADATA');
        if (conv) out.push(conv);
      }
    }
    return out.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  }

  async saveMessage(
    conversationId: string,
    senderId: string,
    senderName: string,
    content: string,
    mediaType: ChatMessage['mediaType'] = 'text',
    mediaUrl?: string,
    replyTo?: ChatMessage['replyTo'],
    e2ee?: { isEncrypted?: boolean; nonce?: string; encVersion?: number },
  ): Promise<ChatMessage> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const isEncrypted = Boolean(e2ee?.isEncrypted);
    const preview = isEncrypted
      ? REDACTED
      : mediaType === 'text'
        ? content
        : `📎 ${mediaType}`;
    const msg: ChatMessage = {
      id,
      conversationId,
      senderId,
      senderName,
      content,
      mediaType,
      mediaUrl,
      replyTo,
      reactions: [],
      status: 'sent',
      isEncrypted,
      nonce: e2ee?.nonce,
      encVersion: e2ee?.encVersion,
      createdAt: now,
    };
    await this.db.put({
      PK: `CONV#${conversationId}`,
      SK: `MSG#${now}#${id}`,
      GSI1PK: `SENDER#${senderId}`,
      GSI1SK: `MSG#${now}`,
      ...msg,
    });
    const conv = await this.getConversation(conversationId);
    const lastMessage = { content: preview, senderName, createdAt: now };
    await this.db.update(
      `CONV#${conversationId}`,
      'METADATA',
      'SET lastMessage = :m, updatedAt = :n',
      { ':m': lastMessage, ':n': now },
    );
    // Refresh denormalized previews on every membership row.
    if (conv?.participants?.length) {
      await Promise.all(
        conv.participants.map((userId) =>
          this.db.update(
            `USER#${userId}`,
            `CONV#${conversationId}`,
            'SET cachedLastMessage = :m, cachedUpdatedAt = :n',
            { ':m': lastMessage, ':n': now },
          ),
        ),
      );
    }
    this.dispatchPush(conversationId, senderId, senderName, isEncrypted ? REDACTED : content);
    return msg;
  }

  /** Newest page first from storage, returned ascending for the UI. */
  async getMessages(
    conversationId: string,
    limit = 50,
    cursor?: string,
  ): Promise<{ messages: ChatMessage[]; nextCursor: string | null }> {
    const { items, nextCursor } = await this.db.queryByPkCursor<ChatMessage>(
      `CONV#${conversationId}`,
      'MSG#',
      Math.min(Math.max(limit, 1), 100),
      cursor,
      false,
    );
    return { messages: [...items].reverse(), nextCursor };
  }

  async putKeyEnvelope(
    conversationId: string,
    recipientId: string,
    envelope: { encryptedKey: string; nonce: string; senderPub: string; keyVersion: number },
  ): Promise<void> {
    await this.db.put({
      PK: `CONV#${conversationId}`,
      SK: `KEY#${recipientId}`,
      conversationId,
      userId: recipientId,
      ...envelope,
      updatedAt: new Date().toISOString(),
    });
  }

  getKeyEnvelope(conversationId: string, userId: string) {
    return this.db.get<KeyEnvelope>(`CONV#${conversationId}`, `KEY#${userId}`);
  }

  async toggleReaction(
    conversationId: string,
    messageSk: string,
    userId: string,
    username: string,
    emoji: string,
  ) {
    const msg = await this.db.get<ChatMessage>(`CONV#${conversationId}`, messageSk);
    if (!msg) return;
    const reactions = msg.reactions || [];
    const i = reactions.findIndex((r) => r.userId === userId && r.emoji === emoji);
    if (i >= 0) reactions.splice(i, 1);
    else reactions.push({ emoji, userId, username });
    await this.db.update(`CONV#${conversationId}`, messageSk, 'SET reactions = :r', {
      ':r': reactions,
    });
  }

  async markRead(conversationId: string, userId: string, messageId: string) {
    await this.db.update(`USER#${userId}`, `CONV#${conversationId}`, 'SET lastReadMessageId = :m', {
      ':m': messageId,
    });
  }

  private async dispatchPush(
    conversationId: string,
    senderId: string,
    senderName: string,
    body: string,
  ) {
    const conv = await this.db.get<ConversationItem>(`CONV#${conversationId}`, 'METADATA');
    if (!conv?.participants) return;
    for (const memberId of conv.participants) {
      if (memberId !== senderId) {
        this.notifications.sendPushNotification(memberId, senderName, body, { conversationId });
      }
    }
  }
}
