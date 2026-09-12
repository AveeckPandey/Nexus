# Nexus — Implementation Spec (Web-Only Scalable Rebuild)

Single source of truth for the Nexus web-only rebuild. Stack: Next.js 14 App Router (React 18.3) + NestJS 11 Fastify backend. Strict zero-knowledge messaging, distributed multi-node architecture, and zero mock dependencies.

## 1. What This Project Is

Nexus is a production-grade, real-time messaging platform designed exclusively for modern web browsers:

- **1:1 & Group Messaging:** Persistent chat history with Base64 cursor pagination, typing indicators, reactions, message replies, and delivery/read receipts (sent → delivered → read).
- **Dual-Layer End-to-End Encryption (E2EE):**
  - *Symmetric Message Privacy:* NaCl secretbox (XSalsa20-Poly1305, 256-bit keys) with unique 24-byte nonces. Server stores opaque ciphertext only; push bodies and notification previews are redacted (🔒 Encrypted message).
  - *Automated Asymmetric Key Distribution:* X25519 public key infrastructure (nacl.box) for automatic in-app key exchange between verified users without manual out-of-band link sharing.
- **Ghost Chats (Zero-Trace Ephemeral Rooms):**
  - 5-minute single-use cryptographic invite links (`INVITE#<token>`).
  - Strict 30-second synchronized self-destruct timer triggered upon first message view.
  - Ephemeral zero-trace key exchange via URL hash fragment (`#k=<keyB64>`) that never hits server logs.
  - Atomic one-time token consumption and DynamoDB TTL purge backup (`expire_at`).
- **WebRTC Mesh Calling:**
  - 1:1 and group peer-to-peer audio/video calling.
  - Socket.IO signaling with user-targeted notification routing (`USER#<userId>`).
  - Native browser RTCPeerConnection, Google public STUN, seamless screen share track replacement (replaceTrack), and ICE candidate buffering.
- **Media Pipeline:** S3 presigned PUT uploads (15-minute expiry) with MIME verification and CloudFront CDN distribution for fast, signed reads.
- **Voice Notes:** In-browser MediaRecorder (audio/webm) with live AnalyserNode audio waveforms, direct-to-S3 uploads, and a variable-speed playback component (1× / 1.5× / 2×).
- **Client-Side AI Integration:** User-initiated Groq (llama-3.3-70b-versatile) conversation summarization and AWS Translate inline translation with explicit client-side decryption opt-in.
- **Push Notifications:** Standard Web Push API via VAPID keys and Service Worker (sw.js).
- **Dual Authentication:** AWS Cognito User Pools (SRP / email-password with verification codes) + hardened Google OAuth ID token verification.

## 2. Tech Stack & Dependencies

### web/ (Frontend)

- Framework: Next.js 14.2 (App Router), React 18.3, TypeScript 5.5.
- UI & Styling: Tailwind CSS 3.4, @heroui/react (v2.6), @heroui/theme, framer-motion 13.
- State & Networking: Zustand 5.0, Axios 1.8, socket.io-client 4.8.
- Cryptography: tweetnacl 1.0 (XSalsa20-Poly1305 & X25519), tweetnacl-util 0.15.
- Dropped: All legacy React Native / Expo libraries (expo-*, react-native-*, gifted-chat, @react-native-webrtc).

### server/ (Backend)

- Core Engine: NestJS 11.0, @nestjs/platform-fastify 11.0, @fastify/cors 10.0.
- WebSockets & Cluster: @nestjs/websockets 11.0, @nestjs/platform-socket.io 11.0, socket.io 4.8, @socket.io/redis-adapter 8.3, ioredis 6.0.
- Authentication & Security: aws-jwt-verify 4.0 (Cognito ID token verifier), Node.js crypto (HS256 session tokens).
- AWS SDK v3:
  - @aws-sdk/client-cognito-identity-provider
  - @aws-sdk/client-dynamodb & @aws-sdk/lib-dynamodb
  - @aws-sdk/client-s3 & @aws-sdk/s3-request-presigner
  - @aws-sdk/client-translate
