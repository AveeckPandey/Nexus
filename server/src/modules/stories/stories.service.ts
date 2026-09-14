import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DynamoDbService } from '../dynamodb/dynamodb.service';

export const STORY_TTL_SECONDS = 86400;

export interface StoryView {
  viewerId: string;
  viewedAt: string;
}

export interface StoryItem {
  PK: string;
  SK: string;
  userId: string;
  mediaUrl: string;
  mediaType: string;
  createdAt: string;
  expire_at: number;
  views: StoryView[];
}

export function storyKey(userId: string, iso: string) {
  return { PK: `STORY#${userId}`, SK: `ITEM#${iso}` };
}

/** Application-level TTL filter — hides expired rows before DynamoDB background sweep. */
export function visibleAt(items: StoryItem[], nowSec: number): StoryItem[] {
  return items.filter((s) => s.expire_at > nowSec);
}

const ALLOWED_STORY_MEDIA = new Set(['image', 'video', 'audio']);

@Injectable()
export class StoriesService {
  constructor(private readonly db: DynamoDbService) {}

  async postStory(userId: string, mediaUrl: string, mediaType = 'image'): Promise<StoryItem> {
    if (!mediaUrl?.trim()) throw new BadRequestException('mediaUrl required');
    if (!ALLOWED_STORY_MEDIA.has(mediaType)) {
      throw new BadRequestException(`Unsupported story mediaType: ${mediaType}`);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const iso = new Date().toISOString();
    const { PK, SK } = storyKey(userId, iso);
    const item: StoryItem = {
      PK,
      SK,
      userId,
      mediaUrl,
      mediaType,
      createdAt: iso,
      expire_at: nowSec + STORY_TTL_SECONDS,
      views: [],
    };
    await this.db.put({ ...item });
    return item;
  }

  async getVisibleStories(userId: string, nowSec = Math.floor(Date.now() / 1000)): Promise<StoryItem[]> {
    const all = await this.db.queryByPk<StoryItem>(`STORY#${userId}`, 'ITEM#', 100);
    return visibleAt(all, nowSec);
  }

  async recordView(ownerId: string, itemSk: string, viewerId: string) {
    const stored = await this.db.get<StoryItem>(`STORY#${ownerId}`, itemSk);
    if (!stored) throw new NotFoundException('Story not found');
    if (stored.expire_at <= Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('Story expired');
    }
    const views = [...(stored.views || [])];
    if (!views.some((v) => v.viewerId === viewerId)) {
      views.push({ viewerId, viewedAt: new Date().toISOString() });
      await this.db.update(`STORY#${ownerId}`, itemSk, 'SET views = :v', { ':v': views });
    }
    return { ownerId, viewerId, itemSk, viewedAt: new Date().toISOString(), totalViews: views.length };
  }
}
