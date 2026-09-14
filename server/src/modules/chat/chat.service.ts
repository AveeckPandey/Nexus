import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { DynamoDbService } from '../dynamodb/dynamodb.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../../common/redis/redis.service';

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
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
    @Optional() private readonly redis?: RedisService,
  ) {}

  async createConversation(
    initiatorId: string,
    participantIds: string[],
    title?: string,
    type: 'direct' | 'group' = 'direct',
  ): Promise<ConversationItem> {
    const id = uuidv4();
    const participants = Array.from(new Set([initiatorId, ...participantIds]));
    if (participants.length > 1024) {
      throw new BadRequestException('Group chat maximum capacity reached (max 1024 members)');
    }
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
    if (type === 'direct' && participants.length === 2) {
      const pair = [participants[0], participants[1]].sort().join('#');
      await this.db.put({
        PK: `DIRECT#${pair}`,
        SK: 'CONV',
        conversationId: id,
        createdAt: now,
      });
    }

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

  async addParticipant(conversationId: string, userId: string): Promise<ConversationItem> {
    const conv = await this.getConversation(conversationId);
    if (!conv) throw new BadRequestException('Conversation not found');
    if (conv.participants.includes(userId)) return conv;
    if (conv.participants.length >= 1024) {
      throw new BadRequestException('Group chat maximum capacity reached (max 1024 members)');
    }
    conv.participants.push(userId);
    conv.updatedAt = new Date().toISOString();
    await this.db.put({
      PK: `CONV#${conversationId}`,
      SK: 'METADATA',
      ...conv,
    });
    await this.db.put({
      PK: `USER#${userId}`,
      SK: `CONV#${conversationId}`,
      conversationId,
      role: 'member',
      joinedAt: conv.updatedAt,
      isMuted: false,
      cachedTitle: conv.title,
      cachedType: conv.type,
      cachedUpdatedAt: conv.updatedAt,
    });
    return conv;
  }

  async getConversation(conversationId: string): Promise<ConversationItem | null> {
    return this.db.get<ConversationItem>(`CONV#${conversationId}`, 'METADATA');
  }

  /**
   * Find the existing 1:1 direct conversation between two users in O(1).
   * Checks deterministic DIRECT#<a#b> index first, with bounded fallback for legacy.
   */
  async findDirectConversation(a: string, b: string): Promise<ConversationItem | null> {
    const pair = [a, b].sort().join('#');
    const directHit = await this.db.get<{ conversationId: string }>(`DIRECT#${pair}`, 'CONV');
    if (directHit?.conversationId) {
      return this.getConversation(directHit.conversationId);
    }
    const memberships = await this.db.queryByPk<MembershipItem>(`USER#${a}`, 'CONV#', 25);
    for (const m of memberships) {
      const conv = await this.getConversation(m.conversationId);
      if (!conv || conv.type !== 'direct' || !Array.isArray(conv.participants)) continue;
      const set = new Set(conv.participants);
      if (set.size === 2 && set.has(a) && set.has(b)) {
        this.db.put({ PK: `DIRECT#${pair}`, SK: 'CONV', conversationId: conv.id }).catch(() => {});
        return conv;
      }
    }
    return null;
  }

  /**
   * Idempotent 1:1 open — invite links and username search both land here,
   * so double-taps and re-opened links never duplicate the chat.
   */
  async findOrCreateDirectConversation(a: string, b: string): Promise<ConversationItem> {
    const existing = await this.findDirectConversation(a, b);
    if (existing) return existing;
    return this.createConversation(a, [b], undefined, 'direct');
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
    senderAvatar?: string,
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
      senderAvatar,
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
    // Atomic METADATA update gives the authoritative preview for all members in O(1)
    const lastMessage = { content: preview, senderName, createdAt: now };
    await this.db.update(
      `CONV#${conversationId}`,
      'METADATA',
      'SET lastMessage = :m, updatedAt = :n',
      { ':m': lastMessage, ':n': now },
    );

    // For 1:1 and small groups (<= 10), asynchronously refresh member previews in background.
    // For large groups, avoids 1000s of writes; getUserConversations falls back to METADATA.
    // Single read reused for both preview fan-out and push (saves ~1 DB read/msg).
    this.getConversation(conversationId).then((conv) => {
      const participants = conv?.participants || [];
      if (participants.length && participants.length <= 10) {
        Promise.all(
          participants.map((userId) =>
            this.db.update(
              `USER#${userId}`,
              `CONV#${conversationId}`,
              'SET cachedLastMessage = :m, cachedUpdatedAt = :n',
              { ':m': lastMessage, ':n': now },
            ),
          ),
        ).catch(() => {});
      }
      this.dispatchPush(
        conversationId,
        senderId,
        senderName,
        isEncrypted ? REDACTED : content,
        participants,
      );
    }).catch(() => {
      this.dispatchPush(conversationId, senderId, senderName, isEncrypted ? REDACTED : content, []);
    });
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

  /**
   * Read receipts that survive reloads: every member's `lastReadMessageId`
   * cursor. The author marks its own messages ✓✓ once every *other*
   * member's cursor has passed them (single other member for 1:1 chats).
   * Message items keep `status: 'sent'` — receipts are derived, never
   * rewritten per message, so reads stay O(participants) cheap.
   */
  async getReadCursors(conversationId: string): Promise<Record<string, string>> {
    const conv = await this.getConversation(conversationId);
    if (!conv?.participants?.length) return {};
    const out: Record<string, string> = {};
    await Promise.all(
      conv.participants.map(async (userId) => {
        const m = await this.db.get<MembershipItem>(`USER#${userId}`, `CONV#${conversationId}`);
        if (m?.lastReadMessageId) out[userId] = m.lastReadMessageId;
      }),
    );
    return out;
  }

  private dispatchPush(
    conversationId: string,
    senderId: string,
    senderName: string,
    body: string,
    participants: string[] = [],
  ) {
    // Batched background fan-out (20/recipient batch) with DLQ on total failure.
    // Hot path never blocks: saveMessage already returned.
    setImmediate(async () => {
      try {
        let targets = participants.filter((m) => m !== senderId);
        if (!targets.length) {
          const conv = await this.db.get<ConversationItem>(`CONV#${conversationId}`, 'METADATA');
          targets = (conv?.participants || []).filter((m) => m !== senderId);
        }
        for (let i = 0; i < targets.length; i += 20) {
          const batch = targets.slice(i, i + 20);
          await Promise.allSettled(
            batch.map((memberId) =>
              this.notifications.sendPushNotification(memberId, senderName, body, { conversationId }),
            ),
          );
        }
      } catch (err: any) {
        // Durability: park for a dedicated push worker / SQS migration (100k path).
        try {
          await this.redis?.set(
            `push:dlq:${conversationId}:${Date.now()}`,
            JSON.stringify({ conversationId, senderId, senderName, body }),
            'EX',
            86400,
          );
        } catch {}
      }
    });
  }
}
