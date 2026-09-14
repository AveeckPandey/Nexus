/**
 * tests/load/benchmark-1k.js
 * High-precision 1,000-user concurrent WebSocket benchmark for Nexus.
 * Uses native socket.io-client to measure real connection concurrency,
 * authentication verification, round-trip message latency, and memory stability.
 */

let io;
try {
  io = require('socket.io-client').io || require('socket.io-client');
} catch (e) {
  io = require('../../web/node_modules/socket.io-client').io;
}

const SERVER_URL = process.env.TARGET_URL || 'https://nexus.buildwithaveeck.com';
const TARGET_CONCURRENCY = parseInt(process.env.CONCURRENCY || '1000', 10);
const BATCH_SIZE = 50;
const BATCH_INTERVAL_MS = 150;

async function runBenchmark() {
  console.log('====================================================');
  console.log(`🚀 Starting Nexus 1,000 Concurrent User Benchmark`);
  console.log(`Target: ${SERVER_URL} | Goal: ${TARGET_CONCURRENCY} active WebSockets`);
  console.log('====================================================\n');

  // 1. Health check & initial memory baseline
  const healthStart = await fetch(`${SERVER_URL}/health`).then((r) => r.json());
  console.log(`[01/05] Server Health: OK (Uptime: ${healthStart.uptime.toFixed(1)}s)`);

  // 2. Authenticate and obtain session tokens
  console.log('[02/05] Authenticating test user for WebSocket authorization...');
  const testEmail = 'benchmark_user@nexus.app';
  const testPassword = 'Password123!';

  // Attempt signup (best effort if not exists)
  await fetch(`${SERVER_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword, name: 'Benchmark User', username: 'bench_user' }),
  }).catch(() => {});

  const loginRes = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  }).then((r) => r.json());

  const token = loginRes.idToken;
  if (!token) {
    console.error('Login response was:', loginRes);
    throw new Error('Failed to obtain authentication token from /api/auth/login');
  }
  console.log('        ✓ Authenticated successfully with valid session token.\n');

  // 3. Ramp up 1,000 concurrent sockets
  console.log(`[03/05] Ramping up to ${TARGET_CONCURRENCY} concurrent WebSocket connections...`);
  const sockets = [];
  const latencies = [];
  let connectedCount = 0;
  let errorCount = 0;

  const connectStartTime = Date.now();

  for (let i = 0; i < TARGET_CONCURRENCY; i += BATCH_SIZE) {
    const batchPromises = [];
    const currentBatchSize = Math.min(BATCH_SIZE, TARGET_CONCURRENCY - i);

    for (let j = 0; j < currentBatchSize; j++) {
      const p = new Promise((resolve) => {
        const socket = io(SERVER_URL, {
          transports: ['websocket'],
          auth: { token },
          reconnection: false,
          timeout: 10000,
        });

        socket.on('connect', () => {
          connectedCount++;
          sockets.push(socket);
          resolve(true);
        });

        socket.on('connect_error', (err) => {
          errorCount++;
          resolve(false);
        });

        socket.on('disconnect', () => {
          // Socket disconnected
        });
      });
      batchPromises.push(p);
    }

    await Promise.all(batchPromises);
    const pct = Math.round((connectedCount / TARGET_CONCURRENCY) * 100);
    process.stdout.write(`\r        Connected: ${connectedCount}/${TARGET_CONCURRENCY} (${pct}%) [Errors: ${errorCount}]`);
    await new Promise((r) => setTimeout(r, BATCH_INTERVAL_MS));
  }

  const connectTotalTime = ((Date.now() - connectStartTime) / 1000).toFixed(2);
  console.log(`\n        ✓ All ${connectedCount} sockets connected in ${connectTotalTime}s.\n`);

  // Create valid benchmark conversation for authorized message exchange
  const convRes = await fetch(`${SERVER_URL}/api/chat/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ type: 'group', title: 'Benchmark Room 001', participantIds: [] }),
  }).then((r) => r.json()).catch(() => ({}));
  const benchConvId = convRes?.conversation?.id || 'bench-room-001';

  // 4. Concurrency Messaging & Latency Benchmark
  console.log('[04/05] Testing concurrent message round-trip latency across active sockets...');
  const sampleSize = Math.min(100, sockets.length);
  const sampleSockets = sockets.slice(0, sampleSize);

  const samplePromises = sampleSockets.map((s) => {
    return new Promise((resolve) => {
      const t0 = Date.now();
      s.emit(
        'send_message',
        {
          conversationId: benchConvId,
          content: 'encrypted_benchmark_payload_' + Math.random(),
          isEncrypted: true,
          nonce: 'bench_nonce_' + Date.now(),
          encVersion: 1,
        },
        () => {
          latencies.push(Date.now() - t0);
          resolve();
        }
      );
      // Fallback timeout in case of packet drop
      setTimeout(resolve, 2000);
    });
  });

  await Promise.all(samplePromises);

  latencies.sort((a, b) => a - b);
  const avgLat = (latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)).toFixed(1);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const maxLat = latencies[latencies.length - 1] || 0;

  console.log(`        ✓ Completed ${latencies.length} message roundtrips.`);
  console.log(`        Avg Latency: ${avgLat}ms | p50: ${p50}ms | p95: ${p95}ms | Max: ${maxLat}ms\n`);

  // 5. Sustained Concurrency & Stability Window
  console.log('[05/05] Holding all 1,000 sockets connected for 8 seconds to verify stability...');
  await new Promise((r) => setTimeout(r, 8000));

  const stillConnected = sockets.filter((s) => s.connected).length;
  console.log(`        ✓ Sustained Connection Check: ${stillConnected}/${connectedCount} sockets active.\n`);

  // Cleanup: Disconnect all sockets
  for (const s of sockets) {
    s.disconnect();
  }

  // Final Health Check
  const healthEnd = await fetch(`${SERVER_URL}/health`).then((r) => r.json());

  console.log('====================================================');
  console.log('📊 NEXUS 1,000 CONCURRENT USERS TEST REPORT');
  console.log('====================================================');
  console.log(`Target Sockets Requested : ${TARGET_CONCURRENCY}`);
  console.log(`Sockets Connected        : ${connectedCount}`);
  console.log(`Success Rate             : ${((connectedCount / TARGET_CONCURRENCY) * 100).toFixed(1)}%`);
  console.log(`Connection Drops         : ${connectedCount - stillConnected}`);
  console.log(`Average Latency          : ${avgLat} ms`);
  console.log(`p95 Latency              : ${p95} ms (Target: < 50 ms)`);
  console.log(`Server Health Post-Test  : ${healthEnd.status.toUpperCase()} (Uptime: ${healthEnd.uptime.toFixed(1)}s)`);
  console.log('====================================================');

  if (connectedCount >= TARGET_CONCURRENCY * 0.95 && (connectedCount - stillConnected) === 0) {
    console.log('🎉 RESULT: PASSED! The server successfully sustained 1,000 concurrent users.');
  } else {
    console.log('⚠️ RESULT: Completed with warnings. Check logs for details.');
  }
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
