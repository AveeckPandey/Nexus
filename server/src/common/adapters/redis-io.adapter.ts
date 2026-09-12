import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplication, Logger } from '@nestjs/common';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

/** Socket.IO adapter: Redis pub/sub when REDIS_URL is set, in-memory otherwise. */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private pub: Redis | null = null;
  private sub: Redis | null = null;

  constructor(app: INestApplication) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.log('Socket.IO: in-memory adapter (set REDIS_URL to scale out)');
      return;
    }
    try {
      this.pub = new Redis(url, { maxRetriesPerRequest: 3 });
      this.sub = this.pub.duplicate();
      await Promise.all([this.pub.ping(), this.sub.ping()]);
      this.logger.log('Socket.IO: connected to Redis adapter');
    } catch (err: any) {
      this.logger.warn(`Socket.IO: Redis failed (${err.message}), using in-memory`);
      this.pub = null;
      this.sub = null;
    }
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: true, credentials: true },
    });
    if (this.pub && this.sub) {
      server.adapter(createAdapter(this.pub, this.sub));
    }
    return server;
  }
}
