import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplication, Logger } from '@nestjs/common';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis, { Cluster } from 'ioredis';

/** Socket.IO adapter: Redis Cluster (50k) > single Redis > in-memory. */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private pub: Redis | Cluster | null = null;
  private sub: Redis | Cluster | null = null;

  constructor(app: INestApplication) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const clusterUrls = (process.env.REDIS_CLUSTER_URLS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (clusterUrls.length) {
      try {
        const nodes = clusterUrls.map((u) => ({ host: u.split(':')[0], port: Number(u.split(':')[1] || 6379) }));
        this.pub = new Cluster(nodes, { redisOptions: { maxRetriesPerRequest: 3 } });
        this.sub = new Cluster(nodes, { redisOptions: { maxRetriesPerRequest: 3 } });
        await Promise.all([(this.pub as Cluster).ping(), (this.sub as Cluster).ping()]);
        this.logger.log(`Socket.IO: Redis Cluster adapter (${nodes.length} nodes)`);
        return;
      } catch (err: any) {
        this.logger.warn(`Socket.IO: Cluster failed (${err.message}), trying single`);
        this.pub = null;
        this.sub = null;
      }
    }
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.log('Socket.IO: in-memory adapter (set REDIS_URL to scale out)');
      return;
    }
    try {
      const pub = new Redis(url, { maxRetriesPerRequest: 3 });
      this.pub = pub;
      this.sub = pub.duplicate();
      await Promise.all([pub.ping(), (this.sub as Redis).ping()]);
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
      server.adapter(createAdapter(this.pub as any, this.sub as any));
    }
    return server;
  }
}
