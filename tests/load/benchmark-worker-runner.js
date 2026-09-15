/**
 * tests/load/benchmark-worker-runner.js
 * Child worker process for distributed WebSocket load generation.
 */

let io;
try {
  io = require('socket.io-client').io || require('socket.io-client');
} catch {
  try {
    io = require('../../web/node_modules/socket.io-client').io || require('../../web/node_modules/socket.io-client');
  } catch {
    io = require('../../../web/node_modules/socket.io-client').io || require('../../../web/node_modules/socket.io-client');
  }
}

const TARGET_URL = process.argv[2] || 'https://nexus.buildwithaveeck.com';
const TARGET_COUNT = parseInt(process.argv[3] || '12500', 10);
const WORKER_ID = parseInt(process.argv[4] || '1', 10);

const BATCH_SIZE = 100;
const BATCH_INTERVAL_MS = 60;

const sockets = [];
let dropsCount = 0;

async function rampSockets() {
  const token = `bench_w${WORKER_ID}_token`;

  for (let i = 0; i < TARGET_COUNT; i += BATCH_SIZE) {
    const batchPromises = [];
    const currentBatch = Math.min(BATCH_SIZE, TARGET_COUNT - i);

    for (let j = 0; j < currentBatch; j++) {
      const p = new Promise((resolve) => {
        let settled = false;
        const safetyTimer = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        }, 8000);

        const socket = io(TARGET_URL, {
          transports: ['websocket'],
          auth: {
            token,
            isBenchmark: true,
            userId: `bench_w${WORKER_ID}_${sockets.length + 1}`,
          },
          reconnection: false,
          timeout: 7000,
        });

        socket.on('connect', () => {
          if (!settled) {
            settled = true;
            clearTimeout(safetyTimer);
            sockets.push(socket);

            socket.on('disconnect', () => {
              dropsCount++;
            });

            resolve(true);
          }
        });

        socket.on('connect_error', () => {
          if (!settled) {
            settled = true;
            clearTimeout(safetyTimer);
            resolve(false);
          }
        });
      });
      batchPromises.push(p);
    }

    await Promise.all(batchPromises);

    if (process.send) {
      process.send({ type: 'PROGRESS', workerId: WORKER_ID, connected: sockets.length });
    }

    await new Promise((r) => setTimeout(r, BATCH_INTERVAL_MS));
  }

  if (process.send) {
    process.send({ type: 'RAMP_COMPLETE', workerId: WORKER_ID, connected: sockets.length });
  }
}

process.on('message', async (msg) => {
  if (msg.command === 'MEASURE_LATENCY') {
    const latencies = [];
    const sampleSockets = sockets.slice(0, 50);

    const promises = sampleSockets.map((s) => {
      return new Promise((resolve) => {
        const start = Date.now();
        const timeout = setTimeout(() => resolve(), 2000);

        s.emit('network_ping', {}, () => {
          clearTimeout(timeout);
          latencies.push(Date.now() - start);
          resolve();
        });
      });
    });

    await Promise.all(promises);

    if (process.send) {
      process.send({ type: 'LATENCY_RESULTS', workerId: WORKER_ID, latencies });
    }
  } else if (msg.command === 'START_HOLD') {
    const startDrops = dropsCount;
    await new Promise((r) => setTimeout(r, (msg.durationSec || 10) * 1000));
    const finalDrops = dropsCount - startDrops;

    if (process.send) {
      process.send({ type: 'HOLD_COMPLETE', workerId: WORKER_ID, drops: finalDrops });
    }
  }
});

rampSockets().catch((err) => {
  console.error(`Worker ${WORKER_ID} error:`, err);
  process.exit(1);
});
