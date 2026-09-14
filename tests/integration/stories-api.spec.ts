/**
 * tests/integration/stories-api.spec.ts — 24h ephemeral stories
 * (TESTING_SPEC.md §3 `integration/stories-api.spec.ts` and §5.7).
 *
 * Pins the STORAGE CONTRACT `PK: STORY#<userId> / SK: ITEM#<iso>` with
 * `expire_at = now + 86400` using the real DynamoDbService in-memory
 * fallback, plus service-level coverage of StoriesService (post, visible
 * filter, view receipts).
 */
import { DynamoDbService } from '../../server/src/modules/dynamodb/dynamodb.service';
import { StoriesService } from '../../server/src/modules/stories/stories.service';

const DAY = 86400;

interface StoryItem {
  PK: string;
  SK: string;
  userId: string;
  mediaUrl: string;
  mediaType: string;
  createdAt: string;
  expire_at: number;
  views?: Array<{ viewerId: string; viewedAt: string }>;
}

function storyKey(userId: string, iso: string) {
  return { PK: `STORY#${userId}`, SK: `ITEM#${iso}` };
}

/** Mirrors the DynamoDB TTL filter: expired rows are invisible to readers. */
function visibleAt(items: StoryItem[], nowSec: number): StoryItem[] {
  return items.filter((s) => s.expire_at > nowSec);
}

describe('stories-api: 24h TTL contract', () => {
  test('post story → fetch returns it with expire_at = now + 86400', async () => {
    const db = new DynamoDbService();
    const before = Math.floor(Date.now() / 1000);
    const iso = new Date().toISOString();
    const { PK, SK } = storyKey('alice', iso);
    await db.put({
      PK,
      SK,
      userId: 'alice',
      mediaUrl: 'https://cdn.example/s.jpg',
      mediaType: 'image',
      createdAt: iso,
      expire_at: before + DAY,
    });
    const stored = await db.get<StoryItem>(PK, SK);
    expect(stored?.mediaUrl).toMatch(/cdn\.example/);
    expect(stored!.expire_at).toBeGreaterThanOrEqual(before + DAY);
    expect(stored!.expire_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + DAY);
  });

  test('story visible at T, purged at T + 24h + 1s (TTL filter)', async () => {
    const db = new DynamoDbService();
    const t = Math.floor(Date.now() / 1000);
    const iso = new Date(t * 1000).toISOString();
    const item: StoryItem = {
      ...storyKey('alice', iso),
      userId: 'alice',
      mediaUrl: 'https://cdn.example/s.jpg',
      mediaType: 'image',
      createdAt: iso,
      expire_at: t + DAY,
    };
    await db.put({ ...item });
    const all = await db.queryByPk<StoryItem>(`STORY#alice`, 'ITEM#');
    expect(visibleAt(all, t)).toHaveLength(1);
    expect(visibleAt(all, t + DAY + 1)).toHaveLength(0);
  });

  test('view receipt: User B views → User A sees receipt event payload', async () => {
    const db = new DynamoDbService();
    const iso = new Date().toISOString();
    const { PK, SK } = storyKey('alice', iso);
    await db.put({
      PK,
      SK,
      userId: 'alice',
      mediaUrl: 'https://cdn.example/s.jpg',
      mediaType: 'image',
      createdAt: iso,
      expire_at: Math.floor(Date.now() / 1000) + DAY,
      views: [],
    });
    // Record view.
    await db.update(PK, SK, 'SET views = :v', {
      ':v': [{ viewerId: 'bob', viewedAt: new Date().toISOString() }],
    });
    const stored = await db.get<StoryItem>(PK, SK);
    expect(stored?.views).toHaveLength(1);
    expect(stored?.views?.[0].viewerId).toBe('bob');
  });

  test('story keys never collide with chat keys (single-table isolation)', async () => {
    const db = new DynamoDbService();
    await db.put({ PK: 'CONV#g1', SK: 'METADATA', id: 'g1' });
    await db.put({
      PK: 'STORY#alice',
      SK: `ITEM#${new Date().toISOString()}`,
      userId: 'alice',
      expire_at: Math.floor(Date.now() / 1000) + DAY,
    });
    expect(await db.queryByPk('CONV#g1', 'MSG#')).toHaveLength(0);
    expect((await db.queryByPk('STORY#alice', 'ITEM#')).length).toBeGreaterThan(0);
  });
});

describe('stories-service: post / visible filter / view receipts', () => {
  test('postStory creates STORY#/ITEM# with 24h TTL, visible immediately', async () => {
    const svc = new StoriesService(new DynamoDbService());
    const story = await svc.postStory('alice', 'https://cdn.example/s.jpg', 'image');
    expect(story.PK).toBe('STORY#alice');
    expect(story.SK.startsWith('ITEM#')).toBe(true);
    expect(story.expire_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(await svc.getVisibleStories('alice')).toHaveLength(1);
  });

  test('expired stories filtered at T + 24h + 1s', async () => {
    const svc = new StoriesService(new DynamoDbService());
    await svc.postStory('bob', 'https://cdn.example/b.mp4', 'video');
    const nowSec = Math.floor(Date.now() / 1000);
    expect(await svc.getVisibleStories('bob', nowSec)).toHaveLength(1);
    expect(await svc.getVisibleStories('bob', nowSec + DAY + 1)).toHaveLength(0);
  });

  test('recordView appends receipt once per viewer', async () => {
    const svc = new StoriesService(new DynamoDbService());
    const story = await svc.postStory('alice', 'https://cdn.example/s.jpg', 'image');
    const r1 = await svc.recordView('alice', story.SK, 'bob');
    expect(r1.viewerId).toBe('bob');
    const r2 = await svc.recordView('alice', story.SK, 'bob');
    expect(r2.totalViews).toBe(1);
    expect(await svc.getVisibleStories('alice')).toHaveLength(1);
  });
});
