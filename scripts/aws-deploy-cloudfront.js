const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../server/.env') });

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'nexus-media-758388043025';
const REGION = process.env.AWS_REGION || 'us-east-1';
const ACCOUNT_ID = '758388043025';
const OAC_NAME = 'nexus-media-oac';

async function deployCloudFront() {
  console.log(`\n🚀 Deploying CloudFront Distribution for S3 bucket "${BUCKET_NAME}"...`);

  // 1. Ensure Origin Access Control (OAC)
  let oacId = '';
  try {
    const oacsRaw = execSync('aws cloudfront list-origin-access-controls', { encoding: 'utf8' });
    const oacs = JSON.parse(oacsRaw);
    const existing = (oacs.OriginAccessControlList?.Items || []).find((item) => item.Name === OAC_NAME);
    if (existing) {
      oacId = existing.Id;
      console.log(`   ✓ Found existing Origin Access Control: ${oacId}`);
    }
  } catch (e) {}

  if (!oacId) {
    console.log(`   Creating Origin Access Control "${OAC_NAME}"...`);
    const oacConfig = {
      Name: OAC_NAME,
      Description: 'CloudFront OAC for Nexus Media S3 bucket',
      SigningProtocol: 'sigv4',
      SigningBehavior: 'always',
      OriginAccessControlOriginType: 's3'
    };
    const oacConfigPath = path.join(__dirname, 'cloudfront-oac-config.json');
    fs.writeFileSync(oacConfigPath, JSON.stringify(oacConfig, null, 2));
    const createdRaw = execSync(`aws cloudfront create-origin-access-control --origin-access-control-config "file://${oacConfigPath.replace(/\\/g, '/')}"`, { encoding: 'utf8' });
    const created = JSON.parse(createdRaw);
    oacId = created.OriginAccessControl.Id;
    console.log(`   ✓ Created Origin Access Control: ${oacId}`);
  }

  // 2. Check for existing distribution for this bucket
  let distId = '';
  let distDomain = '';
  try {
    const listRaw = execSync('aws cloudfront list-distributions', { encoding: 'utf8' });
    const distList = JSON.parse(listRaw);
    const existing = (distList.DistributionList?.Items || []).find((item) =>
      (item.Origins?.Items || []).some((o) => o.DomainName.includes(BUCKET_NAME))
    );
    if (existing) {
      distId = existing.Id;
      distDomain = existing.DomainName;
      console.log(`   ✓ Found existing CloudFront Distribution: ${distId} (${distDomain})`);
    }
  } catch (e) {}

  // 3. Create Distribution if not existing
  if (!distId) {
    console.log(`   Creating CloudFront distribution pointing to S3 origin...`);
    const originDomain = `${BUCKET_NAME}.s3.${REGION}.amazonaws.com`;
    const callerReference = `nexus-media-${Date.now()}`;

    const distConfig = {
      CallerReference: callerReference,
      Comment: 'Nexus Media S3 CDN Distribution',
      Enabled: true,
      Origins: {
        Quantity: 1,
        Items: [
          {
            Id: `S3-${BUCKET_NAME}`,
            DomainName: originDomain,
            OriginAccessControlId: oacId,
            S3OriginConfig: {
              OriginAccessIdentity: ''
            }
          }
        ]
      },
      DefaultCacheBehavior: {
        TargetOriginId: `S3-${BUCKET_NAME}`,
        ViewerProtocolPolicy: 'redirect-to-https',
        AllowedMethods: {
          Quantity: 2,
          Items: ['GET', 'HEAD'],
          CachedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD']
          }
        },
        Compress: true,
        CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6', // Managed-CachingOptimized
        OriginRequestPolicyId: '88a5eaf4-2fd4-4709-b370-b4c650ea3fcf' // Managed-CORS-S3Origin
      },
      PriceClass: 'PriceClass_100', // US, Canada, Europe for lowest cost
      HttpVersion: 'http2and3'
    };

    const distConfigPath = path.join(__dirname, 'cloudfront-dist-config.json');
    fs.writeFileSync(distConfigPath, JSON.stringify(distConfig, null, 2));

    const createdRaw = execSync(`aws cloudfront create-distribution --distribution-config "file://${distConfigPath.replace(/\\/g, '/')}"`, { encoding: 'utf8' });
    const created = JSON.parse(createdRaw);
    distId = created.Distribution.Id;
    distDomain = created.Distribution.DomainName;
    console.log(`   ✓ CloudFront Distribution created: ${distId}`);
    console.log(`   🌐 CloudFront Domain: https://${distDomain}`);
  }

  // 4. Update S3 Bucket Policy to allow CloudFront OAC read
  console.log(`   Attaching S3 bucket policy for CloudFront OAC...`);
  const bucketPolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AllowCloudFrontServicePrincipalReadOnly',
        Effect: 'Allow',
        Principal: {
          Service: 'cloudfront.amazonaws.com'
        },
        Action: 's3:GetObject',
        Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
        Condition: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${distId}`
          }
        }
      }
    ]
  };

  const policyPath = path.join(__dirname, 's3-bucket-policy.json');
  fs.writeFileSync(policyPath, JSON.stringify(bucketPolicy, null, 2));
  execSync(`aws s3api put-bucket-policy --bucket ${BUCKET_NAME} --policy "file://${policyPath.replace(/\\/g, '/')}"`);
  console.log(`   ✓ S3 bucket policy updated: CloudFront OAC authorized to read objects.`);

  // 5. Update server/.env
  console.log(`   Updating server configuration with CloudFront Domain...`);
  const cdnUrl = `https://${distDomain}`;
  const envPath = path.join(__dirname, '../server/.env');
  let envContent = fs.readFileSync(envPath, 'utf8');
  if (envContent.includes('CLOUDFRONT_DOMAIN=')) {
    envContent = envContent.replace(/CLOUDFRONT_DOMAIN=.*/, `CLOUDFRONT_DOMAIN=${cdnUrl}`);
  } else {
    envContent += `\nCLOUDFRONT_DOMAIN=${cdnUrl}\n`;
  }
  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log(`   ✓ Updated server/.env: CLOUDFRONT_DOMAIN=${cdnUrl}`);

  console.log(`\n🎉 CloudFront CDN Deployment Complete!`);
  console.log(`   Distribution ID: ${distId}`);
  console.log(`   Media CDN URL:   ${cdnUrl}`);
  return { distId, distDomain: cdnUrl };
}

deployCloudFront().catch((err) => {
  console.error('\n❌ CloudFront deployment failed:', err);
  process.exit(1);
});
