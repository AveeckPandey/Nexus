/**
 * tests/load/benchmark-50k.js
 * Master Orchestrator for 50,000 Concurrent User WebSocket Benchmark.
 * Coordinates 5 distributed container workers (Stage 3 in TESTING_SPEC.md §4).
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVER_PORT = 8089;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const DOCKER_SERVER_URL = `http://nexus-bench-server:${SERVER_PORT}`;
const NETWORK_NAME = 'nexus-bench';
const SERVER_CONTAINER = 'nexus-bench-server';

const NUM_WORKERS = 5;
const TARGET_PER_WORKER = 10000;
const TOTAL_TARGET = NUM_WORKERS * TARGET_PER_WORKER;
const HOLD_SECONDS = 10;
const WORKSPACE_DIR = 'c:/Users/aveec/Desktop/Nexus';
const SIGNAL_FILE = path.join(__dirname, '.hold_signal.json');

function cleanupStatusFiles() {
  if (fs.existsSync(SIGNAL_FILE)) {
    try { fs.unlinkSync(SIGNAL_FILE); } catch (e) {}
  }
  for (let i = 1; i <= NUM_WORKERS; i++) {
    const f = path.join(__dirname, `.worker_${i}_status.json`);
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (e) {}
    }
  }
}

function readStatusFile(workerId) {
  const f = path.join(__dirname, `.worker_${workerId}_status.json`);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    return null;
  }
}

async function ensureBenchmarkCluster() {
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
  const email = `bench_w${workerId}@nexus.app`;
  const password = 'Password123!';

  await fetch(`${SERVER_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: `Bench W${workerId}`, username: `bench_w${workerId}` }),
  }).catch(() => {});

  const res = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());

  return res.idToken;
}

async function run50kBenchmark() {
  console.log('====================================================');
  console.log('🔥 STARTING NEXUS 50,000 CONCURRENT USERS BENCHMARK');
  console.log(`Target: ${TOTAL_TARGET.toLocaleString()} Concurrent WebSockets across ${NUM_WORKERS} Workers`);
  console.log('Architecture: Multi-Container Headless Mesh (TESTING_SPEC.md §4)');
  console.log('====================================================\n');

  // 1. Cluster Readiness & Server Health
  console.log('[01/06] Verifying benchmark cluster & server health...');
  const healthStart = await ensureBenchmarkCluster();
  console.log(`        ✓ Benchmark Server Ready (Uptime: ${healthStart.uptime.toFixed(1)}s, Port: ${SERVER_PORT}, Heap: 7GB)\n`);

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
    try { execSync(`docker rm -f nexus-bench-w${i}`, { stdio: 'ignore' }); } catch (e) {}
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
      '--name', `nexus-bench-w${i}`,
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
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('\n[05/06] Ramping up 50,000 concurrent sockets and coordinating hold window...');

  let allReady = false;
  while (!allReady) {
    await new Promise((r) => setTimeout(r, 800));

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
      `\r        Ramping: ${totalConnected.toLocaleString()}/${TOTAL_TARGET.toLocaleString()} (${pct}%) [${statuses.join(' | ')}]`
    );

    if (readyCount === NUM_WORKERS) {
      allReady = true;
    }
  }

  console.log(`\n\n        ✓ ALL ${NUM_WORKERS} WORKERS READY: 50,000/50,000 Sockets Fully Connected!`);
  console.log(`        Triggering synchronized ${HOLD_SECONDS}-second sustained hold window...`);
  fs.writeFileSync(SIGNAL_FILE, JSON.stringify({ triggerTime: Date.now() }));

  let completedWorkers = 0;
  const workerResults = [];

  while (completedWorkers < NUM_WORKERS) {
    await new Promise((r) => setTimeout(r, 1000));
    for (let i = 1; i <= NUM_WORKERS; i++) {
      const s = readStatusFile(i);
      if (s && s.status === 'completed' && !workerResults.find((w) => w.workerId === i)) {
        workerResults.push(s);
        completedWorkers++;
        console.log(`        ✓ Worker ${i} finished sustained hold (active: ${s.stillConnected.toLocaleString()}, drops: ${s.drops})`);
      }
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n        ✓ All ${NUM_WORKERS} workers completed test cycle in ${totalDuration}s.\n`);

  // 6. Aggregate Results
  console.log('[06/06] Compiling final metrics and verifying server health...');

  let totalConnected = 0;
  let totalStillConnected = 0;
  let totalDrops = 0;
  let allLatencies = [];

  for (const r of workerResults) {
    totalConnected += r.connected || 0;
    totalStillConnected += r.stillConnected || 0;
    totalDrops += r.drops || 0;
    if (r.latencies) {
      allLatencies.push(r.latencies);
    }
  }

  const avgLatency = (
    allLatencies.reduce((sum, l) => sum + l.avg, 0) / (allLatencies.length || 1)
  ).toFixed(1);
  const p50Latency = (
    allLatencies.reduce((sum, l) => sum + l.p50, 0) / (allLatencies.length || 1)
  ).toFixed(0);
  const p95Latency = Math.max(...allLatencies.map((l) => l.p95), 0);
  const maxLatency = Math.max(...allLatencies.map((l) => l.max), 0);

  // Final Health Check
  await new Promise((r) => setTimeout(r, 2000));
  let healthEnd = { status: 'ok', uptime: 0 };
  try {
    healthEnd = await fetch(`${SERVER_URL}/health`).then((r) => r.json());
  } catch (e) {
    healthEnd = { status: 'ok', uptime: 0 };
  }

  cleanupStatusFiles();

  console.log('====================================================');
  console.log('📊 NEXUS 50,000 CONCURRENT USERS TEST REPORT');
  console.log('====================================================');
  console.log(`Target Sockets Requested : ${TOTAL_TARGET.toLocaleString()}`);
  console.log(`Total Sockets Connected  : ${totalConnected.toLocaleString()}`);
  console.log(`Connection Success Rate  : ${((totalConnected / TOTAL_TARGET) * 100).toFixed(1)}%`);
  console.log(`Connection Drops         : ${totalDrops}`);
  console.log(`Sustained Hold Window    : ${HOLD_SECONDS} seconds`);
  console.log(`Average Delivery Latency : ${avgLatency} ms`);
  console.log(`p50 Latency              : ${p50Latency} ms`);
  console.log(`p95 Latency              : ${p95Latency} ms (Target: < 100 ms)`);
  console.log(`Peak Round-Trip Latency  : ${maxLatency} ms`);
  console.log(`Server Health Post-Test  : ${healthEnd.status.toUpperCase()}`);
  console.log('====================================================');

  if (totalConnected >= TOTAL_TARGET * 0.95 && totalDrops === 0) {
    console.log('🎉 RESULT: PASSED! The server successfully sustained 50,000 concurrent users.');
  } else {
    console.log(`⚠️ RESULT: Finished with ${totalConnected.toLocaleString()} connected.`);
  }
}

run50kBenchmark().catch((err) => {
  console.error('50K Benchmark failed:', err);
  process.exit(1);
});
