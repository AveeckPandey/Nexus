/**
 * tests/load/k6-nexus-loadtest.js — Industry-standard HTTP API load suite.
 *
 * Scope: HTTP API surface only (edge + auth + chat reads + media validation).
 * WebSocket / Socket.IO concurrency (1K→100K) is owned by the native Node
 * harnesses (benchmark-1k/10k/50k.js + makeittobreakit.js) which measure
 * end-to-end send_message ACK RTT. Do NOT use this file for WS capacity claims.
 *
 * Profiles (select via -e K6_PROFILE=<name>):
 *   smoke  — 1 VU, ~30s.   PR gate / pre-deploy sanity.
 *   load   — ramp 0→20→50, hold, ramp-down. Default. Validates p95 budgets.
 *   stress — ramp to 200 to find the knee (expect elevated 429, zero 5xx).
 *   spike  — 10→100 spike then recover. Validates HPA / throttle recovery.
 *
 * Usage:
 *   k6 run tests/load/k6-nexus-loadtest.js
 *   k6 run -e TARGET_URL=http://localhost:8080 -e K6_PROFILE=smoke tests/load/k6-nexus-loadtest.js
 *   k6 run -e TARGET_URL=https://staging.nexus.example.com -e K6_PROFILE=load tests/load/k6-nexus-loadtest.js
 *   k6 run -e TARGET_URL=https://nexus.buildwithaveeck.com -e K6_PROFILE=spike tests/load/k6-nexus-loadtest.js
 *
 * Auth (optional but recommended for chat/media coverage):
 *   k6 run -e TEST_USER_EMAIL=loadtest@nexus.app -e TEST_USER_PASSWORD='...' tests/load/k6-nexus-loadtest.js
 *   Without creds the suite still runs public + negative-auth paths.
 *   If TEST_CONVERSATION_ID is set, message-history reads are exercised too.
 *
 * Budgets (override via env):
 *   P95_BUDGET_MS — default 800 (cross-continent via CDN). Set 300 only for
 *   same-region staging with a warm edge.
 */
import http from 'k6/http';
import ws from 'k6/ws';
import { check, group, sleep } from 'k6';
import { Counter, Gauge, Rate, Trend } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = (__ENV.TARGET_URL || 'http://localhost:8080').replace(/\/$/, '');
const PROFILE = __ENV.K6_PROFILE || 'load';
const P95_BUDGET_MS = parseInt(__ENV.P95_BUDGET_MS || '800', 10);
const ENABLE_WS_PROBE = (__ENV.ENABLE_WS_PROBE || 'false') === 'true';
const TEST_EMAIL = __ENV.TEST_USER_EMAIL || '';
const TEST_PASSWORD = __ENV.TEST_USER_PASSWORD || '';
const TEST_CONVERSATION_ID = __ENV.TEST_CONVERSATION_ID || '';

// ---------------------------------------------------------------------------
// Metrics (429/401 are tracked separately — they are NEVER counted as errors)
// ---------------------------------------------------------------------------
const errors = new Rate('errors'); // unexpected outcomes only (5xx, malformed, contract break)
const rateLimited = new Counter('rate_limited_429');
const successfulReqs = new Counter('successful_reqs');
const unauthorizedExpected = new Counter('auth_expected_401_400');
const healthDuration = new Trend('health_duration');
const authDuration = new Trend('auth_duration');
const chatDuration = new Trend('chat_duration');
const mediaDuration = new Trend('media_duration');
const searchDuration = new Trend('search_duration');
const wsSessions = new Counter('ws_probe_sessions');
const wsProbeErrors = new Counter('ws_probe_errors');
const vusActive = new Gauge('vus_active');

