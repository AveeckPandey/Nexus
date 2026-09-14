# Nexus — AWS Cloud Architecture & Implementation Guide

This document specifies the complete cloud infrastructure, AWS implementation architecture, and detailed rationale for each tool and service used across the **Nexus** platform.

---

## 1. High-Level Architecture Overview

Nexus uses a cloud-native, zero-knowledge architecture deployed across AWS multi-AZ infrastructure. Private end-to-end encrypted payload storage, real-time WebSocket communication, media streaming, and identity management are decoupled across specialized AWS managed services.

```mermaid
flowchart TD
    subgraph Clients["Clients & Edge"]
        User["Next.js Web Client\n(Browser / Mobile Web)"]
        CF["Amazon CloudFront CDN\n(Cached Media & Assets)"]
    end

    subgraph Ingress["Networking & Ingress (VPC)"]
        ALB["AWS Application Load Balancer\n(TLS Termination + Canary Routing)"]
        NAT["NAT Gateways\n(Outbound Internet for Private Subnets)"]
    end

    subgraph Compute["Compute & Orchestration (EKS)"]
        ServerPod["NestJS API Pods\n(Fastify + Socket.IO)"]
        WebPod["Next.js Web Pods\n(SSR & Static Frontend)"]
        CoturnPod["Coturn Pods\n(STUN / TURN for WebRTC)"]
    end

    subgraph State["State, Caching & Real-Time Sync"]
        DynamoDB[("Amazon DynamoDB\n(Single-Table: NexusTable)\nOn-Demand + TTL + GSI1")]
        ElastiCache[("Amazon ElastiCache for Redis 7.1\nMulti-AZ Cluster\nSocket.IO Adapter")]
    end

    subgraph Media["Storage & Object Pipeline"]
        S3[("Amazon S3 Media Bucket\nPrivate + Encrypted (AES256)\nPresigned Uploads")]
    end

    subgraph Security["Identity & Security"]
        Cognito["AWS Cognito User Pools\n(SRP / Password / JWTs)"]
        IRSA["AWS IAM & IRSA\n(OIDC Pod-Level IAM Roles)"]
        Secrets["AWS Secrets Manager\n(Credentials & Connection Strings)"]
    end

    subgraph Intelligence["AI & Translation"]
        Translate["Amazon Translate\n(Real-Time In-Chat Translation)"]
        GroqBedrock["Groq / Bedrock LLM\n(Nexus AI In-Chat Assistant)"]
    end

    User -->|HTTPS / WSS| ALB
    User -->|Direct Media Download| CF
    CF -->|Origin Access Control (OAC)| S3
    User -->|Presigned Direct Upload| S3

    ALB --> ServerPod
    ALB --> WebPod
    CoturnPod -.->|P2P Fallback Relay| User

    ServerPod -->|IRSA Authenticated| DynamoDB
    ServerPod -->|Socket.IO Redis Adapter| ElastiCache
    ServerPod -->|Presigned URL Generation| S3
    ServerPod -->|JWT Validation & Admin Auth| Cognito
    ServerPod -->|TranslateText| Translate
    ServerPod -->|LLM Queries| GroqBedrock

    ServerPod -.->|AssumeRole via OIDC| IRSA
    ServerPod -.->|Read Redis Secret| Secrets
```

---

## 2. Tools & Services Matrix: What We Use and Why

