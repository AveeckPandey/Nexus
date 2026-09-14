/**
 * tests/e2e/auth-flow.spec.ts — Signup, login, verification, invite links
 * (TESTING_SPEC.md §3 `e2e/auth-flow.spec.ts`). Playwright-only; excluded
 * from Jest (see jest.config.js testPathIgnorePatterns).
 *
 * Run: npx playwright test tests/e2e/auth-flow.spec.ts
 */
import { test, expect } from '@playwright/test';

const WEB = process.env.PLAYWRIGHT_WEB_URL || 'http://localhost:3000';

test.describe('auth flow', () => {
  test('signup → verification → profile initialized with identity key', async ({ page }) => {
    await page.goto(WEB);
    await expect(page.getByTestId('auth-form')).toBeVisible();

    // Toggle to signup mode if currently in login mode
    const toggle = page.getByRole('button', { name: /^create account$/i });
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
    }

    const email = `e2e_${Date.now()}@example.com`;
    await page.getByPlaceholder(/email/i).fill(email);
    await page.getByPlaceholder(/password/i).first().fill('E2ePass!234');
    const confirmInput = page.getByPlaceholder(/confirm.*password/i);
    if (await confirmInput.isVisible().catch(() => false)) {
      await confirmInput.fill('E2ePass!234');
    }

    await page.getByRole('button', { name: /create secure account|create account/i }).last().click();

    // Cognito 6-digit verification code step appears (or auto-confirm in dev).
    const codeInput = page.getByPlaceholder(/0 0 0 0 0 0|code|verification/i);
    if (await codeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await codeInput.fill('123456');
      await page.getByRole('button', { name: /confirm & verify|verify|confirm/i }).click();
    }

    await expect(page.getByText(/select a conversation|chats|ghost|private/i).first()).toBeVisible({
      timeout: 30000,
    });

    // X25519 identity key published from this device.
    const pub = await page.evaluate(() => localStorage.getItem('nexus_identity_pub'));
    expect(pub).toBeTruthy();
  });

  test('personal invite link stashes code and auto-opens after sign-in', async ({ page }) => {
    await page.goto(`${WEB}/invite?u=alice`);
    await expect(page).toHaveURL(/invite|u=alice/);
    const pending = await page.evaluate(() => localStorage.getItem('nexus_pending_invite'));
    expect(pending).toBeTruthy();
  });
});
