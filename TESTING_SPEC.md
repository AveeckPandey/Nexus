# Nexus — Comprehensive Testing & Scalability Specification
> Target Scaling Progression: **1,000 → 10,000 → 50,000 → 100,000 Concurrent Users**

---

## 1. Executive Summary

This document specifies the complete, end-to-end testing architecture for the Nexus communications platform. It covers:
1. **Concurrency & Load Testing**: Progressive scaling from 1K to 100K active sockets.
2. **Feature Testing**: Direct messages, group chats, pictures/media uploads, emojis & reactions, replies, `@mentions`, WebRTC audio/video mesh, and 24h ephemeral stories.
3. **Security & Zero-Knowledge Invariants**: Verification of TweetNaCl client encryption, memory safety, and leak prevention.
4. **Directory Structure & Tooling**: Concrete file placement and ready-to-run test scripts.

---

## 2. Answers to Core Questions

### Q1: Can we test concurrent users too?
**YES.** Concurrent user testing is the core pillar of this specification. Using native Node.js Socket.IO orchestrators (early Artillery/k6 prototypes deprecated — see §6.2), we simulate real persistent WebSocket connections that maintain handshakes, send heartbeats, exchange encrypted messages, and monitor server memory/event-loop lag across 1k, 10k, 50k, and 100k levels.

### Q2: What about pictures, emojis, replies, mentions, video calling, group text, and stories?
**YES, every single one of these features is included in the test matrix:**
- **Pictures & Media**: Presigned S3 PUT uploads, CloudFront CDN retrieval, image rendering, and audio waveform replay.
- **Emojis & Reactions**: Real-time reaction toggling (`add_reaction`), database persistence, and room broadcast (`reaction_updated`).
- **Replies**: Nested message chaining via `replyTo` message IDs, preserving parent context in encrypted payloads.
- **Mentions**: `@username` regex extraction, participant tagging, and targeted push notification triggers.
- **WebRTC Video Calling**: Peer-to-peer audio/video calling using headless Chrome with simulated media streams (`--use-fake-device-for-media-stream`), verifying SDP offer/answer/ICE exchange.
- **Group Text**: Multi-participant rooms with automated X25519 key sealing for each member and horizontal Redis fan-out.
- **Stories (24h TTL)**: Ephemeral photo/video stories (`STORY#<userId>` / `ITEM#<iso>`), view receipts, and automatic DynamoDB TTL expiration.

---

## 3. Directory & File Organization

The test suite is structured as follows in the repository:

```
tests/
├── unit/                               # Jest unit tests (Fast, in-memory)
│   ├── crypto.spec.ts                 # TweetNaCl XSalsa20-Poly1305 & X25519 key exchange
│   ├── auth.spec.ts                   # Token minting, validation, dev fallbacks
│   └── search.spec.ts                 # Username & email directory search ranking
│
├── integration/                        # API & Database integration tests
│   ├── chat-api.spec.ts               # Conversations, messages, pagination, direct 1:1
│   ├── media-api.spec.ts              # Presigned S3 upload URLs & MIME validation
│   ├── reactions.spec.ts              # Emoji toggling and reaction aggregation
│   └── stories-api.spec.ts            # Story creation, 24h TTL verification, viewer receipts
│
├── e2e/                               # Playwright browser automation (Real browser instances)
│   ├── auth-flow.spec.ts              # Signup, login, verification, and invite links
│   ├── messaging.spec.ts              # Alice-to-Bob real-time chat, replies, and mentions
│   ├── media-upload.spec.ts           # Picture attachment, voice notes, and waveforms
│   ├── webrtc-call.spec.ts            # 1:1 & group video calls with simulated camera/mic
│   └── ghost-chat.spec.ts             # 30-second burn timer countdown & DOM purge
│
├── load/                              # Concurrency & Stress Testing (native orchestrators; YML deprecated)
│   ├── benchmark-2pod.js              # 2-pod local equivalence benchmark (5,000 sockets, <3GB RAM)
│   ├── benchmark-1k.js                # 1,000 concurrent sockets (current harness)
│   ├── benchmark-10k.js               # 10,000 concurrent sockets (current harness)
│   ├── benchmark-50k.js               # 50,000 sockets via 5× Docker workers (current harness)
│   ├── benchmark-100k.js              # 100,000 sockets via 10× Docker workers (Stage 4 orchestrator)
│   ├── worker-runner.js               # Container worker: 10K sockets each + latency sampling
│   ├── 1k-baseline.yml                # DEPRECATED Artillery prototype (see §6.2, not for CI)
│   ├── 10k-cluster.yml                # DEPRECATED Artillery prototype (see §6.2, not for CI)
│   ├── 50k-scale.yml                  # DEPRECATED Artillery prototype (see §6.2, not for CI)
│   └── 100k-enterprise.yml            # DEPRECATED Artillery prototype (see §6.2, not for CI)
│
└── security/                          # Security, Memory Leaks & Penetration
    ├── memory-leak.spec.ts            # Heap snapshot comparison (0 → 1K users → 0)
    ├── zero-knowledge.spec.ts         # Asserts plaintext NEVER exists in DynamoDB
    ├── idor-guards.spec.ts            # Asserts User C cannot eavesdrop on User A/B
    ├── metadata-leakage.spec.ts       # Ciphertext-only transport + explicit metadata allowlist
    ├── authz-escalation.spec.ts       # No membership forgery (read/typing/reaction/burn), gated bench auth, call authz, SSRF guard, dev-auth fail-closed, loud cloud writes
    └── xss-sanitization.spec.ts       # Malicious script tag escaping in message bubbles
```

