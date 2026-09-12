import { Injectable, Logger } from '@nestjs/common';
import {
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { dynamoDocumentClient, AWS_CONFIG, hasAwsCredentials } from '../../config/aws.config';

/**
 * DynamoDB single-table access. Falls back to an in-memory map when AWS
 * credentials are absent so the API can boot locally; writes still resolve.
 */
@Injectable()
export class DynamoDbService {
  private readonly logger = new Logger(DynamoDbService.name);
  private readonly tableName = AWS_CONFIG.dynamoTable;
  private readonly memory = new Map<string, any>();
  private warned = false;

  private useMemory(): boolean {
    if (!hasAwsCredentials() && !this.warned) {
      this.warned = true;
      this.logger.warn('No AWS credentials — using in-memory store (dev only)');
    }
    return !hasAwsCredentials();
  }

  async put(item: Record<string, any>): Promise<void> {
    this.memory.set(`${item.PK}##${item.SK}`, { ...item });
    if (this.useMemory()) return;
    try {
      await dynamoDocumentClient.send(
        new PutCommand({ TableName: this.tableName, Item: item }),
      );
    } catch (err: any) {
      this.logger.warn(`DynamoDB put failed: ${err.message}`);
    }
  }

  async get<T = any>(pk: string, sk: string): Promise<T | null> {
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
    return (this.memory.get(`${pk}##${sk}`) as T) || null;
  }

  async queryByPk<T = any>(
    pk: string,
    skPrefix?: string,
    limit = 50,
    scanIndexForward = true,
  ): Promise<T[]> {
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

  async delete(pk: string, sk: string): Promise<void> {    this.memory.delete(`${pk}##${sk}`);
    if (this.useMemory()) return;
    try {
      await dynamoDocumentClient.send(
        new DeleteCommand({ TableName: this.tableName, Key: { PK: pk, SK: sk } }),
      );
    } catch (err: any) {
      this.logger.warn(`DynamoDB delete failed: ${err.message}`);
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
    const existing = this.memory.get(key) || { PK: pk, SK: sk };
    for (const [attrKey, val] of Object.entries(values)) {
      existing[attrKey.replace(/^:/, '')] = val;
    }
    this.memory.set(key, existing);
    if (this.useMemory()) return;
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
    const existing = this.memory.get(key);
    const consumed = existing?.isConsumed;
    // Memory fallback: single-process atomic check-then-set.
    if (this.useMemory()) {
      if (consumed) return false;
      const next = { ...(existing || { PK: pk, SK: sk }) };
      for (const [k, v] of Object.entries(values)) next[k.replace(/^:/, '')] = v;
      this.memory.set(key, next);
      return true;
    }
    try {
      const next = { ...(existing || { PK: pk, SK: sk }) };
      for (const [k, v] of Object.entries(values)) next[k.replace(/^:/, '')] = v;
      this.memory.set(key, next);
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
}
