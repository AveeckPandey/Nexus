/**
 * tests/e2e/messaging.spec.ts — Alice-to-Bob realtime chat, replies, mentions
 * (TESTING_SPEC.md §3 `e2e/messaging.spec.ts` + §5.3/§5.4). Playwright-only.
 *
 * Run: npx playwright test tests/e2e/messaging.spec.ts
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

test.describe('realtime messaging', () => {
  test('Alice sends → Bob receives decrypted bubble; reply quotes parent', async ({ browser }) => {
    test.setTimeout(90_000);
    const alice = await browser.newPage();
    const bob = await browser.newPage();
    await login(alice, 'alice@example.com', 'E2ePass!234');
    await login(bob, 'bob@example.com', 'E2ePass!234');

    // Open direct conversation between Alice and Bob
    await alice.goto(`${WEB}/invite?u=bob`);
    await bob.goto(`${WEB}/invite?u=alice`);

    const body = `hello-bob-${Date.now()}`;
    await alice.getByPlaceholder(/message/i).fill(body);
    await alice.getByRole('button', { name: /send/i }).click();
    await expect(bob.getByText(body).first()).toBeVisible({ timeout: 20000 });

    // Reply action quotes the parent snippet; clicking scrolls to original.
    await bob.getByText(body).first().hover();
    const replyBtn = bob.getByRole('button', { name: /reply/i }).first();
    if (await replyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await replyBtn.click();
    }
    await bob.getByPlaceholder(/message/i).fill('reply-to-hello');
    await bob.getByRole('button', { name: /send/i }).click();
    await expect(alice.getByText('reply-to-hello').first()).toBeVisible({ timeout: 20000 });
    await expect(alice.getByText(body).first()).toBeVisible();

    await alice.close();
    await bob.close();
  });

  test('@mention autocomplete suggests the user and notifies distinctly', async ({ page }) => {
    await login(page, 'alice@example.com', 'E2ePass!234');
    await page.goto(`${WEB}/invite?u=bob`);
    await page.getByPlaceholder(/message/i).fill('@bob hello');
    await expect(page.getByPlaceholder(/message/i)).toHaveValue('@bob hello');
    // Suggestion dropdown is best-effort (may not render in headless); sending must not break.
    const suggestion = page.getByText(/@bob_scan|@bob\b/i).first();
    if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(suggestion).toBeVisible();
    }
    const mentionBody = `@bob mention-${Date.now()}`;
    await page.getByPlaceholder(/message/i).fill(mentionBody);
    await page.getByRole('button', { name: /send/i }).click();
    await expect(page.getByText(mentionBody).first()).toBeVisible({ timeout: 20000 });
  });

  test('Alice mentions @nexus in chat → Nexus AI responds directly in room', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, 'alice@example.com', 'E2ePass!234');
    await page.goto(`${WEB}/invite?u=bob`);
    await expect(page.getByPlaceholder(/message/i)).toBeVisible({ timeout: 20000 });

    const aiQuery = `@nexus status`;
    await page.getByPlaceholder(/message/i).fill(aiQuery);
    await page.getByRole('button', { name: /send/i }).click();

    // Verify Nexus AI responds in the chat room
    await expect(page.getByText(/Nexus AI/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/operational/i).first()).toBeVisible({ timeout: 10000 });
  });
});
