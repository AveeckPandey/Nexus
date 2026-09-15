import { test as base, expect } from '@playwright/test';

export const WEB = process.env.PLAYWRIGHT_WEB_URL || 'http://localhost:3000';
export const API = process.env.PLAYWRIGHT_API_URL || 'http://localhost:8080';

/** Isolated user per test (industry standard: no shared alice@example.com). */
export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;
}

export async function signupViaApi(email: string, password: string, name?: string) {
  const res = await fetch(`${API}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      name: name || email.split('@')[0],
      username: (name || email.split('@')[0]).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 20),
    }),
  }).catch(() => null);
  return res;
}

export async function loginViaUi(page: any, email: string, password: string) {
  await page.goto(WEB);
  await page.getByPlaceholder(/email/i).fill(email);
  await page.getByPlaceholder(/^password$/i).fill(password);
  await page.getByRole('button', { name: /log in.*securely|sign in|log in/i }).click();
  await expect(page.getByText(/select a conversation|chats|ghost|private/i).first()).toBeVisible({
    timeout: 30000,
  });
}

export const test = base;
export { expect };
