import * as crypto from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { TranslateClient } from '@aws-sdk/client-translate';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

const region = process.env.AWS_REGION || 'us-east-1';

const credentials =
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined;

const dynamoRaw = new DynamoDBClient({ region, credentials });
export const dynamoDocumentClient = DynamoDBDocumentClient.from(dynamoRaw, {
  marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
  unmarshallOptions: { wrapNumbers: false },
});

export const s3Client = new S3Client({ region, credentials });
export const translateClient = new TranslateClient({ region, credentials });
export const cognitoClient = new CognitoIdentityProviderClient({ region, credentials });

export const AWS_CONFIG = {
  region,
  dynamoTable: process.env.DYNAMODB_TABLE_NAME || 'NexusTable',
  s3Bucket: process.env.S3_BUCKET_NAME || 'nexus-chat-media-storage',
  cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID || '',
  cognitoClientId: process.env.COGNITO_CLIENT_ID || '',
  cognitoClientSecret: process.env.COGNITO_CLIENT_SECRET || '',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  cloudfrontDomain: process.env.CLOUDFRONT_DOMAIN || '',
};

export function hasAwsCredentials(): boolean {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY,
  );
}

/** HMAC SECRET_HASH for Cognito app clients with a secret. */
export function cognitoSecretHash(username: string): string | undefined {
  if (!AWS_CONFIG.cognitoClientSecret || !AWS_CONFIG.cognitoClientId) return undefined;
  return crypto
    .createHmac('sha256', AWS_CONFIG.cognitoClientSecret)
    .update(username + AWS_CONFIG.cognitoClientId)
    .digest('base64');
}
