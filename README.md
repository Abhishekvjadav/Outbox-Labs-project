# ReachFlow

ReachFlow is a production-grade, distributed cold email scheduling engine and web dashboard built to dispatch high-volume email batches reliably across multiple sender mailboxes without violating provider rate limits or burning domain reputations. Built on Express.js, PostgreSQL, Redis, and BullMQ with an isolated Elasticsearch search projection, ReachFlow executes time-accurate dispatching strictly via BullMQ delayed sorted sets—completely eliminating polling cron jobs—while enforcing atomic rate limits, sender-level inter-send throttling, single-active-job idempotency, and automated recovery across server restarts.

## Features

### Backend
- Express.js API
- PostgreSQL persistence
- Redis
- BullMQ delayed job scheduling
- Persistent scheduling across server restarts
- Worker concurrency
- Atomic email claiming / idempotency
- Sender-level minimum delay/throttling
- Hourly rate limiting
- Rate-limit rescheduling instead of dropping jobs
- Processing recovery
- SMTP ambiguity handling
- Elasticsearch projection/search
- Slack rate-limit notifications
- Bull Board / queue monitoring
- Multiple senders

### Frontend
- Authentication/login
- Dashboard
- Compose email
- CSV/text recipient upload
- Recipient validation
- Multiple recipients
- Sender selection
- Subject/body editor
- Attachments
- Scheduled emails
- Sent emails
- Send Later scheduling
- Minimum delay configuration
- Hourly limit configuration
- Delivery metrics
- Email detail view

## Architecture

```text
React/Next-style frontend
        |
        v
Express REST API
        |
        +--> PostgreSQL (source of truth)
        |
        +--> Redis + BullMQ
        |
        +--> Elasticsearch
        |
        v
Email Worker
        |
        +--> Rate Limit
        |
        +--> Sender Throttle
        |
        v
Ethereal SMTP
```

Slack is used for rate-limit notifications.

### Data & Execution Roles
- **PostgreSQL is the authoritative source of truth** for all campaign configs, sender identities, email lifecycle states (`SCHEDULED`, `QUEUED`, `PROCESSING`, `RATE_LIMITED`, `RESCHEDULED`, `SENT`, `FAILED`), and immutable audit event logs.
- **Redis/BullMQ is used for scheduling and execution**: Redis provides the sorted sets (`zset`) for delayed execution, atomic Lua scripts for token/window coordination, and job queues for the distributed BullMQ worker fleet.
- **Elasticsearch is a non-authoritative search projection**: Elasticsearch is indexed asynchronously via a decoupled queue (`esIndexQueue`). If Elasticsearch is unavailable or lagging, core email dispatching and PostgreSQL persistence remain completely unaffected.

## How Scheduling Works

The email scheduling lifecycle follows an explicit 11-step execution path:

1. **User creates campaign:** The user defines campaign parameters (sender, recipients, subject, body, inter-send delay, hourly limit, and scheduled start time) via the frontend or REST API.
2. **Email records are persisted in PostgreSQL:** Individual email records are inserted into PostgreSQL with status `SCHEDULED` along with initial audit trail events.
3. **BullMQ delayed jobs are created in Redis:** Delayed jobs are added to BullMQ (`emailQueue`) with calculated delays (`delay = max(0, scheduledAt - now)`) and deterministic job IDs (`email-send-${email.id}`).
4. **Worker receives the job when due:** When Redis advances the delayed sorted set timestamp to the present, BullMQ pops the job to an available worker thread.
5. **Worker atomically claims the email:** The worker executes an atomic database transaction (`UPDATE email SET status = 'PROCESSING', attempts = attempts + 1 WHERE id = ... AND status IN ('SCHEDULED', 'QUEUED', 'RATE_LIMITED', 'RESCHEDULED')`) preventing parallel workers from claiming the same record.
6. **Hourly rate limit is checked:** The worker checks and increments the sender's hourly quota using an atomic Redis Lua script.
7. **Sender minimum-delay throttle is checked:** The worker coordinates with Redis to reserve an inter-send dispatch timestamp for that specific sender (`reachflow:throttle:sender:{id}:next_send_time`), ensuring consecutive dispatches remain separated by at least the configured minimum delay.
8. **If a constraint prevents sending, the job is rescheduled rather than dropped:**
   - If the hourly limit is exceeded, a deduplicated Slack alert is triggered, a BullMQ delayed job targeting the next hourly window is enqueued, and the email status transitions to `RESCHEDULED`.
   - If inter-send throttling requires a wait exceeding 1000ms, a delayed BullMQ job is enqueued for the reserved start time and the email status transitions to `RESCHEDULED`, freeing worker concurrency.
