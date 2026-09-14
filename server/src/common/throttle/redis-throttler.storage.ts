import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler/dist/throttler-storage.interface';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisService } from '../redis/redis.service';

/** Shared counter so N pods enforce one global limit instead of N x limit. */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const rkey = `throttle:${throttlerName}:${key}`;
    const totalHits = await this.redis.incr(rkey);
    if (totalHits === 1) {
      await this.redis.expire(rkey, Math.max(1, Math.ceil(ttl / 1000)));
    }
    let timeToExpire = await this.redis.ttl(rkey);
    if (timeToExpire < 0) timeToExpire = Math.ceil(ttl / 1000);
    const isBlocked = totalHits > limit;
    let timeToBlockExpire = 0;
    if (isBlocked && blockDuration > 0) {
      const bkey = `${rkey}:blocked`;
      const bHits = await this.redis.incr(bkey);
      if (bHits === 1) await this.redis.expire(bkey, Math.ceil(blockDuration / 1000));
      timeToBlockExpire = await this.redis.ttl(bkey);
    }
    return { totalHits, timeToExpire, isBlocked, timeToBlockExpire };
  }
}
