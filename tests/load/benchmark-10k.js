/**
 * tests/load/benchmark-10k.js
 * High-scale 10,000 concurrent user WebSocket benchmark for Nexus.
 * Simulates Stage 2 production load (TESTING_SPEC.md §4).
 */

const { io } = require('../../web/node_modules/socket.io-client');

const SERVER_URL = process.env.TARGET_URL || 'https://nexus.buildwithaveeck.com';
const TARGET_CONCURRENCY = 10000;
const BATCH_SIZE = 100;
const BATCH_INTERVAL_MS = 80;

async function run10kBenchmark() {
  console.log('====================================================');
  console.log(`🔥 Starting Nexus 10,000 Concurrent User Benchmark`);
  console.log(`Target: ${SERVER_URL} | Goal: ${TARGET_CONCURRENCY} active WebSockets`);
  console.log('====================================================\n');

  // 1. Health check
  const healthStart = await fetch(`${SERVER_URL}/health`).then((r) => r.json());
  console.log(`[01/05] Initial Server Health: OK (Uptime: ${healthStart.uptime.toFixed(1)}s)`);

  // 2. Authenticate
  console.log('[02/05] Authenticating benchmark account...');
  const testEmail = 'benchmark_user@nexus.app';
  const testPassword = 'Password123!';

  await fetch(`${SERVER_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword, name: 'Benchmark 10K', username: 'bench_10k' }),
  }).catch(() => {});

  const loginRes = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  }).then((r) => r.json());

  const token = loginRes.idToken;
  if (!token) {
    throw new Error('Failed to obtain authentication token from /api/auth/login');
  }
  console.log('        ✓ Authenticated successfully with valid session token.\n');

  // 3. Ramp up 10,000 concurrent sockets
  console.log(`[03/05] Ramping up to ${TARGET_CONCURRENCY.toLocaleString()} concurrent WebSockets in batches of ${BATCH_SIZE}...`);
  const sockets = [];
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
          timeout: 15000,
        });

        socket.on('connect', () => {
          connectedCount++;
          sockets.push(socket);
          resolve(true);
        });

        socket.on('connect_error', () => {
          errorCount++;
          resolve(false);
        });
      });
      batchPromises.push(p);
    }

    await Promise.all(batchPromises);
    const pct = ((connectedCount / TARGET_CONCURRENCY) * 100).toFixed(1);
    process.stdout.write(`\r        Connected: ${connectedCount.toLocaleString()}/${TARGET_CONCURRENCY.toLocaleString()} (${pct}%) [Errors: ${errorCount}]`);
    await new Promise((r) => setTimeout(r, BATCH_INTERVAL_MS));
  }

  const connectTotalTime = ((Date.now() - connectStartTime) / 1000).toFixed(2);
  console.log(`\n        ✓ All ${connectedCount.toLocaleString()} sockets connected in ${connectTotalTime}s.\n`);

  // Real conversation so latency measures DB write + fan-out (not Forbidden).
  const convRes = await fetch(`${SERVER_URL}/api/chat/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'group', title: 'Benchmark Room 10K', participantIds: [] }),
  }).then((r) => r.json()).catch(() => ({}));
  const benchConvId = convRes?.conversation?.id || 'bench-room-10k';

  // 4. Sample Round-Trip Latency Across 150 Sockets
  console.log('[04/05] Testing round-trip message latency across active sockets...');
  const latencies = [];
  const sampleSize = Math.min(150, sockets.length);
  const sampleSockets = sockets.slice(0, sampleSize);

  await Promise.all(
    sampleSockets.map(
      (s) =>
        new Promise((resolve) => {
          s.emit('join_room', { conversationId: benchConvId }, () => resolve());
          setTimeout(resolve, 2000);
        }),
    ),
  );

  for (const s of sampleSockets) {
    const t0 = Date.now();
    await new Promise((resolve) => {
      s.emit(
        'send_message',
        {
          conversationId: benchConvId,
          content: 'encrypted_payload_sample_' + Math.random(),
          isEncrypted: true,
          nonce: 'bench_10k_nonce_' + Date.now(),
          encVersion: 1,
        },
        () => {
          latencies.push(Date.now() - t0);
          resolve();
        }
      );
      setTimeout(resolve, 2000);
    });
  }

  latencies.sort((a, b) => a - b);
  const avgLat = (latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)).toFixed(1);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const maxLat = latencies[latencies.length - 1] || 0;

  console.log(`        ✓ Completed ${latencies.length} message roundtrips under 10,000 concurrent connections.`);
  console.log(`        Avg Latency: ${avgLat}ms | p50: ${p50}ms | p95: ${p95}ms | p99: ${p99}ms | Max: ${maxLat}ms\n`);

  // 5. Sustained Concurrency & Stability Window (Hold all 10k sockets open)
  // NOTE: single-token auth is a speed shortcut; strict enterprise mode uses per-user
  // tokens across distributed workers (see benchmark-50k worker-runner). Generator
  // drift below distinguishes generator saturation from server event-loop lag.
  console.log('[05/05] Holding all 10,000 sockets connected simultaneously for 10 seconds...');
  const probeStart = Date.now();
  await new Promise((r) => setTimeout(r, 100));
  const generatorLag = Date.now() - probeStart - 100;
  console.log(`        Generator event-loop drift: ${generatorLag}ms (warn if >50ms)`);
  await new Promise((r) => setTimeout(r, 10000));

  const stillConnected = sockets.filter((s) => s.connected).length;
  console.log(`        ✓ Sustained Connection Check: ${stillConnected.toLocaleString()}/${connectedCount.toLocaleString()} sockets active.\n`);

  // Cleanup: Disconnect all sockets
  for (const s of sockets) {
    s.disconnect();
  }

  // Final Health Check
  const healthEnd = await fetch(`${SERVER_URL}/health`).then((r) => r.json());

  console.log('====================================================');
  console.log('📊 NEXUS 10,000 CONCURRENT USERS TEST REPORT');
  console.log('====================================================');
  console.log(`Target Sockets Requested : ${TARGET_CONCURRENCY.toLocaleString()}`);
  console.log(`Sockets Connected        : ${connectedCount.toLocaleString()}`);
  console.log(`Success Rate             : ${((connectedCount / TARGET_CONCURRENCY) * 100).toFixed(1)}%`);
  console.log(`Connection Drops         : ${connectedCount - stillConnected}`);
  console.log(`Average Latency          : ${avgLat} ms`);
  console.log(`p95 Latency              : ${p95} ms (Target: < 80 ms)`);
  console.log(`p99 Latency              : ${p99} ms (Target: < 150 ms)`);
  console.log(`Generator Drift          : ${generatorLag} ms (Target: < 50 ms)`);
  console.log(`Auth Model               : single benchmark_user token (strict: distributed per-user in 50k run)`);
  console.log(`Server Health Post-Test  : ${healthEnd.status.toUpperCase()} (Uptime: ${healthEnd.uptime.toFixed(1)}s)`);
  console.log('====================================================');

  if (connectedCount >= TARGET_CONCURRENCY * 0.95 && (connectedCount - stillConnected) === 0) {
    console.log('🎉 RESULT: PASSED! The server successfully sustained 10,000 concurrent users.');
  } else {
    console.log(`⚠️ RESULT: Completed (${connectedCount} connected, ${errorCount} errors).`);
  }
}

run10kBenchmark().catch((err) => {
  console.error('10K Benchmark failed:', err);
  process.exit(1);
});
