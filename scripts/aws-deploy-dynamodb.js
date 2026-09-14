/**
 * scripts/aws-deploy-dynamodb.js
 * Automated idempotent deployment for AWS DynamoDB NexusTable (Single-Table Design).
 */
const path = require('path');
const {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
  UpdateContinuousBackupsCommand,
} = require('../server/node_modules/@aws-sdk/client-dynamodb');
require('dotenv').config({ path: path.join(__dirname, '../server/.env') });

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'NexusTable';

async function deployDynamoDb() {
  console.log(`\n📦 [1/4] Deploying AWS DynamoDB Table: "${TABLE_NAME}" in ${process.env.AWS_REGION || 'us-east-1'}...`);

  // 1. Check if table already exists
  try {
    const existing = await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    console.log(`   ✓ Table "${TABLE_NAME}" already exists (Status: ${existing.Table?.TableStatus}).`);
    return existing.Table;
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') {
      throw err;
    }
  }

  // 2. Create Table
  console.log(`   Creating table "${TABLE_NAME}" with On-Demand billing (PAY_PER_REQUEST) and GSI1...`);
  const createRes = await client.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: {
            ProjectionType: 'ALL',
          },
        },
      ],
      Tags: [
        { Key: 'Project', Value: 'Nexus' },
        { Key: 'Environment', Value: 'Production' },
      ],
    }),
  );

  console.log(`   ✓ CreateTable initiated. Waiting for table to become ACTIVE...`);
  let status = createRes.TableDescription?.TableStatus;
  while (status !== 'ACTIVE') {
    await new Promise((r) => setTimeout(r, 2000));
    const desc = await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    status = desc.Table?.TableStatus;
    process.stdout.write(`   ... current status: ${status}\r`);
  }
  console.log(`\n   ✓ Table "${TABLE_NAME}" is now ACTIVE!`);

  // 3. Enable TTL on expire_at
  console.log(`   Enabling TTL on "expire_at" attribute...`);
  try {
    await client.send(
      new UpdateTimeToLiveCommand({
        TableName: TABLE_NAME,
        TimeToLiveSpecification: {
          Enabled: true,
          AttributeName: 'expire_at',
        },
      }),
    );
    console.log(`   ✓ TTL enabled successfully on "expire_at".`);
  } catch (ttlErr) {
    console.log(`   ℹ TTL status: ${ttlErr.message}`);
  }

  // 4. Enable Point-in-Time Recovery (PITR)
  console.log(`   Enabling Point-in-Time Recovery (PITR)...`);
  try {
    await client.send(
      new UpdateContinuousBackupsCommand({
        TableName: TABLE_NAME,
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      }),
    );
    console.log(`   ✓ Point-in-Time Recovery enabled.`);
  } catch (pitrErr) {
    console.log(`   ℹ PITR status: ${pitrErr.message}`);
  }

  console.log(`\n🎉 AWS DynamoDB deployment completed successfully!`);
}

deployDynamoDb().catch((err) => {
  console.error('\n❌ DynamoDB deployment failed:', err);
  process.exit(1);
});