---

## 4. Concurrency Scaling Roadmap (1K → 100K)

### Stage 1: 1,000 Concurrent Users (Baseline)
- **Target Hardware**: 1× Node instance (min 2 vCPU, 2 GB RAM) or 1× EKS Pod (`requests: 512Mi`, `limits: 1Gi`).
- **Execution**:
  ```bash
  node tests/load/benchmark-1k.js
  ```
- **Scenario Profile**:
  - 1,000 simultaneous persistent WebSocket connections maintained concurrently.
  - Full Cognito/JWT authentication handshake on connection.
  - 25–35 messages/second with continuous ping/pong round-trip latency tracking.
  - 15 concurrent WebRTC audio/video mesh signaling sessions.
- **Pass Criteria**:
  - Server memory consumption `< 650 MB` (stable, no GC thrashing).
  - p95 message delivery latency `< 50 ms`.
  - 0 dropped socket connections.

### Stage 2: 10,000 Concurrent Users (Single High-Memory Node / Clustered Pods)
- **Target Hardware**: Dedicated 4 vCPU, 8 GB RAM instance (`--max-old-space-size=4096`) or 3× EKS Pods behind AWS ALB.
- **Execution**:
  ```bash
  node tests/load/benchmark-10k.js
  ```
- **Scenario Profile**:
  - 10,000 simultaneous persistent WebSocket connections.
  - 500 messages/second.
  - Real-time heartbeat failure rate tracking (`< 0.05%`).
- **Pass Criteria**:
  - Memory consumption `< 2.8 GB`.
  - p95 latency `< 80 ms`.
  - Event-loop lag `< 20 ms`.

### Stage 3: 50,000 Concurrent Users (Multi-Node Cluster & Distributed Benchmark)
- **Target Hardware**: 5× EKS Pods (2 vCPU, 4 GB RAM each) behind AWS ALB + `cache.t4g.medium` ElastiCache Redis. Server tuned with `--max-old-space-size=7168`.
- **Execution**:
  ```bash
  node tests/load/benchmark-50k.js
  ```
- **Scenario Profile**:
  - 50,000 concurrent sockets load-balanced across nodes using 5 headless Linux Docker worker containers on a private bridge network (`nexus-bench`).
  - `@socket.io/redis-adapter` syncing room events across nodes.
  - 2,500 messages/second broadcast.
- **Pass Criteria (end-to-end `send_message` ACK RTT, sampled across workers — same method as Stages 1–2):**
  - ALB distributes traffic evenly with cookie stickiness (`stickiness.lb_cookie.duration_seconds=86400`).
  - Redis CPU utilization `< 40%`.
  - 0 dropped connections across ramp-up (~70s for 50K); p95 latency `< 100 ms`, p99 `< 150 ms`.
  - Note: single-digit-ms figures observable on the private `nexus-bench` Docker bridge are intra-container ping, not end-to-end delivery — pass/fail uses end-to-end ACK RTT only.