- External Integrations: groq-sdk 0.15, web-push 3.6, axios 1.8, uuid 11.1.
- Dropped: @nestjs/jwt/passport, passport-*, class-validator/transformer (manual high-performance validation), dotenv (native @nestjs/config).

### Infrastructure (Free Tier Optimized)

- Compute: AWS EC2 t2.micro running Node.js Fastify (--max-old-space-size=450).
- Database: DynamoDB Single Table (NexusTable, 25 GB free tier, On-Demand billing).
- Cache / Signaling Adapter: Upstash Redis or ElastiCache Redis (minimal memory footprint).
- Auth: AWS Cognito User Pool (50,000 MAU free tier).
- Storage & CDN: AWS S3 (5 GB) + CloudFront distribution (1 TB egress/mo free).

## 3. System Architecture & Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CLIENT (BROWSER)                                 │
│  Next.js 14 UI · Zustand Stores · TweetNaCl E2EE Engine · WebRTC Mesh       │
└──────────────┬───────────────────────────────┬──────────────────────────────┘
               │ HTTPS (Bearer Cognito / JWT)   │ WSS (Socket.IO + Auth Token)
               ▼                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       NESTJS FASTIFY API (:8080)                            │
│  AuthGuard · IDOR Check · Gateways (Chat/Ghost/Call) · Presigner · Adapters │
└──────────────┬───────────────────────────────┬──────────────────────────────┘
               │ Redis Pub/Sub Adapter         │ Single-Table AWS SDK v3
               ▼                               ▼
