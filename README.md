# Approvals Platform

[![CI](https://github.com/RomulusMirauta/approvals-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/RomulusMirauta/approvals-platform/actions/workflows/ci.yml) [![Production smoke](https://github.com/RomulusMirauta/approvals-platform/actions/workflows/production-smoke.yml/badge.svg)](https://github.com/RomulusMirauta/approvals-platform/actions/workflows/production-smoke.yml)

**Live demo: [approvals-platform-eta.vercel.app](https://approvals-platform-eta.vercel.app)** · **API docs: [/docs](https://approvals-platform-eta.vercel.app/docs)** · sign in with a demo account (password `demo-password`): `bob@example.com` (approver), `alice@example.com` (requester), `carol@example.com` (admin). It's a shared demo, so others may have changed the data.

Human-in-the-loop approvals for AI agents. An agent (for example the [ERP Procurement MCP server](https://github.com/RomulusMirauta/erp-procurement-mcp)) finds an invoice that fails three-way matching and submits it here. A person reviews it in the dashboard and approves or rejects it, and the decision is recorded with a full audit trail.

## Screenshots

The approver's exception queue: invoices the ERP agent couldn't match, waiting for a person.

![Exception queue](docs/screenshots/exception-queue.png)

A request opened from the queue, with its exception codes, the decision form and the comment thread.

![Request detail](docs/screenshots/request-detail.png)

Sign-in, with one-click demo accounts for each role.

![Sign in](docs/screenshots/login.png)

## Stack

- **API:** Node.js, Fastify 5, TypeScript, zod; versioned `/v1` REST routes; OpenAPI 3 generated from the same schemas that validate requests
- **Database:** Postgres with Drizzle ORM and SQL migrations. Locally and in tests it runs on [PGlite](https://pglite.dev), the Postgres engine compiled to WebAssembly, so no Docker is needed; in production, Neon
- **Auth:** JWT with roles: requester, approver, admin, agent
- **Dashboard:** React, Vite, TanStack Query
- **Shared contract:** `packages/contracts`, zod schemas used by both the API and the dashboard
- **Notification service:** [`services/notifications`](services/notifications), a worker that consumes events from a Postgres-backed queue (see below)
- **Tests:** Vitest for the API and the dashboard; Playwright end-to-end tests in [`e2e/`](e2e)

## Data model

```mermaid
erDiagram
  users ||--o{ requests : raises
  users ||--o{ approvals : decides
  users ||--o{ comments : writes
  requests ||--o{ approvals : has
  requests ||--o{ comments : has
  requests ||--o{ request_tags : ""
  tags ||--o{ request_tags : ""
  users ||--o{ notifications : receives
```

The rules live in the database as constraints: foreign keys with explicit `ON DELETE` behaviour, unique emails and tag names, a composite primary key on the `request_tags` join table, check constraints (an amount always has a currency; only decided requests have a decision time; a rejection needs a comment), and a partial unique index that allows only one pending request per source item, so an agent that retries can't create duplicates. See [apps/api/src/db/schema.ts](apps/api/src/db/schema.ts) and the generated SQL in [apps/api/drizzle](apps/api/drizzle).

## Events and notifications

When a request is created, approved, rejected or cancelled, the API writes an event to the `outbox_events` table **in the same transaction** as the change (the transactional outbox). So the event exists if and only if the change committed: there is no window where the database says "approved" but the event was lost, or the other way round. A separate notification service, [`services/notifications`](services/notifications), consumes the table as a queue. It tells the requester about decisions on their request and tells approvers about new invoice exceptions and high-priority requests, and it can forward every event to a webhook (`NOTIFY_WEBHOOK_URL`).

```mermaid
sequenceDiagram
  participant Approver
  participant API
  participant DB as Postgres
  participant Worker as Notification service
  participant Hook as Webhook (optional)
  Approver->>API: POST /v1/requests/:id/decision
  API->>DB: BEGIN; update request; insert approval; insert outbox event; COMMIT
  API-->>Approver: 200
  loop every 2 s
    Worker->>DB: BEGIN; SELECT … FOR UPDATE SKIP LOCKED (a batch of due events)
    Worker->>DB: insert notifications (unique per event and recipient)
    Worker->>Hook: POST event (Idempotency-Key: event id, 5 s timeout)
    Worker->>DB: set processed_at, or attempts+1, last_error, available_at = now() + backoff; COMMIT
  end
  Note over API,DB: Later: GET /v1/notifications reads them through the API
```

- **Why the worker is a separate service:** it scales and fails independently of the API (if it is down, events wait in the table and nothing is lost), and it talks to the API only through the outbox. Reading notifications goes through the API (`GET /v1/notifications`, `POST /v1/notifications/:id/read`), so authentication and "you only see your own" stay in one place.
- **Why Postgres and not a broker:** the outbox must live in the same database as the data to be written atomically, and with `FOR UPDATE SKIP LOCKED` that same table is already a correct work queue: several workers each claim different rows, and a crashed worker's transaction rolls back so its events are retried. No Redis or RabbitMQ to run, and at this volume Postgres is plenty.
- **Delivery is at-least-once**, so it is idempotent: a unique `(event_id, recipient_id)` makes a repeated event a no-op, and the webhook gets the event id as an idempotency key. A failed delivery is retried with exponential backoff (10 s, 20 s, 40 s, …); after 5 attempts the event is dead-lettered (left unprocessed with its `last_error`). An event that doesn't match the shared contract in `packages/contracts` fails the same way.
- **Moving to a broker later:** keep the outbox and add a relay that publishes each row to SQS, RabbitMQ or BullMQ and marks it processed. The consumer stays the same `deliver` function; the broker replaces `SKIP LOCKED` (visibility timeout, acks), `available_at` (delayed retries) and the attempts limit (a dead-letter queue).
- **How the service reaches the database:** `@approvals/api` exports its database client and schema (`@approvals/api/db/*`), so there is one schema and one migration history, owned by the API. Sharing a database couples the two services' schemas; it is the simple choice for a modular monolith, and the table is the only interface between them.

Run the worker against the same Postgres as the API (PGlite runs inside a single process, so it can't be shared):

```bash
DATABASE_URL=postgres://... npm run worker -w @approvals/notifications
```

It stops cleanly on Ctrl+C or SIGTERM after finishing its current batch. A cron job or serverless function can call `drainOnce(db)` from `@approvals/notifications` instead.

## Testing

```bash
npm test                              # unit and API tests (Vitest)
npx playwright install chromium       # once, for the end-to-end tests
npm run test:e2e                      # Playwright: starts its own API and dashboard
npm run screenshots                   # regenerates the screenshots above
```

The end-to-end suite starts the real API on a fresh, seeded, in-memory Postgres (port 3100) and the dashboard's dev server (port 5174), so it never touches your local data. Tests use page objects and role- and label-based locators, create their own data through the API, and can run alone or in parallel.

The suite also scans the sign-in page, the exception queue and an open request with [axe](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright) for WCAG 2.1 A/AA violations and fails on serious or critical ones. Against a deployment (`E2E_BASE_URL`), it checks the security headers that [vercel.json](vercel.json) sets on the dashboard (a strict CSP, `nosniff`, referrer, permissions and opener policies) and that signing in triggers no CSP violation; the Vite dev server doesn't send those headers, so locally these tests are skipped.

`npm run smoke -w @approvals/e2e` runs only the `@smoke` tests ([smoke.spec.ts](e2e/tests/smoke.spec.ts)): the API is up, and an approver signs in and opens an invoice from the exception queue. They only read, and block any other write, because [production-smoke.yml](.github/workflows/production-smoke.yml) runs them against the live demo every night at 03:30 UTC, after the demo reset.

The API tests use in-memory PGlite, which runs one transaction at a time. To run them against a real Postgres server, where the concurrency tests race over separate connections, set `TEST_DATABASE_URL` (e.g. `postgres://postgres:postgres@localhost:5432/postgres`): each test file creates its own database there and drops it afterwards. CI does this in the `api-postgres` job.

## Deploy (Vercel + Neon)

One Vercel project serves both parts from the same domain: the dashboard as static files, and the API as a serverless function ([api/index.js](api/index.js) → [apps/api/src/serverless/handler.ts](apps/api/src/serverless/handler.ts)) in Frankfurt, next to the Neon database. See [vercel.json](vercel.json).

1. Create a Neon project in AWS Europe Central 1 (Frankfurt) and copy the **pooled** connection string.
2. Import this repository in Vercel and set two environment variables:
   - `DATABASE_URL`: the Neon connection string
   - `JWT_SECRET`: 32+ random characters, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
3. Deploy. The build applies the migrations and adds the demo data if it isn't there yet. Requests never run migrations.
4. Optional: set `CRON_SECRET` (32+ random characters) and Vercel Cron resets the demo data every night at 03:00 UTC, so visitors always find a full queue.

### Notification worker in production

Vercel hosts request handlers only, so the live demo runs the notification service as a scheduled GitHub Actions job ([notifications.yml](.github/workflows/notifications.yml)): every 5 minutes it drains the outbox and exits (`npm run drain -w @approvals/notifications`). It needs a `DATABASE_URL` repository secret and the repository variable `WORKER_ENABLED=true`. On a VM or container platform it would run continuously with `npm run worker`.

### Environments

| | Database | Deployed by | Tested by |
|---|---|---|---|
| **Local** | PGlite (in-process) | `npm run dev:api` / `dev:web` | Vitest and Playwright on fresh in-memory data |
| **Preview** (every pull request) | Neon branch `dev` (copy-on-write copy of production) | Vercel, automatically | [preview-e2e.yml](.github/workflows/preview-e2e.yml): the Playwright suite against the deployed preview |
| **Production** | Neon branch `production` | Vercel, on merge to `main` | The checks above must pass before merging |

Preview deployments sit behind Vercel's login; CI gets in with the `VERCEL_AUTOMATION_BYPASS_SECRET` repository secret. Previews raise the login rate limit (`LOGIN_RATE_LIMIT_MAX`) because the suite signs in many times from one machine.

## Resilience

Neon suspends an idle database and the serverless functions start cold, so a briefly unreachable database or a dropped connection is normal here, not exceptional. What the app does about it:

- **Bounded waits.** The connection pool ([client.ts](apps/api/src/db/client.ts)) holds at most 5 connections, gives up connecting after 3 s and on a query after 5 s, closes connections idle for 10 s and uses TCP keepalive. A stuck query ends in a 503 instead of running into Vercel's 10 s limit.
- **503, not 500.** Connection errors and timeouts, SQLSTATE `08xxx`, `57P01`-`57P03` (server shutting down or starting), `53300` (too many connections), `40001`/`40P01` (serialization failure, deadlock) and `57014` (statement timeout) answer `503` problem+json with `Retry-After: 2`, and are logged as warnings ([errors.ts](apps/api/src/errors.ts)).
- **One retry, only where it is safe** ([retry.ts](apps/api/src/db/retry.ts)): a transaction aborted by a serialization failure or a deadlock rolled back completely, so it runs once more; the first connection on a cold start is retried once, since nothing has been written yet. Other writes are never retried: a timeout doesn't say whether the write committed.
- **Liveness vs readiness.** `GET /health` says the process is up and never touches the database, so a database outage doesn't get healthy instances restarted. `GET /ready` runs `select 1` with a 2 s timeout and answers 200 or 503, for a load balancer or an uptime check to stop sending traffic while the database is away.
- **Graceful shutdown** waits for in-flight requests, then closes the pool; after 10 s it exits anyway.
- **Dashboard.** Queries retry network errors and 5xx up to 3 times, waiting as long as `Retry-After` asks or backing off 1 s, 2 s, 4 s, and never retry a 4xx. Meanwhile a banner says "Service temporarily unavailable, retrying…". Mutations (approve, reject, create, comment) are not retried automatically: if the response is lost after the server committed, a retry could act twice, so the person decides.

**Server-side statement timeout.** `statement_timeout` can't be sent when connecting: Neon's pooler rejects unknown startup parameters. To make the database itself cancel runaway queries, set it once on the app's role: `ALTER ROLE <role> SET statement_timeout = '5s';` (it applies to every session of that role, migrations included).

## Roadmap

- [x] Monorepo, shared contract, database schema and migrations
- [x] API: auth, requests, decisions, comments, tags, OpenAPI docs
- [x] Dashboard: request list and filters, exception queue, approve/reject
- [x] ERP Procurement MCP server sends approval requests to this API
- [x] End-to-end tests with Playwright
- [x] Deploy (Vercel + Neon)
- [x] Notification service consuming decision events from a queue

## License

[MIT](LICENSE)