| Category | Service / Tool | Primary Purpose in Nexus | Technical Rationale & Why We Use It |
| :--- | :--- | :--- | :--- |
| **Compute** | **Amazon EKS** *(Elastic Kubernetes Service)* | Container orchestration for backend (`server`), frontend (`web`), and WebRTC relay (`coturn`). | • High-availability multi-AZ pod scheduling.<br>• Native Horizontal Pod Autoscaler (HPA) for traffic spikes.<br>• Seamless canary ingress deployments (90/10 traffic split).<br>• Eliminates single-VM points of failure. |
| **Containers** | **Amazon ECR** *(Elastic Container Registry)* | Docker image registry with automated CVE scanning on push. | • High-speed internal network pull to EKS worker nodes.<br>• Immutable image tags for deterministic rollbacks.<br>• Automated vulnerability scanning detects CVEs before pod deployment. |
| **Database** | **Amazon DynamoDB** | Single-table NoSQL database (`NexusTable`) storing users, conversations, messages, and keys. | • Predictable single-digit millisecond latency at scale.<br>• On-Demand capacity (`PAY_PER_REQUEST`) handles spiky traffic without over-provisioning.<br>• Native TTL automatically purges ephemeral ghost chats without cron jobs.<br>• Zero server patching or maintenance overhead. |
| **Caching / PubSub** | **Amazon ElastiCache for Redis 7.1** | Multi-AZ Redis replication group powering `@socket.io/redis-adapter`. | • Coordinates real-time WebSocket events across distributed multi-pod EKS deployments.<br>• Sub-millisecond cross-pod pub/sub message broadcasting.<br>• In-transit TLS and at-rest encryption protect message tokens.<br>• Automatic failover across availability zones. |
| **Object Storage** | **Amazon S3** | Storage bucket for encrypted media, images, videos, documents, and voice notes. | • 99.999999999% (11 9's) durability.<br>• Presigned URLs allow direct client-to-S3 uploads, keeping media payloads off API servers.<br>• Server-Side Encryption (`AES256`) and strict bucket policies block public access. |
| **Content Delivery** | **Amazon CloudFront** | Global Content Delivery Network with Origin Access Control (OAC). | • Accelerates media downloads worldwide through edge locations.<br>• Protects S3 origins: S3 bucket is 100% private; only CloudFront OAC can fetch objects.<br>• Reduces AWS egress data costs compared to direct S3 downloads. |
| **Identity & Auth** | **AWS Cognito User Pools** | User directory, credential storage, password policies, and JWT token issuance. | • Eliminates risk of storing raw user passwords on application databases.<br>• Built-in SRP (Secure Remote Password) protocol and refresh token rotation.<br>• Enforces strong password rules and account recovery mechanisms.<br>• Verified directly in NestJS via `aws-jwt-verify`. |
| **Pod Security** | **AWS IAM with IRSA** *(IAM Roles for Service Accounts)* | Fine-grained AWS permissions assigned directly to Kubernetes ServiceAccounts. | • Zero hardcoded AWS Access Keys or Secrets in Kubernetes pods or Git repositories.<br>• Uses short-lived OIDC web-identity tokens automatically rotated by AWS SDK v3.<br>• Follows the principle of least privilege per workload. |
| **Secrets** | **AWS Secrets Manager** | Centralized encryption and rotation of database credentials and API keys. | • Securely stores Redis credentials (`REDIS_URL`) and 3rd-party keys.<br>• Central audit trail via AWS CloudTrail.<br>• Programmatic runtime retrieval prevents config sprawl. |
| **Language & AI** | **Amazon Translate** | Inline chat translation for cross-language real-time communication. | • Neural machine translation with automatic language detection.<br>• Sub-100ms API response time.<br>• Directly integrates with AWS SDK v3 (`TranslateTextCommand`). |
| **Networking** | **Amazon VPC** *(Virtual Private Cloud)* | Isolated private network topology with public/private subnets and NAT Gateways. | • Complete isolation: databases and Redis clusters live in private subnets with no public IPs.<br>• NAT Gateways provide secure outbound internet access for pods.<br>• Security Groups enforce strict port-level ingress/egress rules. |
| **Traffic Ingress** | **AWS ALB** *(Application Load Balancer)* | Layer 7 load balancer with AWS Load Balancer Controller. | • Handles SSL/TLS termination with AWS Certificate Manager (ACM).<br>• Supports sticky sessions and native WebSocket upgrades (`ws://` / `wss://`).<br>• Enables canary ingress weight routing (e.g., 90% production / 10% canary). |
| **IaC** | **Terraform** *(HashiCorp AWS Provider v5)* | Declarative Infrastructure as Code defining all AWS resources. | • Reproducible, version-controlled cloud environments.<br>• Prevents manual drift and misconfigurations.<br>• Modular structure (`infra/terraform/`) separates network, storage, database, and auth. |
| **Application SDK** | **AWS SDK for JavaScript v3** | Modular client libraries in NestJS (`@aws-sdk/*`). | • Tree-shakeable modular imports reduce bundle size and memory usage.<br>• Built-in retry logic, exponential backoff, and SigV4 request signing.<br>• Native support for IRSA credentials without custom token refresh logic. |

---

## 3. Deep-Dive: Implementation Details

### 3.1 Single-Table DynamoDB Design (`NexusTable`)

Nexus uses an advanced single-table design pattern in DynamoDB. All entities (Users, Conversations, Messages, Envelopes, Ghost Chats) share a single table partitioned for sub-millisecond retrieval.

- **Table Name:** `NexusTable`
- **Billing Mode:** `PAY_PER_REQUEST` (On-Demand)
- **Primary Keys:**
  - **Partition Key (`PK`):** String (Entity namespace, e.g., `USER#<id>`, `CONV#<id>`, `AUTH#<email>`)
  - **Sort Key (`SK`):** String (Sub-namespace, e.g., `PROFILE`, `METADATA`, `MSG#<timestamp>`, `KEY#<userId>`)
- **Global Secondary Index (`GSI1`):**
  - **GSI1PK:** Query by type or secondary identifier (`GSI1PK = "TYPE#direct"`, `GSI1PK = "EMAIL#<email>"`)
  - **GSI1SK:** Sorting and temporal queries (`GSI1SK = "UPDATED#<iso>"`, `GSI1SK = "CREATED#<iso>"`)
  - **Projection:** `ALL`
- **Automated TTL Attribute:** `expire_at`
  - Used for Ghost Chats: when a message's 30-second countdown triggers, or a single-use invite expires, DynamoDB automatically purges the row without consuming write capacity.

#### Schema Entity Layout

| Entity | `PK` | `SK` | Key Attributes / Payload |
| :--- | :--- | :--- | :--- |
| **User Profile** | `USER#<userId>` | `PROFILE` | `username`, `name`, `email`, `x25519PublicKey`, `avatarUrl`, `isOnline` |
| **Auth Credential** | `AUTH#<cleanEmail>` | `CRED` | `userId`, `email`, `salt`, `hash`, `createdAt` *(Local/dev fallback)* |
| **User Conversation** | `USER#<userId>` | `CONV#<convId>` | `conversationId`, `role`, `joinedAt`, `cachedTitle`, `cachedType` |
| **Conversation Meta** | `CONV#<convId>` | `METADATA` | `type`, `title`, `participants[]`, `createdAt`, `updatedAt` |
| **Chat Message** | `CONV#<convId>` | `MSG#<createdAt>#<msgId>` | `senderId`, `senderName`, `content` (ciphertext), `nonce`, `isEncrypted`, `mediaUrl` |
| **E2EE Key Envelope** | `CONV#<convId>` | `KEY#<recipientUserId>` | `encryptedKey` (sealed conv key), `nonce`, `senderPub`, `keyVersion` |
| **Ghost Chat Invite** | `INVITE#<token>` | `METADATA` | `conversationId`, `creatorId`, `isConsumed`, `expire_at` (TTL timestamp) |

---

### 3.2 Media Upload Pipeline: Presigned S3 + CloudFront OAC

To guarantee maximum speed and security, user media (photos, videos, audio notes) **never touches the backend application servers**.

```
Client (Browser)
   │
   ├─► 1. POST /api/media/presigned-url ─────────► NestJS API
   │                                                   │
   │   ◄─── Returns uploadUrl (S3) & mediaUrl (CDN) ───┤
   │
   ├─► 2. Direct HTTP PUT upload ────────────────► Amazon S3 (Private Bucket)
   │
   └─► 3. Send message with CDN URL ─────────────► Socket.IO / DynamoDB
                                                       │
Other Clients ◄── Fetch via CloudFront CDN ────────────┘
```

1. **Upload Request:** Client requests an upload ticket specifying MIME type (`image/png`, `video/mp4`, `audio/webm`).
2. **Presigned Generation:** NestJS creates an S3 Presigned URL via `@aws-sdk/s3-request-presigner` expiring in **15 minutes**.
3. **Direct Upload:** Browser PUTs binary data directly to `https://<bucket>.s3.amazonaws.com/<key>`. S3 validates Content-Type and CORS headers.
4. **Secure Distribution:** Media is served through CloudFront (`https://<distribution-id>.cloudfront.net/<key>`). CloudFront uses **Origin Access Control (OAC)** with SigV4 authentication. Direct access to S3 is blocked by bucket policy.

---

### 3.3 Multi-Pod WebSocket Scaling: ElastiCache Redis 7.1

When running multiple NestJS pods behind an Application Load Balancer, a client connected to Pod A needs to receive messages sent by a client connected to Pod B.

- **Engine:** Redis 7.1 Multi-AZ Replication Group.
- **Socket.IO Integration:** `@socket.io/redis-adapter` with `ioredis`.
- **Pub/Sub Channel Topology:**
  - Pods subscribe to conversation rooms (`<conversationId>`) and direct user queues (`USER#<userId>`).
  - When Pod A saves a message, it emits to the Redis adapter; Redis fans out the payload to Pod B and Pod C within **< 2ms**, delivering the event to all active client sockets.
- **Security:**
  - Placed inside private VPC subnets.
  - Ingress allowed **only** from the EKS worker node security group on port `6379`.
  - Transit encryption (TLS) and at-rest encryption enabled with authentication token stored in AWS Secrets Manager.

---

### 3.4 Identity & Token Lifecycle: AWS Cognito + `aws-jwt-verify`

Nexus integrates with AWS Cognito User Pools for production identity:

1. **Sign-Up & SRP Authentication:** Clients authenticate against Cognito using `USER_PASSWORD_AUTH` or SRP.
2. **Client Secret Protection:** NestJS computes `SECRET_HASH` via HMAC-SHA256 (`cognitoSecretHash()`) before communicating with Cognito.
3. **Token Verification:** Every REST request and WebSocket connection handshake transmits the Cognito JWT:
   - Verified cryptographically via `aws-jwt-verify` (`CognitoJwtVerifier`).
   - Verifies signature against Cognito's JWKS (JSON Web Key Set), validates `iss`, `aud`, and expiration timestamp.
4. **Local Development Fallback:** If Cognito environment variables are omitted, Nexus seamlessly switches to an embedded PBKDF2/SHA-512 authentication engine with HMAC-SHA256 session tokens.

---

### 3.5 Kubernetes Orchestration (EKS) & Canary Deployments

The Kubernetes manifest directory (`infra/k8s/`) implements zero-downtime, production-grade workloads:

- **Namespace:** `nexus`
- **IAM for Service Accounts (IRSA):**
  - Pods use `nexus-server-sa` service account annotated with `eks.amazonaws.com/role-arn: arn:aws:iam::<account>:role/nexus-server-irsa`.
  - AWS SDK automatically discovers credentials via the injected `/var/run/secrets/eks.amazonaws.com/serviceaccount/token`.
- **Horizontal Pod Autoscaler (HPA):**
  - Min replicas: 2, Max replicas: 10.
  - Triggers scale-out at 70% CPU utilization or 80% Memory utilization.
- **Canary Deployment (`12-server-canary.yaml` & `31-canary-ingress.yaml`):**
  - NGINX / ALB Ingress weight annotation:
    ```yaml
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "10"
    ```
  - Routes 10% of production traffic to canary pods to verify new versions before full promotion.

---

## 4. Security & Compliance Matrix

| Security Domain | Implementation Standard |
| :--- | :--- |
| **Message Confidentiality** | NaCl Secretbox (`XSalsa20-Poly1305`, 256-bit symmetric keys). Server and AWS store opaque ciphertext only. |
| **Key Distribution** | Asymmetric `X25519` key exchange (`nacl.box`). Keys sealed client-side before upload to DynamoDB. |
| **Data at Rest** | • DynamoDB: AWS KMS Customer Managed Key or AWS Default Encryption.<br>• S3: `AES256` Server-Side Encryption.<br>• ElastiCache: Encrypted at rest. |
| **Data in Transit** | • HTTPS / WSS enforced with TLS 1.3.<br>• CloudFront enforces `redirect-to-https`.<br>• ElastiCache requires `rediss://` TLS in-transit encryption. |
| **Credential Management** | Zero static IAM keys in pods. All AWS permissions handled via IRSA web identity tokens. |
| **Vulnerability Scanning** | ECR automated image scanning on push alerts on CVEs. |

---

## 5. Environment Variables & Configuration

Below are the AWS-specific variables configured in `server/.env`:

```ini
# AWS Region & Credentials (IRSA automatically provides these in EKS)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# AWS Cognito Identity
COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxx

# Amazon DynamoDB
DYNAMODB_TABLE_NAME=NexusTable
DYNAMODB_ENDPOINT=

# Amazon S3 & CloudFront
S3_BUCKET_NAME=nexus-chat-media-storage
CLOUDFRONT_DOMAIN=d111111abcdef8.cloudfront.net

# Amazon ElastiCache for Redis
REDIS_URL=rediss://default:password@nexus-redis.xxxxxx.use1.cache.amazonaws.com:6379
```

---

## 6. Infrastructure Provisioning Runbook

To provision the complete AWS infrastructure using Terraform:

### Step 1: Initialize and Plan
```bash
cd infra/terraform
terraform init
terraform plan -out=nexus-infra.tfplan
```

### Step 2: Apply Infrastructure
```bash
terraform apply nexus-infra.tfplan
```

### Step 3: Configure `kubectl` for EKS
```bash
aws eks update-kubeconfig --region us-east-1 --name nexus-production-eks
```

### Step 4: Deploy Kubernetes Workloads
```bash
kubectl apply -f ../k8s/00-namespace.yaml
kubectl apply -f ../k8s/01-serviceaccount.yaml
kubectl apply -f ../k8s/02-configmap.yaml
kubectl apply -f ../k8s/03-secrets.yaml
kubectl apply -f ../k8s/
```

### Step 5: Verify Deployment Status
```bash
kubectl get pods -n nexus -o wide
kubectl get ingress -n nexus
```
