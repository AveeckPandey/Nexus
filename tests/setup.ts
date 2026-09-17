import 'reflect-metadata';

// In-memory localStorage so web/lib/e2ee.ts (browser-first) runs under node.
// The engine guards storage access, but the global itself must exist.
if (typeof (globalThis as unknown as Record<string, unknown>).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k) as string : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
  };
}

// Force hermetic in-memory backends for the Jest suite (unit/integration/security).
// NOTE: assigned (not deleted) so server-side `dotenv.config()` calls at import
// time do not repopulate them from server/.env — dotenv never overrides an
// already-defined key. This keeps tests off real MongoDB Atlas / AWS / Groq.
process.env.MONGODB_URI = '';
process.env.MONGODB_DB_NAME = '';
process.env.AWS_ACCESS_KEY_ID = '';
process.env.AWS_SECRET_ACCESS_KEY = '';
process.env.AWS_REGION = '';
process.env.DYNAMODB_ENDPOINT = '';
process.env.GROQ_API_KEY = '';
process.env.REDIS_URL = '';
process.env.REDIS_CLUSTER_URLS = '';
// Explicit opt-in for the local-dev auth fallback (AuthService fails closed
// in production without ALLOW_DEV_AUTH=true). Tests exercise dev auth.
process.env.ALLOW_DEV_AUTH = 'true';
