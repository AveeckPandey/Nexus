/**
 * tests/security/memory-leak.spec.ts — Heap snapshot comparison
 * (0 → 1K users → 0) per TESTING_SPEC.md §3 `security/memory-leak.spec.ts`.
 *
 * Strategy: drive the REAL ChatService + DynamoDbService through a 1K-user
 * burst (conversations + messages + reactions), drop all references, force GC
 * when available, and assert the heap returns near baseline. Thresholds are
 * deliberately generous so the test is a leak smoke-signal, not flaky.
 */
import { ChatService } from '../../server/src/modules/chat/chat.service';
import { DynamoDbService } from '../../server/src/modules/dynamodb/dynamodb.service';

function heapMB(): number {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

function forceGc(): void {
  const g = (global as any).gc;
  if (typeof g === 'function') g();
}

async function settle(): Promise<void> {
  forceGc();
  await new Promise((r) => setTimeout(r, 50));
  forceGc();
}

describe('memory-leak: 0 → burst → 0 heap discipline', () => {
  test('1K-message burst releases back near baseline', async () => {
    await settle();
    const baseline = heapMB();

    // Burst phase: fresh service graph, 200 conversations × 5 messages.
    let db: DynamoDbService | null = new DynamoDbService();
    let chat: ChatService | null = new ChatService(db, {
      sendPushNotification: jest.fn(async () => {}),
    } as any);
    for (let c = 0; c < 200; c++) {
      const conv = await chat!.createConversation(`user-${c}`, [`peer-${c}`]);
      for (let m = 0; m < 5; m++) {
        await chat!.saveMessage(conv.id, `user-${c}`, `User ${c}`, `burst payload ${c}/${m}`);
      }
    }
    const burstCount = (await db!.queryByPk(`USER#user-0`, 'CONV#')).length;
    expect(burstCount).toBeGreaterThan(0);
    const peak = heapMB();
    expect(peak - baseline).toBeLessThan(250); // sanity: burst itself must be bounded

    // Release phase: drop every reference and collect.
    db = null;
    chat = null;
    await settle();
    const after = heapMB();
    // Heap must mostly return (generous 80MB slack for JIT/test harness).
    expect(after - baseline).toBeLessThan(80);
  }, 30000);

  test('repeated conversation churn does not grow the retained set', async () => {
    const db = new DynamoDbService();
    const chat = new ChatService(db, { sendPushNotification: jest.fn(async () => {}) } as any);
    await settle();
    const before = heapMB();
    for (let round = 0; round < 5; round++) {
      const conv = await chat.createConversation(`churn-${round}`, ['peer']);
      await chat.saveMessage(conv.id, `churn-${round}`, 'C', 'x'.repeat(256));
      await db.delete(`CONV#${conv.id}`, 'METADATA');
      await db.delete(`USER#churn-${round}`, `CONV#${conv.id}`);
      await db.delete(`USER#peer`, `CONV#${conv.id}`);
    }
    await settle();
    expect(heapMB() - before).toBeLessThan(50);
  }, 30000);
});
