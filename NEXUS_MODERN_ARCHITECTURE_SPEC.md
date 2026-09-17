# Nexus — Tailored Production Architecture Specification
## Unified Architecture: AWS Managed Free Services + High-Performance Compute & State

---

## 1. Architectural Blueprint (Tailored to Your Stack)

```mermaid
flowchart TD
    subgraph ClientTier["1. Clients & Ingress"]
        ClientA["Client A (Mobile / Web)"]
        ClientB["Client B (Mobile / Web)"]
        CF_Edge["Cloudflare Global Anycast Edge\n• DNS (<10ms) • Global CDN Caching\n• WAF & DDoS Shield • Universal SSL\n• Cloudflare Tunnel (0 Public Ports)"]
    end

    subgraph AuthTier["2. Identity & Authentication (AWS Managed)"]
        Cognito["AWS Cognito User Pools (nexus-prod-users)\n• 100% Free Tier (Up to 50k MAUs)\n• SRP Auth + Signed JWT Tokens\n• Verified locally via aws-jwt-verify"]
    end

    subgraph ComputeTier["3. High-Performance Compute (Hetzner CPX31 / K3s)"]
        LB["Traefik / Caddy Layer 7 Reverse Proxy"]
        FastifyPods["NestJS Fastify API & WebSocket Pods\n• Stateless REST API\n• Socket.IO Real-Time Gateway\n• In-Memory Snowflake ID Engine\n• CognitoAuthGuard (Local JWKS Verification)"]
        NextPods["Next.js 14 SSR Web Pods"]
        CoturnPod["COTURN WebRTC Relay Pod\n(Raw UDP & TCP 3478, TLS 443 Fallback)"]
    end

    subgraph StateTier["4. State, Sync & Routing Engine (Replaces ZooKeeper)"]
        RedisCluster[("Valkey / Redis 7.2 State Engine\n• Socket Connection Mapping (HSET user:mapping)\n• Presence Store (presence:userId with 60s TTL)\n• Socket.IO Redis Adapter\n• Rate Limiting & Session Storage")]
    end

    subgraph PersistenceTier["5. Persistent Storage (AWS Managed Free Tiers)"]
        DynamoDB[("Amazon DynamoDB (NexusTable)\n• Single-Table Partitioned Design\n• 100% Free Tier (25 GB + 25 RCU/WCU)\n• Native TTL for Ephemeral Ghost Messages")]
        S3Bucket[("Amazon S3 (nexus-media-758388043025)\n• 11 9's Durability Object Storage\n• Presigned Direct Client PUT Uploads\n• Private & Encrypted at Rest (AES-256)")]
    end

    subgraph NotificationTier["6. Real-Time Push Pipeline"]
        NotifService["Notifications Service\n(Triggered when recipient is offline)"]
        APN["APNs (Apple Push for iOS)"]
        FCM["FCM (Firebase for Android)"]
        WebPush["VAPID WebPush (Browsers)"]
    end

    ClientA -->|1. Authenticate & Obtain JWT| Cognito
    ClientB -->|1. Authenticate & Obtain JWT| Cognito

    ClientA -->|2. HTTPS / WSS with Bearer JWT| CF_Edge
    ClientB -->|2. HTTPS / WSS with Bearer JWT| CF_Edge
    CF_Edge -->|Encrypted Tunnel| LB

    LB -->|/api/* & /socket.io/*| FastifyPods
    LB -->|/*| NextPods

    ClientA -.->|P2P Audio/Video Fallback| CoturnPod
    CoturnPod -.-> ClientB

    FastifyPods <-->|3. Connection Mapping & Presence| RedisCluster
    FastifyPods <-->|4. Real-Time Fanout (Socket.IO Adapter)| RedisCluster
    FastifyPods -->|5. Single-Table Database Operations| DynamoDB
    FastifyPods -->|6. Presigned S3 Upload URLs| S3Bucket
    ClientA -->|Direct Binary Media Upload| S3Bucket

    FastifyPods -->|7. If Recipient Offline| NotifService
    NotifService --> APN
    NotifService --> FCM
    NotifService --> WebPush
```

---

## 2. Component-by-Component Mapping (Your Exact Stack)

| Architectural Role | Selected Technology | Pricing / Tier | Technical Function in Nexus |
| :--- | :--- | :--- | :--- |
| **Edge, DNS & WAF** | **Cloudflare** | **$0.00 (Free Tier)** | Anycast DNS (<10ms), global CDN static caching, unmetered L3/4/7 DDoS mitigation, and Cloudflare Tunnel. |
| **Authentication** | **AWS Cognito User Pools** (`nexus-prod-users`) | **$0.00 (Free up to 50,000 MAUs)** | Manages user credentials, password policies, and issues signed JWTs verified locally in NestJS via `aws-jwt-verify`. |
| **Media Object Storage** | **Amazon S3** (`nexus-media-758388043025`) | **Free Tier (5 GB)** | Presigned PUT URLs enable direct client-to-S3 uploads, keeping heavy media off API servers. |
| **Database Persistence** | **Amazon DynamoDB** (`NexusTable`) | **$0.00 (Free Tier 25 GB + 25 RCU/WCU)** | Single-table design storing users, channels, messages, and cryptographic keys with native TTL ghost chat purge. |
| **Compute & Containers** | **Hetzner CPX31 (or Single AWS t3.micro)** | **~$13.50 / mo (or $0.00 on AWS t3.micro)** | Runs NestJS Fastify API, Next.js SSR, and COTURN in Docker without execution timeouts or memory limits. |
| **Cluster Mapping & State**| **Local Valkey / Redis 7.2** | **$0.00 (Included in Compute)** | **ZooKeeper is eliminated.** Redis Hashes (`HSET user:mapping`) track socket connections; Redis TTL tracks online presence. |
| **Real-Time Push Alerts** | **Notifications Service (Expo + VAPID)** | **$0.00** | Triggers native push notifications (APNs, FCM, WebPush) when messages arrive for offline users. |
| **Transactional Email** | **NONE (Not Needed)** | **$0.00** | Dropped entirely per project requirements. |
| **WebRTC Media Relay** | **COTURN Container** | **$0.00** | Provides STUN/TURN fallback on raw UDP/TCP 3478 for peer connections behind symmetric NATs. |

---

## 3. The Simplified Message Lifecycle (Client A $\rightarrow$ Client B)

1. **Authentication:** Client A authenticates directly with **AWS Cognito** over HTTPS; Cognito validates credentials and returns signed JWT tokens.
2. **Message Ingress:** Client A emits `send_message` over WebSocket carrying the Cognito JWT. Cloudflare routes packets to a **NestJS Fastify pod**.
3. **Local JWT Verification:** NestJS cryptographically validates the token against Cognito's JWKS in memory (< 0.05 ms).
4. **Unique ID Generation:** Fastify generates a 64-bit **Snowflake ID** in memory (< 0.001 ms).
5. **Database Persistence:** Fastify writes the message envelope to **Amazon DynamoDB (`NexusTable`)**.
6. **Recipient Routing (Replaces ZooKeeper):** Fastify queries **Redis**: `HGET user:mapping client_b`:
   * **If Client B is Online:** Redis Pub/Sub fans out the payload to the socket holding Client B (< 15 ms).
   * **If Client B is Offline:** Fastify triggers `NotificationsService` $\rightarrow$ dispatches **APNs / FCM / WebPush** push alert!
7. **Presence Tracking:** Client devices periodically ping the Redis presence key (`presence:<userId>` with 60s TTL), keeping the online/offline badges active across screens.
