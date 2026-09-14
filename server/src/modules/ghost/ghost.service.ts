import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { DynamoDbService } from '../dynamodb/dynamodb.service';

export interface GhostInvite {
  token: string;
  roomId: string;
  createdBy: string;
  isConsumed: boolean;
  claimedBy?: string;
  expireAt: number;
  createdAt: string;
}

export interface GhostMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  burnDuration: number;
  isBurnStarted: boolean;
  burnExpiresAt?: number;
  isEncrypted?: boolean;
  nonce?: string;
  encVersion?: number;
  createdAt: string;
}

@Injectable()
export class GhostService {
  constructor(private readonly db: DynamoDbService) {}

  /** Burn window clamp: minimum 5s, maximum 5 minutes (300s). Default 30s. */
  clampBurn(input?: unknown): number {
    const n = typeof input === 'number' ? Math.floor(input) : parseInt(String(input ?? ''), 10);
    if (!Number.isFinite(n)) return 30;
    return Math.min(300, Math.max(5, n));
  }

  async createInvite(createdBy: string) {
    const token = crypto.randomBytes(16).toString('hex');
    const roomId = uuidv4();
    const nowSec = Math.floor(Date.now() / 1000);
    await this.db.put({
      PK: `INVITE#${token}`,
      SK: 'METADATA',
      token,
      roomId,
      createdBy,
      isConsumed: false,
      expireAt: nowSec + 300,
      expire_at: nowSec + 300,
      createdAt: new Date().toISOString(),
    });
    // Creator is the first room participant.
    await this.db.put({
      PK: `GHOST#${roomId}`,
      SK: `MEMBER#${createdBy}`,
      roomId,
      userId: createdBy,
      joinedAt: new Date().toISOString(),
    });
    return {
      token,
      roomId,
      inviteLink: `${process.env.CLIENT_ORIGIN || 'https://nexus.app'}/ghost?token=${token}`,
      expiresAt: new Date((nowSec + 300) * 1000).toISOString(),
    };
  }

  async claimInvite(token: string, userId: string): Promise<{ roomId: string }> {
    const invite = await this.db.get<GhostInvite>(`INVITE#${token}`, 'METADATA');
    if (!invite) throw new NotFoundException('Invite link is invalid or expired.');
    if (invite.expireAt < Math.floor(Date.now() / 1000)) {
      await this.db.delete(`INVITE#${token}`, 'METADATA');
      throw new BadRequestException('Invite link expired (5-minute limit).');
    }
    if (invite.isConsumed) {
      if (invite.claimedBy === userId || invite.createdBy === userId) {
        return { roomId: invite.roomId };
      }
      throw new BadRequestException('This one-time invite has already been used.');
    }
    // Atomic one-time consumption — losers of a claim race get `false`.
    const claimed = await this.db.updateConditional(
      `INVITE#${token}`,
      'METADATA',
      'SET isConsumed = :c, claimedBy = :u',
      { ':c': true, ':u': userId },
      'attribute_not_exists(isConsumed) OR isConsumed = :__false',
    );
    if (!claimed) {
      throw new BadRequestException('This one-time invite has already been used.');
    }
    await this.db.put({
      PK: `GHOST#${invite.roomId}`,
      SK: `MEMBER#${userId}`,
      roomId: invite.roomId,
      userId,
      joinedAt: new Date().toISOString(),
    });
    return { roomId: invite.roomId };
  }

  async isParticipant(roomId: string, userId: string): Promise<boolean> {
    const m = await this.db.get(`GHOST#${roomId}`, `MEMBER#${userId}`);
    return Boolean(m);
  }

  async setBurnStarted(roomId: string, messageId: string, burnExpiresAt: number) {
    await this.db.update(
      `GHOST#${roomId}`,
      `MSG#${messageId}`,
      'SET isBurnStarted = :s, burnExpiresAt = :b',
      { ':s': true, ':b': burnExpiresAt },
    );
  }

  async saveMessage(
    roomId: string,
    senderId: string,
    senderName: string,
    content: string,
    e2ee?: { isEncrypted?: boolean; nonce?: string; encVersion?: number },
    burnDuration?: unknown,
  ): Promise<GhostMessage> {
    // Ghost messages are ciphertext-only: plaintext is rejected at the gateway.
    if (!e2ee?.isEncrypted || !e2ee?.nonce) {
      throw new BadRequestException('Ghost messages must be end-to-end encrypted.');
    }
    const id = uuidv4();
    const burn = this.clampBurn(burnDuration);
    const msg: GhostMessage = {
      id,
      roomId,
      senderId,
      senderName,
      content,
      burnDuration: burn,
      isBurnStarted: false,
      isEncrypted: true,
      nonce: e2ee?.nonce,
      encVersion: e2ee?.encVersion,
      createdAt: new Date().toISOString(),
    };
    await this.db.put({
      PK: `GHOST#${roomId}`,
      SK: `MSG#${id}`,
      // Short TTL fallback so a crashed/restarted node still loses the
      // ciphertext shortly after the burn window (purge is the primary path).
      expire_at: Math.floor(Date.now() / 1000) + burn + 300,
      ...msg,
    });
    return msg;
  }

  getMessage(roomId: string, messageId: string) {
    return this.db.get<GhostMessage>(`GHOST#${roomId}`, `MSG#${messageId}`);
  }

  purgeMessage(roomId: string, messageId: string) {
    return this.db.delete(`GHOST#${roomId}`, `MSG#${messageId}`);
  }

  /** Wipe a whole ghost room: every message + membership row. Untrackable. */
  async destroyRoom(roomId: string): Promise<{ deleted: number }> {
    const rows = await this.db.queryByPk<{ SK: string }>(`GHOST#${roomId}`, undefined, 500);
    let deleted = 0;
    for (const r of rows) {
      if (!r?.SK) continue;
      await this.db.delete(`GHOST#${roomId}`, r.SK);
      deleted += 1;
    }
    return { deleted };
  }

  async getBurningMessages(roomId: string): Promise<GhostMessage[]> {
    const msgs = await this.db.queryByPk<GhostMessage>(`GHOST#${roomId}`, 'MSG#');
    return msgs.filter((m) => m.isBurnStarted && m.burnExpiresAt);
  }
}