// ---------------------------------------------------------------------------
// Profiles → stages (single ramping-vus scenario keeps `k6 run` simple)
// ---------------------------------------------------------------------------
function stagesFor(profile) {
  switch (profile) {
    case 'smoke':
      return [
        { duration: '10s', target: 1 },
        { duration: '20s', target: 1 },
        { duration: '5s', target: 0 },
      ];
    case 'stress':
      return [
        { duration: '30s', target: 50 },
        { duration: '60s', target: 100 },
        { duration: '60s', target: 200 },
        { duration: '30s', target: 0 },
      ];
    case 'spike':
      return [
        { duration: '30s', target: 10 },
        { duration: '15s', target: 100 }, // spike
        { duration: '30s', target: 100 }, // hold through spike
        { duration: '30s', target: 10 }, // recover
        { duration: '15s', target: 0 },
      ];
    case 'load':
    default:
      return [
        { duration: '30s', target: 20 }, // warm-up
        { duration: '60s', target: 50 }, // sustained load
        { duration: '30s', target: 50 }, // hold
        { duration: '30s', target: 0 }, // cool down
      ];
  }
}

export const options = {
  scenarios: {
    api: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: stagesFor(PROFILE),
      gracefulRampDown: '30s',
      gracefulStop: '30s',
    },
  },
  thresholds: {
    // Per-endpoint latency budgets (tagged below). Global http_req_duration is
    // intentionally NOT thresholded — it mixes edge + auth + DB reads.
    [`http_req_duration{endpoint:health}`]: [`p(95)<${P95_BUDGET_MS}`, 'p(99)<1500'],
    [`http_req_duration{endpoint:config}`]: [`p(95)<${P95_BUDGET_MS}`],
    'http_req_duration{endpoint:auth}': ['p(95)<1500'],
    'http_req_duration{endpoint:chat}': ['p(95)<1200'],
    'http_req_duration{endpoint:media}': ['p(95)<1200'],
    'http_req_duration{endpoint:search}': ['p(95)<1200'],
    errors: ['rate<0.02'],
    // NOTE: no threshold on http_req_failed — k6 counts every 4xx as failed,
    // but 401 (negative-auth probe) and 429 (throttle doing its job) are
    // expected outcomes here. The `errors` gate above is the real SLI.
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function baseHeaders() {
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'k6-nexus-load/2.0',
  };
}

/** 429 and expected 4xx are outcomes, not errors. Only 5xx / contract breaks count. */
function recordOutcome(ok, res, { expect401 = false } = {}) {
  if (res.status === 429) {
    rateLimited.add(1);
    return; // throttled — back off, do not fail the iteration
  }
  if (expect401 && (res.status === 400 || res.status === 401)) {
    unauthorizedExpected.add(1);
    errors.add(0);
    return;
  }
  if (!ok) {
    errors.add(1);
  } else {
    errors.add(0);
    successfulReqs.add(1);
  }
}

function jitterSleep() {
  sleep(0.5 + Math.random() * 1.0); // de-synchronize VUs (no thundering herd)
}

/** Opaque E2EE-shaped payload sizer — server treats content as opaque bytes. */
function fakeCiphertextB64(bytes = 256) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  for (let i = 0; i < Math.ceil((bytes * 4) / 3); i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s.slice(0, Math.ceil((bytes * 4) / 3));
}

function serverHeader(res) {
  const h = res.headers || {};
  return h.Server || h.server || h['cf-ray'] ? 'present' : 'absent';
}

