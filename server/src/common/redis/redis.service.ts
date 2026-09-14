import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis, { Cluster } from 'ioredis';

type RedisClient = Redis | Cluster;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClient | null = null;
  private readonly memoryFallback = new Map<string, { value: string; expiresAt?: number }>();
  private readonly zsetFallback = new Map<string, Map<string, number>>();
  private readonly MAX_FALLBACK_ITEMS = 2000;

  private evictFallbackIfNeeded(): void {
    if (this.memoryFallback.size >= this.MAX_FALLBACK_ITEMS) {
      const oldest = this.memoryFallback.keys().next().value;
      if (oldest) this.memoryFallback.delete(oldest);
    }
  }

  onModuleInit() {
    // Cluster mode for 50k fan-out: REDIS_CLUSTER_URLS=host1:6379,host2:6379
    // (ElastiCache Cluster-mode). Falls back to single REDIS_URL, then memory.
    const clusterUrls = (process.env.REDIS_CLUSTER_URLS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (clusterUrls.length) {
      try {
        this.client = new Cluster(clusterUrls.map((u) => ({ host: u.split(':')[0], port: Number(u.split(':')[1] || 6379) })), {
          redisOptions: { maxRetriesPerRequest: 3 },
        });
        this.logger.log(`RedisService using Cluster mode (${clusterUrls.length} nodes)`);
        return;
      } catch (err: any) {
        this.logger.warn(`Redis Cluster init failed: ${err.message}`);
        this.client = null;
      }
    }
    const url = process.env.REDIS_URL;
    if (url) {
      try {
        this.client = new Redis(url, {
          maxRetriesPerRequest: 3,
          lazyConnect: true,
          enableReadyCheck: true,
        });
        this.client.connect().then(() => {
          this.logger.log('RedisService connected to ElastiCache Redis cluster');
        }).catch((err) => {
          this.logger.warn(`RedisService connection failed: ${err.message}. Using fallback.`);
          this.client = null;
        });
      } catch (err: any) {
        this.logger.warn(`RedisService initialization failed: ${err.message}`);
        this.client = null;
      }
    } else {
      this.logger.log('REDIS_URL not set — RedisService using memory fallback');
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.client) {
      try {
        return await this.client.get(key);
      } catch (err) {
        // fallback
      }
    }
    const item = this.memoryFallback.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.memoryFallback.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<'OK' | null> {
    if (this.client) {
      try {
        if (mode === 'EX' && duration) {
          return await this.client.set(key, value, 'EX', duration);
        }
        return await this.client.set(key, value);
      } catch (err) {
        // fallback
      }
    }
    const expiresAt = mode === 'EX' && duration ? Date.now() + duration * 1000 : undefined;
    this.evictFallbackIfNeeded();
    this.memoryFallback.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    if (this.client) {
      try {
        return await this.client.del(key);
      } catch (err) {
        // fallback
      }
    }
    const had = this.memoryFallback.delete(key);
    return had ? 1 : 0;
  }

  async setJson(key: string, data: any, ttlSeconds?: number): Promise<void> {
    const raw = JSON.stringify(data);
    if (ttlSeconds) {
      await this.set(key, raw, 'EX', ttlSeconds);
    } else {
      await this.set(key, raw);
    }
  }

  async getJson<T = any>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    if (this.client) {
      try {
        return await this.client.zadd(key, score, member);
      } catch (err) {}
    }
    let m = this.zsetFallback.get(key);
    if (!m) {
      m = new Map<string, number>();
      this.zsetFallback.set(key, m);
    }
    m.set(member, score);
    return 1;
  }

  async zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]> {
    if (this.client) {
      try {
        return await this.client.zrangebyscore(key, min, max);
      } catch (err) {}
    }
    const m = this.zsetFallback.get(key);
    if (!m) return [];
    const minVal = min === '-inf' ? -Infinity : Number(min);
    const maxVal = max === '+inf' ? Infinity : Number(max);
    const hits: string[] = [];
    for (const [member, score] of m.entries()) {
      if (score >= minVal && score <= maxVal) {
        hits.push(member);
      }
    }
    return hits;
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    if (this.client) {
      try {
        return await this.client.zrem(key, ...members);
      } catch (err) {}
    }
    const m = this.zsetFallback.get(key);
    if (!m) return 0;
    let count = 0;
    for (const member of members) {
      if (m.delete(member)) count++;
    }
    return count;
  }

  /** Atomic counter for shared rate-limiting (multi-pod). Falls back to memory. */
  async incr(key: string): Promise<number> {
    if (this.client) {
      try {
        return await this.client.incr(key);
      } catch {}
    }
    const cur = this.memoryFallback.get(key);
    const next = (cur ? parseInt(cur.value, 10) || 0 : 0) + 1;
    const expiresAt = cur?.expiresAt;
    this.evictFallbackIfNeeded();
    this.memoryFallback.set(key, { value: String(next), expiresAt });
    return next;
  }

  async expire(key: string, seconds: number): Promise<void> {
    if (this.client) {
      try {
        await this.client.expire(key, seconds);
        return;
      } catch {}
    }
    const cur = this.memoryFallback.get(key);
    if (cur) cur.expiresAt = Date.now() + seconds * 1000;
  }

  /** Seconds until expiry (-1 = no expiry, -2 = missing). */
  async ttl(key: string): Promise<number> {
    if (this.client) {
      try {
        return await this.client.ttl(key);
      } catch {}
    }
    const cur = this.memoryFallback.get(key);
    if (!cur) return -2;
    if (!cur.expiresAt) return -1;
    return Math.max(0, Math.ceil((cur.expiresAt - Date.now()) / 1000));
  }

  /** Append-only outbox queue (SQS seam: swap LPUSH/BRPOP for SQS Send/Receive). */
  private readonly listFallback = new Map<string, string[]>();

  async lpush(key: string, ...values: string[]): Promise<number> {
    if (this.client) {
      try {
        return await this.client.lpush(key, ...values);
      } catch {}
    }
    const arr = this.listFallback.get(key) || [];
    arr.unshift(...values);
    if (arr.length > 2000) arr.length = 2000;
    this.listFallback.set(key, arr);
    return arr.length;
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {}
    }
  }
}
