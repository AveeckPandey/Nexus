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
      inviteLink: `https://nexus.app/ghost?token=${token}`,
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
  ): Promise<GhostMessage> {
    const id = uuidv4();
    const msg: GhostMessage = {
      id,
      roomId,
      senderId,
      senderName,
      content,
      burnDuration: 30,
      isBurnStarted: false,
      isEncrypted: Boolean(e2ee?.isEncrypted),
      nonce: e2ee?.nonce,
      encVersion: e2ee?.encVersion,
      createdAt: new Date().toISOString(),
    };
    await this.db.put({
      PK: `GHOST#${roomId}`,
      SK: `MSG#${id}`,
      expire_at: Math.floor(Date.now() / 1000) + 3600,
      ...msg,
    });
    return msg;
  }

  purgeMessage(roomId: string, messageId: string) {
    return this.db.delete(`GHOST#${roomId}`, `MSG#${messageId}`);
  }

  async getBurningMessages(roomId: string): Promise<GhostMessage[]> {
    const msgs = await this.db.queryByPk<GhostMessage>(`GHOST#${roomId}`, 'MSG#');
    return msgs.filter((m) => m.isBurnStarted && m.burnExpiresAt);
  }
}