9. **Email is sent through Ethereal SMTP:** The worker connects to Ethereal SMTP via Nodemailer, records a Redis dispatch receipt, and transmits the email.
10. **PostgreSQL status is finalized:** The email record is updated to `SENT` with the returned `messageId`, `previewUrl`, and timestamp, campaign counters are incremented, and an `SMTP_DELIVERED` audit event is recorded.
11. **Elasticsearch is updated asynchronously:** An indexing job is enqueued to `esIndexQueue` to project updated email contents and metadata into Elasticsearch without blocking the dispatch pipeline.

> **Note:** The system does **NOT** use cron jobs or polling schedulers (`SELECT * WHERE scheduledAt <= NOW()`). All scheduling is event-driven and powered natively by Redis sorted sets in BullMQ.

## Persistence and Restart Recovery

If the API or worker process is terminated (`kill -9`, SIGTERM, container crash, or machine restart):

- **PostgreSQL retains the authoritative email state:** All email records, campaign configurations, sender states, and audit trails remain permanently stored on disk.
- **BullMQ/Redis persists scheduled jobs:** Redis retains all delayed jobs and queue state in memory backed by append-only files (AOF) and snapshot persistence.
- **Delayed jobs remain available after worker restart:** When the API/worker processes reboot, BullMQ immediately reconnects to Redis and resumes scheduled jobs at their exact intended timestamps without dropping any tasks.
- **Processing recovery handles emails left in PROCESSING:**
  - Active worker leases are tracked via `updatedAt` and periodic heartbeats.
  - If a worker crashes mid-flight, a multi-generation recovery mechanism detects expired leases (exceeding `LEASE_TIMEOUT_MS = 60s`).
  - If a dispatch receipt exists in Redis (indicating SMTP already succeeded before the crash), the status is safely finalized to `SENT` without re-sending.
  - If no receipt exists, the email is transitioned to `FAILED` with a `DLQ_MOVED` event to avoid blind double sends.
- **Idempotency protections prevent duplicate sends:** Deterministic BullMQ job IDs (`email-send-${email.id}`) and pre-send database status checks guarantee that duplicate scheduling requests or retries never trigger duplicate deliveries.

## Rate Limiting and Concurrency

- **Configurable worker concurrency:** BullMQ workers operate with configurable concurrency (e.g., `WORKER_CONCURRENCY=5`), allowing multiple emails to be processed in parallel across worker threads.
- **Hourly sending limit:** Limits the number of emails a sender or campaign can dispatch per 1-hour window (e.g., 50 emails/hour).
- **Sender-level limits:** Each sender mailbox maintains its own configurable hourly sending cap and minimum inter-send delay.
- **Campaign/sender effective limit:** The effective hourly limit is calculated dynamically as `min(sender.hourlyLimit, campaign.hourlyLimit)`.
- **Redis atomic rate-limit coordination:** An atomic Lua script executes `check-and-increment` against the hourly Redis key (`reachflow:ratelimit:sender:{id}:{windowKey}`). If the limit is reached, the counter is not incremented and the next window reset timestamp is returned atomically.
- **Minimum delay between sends:** Per-sender start timestamps are serialized via Redis (`reachflow:throttle:sender:{id}:next_send_time`), ensuring that concurrent workers dispatching for the same sender maintain a strict minimum interval (e.g., 2000ms).
- **Delayed BullMQ rescheduling:** When an email encounters a rate limit or a throttle wait > 1000ms, a delayed job is scheduled in Redis for the exact calculated timestamp.
- **Rate-limited jobs are not dropped:** Jobs that exceed hourly quotas or throttle intervals are never dropped or permanently failed; they transition through `RATE_LIMITED` and `RESCHEDULED` until they are successfully dispatched.

## Setup

### Prerequisites
- **Node.js** (v18 or higher)
- **Docker Desktop**
- **Docker Compose**
- **npm** (v9 or higher)

## Environment Variables

