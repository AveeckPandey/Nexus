/**
 * scripts/aws-configure-s3.js
 * Configures CORS, encryption, and public access settings on S3 media bucket.
 */
const path = require('path');
const fs = require('fs');
const {
  S3Client,
  PutBucketCorsCommand,
  PutBucketEncryptionCommand,
} = require('../server/node_modules/@aws-sdk/client-s3');
require('dotenv').config({ path: path.join(__dirname, '../server/.env') });

const region = process.env.AWS_REGION || 'us-east-1';
const bucketName = 'nexus-media-758388043025';

const s3 = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function configureS3() {
  console.log(`\n🪣 Configuring S3 bucket "${bucketName}" in ${region}...`);

  // 1. Put CORS Configuration
  console.log('   Applying CORS configuration for browser presigned uploads...');
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: bucketName,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
            AllowedOrigins: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  console.log('   ✓ CORS rules applied (GET, PUT, POST, HEAD allowed).');

  // 2. Put Default Server-Side Encryption (SSE-S3 / AES256)
  console.log('   Applying default AES256 encryption...');
  await s3.send(
    new PutBucketEncryptionCommand({
      Bucket: bucketName,
      ServerSideEncryptionConfiguration: {
        Rules: [
          {
            ApplyServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      },
    }),
  );
  console.log('   ✓ Default AES256 encryption enabled.');

  // 3. Update server/.env
  console.log('   Updating server/.env with S3_BUCKET_NAME...');
  const envPath = path.join(__dirname, '../server/.env');
  let envContent = fs.readFileSync(envPath, 'utf8');
  envContent = envContent.replace(/S3_BUCKET_NAME=.*/, `S3_BUCKET_NAME=${bucketName}`);
  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log(`   ✓ Injected S3_BUCKET_NAME=${bucketName}`);

  console.log('\n🎉 AWS S3 Media Bucket configured successfully!');
}

configureS3().catch((err) => {
  console.error('\n❌ S3 configuration failed:', err);
  process.exit(1);
});
