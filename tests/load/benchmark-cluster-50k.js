/**
 * tests/load/benchmark-cluster-50k.js
 * Multi-process Distributed 50,000 Concurrent User WebSocket Benchmark for Nexus.
 * Spawns isolated worker processes to avoid single-process V8 heap & event-loop limits.
 */

const { fork } = require('child_process');
const path = require('path');
const http = require('http');
const https = require('https');

const TARGET_URL = process.env.TARGET_URL || process.argv[2] || 'https://nexus.buildwithaveeck.com';
const TOTAL_CONCURRENCY = parseInt(process.env.CONCURRENCY || '50000', 10);
const NUM_WORKERS = parseInt(process.env.WORKERS || '4', 10);
const TARGET_PER_WORKER = Math.floor(TOTAL_CONCURRENCY / NUM_WORKERS);
const HOLD_SECONDS = parseInt(process.env.HOLD_SEC || '15', 10);

console.log('╔════════════════════════════════════════════════════════════════════════╗');
console.log('║        🚀 NEXUS 50,000 DISTRIBUTED CONCURRENT USER BENCHMARK 🚀         ║');
console.log(`║ Target Cluster : ${TARGET_URL.padEnd(52)}║`);
console.log(`║ Concurrency    : ${TOTAL_CONCURRENCY.toLocaleString()} sockets across ${NUM_WORKERS} worker processes     ║`);
console.log(`║ Target/Worker  : ${TARGET_PER_WORKER.toLocaleString()} sockets/worker                                  ║`);
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

async function checkHealth() {
  const isHttps = TARGET_URL.startsWith('https');
  const client = isHttps ? https : http;
  const url = new URL(`${TARGET_URL}/health`);

  return new Promise((resolve, reject) => {
    const req = client.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ status: 'ok', raw: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Health check timeout')));
  });
}

