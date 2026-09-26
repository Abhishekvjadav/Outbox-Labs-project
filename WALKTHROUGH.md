# ReachFlow: Production-Grade Email Scheduling Engine & Dashboard
*Implementation & Verification Walkthrough Document*
*ReachInbox (Outbox Labs) — SDE Intern Assignment*

---

## 1. Project Overview & Deliverables Summary

We have designed, hardened, and built **ReachFlow (v2.1)**, an enterprise-grade distributed email scheduling engine and dashboard tailored to ReachInbox's cold email outreach infrastructure.

### The Problem Solved
Cold email outreach requires sending millions of emails across distributed mailboxes without burning domain reputations. Naive implementations relying on polling cron jobs (`node-cron`) or in-memory counters suffer from:
- Race conditions and counter overruns across parallel workers.
- Catastrophic duplicate sends and lost jobs upon server termination.
- ESP spam blacklisting due to burst transmissions from concurrent workers.

### Architectural Invariant Enforced
```
┌────────────────────────────────────────────────────────────────────────┐
│ PostgreSQL    = Single source of truth for email delivery state       │
│ Redis/BullMQ  = Distributed delayed execution & atomic coordination   │
│ Elasticsearch = Isolated read/search projection (cannot block dispatch)│
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory & Monorepo Structure

```
Outbox Labs/
├── apps/
│   ├── api/                              # Express.js + TypeScript REST Backend
│   │   ├── src/
│   │   │   ├── config/env.ts             # Environment parser & validated configs
│   │   │   ├── prisma/                   # Prisma schema, client singleton & seed script
│   │   │   ├── queues/                   # BullMQ emailQueue & esIndexQueue, Redis config
│   │   │   ├── services/                 # Atomic Lua RateLimiter, Ethereal SMTP, Slack, ES
│   │   │   ├── workers/                  # emailWorker (concurrency 5x), esWorker
│   │   │   ├── middleware/auth.ts        # Google OAuth session verification & JWT
│   │   │   ├── controllers/              # Auth, Campaign, Email, Slack, Health
│   │   │   ├── routes/apiRoutes.ts       # Unified API routing
│   │   │   └── index.ts                  # Server entry & Bull Board (/admin/queues)
│   │   ├── tests/                        # Automated reliability test suite
│   │   │   ├── rate-limit.test.ts        # Atomic Redis Lua check-and-increment test
│   │   │   ├── idempotency.test.ts       # Deterministic BullMQ job ID test
│   │   │   ├── restart.test.ts           # Server kill & Redis persistence test
│   │   │   ├── throttle.test.ts          # Per-sender start interval serialization test
│   │   │   └── retry.test.ts             # BullMQ exponential backoff test
│   │   ├── dist/                         # Compiled production JS
│   │   └── package.json
│   │
│   └── web/                              # React + Vite + Tailwind CSS Frontend
│       ├── src/
│       │   ├── components/
│       │   │   ├── layout/Header.tsx     # Real-time health pills, user profile, Bull Board
│       │   │   ├── layout/TabNavigation  # Tab buttons with live counts & Compose CTA
│       │   │   ├── campaign/ComposeModal # CSV pre-flight validator & dynamic estimator
│       │   │   ├── emails/ScheduledTable # Scheduled emails table with ES search
│       │   │   ├── emails/SentTable      # Sent emails with 1-click Ethereal preview
│       │   │   ├── emails/DeliveryTimelineModal # Interactive visual audit drawer
│       │   │   ├── senders/SendersView   # Multi-sender management & mailbox provisioner
│       │   │   ├── integrations/Slack    # Slack OAuth card & test alert button
│       │   │   └── auth/LoginPage.tsx    # Google OAuth login with candidate demo pass
│       │   ├── lib/api.ts                # Typed Axios API client
│       │   ├── App.tsx                   # Main state & polling coordinator
│       │   └── main.tsx                  # React DOM entry
│       ├── dist/                         # Production bundled assets
│       └── package.json
│
├── packages/
│   └── shared/                           # Shared DTOs, Enums, Zod Schemas
│       ├── src/
│       │   ├── types.ts                  # EmailStatus, EventType, DTO interfaces
│       │   ├── validation.ts             # RFC 5322 validator & estimator formulas
│       │   └── index.ts                  # Shared exports
│       ├── dist/                         # Compiled ESM package
│       └── package.json
│
├── infrastructure/
│   └── docker/
│       ├── Dockerfile.api                # Multi-stage production API image
│       └── Dockerfile.web                # Multi-stage production Nginx web image
│
├── docker-compose.yml                    # Postgres, Redis, Elasticsearch, API, Web
├── .env.example                          # Environment template with setup guide
├── README.md                             # Comprehensive engineering documentation
└── package.json                          # Monorepo workspaces definition
```

---

## 3. Reliability Invariants Implemented

### 1. Strictly Zero Cron Jobs (BullMQ Delayed Zsets)
- Every scheduled email is placed into Redis using:
  $$\text{delay} = \max(0, \text{scheduledAt.getTime}() - \text{Date.now}())$$
- Redis handles the sorted set epoch ranking natively. No periodic queries against PostgreSQL.

### 2. Truly Atomic Rate Limiting (Redis Lua `check-and-increment`)
- Eliminates the counter overrun flaw where concurrent workers increment past the hourly quota.
- Lua checks if `current >= limit` *before* incrementing.
- Rejection atomically returns the next window reset timestamp without mutating counters.
- Jobs hitting the limit transition to `RATE_LIMITED` and are rescheduled into the next hour window (`RESCHEDULED`). Emails are **never dropped**.

### 3. Multi-Worker Per-Sender Inter-Send Throttling
- Coordinated via Redis timestamp key `reachflow:throttle:sender:{senderId}:next_send_time`.
- Enforces a minimum interval between **SMTP dispatch start times per sender** across all concurrent workers, eliminating parallel bursts to provider mailboxes.

### 4. Single-Active-Job Invariant & Idempotency
- At any point in time, one email record in PostgreSQL has at most one executable BullMQ job.
- Deterministic job IDs: `email-send-${email.id}`. Duplicate scheduling calls are silently ignored by BullMQ.
- Prior to SMTP delivery, the worker validates that the email status is not already `SENT`.

### 5. Slack Alert Deduplication (`SET NX`)
- Locked via Redis atomic `SET reachflow:slack:alert:sender:{id}:window:{windowKey} 1 EX 3600 NX`.
- When 100 emails hit a sender's rate limit, exactly **one Slack Block Kit notification** is dispatched per hour window.

### 6. Isolated Elasticsearch Search Projection
- PostgreSQL is the source of truth for email states.
- Search indexing runs decoupled on `esIndexQueue`. If Elasticsearch is down or laggy, email delivery is completely unaffected, and indexing retries asynchronously.

---

## 7. Next Steps: Git Repo & Submission

1. **Initialize Git Repository**:
   ```bash
   git init
   git add .
   git commit -m "feat: reachflow v2.1 distributed email scheduling engine"
   ```
2. **Grant GitHub Access** to:
   - `Mitrajit`
   - `Yadav036`
3. **Record 5-minute Demo Video** following the walkthrough script in Section 7 of [README.md](file:///c:/Users/hp/Desktop/Outbox%20Labs/README.md).
4. **Submit via ClickUp Form**:
   [ClickUp Assignment Submission Form](https://forms.clickup.com/9005062261/f/8cbwp3n-8876/6NNNJ92DV93PQTAYST)
