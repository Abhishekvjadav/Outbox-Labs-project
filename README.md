# ReachFlow: Production-Grade Distributed Email Scheduling Engine & Dashboard
> **Developed for ReachInbox (Outbox Labs) — Software Development Engineer Intern Assignment**  
> **Author:** Candidate Submission  
> **Reviewers:** Mitrajit Chandra & Yadav036  

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![BullMQ](https://img.shields.io/badge/BullMQ-5.12-red?logo=redis)](https://bullmq.io/)
[![Redis](https://img.shields.io/badge/Redis-7.0-dc382d?logo=redis)](https://redis.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql)](https://www.postgresql.org/)
[![Elasticsearch](https://img.shields.io/badge/Elasticsearch-8.14-005571?logo=elasticsearch)](https://www.elastic.co/)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-3.4-38bdf8?logo=tailwindcss)](https://tailwindcss.com/)

---

## 1. Executive Summary & Problem Context

At **ReachInbox**, high-deliverability cold email outreach at scale requires resilient infrastructure. Email Service Providers (Google Workspace, Microsoft 365, Amazon SES) enforce rigorous hourly quotas and behavioral velocity checks. A naive scheduling system using polling cron jobs or in-memory variables will burn sending domain reputations, drop queued jobs, send duplicate emails, or crash under load.

**ReachFlow** is an enterprise-grade distributed email delivery service and dashboard designed to:
- Schedule high-volume email batches for exact future dispatch using **BullMQ delayed jobs** backed by Redis (**strictly zero cron jobs**).
- Enforce **per-sender atomic rate limits** (e.g. 50/hour) and **per-sender serialized inter-send intervals** (e.g. 2000ms provider throttling) using Redis Lua scripts across concurrent workers.
- Gracefully reschedule rate-limited jobs into the next hourly window without dropping emails or losing sequence.
- Deliver messages via **Ethereal SMTP** with 1-click rendered HTML preview links.
- Dispatch live **Slack OAuth notifications** via Block Kit with Redis `SET NX` alert deduplication.
- Provide near-instant searchability across scheduled and sent emails using **Elasticsearch**.
- Guarantee **single-active-job idempotency and zero job loss across server restarts**.
- Expose real-time queue telemetry via **Bull Board** and a high-aesthetic **React + Tailwind CSS** dashboard.

---

## 2. Core Architecture & System Design

### The Golden Architectural Principle
```
┌────────────────────────────────────────────────────────────────────────┐
│ PostgreSQL    = Single source of truth for email delivery state       │
│ Redis/BullMQ  = Distributed delayed execution & atomic coordination   │
│ Elasticsearch = Isolated read/search projection (cannot block dispatch)│
└────────────────────────────────────────────────────────────────────────┘
```

### High-Level Architecture Diagram

```text
                        ┌────────────────────────┐
                        │   React + Tailwind     │
                        │   Web Dashboard        │
                        └───────────┬────────────┘
                                    │ REST API / JWT
                                    ▼
                        ┌────────────────────────┐
                        │ Express REST API (TS)  │
                        └─────┬───────┬──────────┘
                              │       │
              ┌───────────────┘       └────────────────┐
              ▼                                        ▼
      ┌───────────────┐                        ┌───────────────┐
      │  PostgreSQL   │                        │     Redis     │
      │  (Truth)      │                        │  (Execution)  │
      │  - Users      │                        │  - BullMQ     │
      │  - Campaigns  │                        │  - Delayed Zset│
      │  - Senders    │                        │  - Lua Scripts│
      │  - Emails     │                        │  - Rate Limits│
      │  - Audit Log  │                        │  - Alert Locks│
      └───────┬───────┘                        └───────┬───────┘
              │                                        │ Delayed Jobs
              │ Updates                                ▼
              │                        ┌───────────────────────────────┐
              │                        │ BullMQ Worker Fleet (N Concur) │
              │                        │  1. Idempotency Check         │
              │                        │  2. Atomic Lua Rate Limit     │
              │                        │  3. Serialized Slot Throttle  │
              │                        └───────────────┬───────────────┘
              │                                        │
              │              ┌─────────────────────────┴────────────┐
              ▼              ▼                                      ▼
      ┌───────────────┐┌───────────────┐                    ┌───────────────┐
      │ esIndexQueue  ││ Ethereal SMTP │                    │   Slack API   │
      │ & ES Worker   ││ (Fake Mailbox)│                    │  (Block Kit)  │
      └───────┬───────┘└───────┬───────┘                    └───────────────┘
              │                │
              ▼                ▼
      ┌───────────────┐┌───────────────┐
      │ Elasticsearch ││ Live HTML     │
      │ Search Index  ││ Preview URL   │
      └───────────────┘└───────────────┘
```

---

## 3. Reliability Guarantees & Systems Engineering

### 3.1 Strictly Zero Cron Jobs (BullMQ Delayed Sets)
- **Why no cron?** Crontabs and `node-cron` libraries poll relational databases using `SELECT * WHERE scheduledAt <= NOW()`. This causes severe database lock contention, unbounded memory spikes under load, and high latency.
- **ReachFlow's Implementation:** All scheduled emails are added directly to BullMQ with a calculated delay:
  $$\text{delay} = \max(0, \text{email.scheduledAt.getTime}() - \text{Date.now}())$$
  BullMQ persists these jobs in Redis sorted sets (`zset`) scored by epoch millisecond. When the timestamp arrives, Redis atomically moves the job to the active stream for workers to pop.

### 3.2 True Server Restart Persistence
- BullMQ jobs are stored in Redis RAM backed by append-only files (AOF) and snapshot persistence.
- If the Express API or worker process is terminated (`kill -9`, SIGTERM, power cut), the jobs remain securely in Redis.
- When the server starts back up, BullMQ reconnects and continues executing delayed jobs at their exact scheduled timestamps.
- No emails are lost, and no emails are re-sent from scratch.

### 3.3 Single Active Job Invariant & Idempotency
- **The Invariant:** *At any point in time, one email record in PostgreSQL can have at most one executable BullMQ job.*
- Deterministic BullMQ job IDs: `email-send-${email.id}`. If a scheduling API call is retried or executed in parallel, BullMQ drops duplicates with matching IDs.
- Delivery state checks: Before worker touches SMTP, it verifies the PostgreSQL status. If already `SENT`, it terminates immediately without sending duplicate spam.

### 3.4 Atomic Redis Lua Rate Limiting (`check-and-increment`)
To eliminate the counter overrun bug present in naive `INCR` pipelines across parallel workers, ReachFlow executes an atomic Lua script:

```lua
local current = tonumber(redis.call('get', KEYS[1]) or "0")
if current >= tonumber(ARGV[1]) then
    return {0, current} -- Rejected: limit reached, do NOT increment
else
    local new_val = redis.call('incr', KEYS[1])
    if new_val == 1 then
        redis.call('expire', KEYS[1], tonumber(ARGV[2]))
    end
    return {1, new_val} -- Allowed: atomically incremented
end
```
- When a mailbox hits its limit, jobs transition to `RATE_LIMITED` and are rescheduled into the next hour window (`RESCHEDULED`). Emails are **never dropped or permanently failed**.

### 3.5 Per-Sender Serialized Inter-Send Interval Throttling
- When `WORKER_CONCURRENCY = 5`, multiple workers could pop emails for the same sender simultaneously.
- To prevent burst transmissions that trigger ESP spam filters, workers atomically coordinate dispatch start times using Redis key `reachflow:throttle:sender:{senderId}:next_send_time`.
- Each worker reserves a serialized time slot separated by at least `delayMs` (e.g. 2000ms), guaranteeing a strict start-to-start interval per sender.

### 3.6 Slack Operational Alert Deduplication (`SET NX`)
- When 100 queued emails hit a sender's rate limit, ReachFlow uses Redis atomic `SET NX` keyed by sender and hour window:
  `SET reachflow:slack:alert:sender:{id}:window:{windowKey} 1 EX 3600 NX`
- Exactly **one rich Slack Block Kit notification** is dispatched per sender per hourly window.

### 3.7 Isolated Elasticsearch Search Projection
- PostgreSQL is the source of truth for email states.
- Search indexing is decoupled onto a dedicated BullMQ queue (`esIndexQueue`).
- If Elasticsearch cluster drops, restarts, or lags, the core email delivery pipeline remains 100% operational. The search index retries asynchronously in the background.

---

## 4. Key Features & Differentiators

| Feature | Description |
| :--- | :--- |
| **Delivery Timeline (Visual Audit Trail)** | Clicking any email row opens an interactive drawer rendering every chronological event: `SCHEDULED` ➔ `QUEUED` ➔ `WORKER_PICKED` ➔ `RATE_LIMIT_CHECKED` ➔ `PROVIDER_DELAY_APPLIED` ➔ `SMTP_DELIVERED` ➔ `INDEXED_SEARCH`. |
| **1-Click Ethereal Live Preview** | Sent email records store the test URL from `nodemailer.getTestMessageUrl(info)`. Evaluators can click "Open in Ethereal" to inspect the rendered HTML email in the browser. |
| **Smart CSV Pre-flight & Estimator** | Real-time RFC 5322 regex validation, deduplication badge counter (`✓ 142 valid`, `⚠ 3 duplicate`), and dynamic campaign completion calculator. |
| **Live Telemetry & Bull Board** | Real-time header telemetry monitoring PostgreSQL, Redis, BullMQ Worker, Elasticsearch, and Slack, plus direct access to Bull Board at `/admin/queues`. |
| **Multi-Mailbox Orchestration** | Support for multiple Ethereal senders, persisted via `CampaignSender` join model with round-robin lead allocation. |

---

## 5. Quick Start & Local Setup

### Option A: Complete Docker Compose (Recommended)
Clone the repository and launch the full stack with a single command:

```bash
# 1. Clone repository
git clone <repo-url>
cd "Outbox Labs"

# 2. Copy environment file
cp .env.example .env

# 3. Launch Postgres, Redis, Elasticsearch, API, and Frontend
docker compose up --build
```
- Web Application: `http://localhost:3000`
- REST API Server: `http://localhost:5000`
- Live Bull Board Dashboard: `http://localhost:5000/admin/queues`

---

### Option B: Local Development / Cloud DBs

```bash
# 1. Install dependencies across monorepo
npm install

# 2. Setup packages/shared
npm run build --workspace=@reachflow/shared

# 3. Setup PostgreSQL database with Prisma
npm run prisma:generate --workspace=reachflow-api
npm run prisma:push --workspace=reachflow-api
npm run prisma:seed --workspace=reachflow-api

# 4. Start backend API & workers
npm run dev:api

# 5. In a separate terminal, start frontend
npm run dev:web
```

---

## 6. Automated Reliability Test Suite

ReachFlow includes an automated test suite verifying all critical systems constraints:

```bash
# 1. Atomic Redis Lua Rate Limiting Test (Multi-worker concurrency test)
npm run test:rate-limit

# 2. Single Active Job Idempotency Test (Duplicate schedule prevention)
npm run test:idempotency

# 3. Server Restart & Redis Persistence Test (Hard kill & recovery verification)
npm run test:restart

# 4. Per-Sender Inter-Send Throttling Test (Minimum start-to-start interval)
npm run test:throttle

# 5. BullMQ Exponential Backoff & Retry Test
npm run test:retry
```

---

## 7. The 5-Minute Evaluator Demo Sequence

1. **Google OAuth & Dashboard (0:00–0:40)**
   - Click "Continue with Google" or "Launch Evaluator Dashboard".
   - View top header with user avatar, email, and live System Health pills (DB, Redis, Worker, ES, Slack).
2. **Compose Campaign & CSV Pre-flight (0:40–1:30)**
   - Click "Compose Campaign". Click "Load 10 Demo Leads".
   - Show pre-flight validator badges: `8 valid`, `1 duplicate removed`, `1 invalid`.
   - Set: `Delay = 2000ms`, `Hourly Limit = 3`, `Start Time = Now + 20s`.
   - Show Dynamic Campaign Estimator breakdown. Click "Schedule Campaign".
3. **Bull Board Live Inspection (1:30–2:15)**
   - Open `/admin/queues` in header.
   - Show delayed jobs sitting in Redis BullMQ queue. Explain deterministic job IDs and zero cron usage.
4. **The Hero Server Restart Scenario (2:15–3:00)**
   - Stop backend process (`Ctrl+C`).
   - Show server offline; Redis retains all jobs intact.
   - Start backend (`npm run dev:api`).
   - Worker immediately resumes and dispatches jobs on time without duplicate sends.
5. **Atomic Rate Limit & Slack Alert (3:00–3:45)**
   - First 3 emails send successfully.
   - Email #4 hits the 3/hour limit. Status updates to `RATE_LIMITED` ➔ `RESCHEDULED`.
   - Show the **live Slack Block Kit notification** arriving on screen. Show Redis `SET NX` alert deduplication.
6. **Ethereal Preview & Delivery Timeline (3:45–4:30)**
   - Open Sent Emails tab. Click "Open in Ethereal" -> loads rendered HTML email in browser.
   - Click email row -> opens **Delivery Timeline** drawer displaying every timestamp from `SCHEDULED` to `DELIVERED`.
7. **Elasticsearch Multi-Match Search (4:30–5:00)**
   - Type recipient or subject fragment into search bar.
   - Instant search response rendered via Elasticsearch with PostgreSQL fallback.

---

## 8. Engineering Trade-offs & Design Decisions

1. **Sliding Window vs. Fixed Hourly Window with Jitter**:
   - We selected fixed hourly windows (`YYYY-MM-DD-HH`) with randomized jitter on rescheduling. This matches Email Service Provider billing/quota boundaries and enables $O(1)$ atomic Lua checks with trivial TTL expiration.
2. **Start-to-Start Interval vs. End-to-End Serialized Queue**:
   - To maximize worker throughput while respecting provider limits, inter-send throttling enforces the minimum interval between **SMTP dispatch start times** rather than locking workers for the entire network roundtrip.
3. **Elasticsearch Decoupling**:
   - Elasticsearch indexing is isolated on `esIndexQueue`. Even if Elasticsearch encounters network latency or downtime, email delivery correctness is never compromised.

---

## 9. Submission Details & ClickUp Form Info

- **Repository:** Monorepo (`apps/api`, `apps/web`, `packages/shared`, `infrastructure/docker`)
- **Reviewers:** Mitrajit Chandra & Yadav036
- **Submission Form:** [ClickUp Assignment Submission](https://forms.clickup.com/9005062261/f/8cbwp3n-8876/6NNNJ92DV93PQTAYST)
