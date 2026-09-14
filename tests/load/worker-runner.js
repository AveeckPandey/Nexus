/**
 * tests/load/worker-runner.js
 * Distributed worker script executed inside Docker containers.
 * Connects a designated quota of concurrent WebSockets to the Nexus server.
 */

const fs = require('fs');
const path = require('path');
const { io } = require('/app/web/node_modules/socket.io-client');

const WORKER_ID = parseInt(process.argv[2] || process.env.WORKER_ID || '1', 10);
const TARGET_SOCKETS = parseInt(process.argv[3] || process.env.TARGET_SOCKETS || '10000', 10);
const SERVER_URL = process.argv[4] || process.env.SERVER_URL || 'http://nexus-bench-server:8089';
const TOKEN = process.argv[5] || process.env.AUTH_TOKEN || '';
const HOLD_SECONDS = parseInt(process.argv[6] || process.env.HOLD_SECONDS || '10', 10);

const STATUS_FILE = path.join(__dirname, `.worker_${WORKER_ID}_status.json`);
const SIGNAL_FILE = path.join(__dirname, `.hold_signal.json`);

function updateStatus(data) {
  try {
    fs.writeFileSync(
      STATUS_FILE,
      JSON.stringify({ workerId: WORKER_ID, timestamp: Date.now(), ...data }, null, 2)
    );
  } catch (err) {}
}

async function runWorker() {
  console.log(`[Worker ${WORKER_ID}] Initializing: target=${TARGET_SOCKETS}, server=${SERVER_URL}`);
  updateStatus({ status: 'connecting', connected: 0, target: TARGET_SOCKETS, errors: 0 });

  const BATCH_SIZE = 100;
  const BATCH_INTERVAL_MS = 40;
  const sockets = [];
  let connectedCount = 0;
  let errorCount = 0;

  const connectStartTime = Date.now();

  for (let i = 0; i < TARGET_SOCKETS; i += BATCH_SIZE) {
    const batchPromises = [];
    const count = Math.min(BATCH_SIZE, TARGET_SOCKETS - i);

    for (let j = 0; j < count; j++) {
      const p = new Promise((resolve) => {
        const socket = io(SERVER_URL, {
          transports: ['websocket'],
          auth: { token: TOKEN },
          reconnection: false,
          timeout: 45000,
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

    if (i % 500 === 0 || i + count >= TARGET_SOCKETS) {
      updateStatus({
        status: 'connecting',
        connected: connectedCount,
        target: TARGET_SOCKETS,
        errors: errorCount,
      });
    }

    await new Promise((r) => setTimeout(r, BATCH_INTERVAL_MS));
  }

  const connectDuration = ((Date.now() - connectStartTime) / 1000).toFixed(2);
  console.log(`[Worker ${WORKER_ID}] All ${connectedCount}/${TARGET_SOCKETS} connected in ${connectDuration}s (errors: ${errorCount})`);

  // Create one real conversation for this worker so latency measures actual
  // DB write + Redis fan-out (not a fake room that returns Forbidden).
  let benchConvId = `bench-room-w${WORKER_ID}`;
  try {
    const convRes = await fetch(`${SERVER_URL}/api/chat/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ type: 'group', title: `Bench W${WORKER_ID}`, participantIds: [] }),
    }).then((r) => r.json());
    if (convRes?.conversation?.id) benchConvId = convRes.conversation.id;
    console.log(`[Worker ${WORKER_ID}] Bench conversation: ${benchConvId}`);
  } catch (e) {
    console.log(`[Worker ${WORKER_ID}] Conv create failed, using ${benchConvId}: ${e.message}`);
  }

  // Signal ready and wait for master to trigger synchronized hold window
  updateStatus({
    status: 'ready',
    connected: connectedCount,
    target: TARGET_SOCKETS,
    errors: errorCount,
    connectDuration: parseFloat(connectDuration),
  });

  console.log(`[Worker ${WORKER_ID}] Ready and awaiting synchronized hold signal...`);
  const signalWaitStart = Date.now();
  while (!fs.existsSync(SIGNAL_FILE)) {
    await new Promise((r) => setTimeout(r, 200));
    if (Date.now() - signalWaitStart > 90000) break;
  }

  // Sample message round-trip & Redis fan-out latency across sockets under full load
  console.log(`[Worker ${WORKER_ID}] Synchronized hold active. Sampling fan-out round-trip latency...`);
  const latencies = [];
  const sampleSize = Math.min(100, sockets.length);
  const sampleSockets = sockets.slice(0, sampleSize);

  // Join the real room first so send_message passes MemberGuard.
  await Promise.all(
    sampleSockets.map(
      (s) =>
        new Promise((resolve) => {
          s.emit('join_room', { conversationId: benchConvId }, () => resolve());
          setTimeout(resolve, 2000);
        }),
    ),
  );

  for (let idx = 0; idx < sampleSockets.length; idx++) {
    const s = sampleSockets[idx];
    if (!s.connected) continue;
    const t0 = Date.now();
    await new Promise((resolve) => {
      let resolved = false;
      s.emit(
        'send_message',
        {
          conversationId: benchConvId,
          content: 'bench_sample_' + Math.random(),
          isEncrypted: true,
          nonce: 'nonce_' + Date.now(),
          encVersion: 1,
        },
        () => {
          if (!resolved) {
            resolved = true;
            latencies.push(Date.now() - t0);
            resolve();
          }
        }
      );
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 3000);
    });
  }

  latencies.sort((a, b) => a - b);
  const avgLat = parseFloat(
    (latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)).toFixed(1)
  );
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const maxLat = latencies[latencies.length - 1] || 0;

  console.log(
    `[Worker ${WORKER_ID}] Latency results: avg=${avgLat}ms, p50=${p50}ms, p95=${p95}ms, max=${maxLat}ms`
  );

  updateStatus({
    status: 'sustaining',
    connected: connectedCount,
    target: TARGET_SOCKETS,
    errors: errorCount,
    latencies: { avg: avgLat, p50, p95, max: maxLat, samples: latencies.length },
  });

  // Hold connections open for sustained window
  console.log(`[Worker ${WORKER_ID}] Holding ${connectedCount} sockets for ${HOLD_SECONDS}s...`);
  await new Promise((r) => setTimeout(r, HOLD_SECONDS * 1000));

  const stillConnected = sockets.filter((s) => s.connected).length;
  const drops = connectedCount - stillConnected;
  console.log(`[Worker ${WORKER_ID}] Sustained hold complete. Active: ${stillConnected}/${connectedCount} (drops: ${drops})`);

  updateStatus({
    status: 'completed',
    connected: connectedCount,
    stillConnected,
    drops,
    target: TARGET_SOCKETS,
    errors: errorCount,
    latencies: { avg: avgLat, p50, p95, max: maxLat, samples: latencies.length },
    connectDuration: parseFloat(connectDuration),
  });

  console.log(`[Worker ${WORKER_ID}] Disconnecting sockets...`);
  for (const s of sockets) {
    s.disconnect();
  }

  console.log(`[Worker ${WORKER_ID}] Finished cleanly.`);
}

runWorker().catch((err) => {
  console.error(`[Worker ${WORKER_ID}] Fatal error:`, err);
  updateStatus({ status: 'error', error: err.message });
  process.exit(1);
});