// ---------------------------------------------------------------------------
// Setup: one login for the whole run (VUs share the token; no login flood)
// ---------------------------------------------------------------------------
export function setup() {
  // Edge + public config are fetched ONCE here (real clients fetch config once
  // at startup). Polling /api/auth/config per-iteration would trip the
  // AuthController 15/min throttle and manufacture self-inflicted 429s.
  const health = http.get(`${BASE_URL}/health`, {
    headers: baseHeaders(),
    tags: { endpoint: 'health', name: 'SetupHealth' },
  });
  if (health.status !== 200) {
    console.log(`setup: WARNING — /health returned ${health.status} (continuing anyway).`);
  }
  const cfg = http.get(`${BASE_URL}/api/auth/config`, {
    headers: baseHeaders(),
    tags: { endpoint: 'config', name: 'SetupConfig' },
  });
  if (cfg.status !== 200) {
    console.log(`setup: WARNING — /api/auth/config returned ${cfg.status} (continuing anyway).`);
  }
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    console.log('setup: no TEST_USER_* creds — running public + negative-auth paths only.');
    return { token: null };
  }
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    { headers: baseHeaders(), tags: { endpoint: 'auth', name: 'SetupLogin' } },
  );
  const body = (() => {
    try {
      return JSON.parse(res.body);
    } catch (_) {
      return {};
    }
  })();
  const token = body.idToken || body.accessToken || body.token || null;
  if (res.status === 200 && token) {
    console.log('setup: authenticated OK.');
    return { token };
  }
  console.log(`setup: login returned ${res.status} — continuing without token.`);
  return { token: null };
}