Create a `.env` file in the root directory. Never commit real secrets.

### API / Backend Variables
```env
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
JWT_SECRET=reachflow-super-secure-jwt-secret-key-replace-in-production-min32
WORKER_CONCURRENCY=5
DEFAULT_MIN_EMAIL_DELAY_MS=2000
DEFAULT_MAX_EMAILS_PER_HOUR=100
```

### Frontend Variables
```env
VITE_API_URL=http://localhost:5000
```

### Database / Redis / Elasticsearch Variables
```env
# PostgreSQL
DATABASE_URL=postgresql://postgres:postgrespassword@localhost:5432/reachflow?schema=public

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_TLS=false

# Elasticsearch
ENABLE_ELASTICSEARCH=true
ELASTICSEARCH_NODE=http://localhost:9200
ELASTICSEARCH_USERNAME=
ELASTICSEARCH_PASSWORD=
```

### Google OAuth Variables
```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback
```

### Slack OAuth Variables
```env
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
SLACK_REDIRECT_URI=http://localhost:5000/api/integrations/slack/callback
```

### Ethereal Configuration
```env
DEFAULT_ETHEREAL_USER=
DEFAULT_ETHEREAL_PASS=
ETHEREAL_CACHE=false
```

## Ethereal Email Setup

ReachFlow uses Ethereal Email (a fake SMTP service provided by Nodemailer) for safe email testing.

- **Host:** `smtp.ethereal.email`
- **Port:** `587` (STARTTLS)
- **Username:** Auto-generated or configured via `DEFAULT_ETHEREAL_USER` / sender settings
- **Password:** Auto-generated or configured via `DEFAULT_ETHEREAL_PASS` / sender settings
- **From Address:** Configured per sender mailbox (e.g. `Growth Outreach <user@ethereal.email>`)

### Docker / Demo Seed Behavior
When running in Docker or when the database seed script is executed:
- The system automatically provisions two Ethereal test mailboxes on demand via `nodemailer.createTestAccount()`.
- Default sender accounts are created in PostgreSQL with individual hourly quotas (50/hr and 100/hr).
- Every email sent produces a live preview URL stored on the email record (e.g., `https://ethereal.email/message/...`), viewable with a single click in the dashboard.

## Running with Docker

To build and launch the entire application stack:

```bash
# 1. Build container images
docker compose build

# 2. Start all services in background
docker compose up -d

# 3. Check running status
docker compose ps
```

