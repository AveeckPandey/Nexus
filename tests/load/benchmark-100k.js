/**
 * tests/load/benchmark-100k.js
 * Master Orchestrator for 100,000 Concurrent User WebSocket Benchmark.
 * Coordinates 10 distributed container workers (Stage 4 in TESTING_SPEC.md §4).
 *
 * Architecture:
 * - 3 Server Pods (~33,334 WebSockets per pod target) behind an ALB/Service.
 * - 10 Distributed Load Worker Containers (10,000 WebSockets each) on private bridge network.
 * - Real-time hold window coordination and end-to-end ACK RTT latency measurement.
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVER_PORT = parseInt(process.env.PORT || '8089', 10);
const SERVER_URL = process.env.SERVER_URL || `http://127.0.0.1:${SERVER_PORT}`;
const DOCKER_SERVER_URL = process.env.DOCKER_SERVER_URL || `http://nexus-bench-server:${SERVER_PORT}`;
const NETWORK_NAME = 'nexus-bench-100k';
const SERVER_CONTAINER = 'nexus-bench-server';

const NUM_WORKERS = parseInt(process.env.NUM_WORKERS || '10', 10);
const TARGET_PER_WORKER = parseInt(process.env.TARGET_PER_WORKER || '10000', 10);
const TOTAL_TARGET = NUM_WORKERS * TARGET_PER_WORKER;
const HOLD_SECONDS = parseInt(process.env.HOLD_SECONDS || '15', 10);
const WORKSPACE_DIR = path.resolve(__dirname, '../..').replace(/\\/g, '/');
const SIGNAL_FILE = path.join(__dirname, '.hold_signal_100k.json');

function cleanupStatusFiles() {
  if (fs.existsSync(SIGNAL_FILE)) {
    try { fs.unlinkSync(SIGNAL_FILE); } catch (e) {}
  }
  for (let i = 1; i <= NUM_WORKERS; i++) {
    const f = path.join(__dirname, `.worker_100k_${i}_status.json`);
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (e) {}
    }
  }
}

function readStatusFile(workerId) {
  const f = path.join(__dirname, `.worker_100k_${workerId}_status.json`);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    return null;
  }
}

async function ensureBenchmarkCluster() {
  // If external cluster URL is provided, verify it directly
  if (process.env.SERVER_URL) {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const res = await fetch(`${SERVER_URL}/health`);
        if (res.ok) return await res.json();
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Target server at ${SERVER_URL} failed to respond to /health.`);
  }

  // Local Docker benchmark cluster setup
  try {
    execSync(`docker network inspect ${NETWORK_NAME}`, { stdio: 'ignore' });
  } catch (e) {
    execSync(`docker network create ${NETWORK_NAME}`, { stdio: 'ignore' });
  }

  let serverRunning = false;
  try {
    const res = execSync(`docker inspect -f "{{.State.Running}}" ${SERVER_CONTAINER}`, { encoding: 'utf8' }).trim();
    serverRunning = res === 'true';
  } catch (e) {}

  if (!serverRunning) {
    try { execSync(`docker rm -f ${SERVER_CONTAINER}`, { stdio: 'ignore' }); } catch (e) {}
    execSync(
      `docker run -d --name ${SERVER_CONTAINER} --network ${NETWORK_NAME} ` +
      `-v "${WORKSPACE_DIR}/server:/app" -w /app ` +
      `-e PORT=${SERVER_PORT} -e SESSION_JWT_SECRET=nexus_local_dev_session_jwt_secret_32plus_chars ` +
      `-e ALLOW_BENCHMARK_AUTH=true ` +
      `-e NODE_ENV=development --ulimit nofile=1048576:1048576 ` +
      `-p ${SERVER_PORT}:${SERVER_PORT} node:20-alpine ` +
      `node --max-old-space-size=7168 dist/main`,
      { stdio: 'ignore' }
    );
  }

  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(`${SERVER_URL}/health`);
      if (res.ok) return await res.json();
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Benchmark server container failed to become healthy within 30s.');
}

async function getWorkerToken(workerId) {
  const email = `bench_100k_w${workerId}@nexus.app`;
  const password = 'Password123!';

  await fetch(`${SERVER_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: `Bench 100k W${workerId}`, username: `bench_100k_w${workerId}` }),
  }).catch(() => {});

  const res = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());

  return res.idToken;
}

async function run100kBenchmark() {
  console.log('================================================================');
  console.log('🔥 STARTING NEXUS 100,000 CONCURRENT USERS BENCHMARK');
  console.log(`Target: ${TOTAL_TARGET.toLocaleString()} Concurrent WebSockets across ${NUM_WORKERS} Workers`);
  console.log('Fleet Target: 3 Pods × ~33,334 WebSockets/Pod (TESTING_SPEC.md §4 Stage 4)');
  console.log('================================================================\n');

  // 1. Cluster Readiness & Server Health
  console.log('[01/06] Verifying benchmark fleet & server health...');
  const healthStart = await ensureBenchmarkCluster();
  console.log(`        ✓ Fleet Server Ready (Uptime: ${healthStart.uptime.toFixed(1)}s, Port: ${SERVER_PORT})\n`);

  // 2. Multi-Worker Authentication
  console.log('[02/06] Authenticating isolated benchmark accounts per worker node...');
  const tokens = [];
  for (let i = 1; i <= NUM_WORKERS; i++) {
    const t = await getWorkerToken(i);
    if (!t) throw new Error(`Failed to acquire token for worker ${i}`);
    tokens.push(t);
  }
  console.log(`        ✓ Generated ${tokens.length} isolated cryptographic tokens.\n`);

  // 3. Clean environment
  console.log('[03/06] Preparing clean execution environment...');
  cleanupStatusFiles();
  for (let i = 1; i <= NUM_WORKERS; i++) {
    try { execSync(`docker rm -f nexus-bench-100k-w${i}`, { stdio: 'ignore' }); } catch (e) {}
  }
  console.log(`        ✓ Cleaned previous state for ${NUM_WORKERS} worker nodes.\n`);

  // 4. Launch Workers
  console.log(`[04/06] Launching ${NUM_WORKERS} containerized workers (${TARGET_PER_WORKER.toLocaleString()} sockets each)...`);
  const workerProcesses = [];
  const startTime = Date.now();

  for (let i = 1; i <= NUM_WORKERS; i++) {
    const args = [
      'run',
      '--rm',
      '--name', `nexus-bench-100k-w${i}`,
      '--network', NETWORK_NAME,
      '-v', `${WORKSPACE_DIR}:/app`,
      '-w', '/app',
      '--ulimit', 'nofile=1048576:1048576',
      'node:20-alpine',
      'node',
      '--max-old-space-size=2048',
      'tests/load/worker-runner.js',
      String(i),
      String(TARGET_PER_WORKER),
      DOCKER_SERVER_URL,
      tokens[i - 1],
      String(HOLD_SECONDS),
    ];

    const child = spawn('docker', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.error(`        [Worker ${i} stderr]:`, msg);
    });

    workerProcesses.push(child);
    console.log(`        → Worker ${i}/${NUM_WORKERS} launched`);
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log('\n[05/06] Ramping up 100,000 concurrent sockets and coordinating hold window...');

  let allReady = false;
  while (!allReady) {
    await new Promise((r) => setTimeout(r, 1000));

    let totalConnected = 0;
    let readyCount = 0;
    const statuses = [];

    for (let i = 1; i <= NUM_WORKERS; i++) {
      const s = readStatusFile(i);
      if (s) {
        totalConnected += s.connected || 0;
        if (s.status === 'ready' || s.status === 'sustaining' || s.status === 'completed') {
          readyCount++;
          statuses.push(`W${i}: READY (${(s.connected || 0).toLocaleString()})`);
        } else {
          statuses.push(`W${i}: ${(s.connected || 0).toLocaleString()}`);
        }
      } else {
        statuses.push(`W${i}: init`);
      }
    }

    const pct = ((totalConnected / TOTAL_TARGET) * 100).toFixed(1);
    process.stdout.write(
      `\r        Ramping: ${totalConnected.toLocaleString()}/${TOTAL_TARGET.toLocaleString()} (${pct}%) [${statuses.slice(0, 5).join(' | ')}...]`
    );

    if (readyCount === NUM_WORKERS) {
      allReady = true;
    }
  }

  const rampDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n\n        ✓ All ${NUM_WORKERS} Workers READY! Total ${TOTAL_TARGET.toLocaleString()} sockets connected in ${rampDuration}s`);

  // 5. Trigger synchronized hold
  console.log(`\n[06/06] Triggering synchronized ${HOLD_SECONDS}s hold window across all workers...`);
  fs.writeFileSync(SIGNAL_FILE, JSON.stringify({ signal: 'HOLD_NOW', timestamp: Date.now() }));

  let allCompleted = false;
  while (!allCompleted) {
    await new Promise((r) => setTimeout(r, 1000));
    let done = 0;
    for (let i = 1; i <= NUM_WORKERS; i++) {
      const s = readStatusFile(i);
      if (s && s.status === 'completed') done++;
    }
    if (done === NUM_WORKERS) allCompleted = true;
  }

  // 6. Aggregate results
  console.log('\n================================================================');
  console.log('🏆 100,000 CONCURRENT USERS BENCHMARK RESULTS');
  console.log('================================================================');

  let totalConnected = 0;
  let totalErrors = 0;
  const latencies = [];

  for (let i = 1; i <= NUM_WORKERS; i++) {
    const s = readStatusFile(i) || {};
    totalConnected += s.connected || 0;
    totalErrors += s.errors || 0;
    if (Array.isArray(s.latencies)) latencies.push(...s.latencies);
    console.log(`Worker ${String(i).padStart(2, ' ')}: ${(s.connected || 0).toLocaleString()} connected | errors: ${s.errors || 0} | rtt p95: ${s.p95 || 'N/A'}ms`);
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.50)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

  console.log('----------------------------------------------------------------');
  console.log(`Total Connected Sockets : ${totalConnected.toLocaleString()} / ${TOTAL_TARGET.toLocaleString()}`);
  console.log(`Connection Success Rate : ${((totalConnected / TOTAL_TARGET) * 100).toFixed(2)}%`);
  console.log(`Total Dropped / Errors  : ${totalErrors}`);
  console.log(`Ramp-Up Duration        : ${rampDuration}s`);
  console.log(`Message ACK Latency p50 : ${p50} ms`);
  console.log(`Message ACK Latency p95 : ${p95} ms (Target: < 150 ms)`);
  console.log(`Message ACK Latency p99 : ${p99} ms (Target: < 250 ms)`);
  console.log('================================================================\n');

  cleanupStatusFiles();

  if (totalConnected >= TOTAL_TARGET && totalErrors === 0) {
    console.log('🎉 100,000 CONCURRENCY CERTIFICATION: PASSED (100% SUCCESS)');
    process.exit(0);
  } else {
    console.warn('⚠️ 100,000 CONCURRENCY CERTIFICATION: COMPLETED WITH DROPS');
    process.exit(1);
  }
}

run100kBenchmark().catch((err) => {
  console.error('Benchmark 100k Fatal Error:', err);
  cleanupStatusFiles();
  process.exit(1);
});
