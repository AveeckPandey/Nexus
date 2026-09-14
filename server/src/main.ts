import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';
import cors from '@fastify/cors';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, bodyLimit: 10 * 1024 * 1024 }),
  );

  const origins = (process.env.CLIENT_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  await app.register(cors, { origin: origins, credentials: true });

  // Security headers (threat model §10) — no extra deps, Fastify hooks only.
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req: any, body: any, done: any) => {
    done(null, body);
  });
  fastify.addHook('onRequest', async (req: any, reply: any) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        'img-src \'self\' data: blob: https: http:; media-src \'self\' blob: https: http:; ' +
        'connect-src \'self\' ' +
        origins.join(' ') +
        ' https://oauth2.googleapis.com; frame-ancestors \'none\'',
    );
  });

  const redisAdapter = new RedisIoAdapter(app);
  await redisAdapter.connectToRedis();
  app.useWebSocketAdapter(redisAdapter);

  app.useGlobalFilters(new AllExceptionsFilter());

  // Reject malformed/oversized input with 400 before it reaches handlers.
  // DTOs in each module declare the contract; unknown props are stripped.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }),
  );

  const port = Number(process.env.PORT || 8080);
  await app.listen(port, '0.0.0.0');
  logger.log(`Nexus API listening on :${port}`);
}

bootstrap();