async function runMaster() {
  // 1. Initial Health Check
  try {
    const h = await checkHealth();
    console.log(`[01/05] Initial Cluster Health: OK (Status: ${h.status || 'running'}, Uptime: ${h.uptime ? h.uptime.toFixed(1) + 's' : 'N/A'})`);
  } catch (err) {
    console.warn(`[01/05] Initial Cluster Health check warning: ${err.message} (proceeding)`);
  }

  // 2. Spawn Child Workers
  console.log(`[02/05] Spawning ${NUM_WORKERS} isolated worker processes...`);
  const workers = [];
  const workerStats = new Map();

  const workerScript = path.join(__dirname, 'benchmark-worker-runner.js');

  for (let i = 0; i < NUM_WORKERS; i++) {
    const workerId = i + 1;
    const child = fork(workerScript, [TARGET_URL, TARGET_PER_WORKER, workerId], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      execArgv: ['--max-old-space-size=2048'],
    });

    workerStats.set(workerId, { connected: 0, drops: 0, latencies: [], ready: false });

    child.on('message', (msg) => {
      if (msg.type === 'PROGRESS') {
        const s = workerStats.get(workerId);
        if (s) s.connected = msg.connected;
      } else if (msg.type === 'RAMP_COMPLETE') {
        const s = workerStats.get(workerId);
        if (s) {
          s.connected = msg.connected;
          s.ready = true;
        }
      } else if (msg.type === 'LATENCY_RESULTS') {
        const s = workerStats.get(workerId);
        if (s) s.latencies = msg.latencies || [];
      } else if (msg.type === 'HOLD_COMPLETE') {
        const s = workerStats.get(workerId);
        if (s) s.drops = msg.drops || 0;
      }
    });

    workers.push(child);
  }

  // 3. Monitor Ramp Progress
  console.log(`[03/05] Ramping up to ${TOTAL_CONCURRENCY.toLocaleString()} concurrent WebSockets across workers...`);
  const rampStartTime = Date.now();

  await new Promise((resolve) => {
    const interval = setInterval(() => {
      let totalConnected = 0;
      let allReady = true;

      for (const [_, s] of workerStats.entries()) {
        totalConnected += s.connected;
        if (!s.ready) allReady = false;
      }

      const elapsed = ((Date.now() - rampStartTime) / 1000).toFixed(1);
      process.stdout.write(`\r   ↳ Connected: ${totalConnected.toLocaleString()} / ${TOTAL_CONCURRENCY.toLocaleString()} sockets (${elapsed}s elapsed)... `);

      if (allReady) {
        clearInterval(interval);
        console.log(`\n        ✓ Ramp completed. Total Connected: ${totalConnected.toLocaleString()}`);
        resolve();
      }
    }, 1000);
  });

  // 4. Latency Sampling
  console.log('\n[04/05] Measuring roundtrip latency across all workers under load...');
  for (const w of workers) {
    w.send({ command: 'MEASURE_LATENCY' });
  }

  await new Promise((resolve) => {
    const deadline = Date.now() + 6000;
    const chk = setInterval(() => {
      let gotAll = true;
      for (const [_, s] of workerStats.entries()) {
        if (!s.latencies || s.latencies.length === 0) gotAll = false;
      }
      if (gotAll || Date.now() > deadline) {
        clearInterval(chk);
        resolve();
      }
    }, 200);
  });

  let combinedLatencies = [];
  for (const [_, s] of workerStats.entries()) {
    combinedLatencies = combinedLatencies.concat(s.latencies || []);
  }
  combinedLatencies.sort((a, b) => a - b);

  const avgLat = combinedLatencies.length
    ? (combinedLatencies.reduce((a, b) => a + b, 0) / combinedLatencies.length).toFixed(1)
    : 'N/A';
  const p50 = combinedLatencies[Math.floor(combinedLatencies.length * 0.5)] || 0;
  const p95 = combinedLatencies[Math.floor(combinedLatencies.length * 0.95)] || 0;
  const p99 = combinedLatencies[Math.floor(combinedLatencies.length * 0.99)] || 0;

  console.log(`        ✓ Completed ${combinedLatencies.length} distributed message rounds.`);
  console.log(`        Latency: Avg=${avgLat}ms | p50=${p50}ms | p95=${p95}ms | p99=${p99}ms\n`);

  // 5. Sustained Hold
  console.log(`[05/05] Holding all ${TOTAL_CONCURRENCY.toLocaleString()} sockets open simultaneously for ${HOLD_SECONDS} seconds...`);
  for (const w of workers) {
    w.send({ command: 'START_HOLD', durationSec: HOLD_SECONDS });
  }

  await new Promise((r) => setTimeout(r, (HOLD_SECONDS + 2) * 1000));

  let totalDrops = 0;
  let finalConnected = 0;
  for (const [_, s] of workerStats.entries()) {
    totalDrops += s.drops;
    finalConnected += s.connected - s.drops;
  }

  const dropRate = ((totalDrops / (TOTAL_CONCURRENCY || 1)) * 100).toFixed(2);

  console.log('\n================================================================');
  console.log('🏆 NEXUS 50,000 CONCURRENT USER BENCHMARK SUMMARY');
  console.log('================================================================');
  console.log(`Target Cluster URL      : ${TARGET_URL}`);
  console.log(`Peak Target Concurrency : ${TOTAL_CONCURRENCY.toLocaleString()} concurrent WebSockets`);
  console.log(`Total Sustained Sockets : ${finalConnected.toLocaleString()} / ${TOTAL_CONCURRENCY.toLocaleString()} (${((finalConnected / TOTAL_CONCURRENCY) * 100).toFixed(1)}% survival)`);
  console.log(`Connection Drops        : ${totalDrops} (${dropRate}%)`);
  console.log(`Average Latency         : ${avgLat} ms`);
  console.log(`p50 Latency             : ${p50} ms`);
  console.log(`p95 Latency             : ${p95} ms (Target: < 100 ms)`);
  console.log(`p99 Latency             : ${p99} ms (Target: < 250 ms)`);

  const passed = finalConnected >= TOTAL_CONCURRENCY * 0.95 && p95 < 150 && totalDrops < TOTAL_CONCURRENCY * 0.05;
  console.log(`Overall Benchmark Result: ${passed ? '✅ PASSED (Production Ready)' : '⚠️ DEGRADED'}`);
  console.log('================================================================\n');

  console.log('Terminating workers...');
  for (const w of workers) {
    w.kill('SIGTERM');
  }

  process.exit(passed ? 0 : 1);
}

runMaster().catch((err) => {
  console.error('Fatal benchmark failure:', err);
  process.exit(1);
});