### Service Access URLs
- **Frontend Dashboard:** [http://localhost:3000](http://localhost:3000)
- **Backend REST API:** [http://localhost:5000](http://localhost:5000)
- **Bull Board Queue Monitor:** [http://localhost:5000/admin/queues](http://localhost:5000/admin/queues)

### Container Architecture
- `reachflow-postgres`: PostgreSQL 16 Alpine container with persistent volume `postgres_data`.
- `reachflow-redis`: Redis 7 Alpine container with Append-Only File (AOF) persistence on `redis_data`.
- `reachflow-elasticsearch`: Elasticsearch 8.14 single-node container with persistent volume `es_data`.
- `reachflow-api`: Express.js backend, BullMQ workers, and API router.
- `reachflow-web`: React + Vite frontend served via Nginx with API reverse proxy.

## Running Without Docker

To run the application locally outside of Docker (requires local or managed instances of PostgreSQL, Redis, and optionally Elasticsearch):

```bash
# 1. Install all dependencies across the monorepo
npm install

# 2. Build the shared types package
npm run build --workspace=@reachflow/shared

# 3. Initialize Prisma database schema and seed default data
npm run prisma:generate --workspace=reachflow-api
npm run prisma:push --workspace=reachflow-api
npm run prisma:seed --workspace=reachflow-api

# 4. Start the backend API and BullMQ workers (Terminal 1)
npm run dev:api

# 5. Start the frontend web application (Terminal 2)
npm run dev:web
```

## Demo

The 5-minute evaluator demonstration covers the following sequence:

1. **Login:** Authenticate via Google OAuth or click the one-click evaluator login button to access the dashboard.
2. **Create campaign:** Open Campaign Studio / Compose Modal and assign a campaign name.
3. **Add/upload recipients:** Paste recipient emails directly or load/upload a CSV file with automatic RFC 5322 validation and duplicate detection.
4. **Configure delay and hourly limit:** Set the sender minimum inter-send delay (e.g. 2000ms) and hourly limit (e.g. 50/hour), and inspect the dynamic delivery timeline estimator.
5. **Schedule emails:** Choose immediate dispatch or a future Send Later timestamp and submit the campaign.
6. **Show Scheduled emails:** View scheduled jobs in the Scheduled tab, inspect live queue status in Bull Board (`/admin/queues`), and verify deterministic job IDs.
7. **Show Sent emails:** View completed emails in the Sent tab, inspect the Delivery Timeline audit drawer, and click the Ethereal link to open the rendered HTML preview.
8. **Demonstrate restart persistence:** Stop the backend process while jobs are queued, restart the backend, and verify that BullMQ resumes jobs on time without lost records or duplicate sends.
9. **Briefly demonstrate throttling/rate limiting:** Trigger a batch exceeding sender limits, observe atomic rescheduling to the next hour window, and view the deduplicated Slack alert.

## Reliability / Verification

The platform's throttling and scheduling engine has been validated through automated stress testing with the following verified results:

- **50 emails**
- **concurrency 5**
- **2000 ms minimum delay**
- **50/50 SENT**
- **0 duplicate sends**
- **0 stranded PROCESSING**
- **0 spacing violations**
- **2000 ms reservation spacing**

### Running Automated Test Suite
```bash
# Run atomic rate limit tests
npm run test:rate-limit

# Run idempotency and duplicate prevention tests
npm run test:idempotency

# Run server restart and persistence tests
npm run test:restart

# Run per-sender inter-send throttling tests
npm run test:throttle

# Run retry and exponential backoff tests
npm run test:retry
```

## Assumptions, Shortcuts and Trade-offs

- **Ethereal SMTP vs Production ESP:** Ethereal SMTP is used instead of a production SMTP provider (such as SES, SendGrid, or Google Workspace) because this repository is configured as a self-contained evaluation environment.
- **Elasticsearch as Non-Authoritative Projection:** Elasticsearch serves strictly as a read/search projection. PostgreSQL remains the single source of truth; any Elasticsearch latency or failure does not block email dispatching.
- **Fixed-Window Rate Limiting:** Rate limiting uses atomic fixed-window hourly buckets (`YYYY-MM-DD-HH`), which allows a boundary burst at the top of an hour in exchange for $O(1)$ atomic Lua execution and zero memory bloat compared to sliding log structures.
- **Ambiguous Post-Transmission SMTP Handling:** Ambiguous post-transmission network/socket errors (e.g., `ECONNRESET` during DATA transmission) are not automatically retried blindly because retrying could cause duplicate real-world delivery if the receiving MTA accepted the message.
- **Docker Demo Mode:** Demo mode and automatic Ethereal test account creation are enabled by default for evaluator convenience so the application runs out of the box without requiring manual SMTP credentials.

## Project Structure

```text
ReachFlow/
├── backend/                          # Express.js + TypeScript REST Backend
│   ├── src/
│   │   ├── config/env.ts             # Validated environment configuration
│   │   ├── prisma/                   # Prisma schema, client, and seed script
│   │   ├── queues/                   # BullMQ queues (emailQueue, esIndexQueue) and Redis client
│   │   ├── services/                 # RateLimiter (Lua), Ethereal SMTP, Slack, Elasticsearch
│   │   ├── workers/                  # emailWorker (BullMQ consumer) and esWorker
│   │   ├── middleware/auth.ts        # JWT and session authentication middleware
│   │   ├── controllers/              # Auth, Campaign, Email, Slack, Health controllers
│   │   ├── routes/apiRoutes.ts       # Express API routes
│   │   └── index.ts                  # Server entrypoint and Bull Board setup
│   └── tests/                        # Automated reliability and stress test suite
│
├── frontend/                         # React + Vite + Tailwind CSS Frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── auth/                 # LoginPage with Google OAuth and demo login
│   │   │   ├── campaign/             # CampaignStudio and ComposeModal with CSV validator
│   │   │   ├── dashboard/            # Metrics summary and delivery analytics
│   │   │   ├── emails/               # ScheduledTable, SentTable, EmailDetailView, DeliveryTimelineModal
│   │   │   ├── integrations/         # Slack integration settings card
│   │   │   ├── layout/               # Header with health indicators and TabNavigation
│   │   │   └── senders/              # SendersView and mailbox manager
│   │   ├── lib/api.ts                # Typed Axios API client
│   │   ├── App.tsx                   # Main application layout and state coordinator
│   │   └── main.tsx                  # React entry point
│   └── vite.config.ts                # Vite config with /api and /admin/queues proxies
│
├── packages/
│   └── shared/                       # Shared TypeScript definitions, DTOs, and validation logic
│       └── src/
│           ├── types.ts              # EmailStatus, EventType, Campaign, Email, Sender DTOs
│           ├── validation.ts         # RFC 5322 email regex and campaign estimator helpers
│           └── index.ts              # Shared exports
│
├── infrastructure/
│   └── docker/
│       ├── Dockerfile.api            # Multi-stage production API Dockerfile
│       └── Dockerfile.web            # Multi-stage Nginx frontend Dockerfile
│
├── docker-compose.yml                # Docker Compose orchestration definition
├── .env.example                      # Environment variables template
└── package.json                      # Monorepo workspaces configuration
```

## API / Important Endpoints

### Public & Health Endpoints
- `GET /` - Service status and metadata
- `GET /api/health` - Health check verifying PostgreSQL, Redis, BullMQ Worker, Elasticsearch, and Slack connectivity
- `GET /admin/queues` - Interactive Bull Board UI for queue monitoring

### Authentication Endpoints
- `GET /api/auth/google/url` - Generate Google OAuth consent URL
- `GET /api/auth/google/callback` - Handle Google OAuth callback and return JWT session cookie
- `POST /api/auth/google/verify` - Verify Google ID Token / evaluator demo login
- `POST /api/auth/logout` - Clear authentication session cookie
- `GET /api/auth/me` - Get current authenticated user profile

### Campaigns & Senders
- `POST /api/campaigns` - Create a new campaign and enqueue scheduled email jobs
- `GET /api/campaigns` - List user campaigns with progress counters
- `GET /api/senders` - List connected sender mailboxes with hourly quotas
- `POST /api/senders` - Create or provision a new sender mailbox

### Emails & Search
- `GET /api/emails/metrics` - Retrieve aggregated delivery metrics (scheduled, sent, rate-limited, failed)
- `GET /api/emails/scheduled` - Get paginated list of scheduled, queued, and rescheduled emails
- `GET /api/emails/sent` - Get paginated list of sent emails with Ethereal preview URLs
- `GET /api/emails/search?q=...` - Multi-match search across subject, body, and recipient via Elasticsearch (with DB fallback)
- `GET /api/emails/:id/timeline` - Retrieve complete chronological audit event log for an email
- `POST /api/emails/:id/cancel` - Cancel a scheduled email prior to worker dispatch

### Slack Integration
- `GET /api/integrations/slack/url` - Generate Slack OAuth authorization URL
- `GET /api/integrations/slack/callback` - Handle Slack OAuth installation redirect
- `POST /api/integrations/slack/disconnect` - Disconnect Slack integration
- `POST /api/integrations/slack/test` - Dispatch test alert to connected Slack channel

## Evaluation Notes

| Requirement | Implementation |
| :--- | :--- |
| **Persistent scheduler** | PostgreSQL (authoritative data) + Redis / BullMQ delayed sorted sets (`zset`) |
| **No cron scheduler** | BullMQ delayed jobs (`delay = scheduledAt - now`), strictly 0 polling crons |
| **Concurrency** | BullMQ worker concurrency (`WORKER_CONCURRENCY=5`) with atomic row claiming |
| **Rate limiting** | Redis atomic Lua script (`check-and-increment`) with next-window rescheduling |
| **Sender delay** | Redis atomic start timestamp reservation (`reachflow:throttle:sender:{id}:next_send_time`) |
| **Restart recovery** | BullMQ Redis persistence + lease-based `PROCESSING` recovery & dispatch receipt check |
| **Delivery** | Ethereal SMTP with 1-click HTML rendered test preview URLs |
| **Search** | Asynchronous decoupled Elasticsearch projection with PostgreSQL fallback |
| **Notifications** | Slack OAuth integration with Block Kit alerts and Redis `SET NX` window deduplication |
| **Dashboard** | React + TypeScript + Tailwind CSS with live health pills, visual audit timeline, and Bull Board |