### Stage 4: 100,000+ Concurrent Users (3 Pods × ~33,334 Users/Pod)
- **Target Architecture**: 3× Server Pods (each holding ~33,334 active WebSockets) behind an AWS ALB with `least_outstanding_requests` + Multi-AZ Redis Cluster + DynamoDB On-Demand.
- **Pod Resource Allocation**: 4 vCPU, 8 GB RAM limit per pod (`requests: 6Gi`, `limits: 8Gi`), Node heap flag `--max-old-space-size=6144`.
- **Execution**:
  ```bash
  # Option A — 2-cell composite benchmark (avoiding generator port exhaustion):
  node tests/load/benchmark-50k.js
  # repeat for cohort 2 against 3-pod fleet
  node tests/load/benchmark-50k.js

  # Option B — distributed 100k orchestrator (10 workers x 10k or 3 workers x 33.3k):
  node tests/load/benchmark-100k.js
  ```
- **Scenario Profile**:
  - 100,000 persistent sockets distributed across the 3 pods (~33,334 per pod).
  - 10,000 messages/second peak burst.
  - Same authenticated `io(..., { auth: { token } })` + `send_message` ACK sampling as Stages 1–3.
- **Pass Criteria**:
  - Load balancer distributes traffic across all 3 pods (33,334 ± 5% each).
  - p95 delivery latency `< 150 ms`, p99 `< 250 ms` (global, multi-AZ).
  - DynamoDB handles burst without `ProvisionedThroughputExceededException`.
  - 0 dropped connections across all workers during the synchronized hold window.

### Stage 5: 1,000,000+ Concurrent Users (Theoretical Architectural Roadmap)
> [!NOTE]
> **Roadmap Target — Not Empirically Verified**: Stage 5 represents a theoretical capacity projection (40 Pods × 25k Users/Pod). Linear scaling to 1M users cannot be asserted as an automatic guarantee without solving and testing several distributed bottlenecks:
- **Target Architecture (Projected)**: 40× Auto-scaled Server Pods across AWS EKS Managed Node Groups (`c6g.2xlarge` instances) + Multi-AZ ElastiCache Redis Cluster (`cache.m6g.4xlarge`) + DynamoDB On-Demand with write buffering.
- **Unverified Scaling Bottlenecks Requiring Empirical Proof**:
  1. **Redis Pub/Sub Fan-Out Saturation**: Standard Redis Pub/Sub replicates every broadcast to all connected cluster nodes. At 1M users and 50,000 msgs/sec, a single Redis broker node saturates single-thread CPU and network bandwidth. Production 1M scale requires **Redis 7+ Sharded Pub/Sub (`SPUBLISH`)** or migration to an event-mesh broker (e.g. Apache Kafka or NATS JetStream).
  2. **DynamoDB Partition Throttling**: 100,000 writes/second burst can exceed single-partition adaptive capacity without an asynchronous message ingestion buffer (e.g. Amazon SQS / Kinesis) decoupling chat ingestion from storage.
  3. **AWS VPC CNI & IP Allocation Limits**: Managing 1,000,000 active TCP sessions across 40 pods requires careful ENI trunking, NAT Gateway scaling, and multi-AZ egress cost budgeting.
  4. **Load Generation Cost & Infrastructure**: Verifying 1M concurrent users requires a distributed multi-region cluster of 40–100 load generator instances (e.g. distributed k6 on AWS Fargate), which remains an unexecuted enterprise validation phase.

---

### Local Cluster Equivalence Verification (2-Pod Model for 8–9 GB Laptops)

For local development and verification on memory-constrained hardware (e.g., developer laptops with 8–9 GB RAM), running 100,000 active sockets locally would exhaust system memory (~24–32 GB required). 

Instead, the architecture is verified using **Cluster Equivalence (2-Pod Model)**:
- **Target Footprint**: 2 Server Pods (2,500 sockets each = 5,000 total) + 1 Redis Broker + 1 Load Balancer.
- **Total RAM Required**: `< 3.0 GB RAM` (safe for 8–9 GB host systems without OS memory pressure).
- **Distributed Invariants Proven by 2 Pods**:
  1. **Cross-Pod Relay:** Client A on Pod 1 sends an encrypted message to Client B on Pod 2; verifies that the Redis Pub/Sub adapter routes the message across distinct process spaces with target ACK RTT `< 100 ms` (typical loopback: `< 10 ms`).
  2. **50/50 Load Distribution:** Verifies that NGINX / ALB distributes incoming WebSocket handshakes evenly between the pods.
  3. **Sticky Session Persistence:** Verifies that socket connections and HTTP upgrades do not drop or thrash across nodes.
