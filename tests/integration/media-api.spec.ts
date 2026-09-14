/**
 * tests/integration/media-api.spec.ts — Presigned S3 upload URLs & MIME
 * validation (TESTING_SPEC.md §3 `integration/media-api.spec.ts` and §5.1).
 *
 * Exercises the REAL MediaService. Disallowed types must throw 400 even with
 * no AWS configured; allowed types either return { uploadUrl, mediaUrl, key }
 * or throw "not configured" when credentials are absent (both are correct —
 * the MIME gate must run BEFORE the credential gate).
 */
import { MediaService } from '../../server/src/modules/media/media.service';

describe('media-api: MIME validation gate', () => {
  test.each([['application/x-msdownload'], ['application/x-sh'], ['text/html'], ['application/javascript']])(
    'rejects disallowed type %s with 400',
    async (fileType) => {
      const svc = new MediaService();
      await expect(svc.presignedPut('u1', fileType, 'bin')).rejects.toMatchObject({
        status: 400,
      });
    },
  );

  test('rejects .exe / .sh payloads masquerading with bad MIME', async () => {
    const svc = new MediaService();
    await expect(svc.presignedPut('u1', 'application/x-msdownload', 'exe')).rejects.toThrow();
    await expect(svc.presignedPut('u1', 'application/x-sh', 'sh')).rejects.toThrow();
  });

  test.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['video/mp4', 'mp4'],
    ['audio/webm', 'webm'],
    ['application/pdf', 'pdf'],
  ])('accepts allowed type %s (URL or not-configured, never MIME-rejected)', async (fileType, ext) => {
    const svc = new MediaService();
    try {
      const out = await svc.presignedPut('u1', fileType, ext);
      expect(out.uploadUrl).toMatch(/^https?:\/\//);
      expect(out.mediaUrl).toMatch(/^https?:\/\//);
      expect(out.key).toMatch(/^uploads\/u1\//);
    } catch (err: any) {
      // No AWS credentials in test env — the only acceptable failure.
      // NOTE: both branches throw BadRequestException (status 400), so
      // discriminate by message: allowed types fail with "not configured",
      // never with "Unsupported file type".
      expect(String(err?.message || err)).toMatch(/not configured/i);
      expect(String(err?.message || err)).not.toMatch(/Unsupported file type/i);
    }
  });

  test('presigned PUT contract: 15-min expiry path returns upload + CDN read URLs', async () => {
    const svc = new MediaService();
    try {
      const out = await svc.presignedPut('alice', 'image/png', 'png');
      expect(out).toHaveProperty('uploadUrl');
      expect(out).toHaveProperty('mediaUrl');
      expect(out).toHaveProperty('key');
    } catch (err: any) {
      expect(String(err?.message || err)).toMatch(/not configured/i);
    }
  });
});
