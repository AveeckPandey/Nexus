# Nexus — Web-Only Encrypted Messaging Platform

Clean rebuild: **Next.js 14 web app** (`web/`) + **NestJS 11 API** (`server/`).
See `IMPLEMENTATION.md` for the full spec.

## Quickstart

### 1. Server

```bash
cd server
cp .env.example .env   # fill AWS Cognito, DynamoDB, S3, Groq, VAPID, SESSION_JWT_SECRET
npm install --legacy-peer-deps
npm run start:dev      # :8080
```

### 2. Web

```bash
cd web
cp .env.example .env.local
npm install --legacy-peer-deps
npm run dev            # http://localhost:3000
```

## Rules for this repo

- No demo accounts, sample messages, or mock upload URLs.
- No `console.*` in shipped code (`web/lib/logger.ts` only, dev-gated).
- Every REST route and WebSocket event in `IMPLEMENTATION.md` §6–7 is called
  from the UI. Do not add handlers without wiring them.
- E2EE wire format (`content` / `isEncrypted` / `nonce` / `encVersion`) must not
  change without bumping `encVersion` and migrating `web/lib/e2ee.ts`.