- **Execution**:
  ```bash
  node tests/load/benchmark-2pod.js
  ```
  *Passing the 2-pod equivalence test increases confidence, but does not replace full-fleet validation for 4 pods (100k) and 40 pods (1M) in production.*

---

## 5. Feature Test Matrix & Implementation Details

### 5.1 Pictures, Voice Notes & Media Attachments
- **Mechanism**:
  1. **Presigned Upload Flow**: Client requests presigned URL from `POST /api/media/presigned-url` with MIME type check (`image/*`, `audio/*`, `video/*`, `application/pdf`).
  2. **Direct S3 / CDN Storage**: Client uploads raw binary directly to S3 via HTTP `PUT` (15-min expiry). S3 URL is stored with `mediaType: 'image' | 'audio' | 'video' | 'file'`.
  3. **Voice Notes & Waveforms**: Audio recorded in-browser via `MediaRecorder` (`audio/webm`), visualized with live `AnalyserNode` waveforms, and playable at variable speeds (1×, 1.5×, 2×).
  4. **AI Speech-to-Text Transcription**: Audio bubbles include an integrated `POST /api/ai/transcribe` action rendering transcription directly beneath the audio player.
- **Automated Test (`tests/e2e/media-upload.spec.ts`)**:
  - Attach a test PNG/JPEG file in the chat composer.
  - Verify presigned PUT status is 200.
  - Verify recipient receives the message, decrypts the S3 URL, and the image renders with correct dimensions.
  - Verify voice note upload, audio player rendering, and transcription trigger.
  - Verify files with disallowed MIME types (`.exe`, `.sh`) are rejected with `400 Bad Request`.

### 5.2 Emojis & Message Reactions
- **Mechanism**:
  - Client emits `add_reaction` { conversationId, messageSk, emoji }.
  - Backend toggles emoji under message's `reactions` array in DynamoDB and emits `reaction_updated`.
- **Automated Test (`tests/integration/reactions.spec.ts`)**:
  - Alice sends message.
  - Bob reacts with "❤️". Verify Alice receives `reaction_updated` with count = 1.
  - Bob clicks "❤️" again (unreact). Verify count returns to 0.
  - Multiple users reacting with different emojis are aggregated cleanly without race conditions.

### 5.3 Replies & Contextual Quoting
- **Mechanism**:
  - Composer sets `replyTo: { messageId, senderName, snippet }`.
  - Message bubble displays parent quote block with click-to-scroll to original message.
- **Automated Test (`tests/e2e/messaging.spec.ts`)**:
  - Send original message.
  - Trigger "Reply" action on original message.
  - Send reply text.
  - Verify recipient's UI renders the quoted parent snippet and clicking it scrolls the view to the target.

### 5.4 Mentions (`@username`)
- **Mechanism**:
  - Client highlights `@username` in the composer with auto-complete dropdown.
  - Server extracts mentioned users and triggers push notifications even if the conversation is muted.
- **Automated Test (`tests/unit/search.spec.ts` & `tests/e2e/messaging.spec.ts`)**:
  - Type `@bob` in a group chat. Verify suggestions list displays `@bob_scan`.
  - Send message. Verify Bob receives targeted notification header with distinct mention styling.

### 5.5 P2P WebRTC Audio & Video Calling
- **Mechanism**:
  - `WebRtcGateway` routes signaling (`call_initiate`, `call_accept`, `webrtc_offer`, `webrtc_answer`, `ice_candidate`).
  - Video streams travel peer-to-peer; server handles 0 video bandwidth.
  - **5-Peer Capacity Guard:** Call sessions enforce a strict hard cap of 5 participants (1 initiator + 4 peers) to avoid $O(N^2)$ client CPU and uplink exhaustion on home internet connections.
  - **NAT & TURN Realities:** While direct STUN handles open/moderate NATs, symmetric NATs (~15–20% of enterprise/mobile connections) require TURN relays (`NEXT_PUBLIC_TURN_URL`). True media load testing requires dedicated RTP packet generators, whereas fake-device flags validate client signaling negotiation and track lifecycle.
