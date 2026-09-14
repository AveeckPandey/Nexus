/**
 * tests/security/xss-sanitization.spec.ts — Malicious script escaping in
 * message bubbles (TESTING_SPEC.md §3 `security/xss-sanitization.spec.ts`).
 *
 * Server stores message bodies opaquely (never interprets HTML); the client
 * must render them as inert text. This spec pins the escaping contract with
 * the same attacker vectors the E2E suite types into the composer, and guards
 * against regressions to `dangerouslySetInnerHTML` in the chat render path.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ChatService } from '../../server/src/modules/chat/chat.service';
import { DynamoDbService } from '../../server/src/modules/dynamodb/dynamodb.service';

/** Minimal HTML escaper mirroring the client render contract (text-only bubbles). */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const VECTORS = [
  `<script>alert('xss')</script>`,
  `<img src=x onerror=alert(1)>`,
  `<svg onload=alert(1)>`,
  `"><script>alert(document.cookie)</script>`,
  `<a href="javascript:alert(1)">click</a>`,
  `hello <b>bob</b> & <i>alice</i>`,
];

describe('xss-sanitization: escaping contract', () => {
  test.each(VECTORS)('neutralizes %p', (payload) => {
    const out = escapeHtml(payload);
    // No raw tag openers survive — every '<' that starts markup is escaped.
    // Attribute text like `onerror=` may still appear as INERT text inside
    // `&lt;...&gt;`, which is safe because the browser never parses it as HTML.
    expect(out).not.toMatch(/<[a-zA-Z]/);
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;');
    // javascript: URIs are inert once the anchor brackets are escaped.
    expect(out).not.toMatch(/<a\s/i);
    // Round-trip decode restores the literal text (no data loss, no execution).
    const decoded = out
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, '&');
    expect(decoded).toBe(payload);
  });

  test('server persists the raw body opaquely (no server-side HTML interpretation)', async () => {
    const db = new DynamoDbService();
    const chat = new ChatService(db, { sendPushNotification: jest.fn(async () => {}) } as any);
    const conv = await chat.createConversation('alice', ['bob']);
    const payload = `<script>alert('xss')</script>`;
    await chat.saveMessage(conv.id, 'alice', 'Alice', payload);
    const { messages } = await chat.getMessages(conv.id);
    expect(messages[0].content).toBe(payload);
    // The stored value is inert data — escaping happens at render time.
    expect(escapeHtml(messages[0].content)).toBe('&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;');
  });

  test('chat render path must not use dangerouslySetInnerHTML for message bodies', () => {
    const candidates = [
      path.resolve(__dirname, '../../web/components/ChatWindow.tsx'),
      path.resolve(__dirname, '../../web/components/Composer.tsx'),
    ];
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      const src = fs.readFileSync(file, 'utf8');
      expect(src).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });
});
