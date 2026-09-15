import {
  Controller,
  Post,
  Put,
  Get,
  Body,
  UseGuards,
  BadRequestException,
  NotFoundException,
  Req,
  Res,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Throttle } from '@nestjs/throttler';
import { MediaService } from './media.service';
import { CognitoAuthGuard } from '../../common/guards/cognito-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');

function getSafeFilePath(rawKey: string): string {
  const cleaned = rawKey.replace(/\\/g, '/').replace(/^\/+/, '');
  if (cleaned.includes('..')) {
    throw new BadRequestException('Invalid path');
  }
  const rel = cleaned.startsWith('uploads/') ? cleaned.slice('uploads/'.length) : cleaned;
  return path.join(UPLOAD_ROOT, rel);
}

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
};

@Throttle({ default: { limit: 25, ttl: 60000 } })
@Controller('api/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('presigned-url')
  @UseGuards(CognitoAuthGuard)
  presigned(
    @CurrentUser() u: AuthenticatedUser,
    @Body() b: { fileType?: string; fileExtension?: string },
  ) {
    if (!b.fileType || !b.fileExtension) {
      throw new BadRequestException('fileType and fileExtension required');
    }
    return this.media.presignedPut(u.userId, b.fileType, b.fileExtension);
  }

  @Put('upload/*')
  async uploadLocal(@Req() req: any) {
    const rawKey = req.params?.['*'] || req.url.split('?')[0].replace(/^\/api\/media\/upload\/?/, '');
    const filePath = getSafeFilePath(rawKey);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    let contentBuffer: Buffer;
    if (Buffer.isBuffer(req.body)) {
      contentBuffer = req.body;
    } else if (req.raw && typeof req.raw.pipe === 'function' && (!req.body || (typeof req.body === 'object' && Object.keys(req.body).length === 0 && !Buffer.isBuffer(req.body)))) {
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        req.raw.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.raw.on('end', () => resolve());
        req.raw.on('error', reject);
      });
      contentBuffer = Buffer.concat(chunks);
    } else {
      contentBuffer = Buffer.from(req.body || '');
    }

    // Security check 1: Disallow Windows MZ/PE executables (magic bytes 'MZ')
    if (contentBuffer.length >= 2 && contentBuffer[0] === 0x4D && contentBuffer[1] === 0x5A) {
      throw new BadRequestException('Executable files are forbidden.');
    }

    // Security check 2: Disallow Linux ELF binaries (magic bytes 0x7F 'ELF')
    if (contentBuffer.length >= 4 && contentBuffer[0] === 0x7F && contentBuffer[1] === 0x45 && contentBuffer[2] === 0x4C && contentBuffer[3] === 0x46) {
      throw new BadRequestException('Binary executable files are forbidden.');
    }

    // Security check 3: Sanitize SVG scripts / XSS injection
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.svg') {
      const svgStr = contentBuffer.toString('utf8');
      if (/<script|onload=|onerror=|onclick=/i.test(svgStr)) {
        throw new BadRequestException('SVG files containing executable scripts or event handlers are forbidden.');
      }
    }

    await fs.promises.writeFile(filePath, contentBuffer);
    return { success: true };
  }

  @Get('files/*')
  async getFile(@Req() req: any, @Res() reply: any) {
    const rawKey = req.params?.['*'] || req.url.split('?')[0].replace(/^\/api\/media\/files\/?/, '');
    const filePath = getSafeFilePath(rawKey);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('File not found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    reply.type(contentType);
    reply.header('Cache-Control', 'public, max-age=86400');
    reply.header('Access-Control-Allow-Origin', '*');
    const buffer = await fs.promises.readFile(filePath);
    return reply.send(buffer);
  }
}