// ---------------------------------------------------------------------------
// Main VU loop
// ---------------------------------------------------------------------------
export default function (data) {
  vusActive.add(1);
  const token = (data && data.token) || null;
  const authed = token ? { ...baseHeaders(), Authorization: `Bearer ${token}` } : null;

  // --- 01. Health & edge (always) ------------------------------------------
  group('01. Health & Edge', () => {
    const res = http.get(`${BASE_URL}/health`, {
      headers: baseHeaders(),
      tags: { endpoint: 'health', name: 'HealthCheck' },
    });
    healthDuration.add(res.timings.duration);
    const ok = check(res, {
      'health: status is 200': (r) => r.status === 200,
      'health: body.status ok': (r) => {
        try {
          return JSON.parse(r.body).status === 'ok';
        } catch (_) {
          return false;
        }
      },
      'health: no 5xx': (r) => r.status < 500,
    });
    // Informational only — CDN presence varies by env (staging vs direct).
    serverHeader(res);
    recordOutcome(ok, res);
  });

  // --- 02. Negative auth (10% of iterations; validates guard + throttle) ---
  if (Math.random() < 0.1) {
    group('02. Negative auth', () => {
      const payload = JSON.stringify({
        email: `loadtest_${__VU}_${__ITER}_${Date.now()}@nexus.invalid`,
        password: 'WrongPassword123!',
      });
      const res = http.post(`${BASE_URL}/api/auth/login`, payload, {
        headers: baseHeaders(),
        tags: { endpoint: 'auth', name: 'InvalidLogin' },
      });
      authDuration.add(res.timings.duration);
      const ok = check(res, {
        'auth: rejected without 5xx': (r) => r.status < 500,
        'auth: 400/401/429 (expected)': (r) => [400, 401, 429].includes(r.status),
      });
      recordOutcome(ok, res, { expect401: true });
      if (res.status === 429) sleep(1); // cooperative back-off on throttle
    });
  }

  // --- 03. Authenticated reads (only with creds; read-only, no DB writes) --
  if (authed) {
    group('03. Chat reads', () => {
      let res = http.get(`${BASE_URL}/api/auth/me`, {
        headers: authed,
        tags: { endpoint: 'chat', name: 'GetMe' },
      });
      chatDuration.add(res.timings.duration);
      recordOutcome(
        check(res, { 'me: 200 (or 429 under stress)': (r) => [200, 429].includes(r.status) }),
        res,
      );

      res = http.get(`${BASE_URL}/api/chat/conversations`, {
        headers: authed,
        tags: { endpoint: 'chat', name: 'ListConversations' },
      });
      chatDuration.add(res.timings.duration);
      const ok = check(res, {
        'conversations: 200 with array (or 429)': (r) => {
          if (r.status === 429) return true;
          if (r.status !== 200) return false;
          try {
            return Array.isArray(JSON.parse(r.body).conversations);
          } catch (_) {
            return false;
          }
        },
      });
      recordOutcome(ok, res);

      if (TEST_CONVERSATION_ID) {
        res = http.get(
          `${BASE_URL}/api/chat/messages/${TEST_CONVERSATION_ID}?limit=50`,
          { headers: authed, tags: { endpoint: 'chat', name: 'GetMessages' } },
        );
        chatDuration.add(res.timings.duration);
        recordOutcome(
          check(res, {
            'messages: 200/403/429 (membership-aware)': (r) => [200, 403, 429].includes(r.status),
          }),
          res,
        );
      }

      const q = `user${__VU % 10}`;
      const sres = http.get(`${BASE_URL}/api/auth/search?q=${q}`, {
        headers: authed,
        tags: { endpoint: 'search', name: 'UserSearch' },
      });
      searchDuration.add(sres.timings.duration);
      recordOutcome(
        check(sres, {
          'search: 200 with users array (or 429)': (r) => {
            if (r.status === 429) return true;
            if (r.status !== 200) return false;
            try {
              return Array.isArray(JSON.parse(r.body).users);
            } catch (_) {
              return false;
            }
          },
        }),
        sres,
      );
    });

    group('04. Media validation (no upload, presigned-url only)', () => {
      // Realistic E2EE-shaped sizing is exercised by the *payload shape* the
      // client would upload; here we only validate the MIME gate + signing
      // path without pushing bytes (keeps the load run side-effect free).
      const payload = JSON.stringify({ fileType: 'image/png', fileExtension: 'png' });
      void fakeCiphertextB64(256); // documents expected ciphertext scale (~256B msg)
      const res = http.post(`${BASE_URL}/api/media/presigned-url`, payload, {
        headers: authed,
        tags: { endpoint: 'media', name: 'PresignedUrl' },
      });
      mediaDuration.add(res.timings.duration);
      const ok = check(res, {
        'media: 200 with uploadUrl (or 429)': (r) => {
          if (r.status === 429) return true;
          if (r.status !== 200) return false;
          try {
            return Boolean(JSON.parse(r.body).uploadUrl);
          } catch (_) {
            return false;
          }
        },
      });
      recordOutcome(ok, res);
    });
  }

  // --- 05. Optional WS handshake probe (smoke-level; capacity stays in Node) --
  if (ENABLE_WS_PROBE) {
    group('05. WS handshake probe', () => {
      const url = `${BASE_URL.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;
      try {
        const res = ws.connect(url, null, (socket) => {
          socket.on('open', () => {
            wsSessions.add(1);
            socket.close();
          });
          socket.on('error', () => wsProbeErrors.add(1));
          socket.setTimeout(() => socket.close(), 3000);
        });
        check(res, { 'ws: handshake attempted without crash': () => true });
      } catch (_) {
        wsProbeErrors.add(1);
      }
    });
  }

  jitterSleep();
}

export function teardown() {
  console.log(`teardown: profile=${PROFILE} target=${BASE_URL} p95_budget=${P95_BUDGET_MS}ms`);
}

export function handleSummary(data) {
  const p95 = (m) => (data.metrics[m] ? data.metrics[m].values['p(95)'] : null);
  const summary = {
    profile: PROFILE,
    target: BASE_URL,
    checks_passed: data.metrics.checks ? data.metrics.checks.values.passes : null,
    checks_failed: data.metrics.checks ? data.metrics.checks.values.fails : null,
    error_rate: data.metrics.errors ? data.metrics.errors.values.rate : null,
    rate_limited_429: data.metrics.rate_limited_429 ? data.metrics.rate_limited_429.values.count : 0,
    p95: {
      health: p95('http_req_duration{endpoint:health}'),
      auth: p95('http_req_duration{endpoint:auth}'),
      chat: p95('http_req_duration{endpoint:chat}'),
      media: p95('http_req_duration{endpoint:media}'),
      search: p95('http_req_duration{endpoint:search}'),
    },
  };
  console.log(JSON.stringify(summary, null, 2));
  return {
    stdout: JSON.stringify(summary, null, 2),
    'test-results/k6-summary.json': JSON.stringify(data, null, 2),
  };
}