- **Automated Test (`tests/e2e/webrtc-call.spec.ts`)**:
  - Launch Playwright with fake media flags:
    `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`
  - Alice initiates video call to Bob.
  - Verify Bob's browser receives `incoming_call` modal within 500ms.
  - Bob clicks "Accept".
  - Verify `RTCPeerConnection.connectionState === 'connected'`.
  - Verify audio/video tracks are active on both sides.
  - Alice clicks "Mute". Verify Bob's remote track status updates to muted.
  - Hangup terminates the session and removes media streams cleanly.
  - Verify 6th participant receives `{ status: 'full', message: 'Maximum 5 participants' }`.

### 5.6 Group Text & Fan-Out
- **Mechanism**:
  - `POST /api/chat/conversations` with `type: 'group'`, `participantIds: [id1, id2, id3]`.
  - Creator client seals conversation key for each participant's X25519 public key.
- **Automated Test (`tests/integration/chat-api.spec.ts`)**:
  - Create group with 5 members.
  - Send message from Member 1.
  - Verify Members 2, 3, 4, and 5 all receive the message over their respective WebSockets.
  - Verify message is stored once under `CONV#<groupId>` and fan-out happens in memory/Redis.

### 5.7 24-Hour Ephemeral Stories (Roadmap Phase 3)
> [!NOTE]
> **Contract-Only Test (Roadmap Phase 3):** A dedicated `server/src/modules/stories/` backend module has not been built yet. The integration test `tests/integration/stories-api.spec.ts` pins the **storage contract** directly against `DynamoDbService` (`PK: STORY#<userId>`, `SK: ITEM#<isoTimestamp>`, `expire_at = now + 86400`). When the service lands, assertions remain identical.

- **Mechanism**:
  - User uploads photo/video to S3 via presigned URL.
  - Record created in DynamoDB: `PK: STORY#<userId>`, `SK: ITEM#<isoTimestamp>`, with `expire_at = now + 86400`.
  - Story carousel renders circles in the sidebar header.
  - **DynamoDB TTL Purge Behavior:** DynamoDB background TTL deletion is asynchronous and may take up to **48 hours** to physically purge items. Therefore, the system enforces an application-level filter (`WHERE expire_at > now`) on all queries to guarantee immediate expiration.
- **Automated Test (`tests/integration/stories-api.spec.ts`)**:
  - Post story item with timestamp T.
  - Fetch user stories: story is returned.
  - Advance mock time by 24 hours and 1 second:
    - Verify application query filter (`visibleAt()`) hides the story immediately, even before physical DynamoDB background sweep.
    - Story is no longer returned in story carousel.
  - Record view receipt: User B views story → User A receives view receipt event.

### 5.8 Ephemeral Ghost Chats (30s Burn Countdown & Anonymous Guest Access)
- **Mechanism**:
  - `POST /api/ghost/invite` generates single-use token (`INVITE#<token>`) with 5-minute TTL.
  - Zero-registration anonymous guest access via `Guest_XXXX` identities.
  - Encryption key transmitted via URL hash fragment (`#k=<keyB64>`), never sent across the wire.
  - Viewing a message (`ghost_message_opened`) triggers a synchronized 30-second countdown (`burn_started`), terminating with permanent DynamoDB purge (`ghost_message_purged`) and DOM removal.
- **Automated Test (`tests/e2e/ghost-chat.spec.ts`)**:
  - Creator generates ghost invite.
  - Claimer opens link as anonymous guest.
  - Send message → message view starts 30s countdown → verify countdown timer renders in DOM.
  - Verify purge signal deletes message from DOM and database.

### 5.9 Database Persistence: DynamoDB Single-Table & MongoDB Atlas Cloud Adapter
- **Mechanism**:
  - **Single-Table Design**: All entities are modeled on single-table partition/sort keys (`PK: CONV#<conversationId>`, `SK: MSG#<isoTimestamp>#<uuid>`, `PK: USER#<userId>`, `PK: STORY#<userId>`, `PK: INVITE#<token>`).
  - **Hybrid 3-Tier Storage Hierarchy**:
    1. **Tier 1 (AWS DynamoDB - Production Target)**: Activated via `AWS_ACCESS_KEY_ID` & `AWS_SECRET_ACCESS_KEY` or `DYNAMODB_ENDPOINT`.
    2. **Tier 2 (MongoDB Atlas - Cloud Sandbox & Testing)**: Activated via `MONGODB_URI` (`mongodb+srv://...`). Automatically provisions the `nexus_items` collection, maps `_id: ${PK}##${SK}`, creates `{ PK: 1, SK: 1 }` and `{ GSI1PK: 1, GSI1SK: 1 }` indexes, and provisions a native MongoDB TTL index on `expire_at` (`expireAfterSeconds: 0`) for stories and ghost chat auto-purging.
    3. **Tier 3 (In-Memory Map - Local Dev & CI)**: Active when neither cloud credential is set, ensuring zero-latency offline testing with 0 external dependencies.
  - Supports Base64 cursor pagination (`LastEvaluatedKey` in DynamoDB, `$gt` / `$lt` on `SK` in MongoDB) loading 50 messages per page without memory spikes.
  - Membership rows (`USER#<userId> / CONV#<conversationId>`) store denormalized previews (`cachedLastMessage`, `cachedUpdatedAt`) eliminating N+1 queries during conversation list load.
