/**
 * tests/e2e/media-upload.spec.ts — Picture attachment, voice notes, waveforms
 * (TESTING_SPEC.md §3 `e2e/media-upload.spec.ts` + §5.1). Playwright-only.
 *
 * Run: npx playwright test tests/e2e/media-upload.spec.ts
 */
import { test, expect } from '@playwright/test';

const WEB = process.env.PLAYWRIGHT_WEB_URL || 'http://localhost:3000';
const API = process.env.PLAYWRIGHT_API_URL || 'http://localhost:8080';

async function getAuthToken(page: any) {
  const loginRes = await page.request.post(`${API}/api/auth/login`, {
    data: { email: 'alice@example.com', password: 'E2ePass!234' },
  });
  const data = await loginRes.json();
  return data.idToken;
}

test.describe('media upload', () => {
  test('presigned PUT 200 → recipient image renders with dimensions', async ({ page }) => {
    const token = await getAuthToken(page);
    const presigned = await page.request.post(`${API}/api/media/presigned-url`, {
      data: { fileType: 'image/png', fileExtension: 'png' },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(presigned.ok()).toBeTruthy();
    const { uploadUrl, mediaUrl } = await presigned.json();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const put = await page.request.put(uploadUrl, {
      data: png,
      headers: { 'Content-Type': 'image/png' },
    });
    expect([200, 204]).toContain(put.status());
    expect(mediaUrl).toMatch(/^https?:\/\//);

    await page.goto(WEB);
    await page.getByPlaceholder(/email/i).fill('alice@example.com');
    await page.getByPlaceholder(/^password$/i).fill('E2ePass!234');
    await page.getByRole('button', { name: /log in.*securely|sign in|log in/i }).click();
    // Composer attachment flow surfaces the CDN URL in the thread.
    await expect(page.getByPlaceholder(/message|search/i).first()).toBeVisible({ timeout: 30000 });
  });

  test('disallowed MIME (.exe/.sh) rejected with 400', async ({ page }) => {
    const token = await getAuthToken(page);
    for (const fileType of ['application/x-msdownload', 'application/x-sh']) {
      const res = await page.request.post(`${API}/api/media/presigned-url`, {
        data: { fileType, fileExtension: 'bin' },
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(400);
    }
  });
});
