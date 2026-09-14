import { Injectable, BadRequestException } from '@nestjs/common';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { s3Client, AWS_CONFIG, hasAwsCredentials } from '../../config/aws.config';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'application/pdf',
]);

@Injectable()
export class MediaService {
  async presignedPut(userId: string, fileType: string, fileExtension: string) {
    if (!ALLOWED_TYPES.has(fileType)) {
      throw new BadRequestException(`Unsupported file type: ${fileType}`);
    }
    const ext = fileExtension.replace(/^\./, '').slice(0, 10) || 'bin';
    const key = `uploads/${userId}/${uuidv4()}.${ext}`;
    if (!hasAwsCredentials()) {
      const base = process.env.API_URL || 'http://localhost:8080';
      return {
        uploadUrl: `${base}/api/media/upload/${key}`,
        mediaUrl: `${base}/api/media/files/${key}`,
        key,
      };
    }
    const uploadUrl = await getSignedUrl(
      s3Client,
      new PutObjectCommand({
        Bucket: AWS_CONFIG.s3Bucket,
        Key: key,
        ContentType: fileType,
      }),
      { expiresIn: 900 },
    );
    const cdn = (AWS_CONFIG.cloudfrontDomain || '').replace(/\/$/, '');
    const mediaUrl = cdn
      ? `${cdn}/${key}`
      : `https://${AWS_CONFIG.s3Bucket}.s3.${AWS_CONFIG.region}.amazonaws.com/${key}`;
    return { uploadUrl, mediaUrl, key };
  }
}