┌───────────────────────────────┐ ┌───────────────────────────────────────────┐
│     REDIS PUB/SUB CLUSTER     │ │           DYNAMODB (NexusTable)           │
│ Multi-node gateway broadcast  │ │ Encrypted messages · Users · Ghost Invites│
└───────────────────────────────┘ └───────────────────────────────────────────┘
```

### Trust Boundaries & Privacy Invariants

- **Server Zero-Knowledge Zone:** The server NEVER receives unencrypted chat or ghost message bodies. Nonces, ciphertexts, and version numbers are persisted opaquely.
- **Key Storage Invariant:** Private identity keys (`localStorage['nexus_identity_sk']`) and conversation secret keys (`localStorage['nexus_e2ee_v1:<id>']`) are strictly client-side. They are never transmitted over the network in plaintext.
- **AI Plaintext Boundary (Explicit Opt-In):** Summarization and translation decrypt content strictly in the browser. When the user taps "Summarize" or "Translate", the decrypted text is transmitted over TLS to `/api/ai/summarize` or `/api/ai/translate`. A UI notice informs the user that message text will be processed by Groq / AWS Translate.

## 4. DynamoDB Single-Table Design (NexusTable)

Global Secondary Indexes:

- **GSI1:** GSI1PK (Partition) / GSI1SK (Sort) — Used for email lookup, membership reverse lookups, and sender queries.
- **TTL Attribute:** Standardized to `expire_at` (epoch seconds) across all expiring entities.

| Entity | PK | SK | GSI1PK | GSI1SK | Attributes & Notes |
|---|---|---|---|---|---|
| User Profile | `USER#<sub>` | `PROFILE` | `EMAIL#<email>` | `PROFILE` | userId, email, name, x25519PublicKey, preferredLanguage, createdAt |
| Device Token | `USER#<sub>` | `TOKEN#<endpointHash>` | — | — | platform ('web'\|'mobile'), subscription (WebPush JSON), updatedAt |
| Conversation | `CONV#<id>` | `METADATA` | `TYPE#<direct\|group>` | `UPDATED#<iso>` | id, type, title, participants[], lastMessage, updatedAt |
| Membership | `USER#<sub>` | `CONV#<id>` | `CONV#<id>` | `USER#<sub>` | role ('admin'\|'member'), joinedAt, lastReadMessageId, cachedConv (denormalized title/type) |
| Key Envelope | `CONV#<id>` | `KEY#<userId>` | — | — | encryptedKey (conversation secret key encrypted with user's X25519 public key), keyVersion |
| Message | `CONV#<id>` | `MSG#<iso>#<uuid>` | `SENDER#<userId>` | `MSG#<iso>` | id, senderId, senderName, content (ciphertext), nonce, encVersion, mediaType, mediaUrl, reactions[] |
| Ghost Invite | `INVITE#<token>` | `METADATA` | — | — | token, roomId, createdBy, isConsumed (boolean), expire_at = now + 300 |
| Ghost Message | `GHOST#<room>` | `MSG#<uuid>` | — | — | id, roomId, senderId, content, burnDuration (30), burnExpiresAt, expire_at = now + 3600 |

### Eliminating N+1 Reads in Conversation Listing

Instead of issuing individual GetItem queries for every conversation membership, `USER#<sub>` / `CONV#<id>` records denormalize basic metadata (title, type, updatedAt). Full metadata updates are handled in batch via BatchGetItem if stale, ensuring O(1) database trips per conversation load.

## 5. End-to-End Encryption Specification

### 5.1 Hybrid Key Management Protocol

```
                   ALICE                                            BOB
┌───────────────────────────────────────────┐   ┌───────────────────────────────────────────┐
│ 1. Generates Identity Keypair (X25519)     │   │ 1. Generates Identity Keypair (X25519)     │
│    Publishes x25519PublicKey to Profile   │   │    Publishes x25519PublicKey to Profile   │
│ 2. Initiates Conversation with Bob        │   │                                           │
│ 3. Generates 256-bit SymKey (secretbox)   │   │                                           │
│ 4. Fetches Bob's x25519PublicKey          │   │                                           │
│ 5. Encrypts SymKey with Bob's PubKey      │   │                                           │
│    (nacl.box) → stores KEY#<BobId>        │───┼──> 6. Fetches KEY#<BobId> envelope         │
│ 7. Encrypts message with SymKey           │   │    7. Decrypts SymKey using Identity SK   │
│    (nacl.secretbox) → sends ciphertext   │───┼──> 8. Decrypts message with SymKey         │
└───────────────────────────────────────────┘   └───────────────────────────────────────────┘
```

- **User Identity Keypair:** Generated on initial device login: `nacl.box.keyPair()`. Public key stored in DynamoDB profile (`USER#<sub>` / `PROFILE` / `x25519PublicKey`). Private key stored strictly in `localStorage['nexus_identity_sk']`.
- **Automatic Key Exchange (1:1 & Group):** Creator generates a random 32-byte conversation master key via `crypto.getRandomValues`. For every participant P, the creator encrypts the conversation key using `nacl.box(convKey, nonce, P.x25519PublicKey, myPrivateKey)` and uploads it to `POST /api/chat/conversations/keys`. Participants automatically fetch and decrypt their envelope on startup with zero user prompts.
- **Ghost Chat Ephemeral Key Sharing:** Ghost chats bypass the server key store completely. The 32-byte key is generated client-side and appended to the invite link hash: `https://nexus.app/ghost?token=<token>#k=<base64Key>`. The browser never transmits URL hash fragments to the server (RFC 3986 §3.5). The joiner reads `window.location.hash`, imports the key into local memory, and wipes the hash from browser history via `history.replaceState`.

### 5.2 Wire Format & Cryptographic Payloads

All encrypted text and payload metadata obey the following wire structure:

```json
{
  "content": "<base64_ciphertext>",
  "isEncrypted": true,
  "nonce": "<base64_24byte_nonce>",
  "encVersion": 1
}
```

- Cipher: XSalsa20 stream cipher with Poly1305 MAC (nacl.secretbox).
- Fail-Safe Rendering: If `decryptText(...)` returns null (missing key or corrupted MAC), the UI displays: 🔒 Encrypted — key missing on this device.

## 6. REST API Specification

All protected endpoints require an `Authorization: Bearer <token>` header (Cognito ID token or Google session JWT).

```
# System
GET  /health                                → { status: 'ok', uptime, timestamp }
# Authentication
GET  /api/auth/config                       → { cognitoConfigured, userPoolId, clientId, region, googleClientId }
POST /api/auth/signup                       → { email, password, name? }
POST /api/auth/confirm                      → { email, code }
POST /api/auth/resend-code                  → { email }
POST /api/auth/login                        → { email, password } → { idToken, accessToken, refreshToken, user }
POST /api/auth/google                       → { credential } → { idToken, user } (Strict Google tokeninfo verify)
POST /api/auth/refresh                      → { refreshToken } → { idToken, accessToken }
GET  /api/auth/me                           → Authenticated user profile + x25519PublicKey
PATCH /api/auth/profile                     → Update preferred language, displayName, x25519PublicKey
# Chat & Messaging
GET  /api/chat/conversations                → List user's conversations with denormalized previews
POST /api/chat/conversations                → { participantIds: string[], title?: string, type: 'direct'|'group' }
GET  /api/chat/conversations/:id/key        → Fetch caller's encrypted conversation key envelope
POST /api/chat/conversations/:id/key        → { recipientId, encryptedKey, keyVersion }
GET  /api/chat/messages/:id                 → Query params: ?limit=50&cursor=<base64_last_key>
                                              (Guarded: UserBelongsToConversationGuard)
# Ghost Ephemeral Chats
POST /api/ghost/invite                      → { token, roomId, inviteLink, expiresAt }
GET  /api/ghost/join/:token                 → { roomId } (Atomic one-time claim)
# Media & Voice Notes
POST /api/media/presigned-url               → { fileType, fileExtension } → { uploadUrl, mediaUrl, key }
                                              (mediaUrl routed via CloudFront distribution)
# Client-Side Opt-In AI
POST /api/ai/summarize                      → { messages: [{ sender, content }] } → { summary }
POST /api/ai/translate                      → { text, targetLang, sourceLang? } → { translatedText }
# Notifications
POST /api/notifications/register-token      → { platform: 'web', subscription: WebPushSubscriptionJSON }
```

### Pagination Contract (Cursor / ExclusiveStartKey)

```
GET /api/chat/messages/:id?limit=50&cursor=<token>
```

- `cursor`: Base64-encoded JSON object of DynamoDB's LastEvaluatedKey.
- Response: `{ success: true, messages: ChatMessage[], nextCursor: string | null }`.

## 7. WebSocket Gateway Specifications

Socket connections authenticate via `auth.token` in handshake parameters. Gateways run on root `/` namespace with `@socket.io/redis-adapter` for horizontal node synchronization.

### 7.1 Chat Gateway (ChatGateway)

- `join_room { conversationId }`: Validates user membership before executing `client.join(conversationId)`. Rejects unauthorized eavesdroppers with `{ error: 'Forbidden' }`.
- `leave_room { conversationId }`: Leaves Socket.IO room.
- `send_message { conversationId, content, isEncrypted, nonce, encVersion, mediaType?, mediaUrl?, replyTo? }`:
  - Validates sender membership.
  - Persists message to DynamoDB (`CONV#<id>` / `MSG#<iso>#<uuid>`).
  - Broadcasts `new_message` to room peers.
  - Returns acknowledgement with server UUID to replace client tempId.
- `typing_start` / `typing_stop`: Ephemeral broadcast to room (`user_typing_start` / `user_typing_stop`).
- `add_reaction { conversationId, messageSk, emoji }`: Toggles reaction in DB; emits `reaction_updated`.
- `message_read { conversationId, messageId }`: Updates caller's read status; emits `message_status_update`.

### 7.2 WebRTC Gateway (WebRtcGateway)

- **User Notification Room:** On connection, each socket joins `USER#<userId>`.
- `call_initiate { conversationId, callType: 'video'|'audio', recipientIds: string[] }`:
  - Creates call session in Redis/Memory with callId.
  - Emits `incoming_call` directly to `USER#<recipientId>` notification rooms (rings regardless of open chat view).
- `call_accept { callId }`: Caller joins callId room; emits `call_started` to room.
- `call_reject { callId, reason? }`: Emits `call_rejected` to caller; tears down session.
- `call_hangup { callId }`: Emits `call_ended` to all peers in call room.
- `webrtc_offer` / `webrtc_answer` / `ice_candidate`: Relayed to specific targetSocketId.

### 7.3 Ghost Gateway (GhostGateway)

- `join_ghost_room { roomId }`: Validates caller is creator or claimer; joins room; emits `peer_joined_ghost_room`.
- `send_ghost_message { roomId, content, isEncrypted, nonce, encVersion }`: Persists to DynamoDB with `expire_at` = now + 3600; broadcasts `new_ghost_message`.
- `ghost_message_opened { roomId, messageId }`:
  - Writes `burnExpiresAt` = now + 30 to DynamoDB.
  - Broadcasts `burn_started { roomId, messageId, duration: 30, burnExpiresAt }`.
  - Distributed Purge: Backed by Redis TTL / server cleanup job to execute `ghost_message_purged` and delete the DynamoDB record cleanly across multi-node clusters.

## 8. Web Frontend Architecture (web/app)

### Component & Layout Hierarchy

```
web/
├── app/
│   ├── globals.css           Purple palette (#14092B, #7C3AED, #1E1238, #121B22)
│   ├── layout.tsx            HeroUIProvider + Zustand stores hydration + socket lifecycle
│   ├── page.tsx              Unified single-page shell: Sidebar (Desktop) | BottomNav (Mobile)
│   └── providers.tsx         HeroUI theme provider
├── components/
│   ├── AuthForm.tsx          Cognito sign-up/in/verification + Google OAuth popup
│   ├── Sidebar.tsx           Active chats list, search filter, new conversation modal
│   ├── ChatWindow.tsx        Message stream, E2EE status, voice notes, media gallery, in-chat search
│   ├── Composer.tsx          Text composer, file attach, voice note recorder
│   ├── VoiceRecorder.tsx     Web Audio Analyser waveform visualizer, MediaRecorder S3 uploader
│   ├── GhostPanel.tsx        Invite creation, token claim, self-destruct countdown renderer
│   ├── CallPanel.tsx         Video/audio mesh grid, screen sharing toggle, device mute
│   └── ProfilePanel.tsx      User profile, language picker, public/private E2EE key export
├── lib/
│   ├── api.ts                Axios client with Bearer auth interceptor and refresh flow
│   ├── e2ee.ts               TweetNaCl X25519 (box) and XSalsa20 (secretbox) engine
│   ├── socket.ts             Socket.IO singleton with automatic reconnect
│   ├── webrtc.ts             RTCPeerConnection mesh manager with ICE queueing & replaceTrack
│   └── notify.ts             Web Push registration and sw.js subscription sync
└── store/
    ├── auth.ts               Session tokens, user metadata, identity keys
    ├── chat.ts               Conversation lists, message history, optimistic UI reconciliation
    ├── ghost.ts              Ephemeral room messages, burn timer states
    └── call.ts               Active call sessions, peer streams, device states
```

### Optimistic UI & Reconciliation State Machine

1. User types message and hits send.
2. Frontend creates an optimistic item: `{ id: 'temp_' + uuid(), status: 'sending', content: plain, ... }`.
3. Client encrypts payload and emits `send_message` with tempId.
4. Chat store appends message immediately for instant rendering.
5. Server saves message, generates real UUID, and acknowledges with `{ tempId, realId, createdAt, status: 'sent' }`.
6. Store updates message: replaces tempId with realId and switches status to 'sent'. Duplicate rendering is strictly prevented.

## 9. Environment Configuration Matrix

### Backend (server/.env — Strict Validation, No Silent Fallbacks)

```ini
# Server
PORT=8080
NODE_ENV=production
CLIENT_ORIGIN=https://nexus.app
# Security & Sessions
SESSION_JWT_SECRET=min_32_chars_random_hex_secret_key_nexus_prod
GOOGLE_CLIENT_ID=xxxxxxxxxxxx-xxxxxxxxxxxxxxxx.apps.googleusercontent.com
# AWS Core
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# AWS Cognito
COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_CLIENT_SECRET=
# AWS Storage & Database
DYNAMODB_TABLE_NAME=NexusTable
S3_BUCKET_NAME=nexus-media-production
CLOUDFRONT_DOMAIN=https://d111111abcdef8.cloudfront.net
# Redis Cluster / PubSub (Optional for multi-node, falls back to in-memory in dev)
REDIS_URL=redis://default:token@cluster-url.upstash.io:6379
# AI Services
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GROQ_MODEL=llama-3.3-70b-versatile
# Web Push (VAPID)
VAPID_PUBLIC_KEY=BXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX=
VAPID_PRIVATE_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=
VAPID_SUBJECT=mailto:admin@nexus.app
```

### Frontend (web/.env.local)

```ini
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=http://localhost:8080
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_GOOGLE_CLIENT_ID=xxxxxxxxxxxx-xxxxxxxxxxxxxxxx.apps.googleusercontent.com
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX=
```

## 10. Security, Authorization & Threat Model

| Threat / Attack Vector | Mitigation Strategy |
|---|---|
| Insecure Direct Object Reference (IDOR) | UserBelongsToConversationGuard enforces that request.user.userId is in conv.participants before any message fetch or socket room join. |
| Google Authentication Forgery | Direct validation via Google's tokeninfo endpoint with exact aud === GOOGLE_CLIENT_ID matching. Unverified JWT payload fallback is strictly removed. |
| Eavesdropping on Server Database | Server compromise reveals only ciphertext. Message content cannot be decrypted without private keys stored in client localStorage. |
| Race-Condition Double-Claiming on Invites | Atomic conditional update in DynamoDB: SET isConsumed = true WHERE attribute_not_exists(isConsumed) OR isConsumed = false. |
| Cross-Site Scripting (XSS) | React automatic string escaping; strict Content Security Policy (CSP) headers configured in Fastify; no dangerouslySetInnerHTML. |
| WebRTC ICE Candidate Race Condition | Browser queue buffers candidates until setRemoteDescription completes, eliminating InvalidStateError connection failures. |
| Strict NAT Connection Failure | Documented fallback requirement for STUN/TURN (Coturn) on carrier-grade symmetric NATs. |

## 11. Verification & Build Validation

Both tiers must compile with zero errors:

```bash
# 1. Server Production Build
cd server
npm install --legacy-peer-deps
npm run build
# Output: dist/main.js generated via NestJS build
# 2. Web Frontend Production Build
cd ../web
npm install --legacy-peer-deps
npm run build
# Output: Next.js optimized production build with prerendered routes
```

### Runtime Smoke Test Sequence

1. **Sign Up / Login:** User registers with email → verifies Cognito 6-digit code → profile initialized.
2. **Key Generation:** Browser verifies `localStorage['nexus_identity_sk']` and publishes x25519PublicKey.
3. **Encrypted Chat:** Alice starts chat with Bob → automatically exchanges conversation key envelope → sends encrypted text (🔒 Encrypted message on server).
4. **Ghost Chat:** User creates invite link (/ghost?token=...#k=...) → Claimer opens link in private window → 30s burn timer syncs and purges on both sides.
5. **Voice Note:** Record 5s audio note → waveform visualizes → uploads via presigned S3 PUT → plays back at 1.5× speed.
6. **Call Signaling:** Alice initiates call → Bob's client receives incoming_call across any view → accept establishes peer stream.

## 12. Architectural Roadmap (Post-Rebuild)

### 12.1 Phase 2 (Hardening & TURN)

- **Dedicated TURN Server:** Deploy Coturn relay on AWS ECS / Lightsail to guarantee 100% WebRTC connection traversal across symmetric corporate NATs and 5G cellular networks.
- **Biometric WebAuthn Unlock:** Protect local localStorage encryption keys with browser WebAuthn (Passkeys / Touch ID / Windows Hello).

### 12.2 Phase 3 (Broadcast & Ephemeral Stories)

- **Status / Stories (24h TTL):** Ephemeral photo/video updates with viewer receipts (`STORY#<userId>` / `ITEM#<iso>`).
- **Broadcast Channels (1:Many):** Unlimited subscriber channels with admin-only send privileges and subscriber fan-out over Redis.
- **Serverless Full-Text Search:** Client-side encrypted search indexes (MiniSearch) or server-side OpenSearch for unencrypted broadcast metadata.
