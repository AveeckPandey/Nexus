import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { dynamoDocumentClient, AWS_CONFIG, hasAwsCredentials } from '../../config/aws.config';
import { MongoClient, Collection } from 'mongodb';

/**
 * DynamoDB single-table access with optional MongoDB Atlas persistence.
 * Falls back to an in-memory map when neither AWS credentials nor MONGODB_URI
 * are present so the API can boot locally; writes still resolve.
 */
@Injectable()
export class DynamoDbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DynamoDbService.name);
  private readonly tableName = AWS_CONFIG.dynamoTable;
  private readonly memory = new Map<string, any>();
  private warned = false;

  private mongoClient: MongoClient | null = null;
  private mongoCol: Collection | null = null;
  private mongoConnecting: Promise<Collection | null> | null = null;
  private mongoFailed = false;
  private mongoLastRetry = 0;

  async onModuleInit(): Promise<void> {
    await this.getMongoCol();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.mongoClient) {
      await this.mongoClient.close().catch(() => {});
      this.mongoClient = null;
      this.mongoCol = null;
    }
  }

  private async getMongoCol(): Promise<Collection | null> {
    if (this.mongoCol) return this.mongoCol;
    if (this.mongoFailed && Date.now() - this.mongoLastRetry < 60000) return null;
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) return null;

    if (this.mongoConnecting) return this.mongoConnecting;

    this.mongoConnecting = (async () => {
      try {
        const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 2500 });
        await client.connect();
        const dbName = process.env.MONGODB_DB_NAME || 'nexus';
        const col = client.db(dbName).collection('nexus_items');
        this.mongoClient = client;
        this.mongoCol = col;
        this.mongoFailed = false;
        this.logger.log(`Connected to MongoDB Atlas: database "${dbName}", collection "nexus_items"`);

        // Create indexes in background
        col.createIndex({ PK: 1, SK: 1 }).catch(() => {});
        col.createIndex({ GSI1PK: 1, GSI1SK: 1 }).catch(() => {});
        col.createIndex({ expire_at: 1 }, { expireAfterSeconds: 0 }).catch(() => {});

        return col;
      } catch (err: any) {
        this.logger.warn(`MongoDB Atlas connection error: ${err.message} — activating in-memory fallback`);
        this.mongoFailed = true;
        this.mongoLastRetry = Date.now();
        return null;
      } finally {
        this.mongoConnecting = null;
      }
    })();

    return this.mongoConnecting;
  }

  private useMemory(): boolean {
    if (!hasAwsCredentials() && !this.warned) {
      this.warned = true;
      if (!process.env.MONGODB_URI) {
        this.logger.warn('No AWS or MongoDB credentials — using in-memory store (dev only)');
      }
    }
    return !hasAwsCredentials();
  }

  async put(item: Record<string, any>): Promise<void> {
    const key = `${item.PK}##${item.SK}`;
    this.memory.set(key, { ...item });

    const col = await this.getMongoCol();
    if (col) {
      try {
        await col.replaceOne({ _id: key as any }, { _id: key, ...item }, { upsert: true });
      } catch (err: any) {
        this.logger.warn(`MongoDB put failed: ${err.message}`);
      }
    }

    if (hasAwsCredentials()) {
      try {
        await dynamoDocumentClient.send(
          new PutCommand({ TableName: this.tableName, Item: item }),
        );
      } catch (err: any) {
        this.logger.warn(`DynamoDB put failed: ${err.message}`);
      }
    }
  }

  async get<T = any>(pk: string, sk: string): Promise<T | null> {
    const key = `${pk}##${sk}`;
    if (this.memory.has(key)) {
      return this.memory.get(key) as T;
    }

    const col = await this.getMongoCol();
    if (col) {
      try {
        const doc = await col.findOne({ _id: key as any });
        if (doc) {
          const { _id, ...rest } = doc;
          this.memory.set(key, rest);
          return rest as T;
        }
      } catch (err: any) {
        this.logger.warn(`MongoDB get failed: ${err.message}`);
      }
    }

    if (!this.useMemory()) {
      try {
        const r = await dynamoDocumentClient.send(
          new GetCommand({ TableName: this.tableName, Key: { PK: pk, SK: sk } }),
        );
        if (r.Item) return r.Item as T;
      } catch (err: any) {
        this.logger.warn(`DynamoDB get failed: ${err.message}`);
      }
    }

    return (this.memory.get(key) as T) || null;
  }

  async queryByPk<T = any>(
    pk: string,
    skPrefix?: string,
    limit = 50,
    scanIndexForward = true,
  ): Promise<T[]> {
    const col = await this.getMongoCol();
    if (col) {
      try {
        const filter: any = { PK: pk };
        if (skPrefix) {
          filter.SK = { $regex: `^${skPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
        }
        const docs = await col
          .find(filter)
          .sort({ SK: scanIndexForward ? 1 : -1 })
          .limit(limit)
          .toArray();
        return docs.map(({ _id, ...rest }) => {
          this.memory.set(`${rest.PK}##${rest.SK}`, rest);
          return rest as T;
        });
      } catch (err: any) {
        this.logger.warn(`MongoDB query failed: ${err.message}`);
      }
    }

    if (!this.useMemory()) {
      try {
        let expr = 'PK = :pk';
        const values: Record<string, any> = { ':pk': pk };
        if (skPrefix) {
          expr += ' AND begins_with(SK, :sk)';
          values[':sk'] = skPrefix;
        }
        const r = await dynamoDocumentClient.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: expr,
            ExpressionAttributeValues: values,
            Limit: limit,
            ScanIndexForward: scanIndexForward,
          }),
        );
        if (r.Items?.length) return r.Items as T[];
      } catch (err: any) {
        this.logger.warn(`DynamoDB query failed: ${err.message}`);
      }
    }

    const out: T[] = [];
    for (const v of this.memory.values()) {
      if (v.PK === pk && (!skPrefix || v.SK?.startsWith(skPrefix))) out.push(v as T);
    }
    return out.slice(0, limit);
  }

  async delete(pk: string, sk: string): Promise<void> {
    const key = `${pk}##${sk}`;
    this.memory.delete(key);

    const col = await this.getMongoCol();
    if (col) {
      try {
        await col.deleteOne({ _id: key as any });
      } catch (err: any) {
        this.logger.warn(`MongoDB delete failed: ${err.message}`);
      }
    }

    if (!this.useMemory()) {
      try {
        await dynamoDocumentClient.send(
          new DeleteCommand({ TableName: this.tableName, Key: { PK: pk, SK: sk } }),
        );
      } catch (err: any) {
        this.logger.warn(`DynamoDB delete failed: ${err.message}`);
      }
    }
  }

  /**
   * Apply a `SET a = :v, #n = :w` update expression to a plain object.
   * Used by the in-memory dev fallback so local behavior matches DynamoDB
   * (top-level assignments only — the only shape this codebase emits).
   */
  private applyUpdateExpression(
    item: Record<string, any>,
    updateExpression: string,
    values: Record<string, any>,
    attributeNames?: Record<string, string>,
  ): void {
    const body = updateExpression.match(/SET\s+(.+)/i)?.[1] || updateExpression;
    for (const part of body.split(',')) {
      const seg = part.trim().match(/^([A-Za-z0-9_#.]+)\s*=\s*(:[A-Za-z0-9_]+)$/);
      if (!seg) continue;
      let attr = seg[1];
      if (attributeNames?.[attr]) attr = attributeNames[attr];
      if (attr.startsWith('#')) attr = attributeNames?.[attr] || attr.slice(1);
      if (seg[2] in values) item[attr] = values[seg[2]];
    }
  }

  async update(
    pk: string,
    sk: string,
    updateExpression: string,
    values: Record<string, any>,
    attributeNames?: Record<string, string>,
  ): Promise<void> {
    const key = `${pk}##${sk}`;
    let existing = this.memory.get(key);
    if (!existing) {
      existing = (await this.get(pk, sk)) || { PK: pk, SK: sk };
    }
    this.applyUpdateExpression(existing, updateExpression, values, attributeNames);
    this.memory.set(key, existing);

    const col = await this.getMongoCol();
    if (col) {
      try {
        await col.replaceOne({ _id: key as any }, { _id: key, ...existing }, { upsert: true });
      } catch (err: any) {
        this.logger.warn(`MongoDB update failed: ${err.message}`);
      }
    }

    if (!this.useMemory()) {
      try {
        await dynamoDocumentClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { PK: pk, SK: sk },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: values,
            ExpressionAttributeNames: attributeNames,
          }),
        );
      } catch (err: any) {
        this.logger.warn(`DynamoDB update failed: ${err.message}`);
      }
    }
  }

  /**
   * Conditional update for atomic claims (e.g. one-time invite consumption).
   * Returns true if the condition held and the write applied.
   */
  async updateConditional(
    pk: string,
    sk: string,
    updateExpression: string,
    values: Record<string, any>,
    conditionExpression: string,
  ): Promise<boolean> {
    const key = `${pk}##${sk}`;
    let existing = this.memory.get(key);
    if (!existing) {
      existing = await this.get(pk, sk);
    }
    const consumed = existing?.isConsumed;

    if (consumed) return false;
    const next = { ...(existing || { PK: pk, SK: sk }) };
    this.applyUpdateExpression(next, updateExpression, values);
    this.memory.set(key, next);

    const col = await this.getMongoCol();
    if (col) {
      try {
        const res = await col.updateOne(
          { _id: key as any, isConsumed: { $ne: true } },
          { $set: next },
          { upsert: !existing },
        );
        if (res.matchedCount === 0 && existing) return false;
      } catch {
        return false;
      }
    }

    if (!this.useMemory()) {
      try {
        await dynamoDocumentClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { PK: pk, SK: sk },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: { ...values, ':__false': false },
            ConditionExpression: conditionExpression,
          }),
        );
        return true;
      } catch {
        return false;
      }
    }

    return true;
  }

  static encodeCursor(key: Record<string, any> | null | undefined): string | null {
    if (!key) return null;
    return Buffer.from(JSON.stringify(key)).toString('base64');
  }

  static decodeCursor(cursor?: string): Record<string, any> | undefined {
    if (!cursor) return undefined;
    try {
      return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    } catch {
      return undefined;
    }
  }

  /**
   * Cursor-paginated query. Returns items in requested order plus an opaque
   * `nextCursor` (Base64 LastEvaluatedKey) or null when exhausted.
   */
  async queryByPkCursor<T = any>(
    pk: string,
    skPrefix?: string,
    limit = 50,
    cursor?: string,
    scanIndexForward = false,
  ): Promise<{ items: T[]; nextCursor: string | null }> {
    const col = await this.getMongoCol();
    if (col) {
      try {
        const filter: any = { PK: pk };
        if (skPrefix) {
          filter.SK = { $regex: `^${skPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
        }
        if (cursor) {
          const decoded = DynamoDbService.decodeCursor(cursor) as any;
          if (decoded?.SK) {
            filter.SK = {
              ...(typeof filter.SK === 'object' ? filter.SK : {}),
              ...(scanIndexForward ? { $gt: decoded.SK } : { $lt: decoded.SK }),
            };
          }
        }
        const docs = await col
          .find(filter)
          .sort({ SK: scanIndexForward ? 1 : -1 })
          .limit(limit + 1)
          .toArray();

        const hasMore = docs.length > limit;
        const page = docs.slice(0, limit);
        const last: any = page[page.length - 1];

        return {
          items: page.map(({ _id, ...rest }) => rest as T),
          nextCursor: hasMore && last ? DynamoDbService.encodeCursor({ PK: pk, SK: last.SK }) : null,
        };
      } catch (err: any) {
        this.logger.warn(`MongoDB cursor query failed: ${err.message}`);
      }
    }

    if (!this.useMemory()) {
      try {
        let expr = 'PK = :pk';
        const values: Record<string, any> = { ':pk': pk };
        if (skPrefix) {
          expr += ' AND begins_with(SK, :sk)';
          values[':sk'] = skPrefix;
        }
        const r = await dynamoDocumentClient.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: expr,
            ExpressionAttributeValues: values,
            Limit: limit,
            ScanIndexForward: scanIndexForward,
            ExclusiveStartKey: DynamoDbService.decodeCursor(cursor),
          }),
        );
        return {
          items: (r.Items as T[]) || [],
          nextCursor: DynamoDbService.encodeCursor(r.LastEvaluatedKey),
        };
      } catch (err: any) {
        this.logger.warn(`DynamoDB cursor query failed: ${err.message}`);
      }
    }

    const all: T[] = [];
    for (const v of this.memory.values()) {
      if (v.PK === pk && (!skPrefix || v.SK?.startsWith(skPrefix))) all.push(v as T);
    }
    all.sort((a: any, b: any) =>
      scanIndexForward ? (a.SK < b.SK ? -1 : 1) : a.SK > b.SK ? -1 : 1,
    );
    let start = 0;
    if (cursor) {
      const decoded = DynamoDbService.decodeCursor(cursor) as any;
      const idx = all.findIndex((v: any) => v.SK === decoded?.SK);
      if (idx >= 0) start = idx + 1;
    }
    const page = all.slice(start, start + limit);
    const last: any = page[page.length - 1];
    return {
      items: page,
      nextCursor:
        start + limit < all.length && last
          ? DynamoDbService.encodeCursor({ PK: pk, SK: last.SK })
          : null,
    };
  }

  /**
   * Exact lookup on GSI1 (e.g. GSI1PK = EMAIL#<email> per spec §4).
   * Memory fallback scans the local map; DynamoDB queries the GSI1 index.
   */
  async queryGsi<T = any>(gsi1pk: string, gsi1skPrefix?: string, limit = 10): Promise<T[]> {
    const col = await this.getMongoCol();
    if (col) {
      try {
        const filter: any = { GSI1PK: gsi1pk };
        if (gsi1skPrefix) {
          filter.GSI1SK = { $regex: `^${gsi1skPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
        }
        const docs = await col.find(filter).limit(limit).toArray();
        return docs.map(({ _id, ...rest }) => rest as T);
      } catch (err: any) {
        this.logger.warn(`MongoDB GSI query failed: ${err.message}`);
      }
    }

    if (!this.useMemory()) {
      try {
        let expr = 'GSI1PK = :pk';
        const values: Record<string, any> = { ':pk': gsi1pk };
        if (gsi1skPrefix) {
          expr += ' AND begins_with(GSI1SK, :sk)';
          values[':sk'] = gsi1skPrefix;
        }
        const r = await dynamoDocumentClient.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'GSI1',
            KeyConditionExpression: expr,
            ExpressionAttributeValues: values,
            Limit: limit,
          }),
        );
        if (r.Items?.length) return r.Items as T[];
      } catch (err: any) {
        this.logger.warn(`DynamoDB GSI query failed: ${err.message}`);
      }
    }

    const out: T[] = [];
    for (const v of this.memory.values()) {
      if (v.GSI1PK === gsi1pk && (!gsi1skPrefix || v.GSI1SK?.startsWith(gsi1skPrefix))) {
        out.push(v as T);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /**
   * Bounded profile scan for the user directory (username / name / email
   * prefix search). Authenticated-only callers; results are capped.
   */
  async scanProfiles(limit = 100): Promise<any[]> {
    const col = await this.getMongoCol();
    if (col) {
      try {
        const filter = { PK: { $regex: '^USER#' }, SK: 'PROFILE' };
        const docs = await col.find(filter).limit(limit).toArray();
        return docs.map(({ _id, ...rest }) => rest);
      } catch (err: any) {
        this.logger.warn(`MongoDB profile scan failed: ${err.message}`);
      }
    }

    if (!this.useMemory()) {
      try {
        const r = await dynamoDocumentClient.send(
          new ScanCommand({
            TableName: this.tableName,
            FilterExpression: 'begins_with(PK, :pk) AND SK = :sk',
            ExpressionAttributeValues: { ':pk': 'USER#', ':sk': 'PROFILE' },
            Limit: Math.min(Math.max(limit, 1), 200),
          }),
        );
        if (r.Items?.length) return r.Items;
      } catch (err: any) {
        this.logger.warn(`DynamoDB profile scan failed: ${err.message}`);
      }
    }

    const out: any[] = [];
    for (const v of this.memory.values()) {
      if (typeof v.PK === 'string' && v.PK.startsWith('USER#') && v.SK === 'PROFILE') {
        out.push(v);
        if (out.length >= limit) break;
      }
    }
    return out;
  }
}