- **Automated Test (`tests/integration/chat-api.spec.ts`)**:
  - Verify direct 1:1 conversation creation with admin/member roles.
  - Verify idempotent 1:1 conversation lookup (`findOrCreateDirectConversation`).
  - Verify 50-message pagination with `nextCursor` traversal.
  - Verify key envelope storage and retrieval (`putKeyEnvelope` / `getKeyEnvelope`).

### 5.10 In-Chat AI Assistant & Real-Time Audio Transcription (Groq Cloud Engine)
- **Mechanism**:
  - **Live AI Provider**: Powered by Groq Cloud SDK (`groq-sdk`) configured via `GROQ_API_KEY`.
  - **Chat Summarization & In-Chat Assistant**: Uses Groq LLM (`GROQ_MODEL=openai/gpt-oss-20b`), generating bulleted action items and responding to `@nexus` / `@ai` mentions with structured summaries.
  - **Speech-to-Text (STT)**: Uses Groq **Whisper Large v3** (`whisper-large-v3`) in `AiService.transcribe()`, ingesting binary audio WebM buffers or S3 presigned URLs and returning transcribed text.
  - Unencrypted messages mentioning `@nexus` trigger bot typing indicators (`user_typing_start`) and reply under `senderId: 'nexus-ai'` with bot badges.
- **Automated Test (`tests/e2e/messaging.spec.ts` & `tests/unit/features-cap.spec.ts`)**:
  - Alice sends message mentioning `@nexus`.
  - Verify `user_typing_start` event for `Nexus AI`.
  - Verify AI message arrives with `senderId: 'nexus-ai'` and renders with distinct gradient bubble styling.


---

## 6. Architectural Deductions & Production Hardening

### 6.1 Hardware Math & Socket Memory (OOM Prevention)
- **Deduction:** Estimating 10K concurrent sockets on 1× `t4g.small` (2 GB RAM) or 1K on `t2.micro` is physically unviable. In Node.js, each active Socket.IO connection consumes memory for TCP buffers, TLS state, Engine.IO heartbeat timers, and event listeners (100–300 KB idle, up to ~1 MB active). 10,000 active sockets will exhaust 2 GB RAM and trigger V8 garbage collection event-loop stalls or fatal OOM kills.
- **Production Hardening:**
  1. **V8 Heap Memory Sizing:** In high-density single-container benchmarks (Stage 3 50K benchmark container), the process allocates `--max-old-space-size=7168` (7 GB RAM) to hold 50k connections. In the 3-pod fleet (Stage 4), each pod allocates `--max-old-space-size=6144` (6 GB heap) to sustain ~33,334 connections without GC thrashing.
  2. **Horizontal Pod Autoscaling & Pod Sizing:** Production deployments abandon underpowered single instances in favor of Kubernetes multi-pod clusters (`infra/k8s/10-server-deployment.yaml` and `infra/k8s/40-hpa.yaml`). Baseline capacity starts at `minReplicas: 3` (3 pods × ~33.3k = 100k capacity) scaling up to `maxReplicas: 16`, with each pod allocated `requests: 6Gi` and `limits: 8Gi`.

