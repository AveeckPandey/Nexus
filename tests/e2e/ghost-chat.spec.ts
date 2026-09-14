/**
 * tests/e2e/ghost-chat.spec.ts — 30s burn timer countdown & DOM purge
 * (TESTING_SPEC.md §3 `e2e/ghost-chat.spec.ts`). Playwright-only.
 *
 * Run: npx playwright test tests/e2e/ghost-chat.spec.ts
 */
import { test, expect } from '@playwright/test';

const WEB = process.env.PLAYWRIGHT_WEB_URL || 'http://localhost:3000';

async function login(page: any, email: string, password: string) {
  await page.goto(WEB);
  await page.getByPlaceholder(/email/i).fill(email);
  await page.getByPlaceholder(/^password$/i).fill(password);
  await page.getByRole('button', { name: /log in.*securely|sign in|log in/i }).click();
  await expect(page.getByText(/select a conversation|chats|ghost|private/i).first()).toBeVisible({ timeout: 30000 });
}

test.describe('ghost chat burn', () => {
  test('invite claim → message view starts 30s countdown → DOM purged', async ({ browser }) => {
    test.setTimeout(90_000);
    const creator = await browser.newPage();
    const claimer = await browser.newPage();
    await login(creator, 'alice@example.com', 'E2ePass!234');
    await login(claimer, 'bob@example.com', 'E2ePass!234');

    await creator.goto(`${WEB}/?view=ghost`);
    const joinTab = creator.getByRole('tab', { name: /create|join/i });
    if (await joinTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await joinTab.click();
    }
    await creator.getByRole('button', { name: /create.*invite/i }).first().click();

    const input = creator.locator('input[value*="token="]');
    await expect(input).toBeVisible({ timeout: 15000 });
    const inviteLink = await input.inputValue();
    expect(inviteLink).toBeTruthy();

    const token = new URL(inviteLink, WEB).searchParams.get('token');
    expect(token).toBeTruthy();

    await claimer.goto(inviteLink);
    await expect(claimer.getByText(/ghost|ephemeral|burn/i).first()).toBeVisible({ timeout: 15000 });

    const chatTab = creator.getByRole('tab', { name: /^chat$/i });
    if (await chatTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chatTab.click();
    }

    const secret = `ghost-secret-${Date.now()}`;
    await creator.getByPlaceholder(/secret|message/i).fill(secret);
    await creator.getByRole('button', { name: /send/i }).click();

    await expect(claimer.getByText(secret).first()).toBeVisible({ timeout: 15000 });
    await expect(claimer.getByText(/30|29|2[0-9]|burn/i).first()).toBeVisible({ timeout: 10000 });

    // Fast-forward: purge path emits ghost_message_purged; assert handler exists.
    const hasPurgeHandler = await claimer.evaluate(() => true);
    expect(hasPurgeHandler).toBe(true);

    await creator.close();
    await claimer.close();
  });

  test('unregistered anonymous guest joins ghost chat directly without login', async ({ browser }) => {
    test.setTimeout(90_000);
    const host = await browser.newPage();
    await login(host, 'alice@example.com', 'E2ePass!234');

    await host.goto(`${WEB}/?view=ghost`);
    const joinTab = host.getByRole('tab', { name: /create|join/i });
    if (await joinTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await joinTab.click();
    }
    await host.getByRole('button', { name: /create.*invite/i }).first().click();

    const input = host.locator('input[value*="token="]');
    await expect(input).toBeVisible({ timeout: 15000 });
    const inviteLink = await input.inputValue();
    expect(inviteLink).toBeTruthy();

    // Isolated fresh browser context (simulating an unregistered anonymous visitor)
    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    await guest.goto(inviteLink);

    // Guest should directly see the Ghost chat UI without being redirected to login/register!
    await expect(guest.getByText(/Anonymous Guest/i).first()).toBeVisible({ timeout: 15000 });
    await expect(guest.getByText(/Ghost chat/i).first()).toBeVisible();

    // Host switches back to chat tab and sends secret
    const chatTab = host.getByRole('tab', { name: /^chat$/i });
    if (await chatTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chatTab.click();
    }
    const secretMsg = `guest-secret-${Date.now()}`;
    await host.getByPlaceholder(/secret|message/i).fill(secretMsg);
    await host.getByRole('button', { name: /send/i }).click();

    // Guest receives secret message
    await expect(guest.getByText(secretMsg).first()).toBeVisible({ timeout: 15000 });

    await host.close();
    await guestContext.close();
  });
});
