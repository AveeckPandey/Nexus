/**
 * scripts/aws-deploy-elasticache.js
 * Automated deployment for AWS ElastiCache for Redis Replication Group.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const {
  ElastiCacheClient,
  CreateCacheSubnetGroupCommand,
  DescribeCacheSubnetGroupsCommand,
  CreateReplicationGroupCommand,
  DescribeReplicationGroupsCommand,
} = require('../server/node_modules/@aws-sdk/client-elasticache');
require('dotenv').config({ path: path.join(__dirname, '../server/.env') });

const region = process.env.AWS_REGION || 'us-east-1';
const client = new ElastiCacheClient({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const CLUSTER_ID = 'nexus-prod-redis';
const SUBNET_GROUP = 'nexus-redis-subnets';
const SG_NAME = 'nexus-redis-sg';

async function deployElastiCache() {
  console.log(`\n⚡ [3/4] Deploying AWS ElastiCache for Redis in ${region}...`);

  // 1. Get default VPC and subnets
  console.log('   Discovering VPC subnets...');
  const vpcOut = execSync('aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text', { encoding: 'utf8' }).trim();
  const subnetsOut = execSync(`aws ec2 describe-subnets --filters "Name=vpc-id,Values=${vpcOut}" --query "Subnets[*].SubnetId" --output text`, { encoding: 'utf8' }).trim();
  const subnetIds = subnetsOut.split(/\s+/);
  console.log(`   ✓ Found VPC ${vpcOut} with ${subnetIds.length} subnets`);

  // 2. Security Group
  console.log(`   Ensuring Security Group "${SG_NAME}"...`);
  let sgId = '';
  try {
    const existingSg = execSync(`aws ec2 describe-security-groups --filters "Name=group-name,Values=${SG_NAME}" --query "SecurityGroups[0].GroupId" --output text`, { encoding: 'utf8' }).trim();
    if (existingSg && existingSg !== 'None') {
      sgId = existingSg;
      console.log(`   ✓ Found existing Security Group: ${sgId}`);
    }
  } catch (e) {}

  if (!sgId) {
    const createdSg = execSync(`aws ec2 create-security-group --group-name ${SG_NAME} --description "Nexus Redis Ingress" --vpc-id ${vpcOut} --query "GroupId" --output text`, { encoding: 'utf8' }).trim();
    sgId = createdSg;
    execSync(`aws ec2 authorize-security-group-ingress --group-id ${sgId} --protocol tcp --port 6379 --cidr 172.31.0.0/16`);
    console.log(`   ✓ Created Security Group: ${sgId} (ingress TCP 6379 authorized)`);
  }

  // 3. Cache Subnet Group
  console.log(`   Ensuring Cache Subnet Group "${SUBNET_GROUP}"...`);
  try {
    await client.send(new DescribeCacheSubnetGroupsCommand({ CacheSubnetGroupName: SUBNET_GROUP }));
    console.log(`   ✓ Found existing Cache Subnet Group: ${SUBNET_GROUP}`);
  } catch (err) {
    if (err.name === 'CacheSubnetGroupNotFoundFault') {
      console.log(`   Creating Cache Subnet Group "${SUBNET_GROUP}"...`);
      await client.send(
        new CreateCacheSubnetGroupCommand({
          CacheSubnetGroupName: SUBNET_GROUP,
          CacheSubnetGroupDescription: 'Nexus Redis Subnet Group',
          SubnetIds: subnetIds.slice(0, 3), // select 3 availability zones
        }),
      );
      console.log(`   ✓ Created Cache Subnet Group: ${SUBNET_GROUP}`);
    } else {
      throw err;
    }
  }

  // 4. Replication Group (Redis 7.1 with In-Transit & At-Rest Encryption)
  console.log(`   Checking Replication Group "${CLUSTER_ID}"...`);
  let repGroup = null;
  try {
    const desc = await client.send(
      new DescribeReplicationGroupsCommand({ ReplicationGroupId: CLUSTER_ID }),
    );
    repGroup = desc.ReplicationGroups?.[0];
    console.log(`   ✓ Replication Group already exists (Status: ${repGroup.Status})`);
  } catch (err) {
    if (err.name !== 'ReplicationGroupNotFoundFault') throw err;
  }

  const authToken = crypto.randomBytes(16).toString('hex'); // 32 alphanumeric chars

  if (!repGroup) {
    console.log(`   Creating Redis Replication Group "${CLUSTER_ID}" (Engine 7.1, cache.t4g.micro)...`);
    const createRes = await client.send(
      new CreateReplicationGroupCommand({
        ReplicationGroupId: CLUSTER_ID,
        ReplicationGroupDescription: 'Nexus Socket.IO Redis cluster',
        Engine: 'redis',
        EngineVersion: '7.1',
        CacheNodeType: 'cache.t4g.micro',
        NumCacheClusters: 1, // Single-node baseline for dev/staging, upgradeable to multi-AZ
        SecurityGroupIds: [sgId],
        CacheSubnetGroupName: SUBNET_GROUP,
        TransitEncryptionEnabled: true,
        AtRestEncryptionEnabled: true,
        AuthToken: authToken,
        Tags: [
          { Key: 'Project', Value: 'Nexus' },
          { Key: 'Environment', Value: 'Production' },
        ],
      }),
    );
    repGroup = createRes.ReplicationGroup;
    console.log(`   ✓ Provisioning initiated. Status: ${repGroup?.Status}`);
  }

  // 5. Poll until endpoint is assigned
  console.log('   Waiting for primary endpoint assignment (this may take 2-4 minutes)...');
  let endpoint = repGroup?.NodeGroups?.[0]?.PrimaryEndpoint?.Address;
  while (!endpoint) {
    await new Promise((r) => setTimeout(r, 10000));
    const desc = await client.send(
      new DescribeReplicationGroupsCommand({ ReplicationGroupId: CLUSTER_ID }),
    );
    const rg = desc.ReplicationGroups?.[0];
    endpoint = rg?.NodeGroups?.[0]?.PrimaryEndpoint?.Address || rg?.ConfigurationEndpoint?.Address;
    process.stdout.write(`   ... current status: ${rg?.Status || 'creating'}\r`);
    if (rg?.Status === 'available') break;
  }

  console.log(`\n   ✓ Redis Primary Endpoint: ${endpoint || CLUSTER_ID + '.cache.amazonaws.com'}`);

  // 6. Update server/.env
  const redisUrl = endpoint
    ? `rediss://default:${authToken}@${endpoint}:6379`
    : `rediss://default:${authToken}@${CLUSTER_ID}.${region}.cache.amazonaws.com:6379`;

  console.log(`   Updating server/.env with REDIS_URL...`);
  const envPath = path.join(__dirname, '../server/.env');
  let envContent = fs.readFileSync(envPath, 'utf8');
  envContent = envContent.replace(/REDIS_URL=.*/, `REDIS_URL=${redisUrl}`);
  fs.writeFileSync(envPath, envContent, 'utf8');

  console.log(`   ✓ Injected REDIS_URL=${redisUrl.replace(/:[^:]*@/, ':***@')}`);
  console.log(`\n🎉 AWS ElastiCache for Redis deployment initiated successfully!`);
}

deployElastiCache().catch((err) => {
  console.error('\n❌ ElastiCache deployment failed:', err);
  process.exit(1);
});