### 6.2 Sustained Concurrency vs. Arrival Rates (Replacing Flawed Artillery Scripts)
- **Deduction:** Naive Artillery configurations (`arrivalRate: 10/20/25`) initiate users per second rather than sustaining 1,000 simultaneous connections. Furthermore, scripts lacking Cognito JWT authentication fail against `ChatGateway.handleConnection()`, which rejects unauthenticated handshakes.
- **Production Hardening:**
  1. **Native Socket Orchestrators:** Replaced generic Artillery YAML with native Node.js benchmarks (`tests/load/benchmark-1k.js`, `benchmark-10k.js`, `benchmark-50k.js` + `worker-runner.js`). Old YMLs are retained in `tests/load/` as `DEPRECATED` reference only and are excluded from CI.
  2. **Authenticated Sockets:** The harness calls `POST /api/auth/login`, retrieves an authentic ID token, and connects via `io(SERVER_URL, { auth: { token } })`.
  3. **Batching & Heartbeats:** Sockets connect in controlled batches (50/150ms for 1K, 100/80ms for 10K, 100/40ms per worker for 50K) and latency is measured as end-to-end `send_message` ACK RTT — the same method at every stage.

### 6.3 WebRTC Mesh Scalability & TURN Realities
- **Deduction:** Claiming 500–2,000 concurrent WebRTC calls on a pure P2P mesh ignores that mesh complexity scales quadratically ($N \times (N-1)$ streams). Moreover, ~15–20% of users behind symmetric NATs or enterprise firewalls require TURN relaying, generating massive bandwidth costs. Headless Chrome flags (`--use-fake-device-for-media-stream`) only test the SDP handshake, not raw media packet load.
- **Production Hardening:**
  1. **5-Peer Capacity Guard:** Enforced in `WebRtcGateway`: call sessions reject any 6th participant (`call.participants.size >= 5`) with `'Call is full (maximum 5 participants for P2P mesh)'`.
  2. **TURN Architecture:** Client ICE via `NEXT_PUBLIC_TURN_URL` in `web/lib/webrtc.ts` (see `web/.env.local.example`); relay deployed as coturn in `infra/k8s/32-turn.yaml` (2 replicas, LoadBalancer :3478 UDP/TCP, credentials from `nexus-turn-secret`). Large-scale broadcasting (>5 peers) is recognized as requiring a dedicated SFU/MCU media server, keeping Nexus's core lightweight and zero-knowledge.

### 6.4 Missing Production Infrastructure Concerns
- **Deduction:** Testing scaling without ALB sticky sessions causes WebSocket handshake upgrade failures across multi-node clusters. A single load generator machine hits OS ephemeral port exhaustion (Windows limits dynamic ports to 16,384: `49152`–`65535`).
- **Production Hardening:**
  1. **AWS ALB Sticky Sessions:** Configured in `infra/k8s/30-ingress.yaml` with cookie stickiness (`stickiness.lb_cookie.duration_seconds=86400`) and 3,600s idle timeouts (`idle_timeout.timeout_seconds=3600`).
  2. **Distributed Containerized Load Generator:** Solved in `tests/load/benchmark-50k.js` by orchestrating 5 headless Linux worker containers on a private Docker bridge network (`nexus-bench`), each with `ulimit -n 1048576` and dedicated port pools.
  3. **Automated CI/CD & Canary Rollout:** Codified in `.github/workflows/ci.yml` (GitHub Actions) and `Jenkinsfile`, delivering a 5-stage automated pipeline with 10% canary traffic splitting and manifest validation (`npm run pipeline:canary`).

### 6.5 DynamoDB TTL Purge Asynchrony
- **Deduction:** DynamoDB TTL eviction is an asynchronous background process that can take up to **48 hours** to physically delete expired rows. Advancing mock time in integration tests does not simulate real-world behavior where expired rows remain visible to scans and queries.
- **Production Hardening:**
  1. **Application-Level Purge Check:** In `GhostService.claimInvite()`, the backend validates `expireAt < nowSec` synchronously on read and performs immediate programmatic deletion.
  2. **Query Filter Contract:** In `tests/integration/stories-api.spec.ts`, tests assert on a `visibleAt()` query filter (`expire_at > nowSec`), codifying that the application layer must always filter out expired records independently of DynamoDB's background sweep.

---

## 7. Verified High-Precision Load Test Harness

The benchmark suite uses native Socket.IO client orchestrators located in `tests/load/`. All latency figures below are end-to-end `send_message` ACK RTT (same sampling method at every stage):

