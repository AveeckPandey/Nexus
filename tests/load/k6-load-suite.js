import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics to track system behavior under load
const errorRate = new Rate('errors');
const healthReqDuration = new Trend('health_duration');
const authReqDuration = new Trend('auth_duration');
const rateLimitCount = new Counter('rate_limited_429');
const successfulRequests = new Counter('successful_reqs');

export const options = {
  scenarios: {
    // 1. Ramp-up load test
    load_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 20 },  // Warm-up to 20 users
        { duration: '30s', target: 50 },  // Ramp to 50 concurrent users
        { duration: '30s', target: 100 }, // Peak at 100 concurrent users
        { duration: '15s', target: 0 },   // Cool down
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    // Adjusted for geographical cross-continent latency (India -> US origin via Cloudflare)
    'http_req_duration': ['p(95)<800'],
    'errors': ['rate<0.05'], // Under 5% non-429 errors
  },
};

const BASE_URL = __ENV.TARGET_URL || 'https://nexus.buildwithaveeck.com';

export default function () {
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'k6-load-test-agent/1.0',
    },
  };

  group('01. Health & Edge Ingress', function () {
    const res = http.get(`${BASE_URL}/health`, params);
    healthReqDuration.add(res.timings.duration);

    const ok = check(res, {
      'health: status is 200': (r) => r.status === 200,
      'health: status body ok': (r) => {
        try {
          return JSON.parse(r.body).status === 'ok';
        } catch (_) {
          return false;
        }
      },
      'health: routed via Cloudflare': (r) => r.headers['Server'] === 'cloudflare',
    });

    if (res.status === 429) {
      rateLimitCount.add(1);
    } else if (!ok) {
      errorRate.add(1);
    } else {
      successfulRequests.add(1);
      errorRate.add(0);
    }
  });

  group('02. Auth & Rate Limiting Check', function () {
    const payload = JSON.stringify({
      email: `test_user_${__VU}_${Date.now()}@nexus.app`,
      password: 'SamplePassword123!',
    });

    const res = http.post(`${BASE_URL}/api/auth/login`, payload, params);
    authReqDuration.add(res.timings.duration);

    // Either 401 (invalid creds) or 400 or 429 (rate limited) or 200 - all show server handling
    const handled = check(res, {
      'auth: handled without crash (not 5xx)': (r) => r.status < 500,
    });

    if (res.status === 429) {
      rateLimitCount.add(1);
    } else if (!handled) {
      errorRate.add(1);
    }
  });

  // Human think-time between actions
  sleep(0.5 + Math.random() * 0.5);
}