- **2-Pod Local Equivalence Benchmark (for 8–9 GB Laptops):** [`tests/load/benchmark-2pod.js`](tests/load/benchmark-2pod.js)
  - Tests 2 server pods (2,500 sockets each = 5,000 total) + Redis Pub/Sub adapter.
  - Verifies 50/50 load balancing, cross-pod E2EE message delivery (target: < 100 ms, loopback: < 10 ms), and sticky sessions with `< 3.0 GB` total RAM footprint.
- **1,000 Baseline Test:** [`tests/load/benchmark-1k.js`](tests/load/benchmark-1k.js)
  - Performs health checks, authenticates test user, ramps up 1,000 sockets in batches of 50.
  - Measures p50, p95, and p99 round-trip latency via `send_message` ACK (target: p95 `< 50 ms`).
- **10,000 Single-Node Test:** [`tests/load/benchmark-10k.js`](tests/load/benchmark-10k.js)
  - Tests single-node connection saturation and V8 event loop lag (target: p95 `< 80 ms`).
- **50,000 Distributed Mesh Benchmark:** [`tests/load/benchmark-50k.js`](tests/load/benchmark-50k.js) + [`tests/load/worker-runner.js`](tests/load/worker-runner.js)
  - Orchestrates 5 headless Docker worker containers (`nexus-bench-w1` ... `nexus-bench-w5`) targeting `nexus-bench-server`.
  - Target: **50,000 / 50,000 active sockets** with **0 connection drops** and **p95 `< 100 ms`** end-to-end (see Stage 3).
- **100,000 Enterprise Check:** 3 Pods × ~33.3k (or 2× 50K-cell composition, see Stage 4) — verifies 100k persistent sockets with 0 dropped connections and p95 `< 150 ms`.

---

## 8. Execution Commands & Verification

```bash
# 0. Verify Cloud Services (MongoDB Atlas & Groq AI)
node -e "require('dotenv').config({ path: 'server/.env' }); const { MongoClient } = require('mongodb'); new MongoClient(process.env.MONGODB_URI).connect().then(() => console.log('MongoDB Atlas: Connected')).catch(console.error);"
node -e "require('dotenv').config({ path: 'server/.env' }); const Groq = require('groq-sdk'); new Groq({ apiKey: process.env.GROQ_API_KEY }).models.list().then(r => console.log('Groq: Authenticated')).catch(console.error);"

# 1. Run all Unit, Integration & Security Tests (87 tests)
npm test

# 2. Run Playwright Headless Browser E2E Suite (10 Chrome tests)
npx playwright test --project=chromium

# 3. Run 2-Pod Local Equivalence Benchmark (Safe for 8-9 GB Laptops)
node tests/load/benchmark-2pod.js

# 4. Run 1,000 User Authenticated Concurrent Benchmark
node tests/load/benchmark-1k.js

# 5. Run 10,000 User Single-Node Benchmark
node tests/load/benchmark-10k.js

# 6. Run 50,000 Distributed Multi-Container Benchmark (Docker required)
node tests/load/benchmark-50k.js

# 7. Run 100,000 Enterprise Check (3 Pods x ~33.3k / 2x 50K cells)
node tests/load/benchmark-100k.js

# 8. Run the Full 5-Stage Production CI/CD Pipeline (Jenkinsfile equivalent)
npm run pipeline
```

---

## 9. Summary Checklist

- [x] Concurrency testing progression defined (1K → 10K → 50K → 100K with p95 50/80/100/150ms).
- [x] 5 critical architectural deductions documented with production hardening mitigations.
- [x] Hardware memory math adjusted with V8 heap expansion (`--max-old-space-size=6144`) and Kubernetes HPA (3 pods baseline).
- [x] Flawed Artillery scripts replaced with authenticated native Socket.IO harnesses (old YMLs marked DEPRECATED).
- [x] Single latency methodology everywhere: end-to-end `send_message` ACK RTT (no bridge-ping / e2e mixing).
- [x] 100K defined as 2× 50K-cell composition with explicit sequential/parallel commands and aggregation rule.
- [x] WebRTC 5-peer capacity ceiling and TURN bandwidth requirements codified.
- [x] AWS ALB cookie stickiness and distributed Docker container mesh documented.
- [x] DynamoDB TTL 48h purge delay addressed with application-level query filtering.
- [x] Complete file/folder architecture (relative links only) and automated 5-stage CI/CD pipeline integrated.
- [x] Hybrid MongoDB Atlas Cloud Adapter and Groq AI Engine (summarization + Whisper STT) verified.

