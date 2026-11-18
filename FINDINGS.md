# Findings

Bugs and weaknesses found in this project, how they were found and what was done.

## 2026-11-18: code review of the first API and dashboard

An independent review drove the API with `app.inject()` and confirmed each issue before it was fixed. Each fix has a regression test (`apps/api/tests/hardening.test.ts`, `apps/web/tests`).

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | Without `JWT_SECRET`, the API fell back to a secret that is public in this repo, unless `NODE_ENV` was exactly `production`. Anyone could sign an admin token. | The fallback is used only with an explicit `--dev` flag (`npm run dev`). Otherwise the server refuses to start without a secret of 32+ characters. The algorithm is pinned to HS256. |
| 2 | High | Any requester could post `source: "erp-procurement-mcp", externalRef: "INV-…"`. That put a fake item in the approvers' exception queue and made the real agent's submission fail with 409. | Only `agent` accounts may set `source` and `externalRef`; others get 403. |
| 3 | Medium | Amounts above 2^31 minor units (21 million RON) failed with a 500: the column was a 32-bit `integer`. | `bigint` column (migration `0001`), and "number out of range" maps to 400. |
| 4 | Medium | `/v1/tags` counted every request, so a requester's tag filter revealed activity on other people's requests. | Counts use the same visibility rule as the request list. |
| 5 | Medium | The role in the JWT was trusted for 8 hours: a demoted approver could keep approving until the token expired. | `authenticate` reloads the user by primary key on every request. |
| 6 | Medium | Behind a proxy, every client shares the proxy's IP, so the login rate limit would lock everyone out at once. | `TRUST_PROXY=true` makes Fastify use the forwarded client IP. |
| 7 | Low | `POST /cancel` with `Content-Type: application/json` and no body returned 400. | An empty JSON body is treated as no body. |
| 8 | Low | If the pending request was decided between the idempotent insert and the follow-up select, the caller got a misleading 409. | The create retries once. |
| 9 | Low | OpenAPI documented errors as `application/json`; the API sends `application/problem+json`, and 429/500 were missing. | Problem responses are documented with the real content type; 429 and 500 are on every route. |
| 10 | Low | Decision times came from the app server's clock and creation times from the database's, so clock skew could put a decision before the request. | Both use the database clock (`now()`). |
| 11 | Low | Dashboard: after a 409 (someone else decided first) the panel still showed Approve/Reject; approving the last item on the last page showed "Page 2 of 1". | Queries refresh after errors too; the page clamps to the last one. |
| 12 | Low | Dashboard: form errors weren't linked to their inputs for screen readers; the request panel didn't take focus. | `aria-invalid`/`aria-describedby` and `role="alert"`; the panel heading gets focus. |

Also: `metadata` is limited to 10 KB, and the dashboard can call an API on another host (`VITE_API_URL`).

### Known limitations (documented, not fixed)

- ~~**Concurrency tests run on PGlite**, which executes transactions one at a time, so they proved the code paths, not real races.~~ Covered since: the `api-postgres` CI job runs the API tests against a Postgres 17 server (`TEST_DATABASE_URL`), where simultaneous requests race over separate connections. Ten parallel decisions on one request must produce exactly one winner and one `approvals` row, which would not hold without `SELECT … FOR UPDATE`.
- **Agents sign in with an email and password** and get an 8-hour user token. A production setup would give machines their own credentials (API keys or OAuth client credentials) with short-lived tokens.
- **The login limit is per IP**, not per account. A per-account backoff would also slow down distributed guessing.
- **An idempotent retry with a different payload** returns the original request unchanged. Storing a hash of the payload and answering 422 on a mismatch, as payment APIs do, would make that explicit.
- **The notification worker's SKIP LOCKED is tested on PGlite too**, so two workers draining at once run one after the other. The test proves each event is delivered once; the skipping itself needs a real Postgres to observe.
- **The worker calls the webhook inside the transaction that claimed the batch**, so a slow receiver holds row locks and a connection for up to its 5-second timeout per event. Fine at this volume; at scale, claim events with a lease (push `available_at` forward and commit) and deliver outside the transaction.

## 2026-11-18: first production deploy

| Severity | Finding | Fix |
|---|---|---|
| High | Every API request on Vercel failed with `FUNCTION_INVOCATION_FAILED`. The logs showed `ERR_REQUIRE_ESM`: `@fastify/swagger-ui` → `@fastify/static` `require()`s the ESM-only `content-disposition` 3. Node 26 allows that locally, so tests and local runs passed; Vercel's function loader does not. | Removed `@fastify/swagger-ui`. `/docs` is a small page that loads Swagger UI from a CDN, with a CSP relaxed only on that route. Verified on the live deployment. |

Lesson: test the deployed artifact, not just the code. The serverless handler had been tested behind a local Node server, which used the local module loader.

## 2026-11-18: database failures and resilience

The `api-postgres` CI job (the API tests against a real Postgres 17 server) crashed the test process: the server closed a connection that sat idle in the pool, the pool emitted `'error'`, and nothing listened for it. PGlite has no network connections, so the local runs never showed it. On Neon, which drops idle connections and suspends the database, the same thing would kill a running server. That prompted a look at every way the database can be briefly unavailable.

| Severity | Finding | Fix |
|---|---|---|
| High | An idle pool connection closed by the server crashed the process (unhandled `'error'` event). | The pool has an `'error'` listener that logs; the pool replaces the connection itself. |
| Medium | The pool waited forever for a connection and a query, so an unreachable database held a function until Vercel killed it at 10 s, with a generic platform error. | Connect timeout 3 s, query timeout 5 s, max 5 connections, idle timeout 10 s, TCP keepalive. |
| Medium | A dropped connection, a database waking up or a deadlock answered 500 "Something went wrong", which clients treat as a bug and don't retry. | Transient failures answer 503 problem+json with `Retry-After` and are logged as warnings. |
| Medium | The serverless handler cached the promise of its first start. If that start failed, every later request on the instance got the same rejected promise until the instance was recycled. | A failed start is forgotten so the next request tries again; a transient one answers 503. The first connection on a cold start is retried once. |
| Low | Deadlocks and serialization failures, which Postgres says to fix by re-running the transaction, reached the user as errors. | Those transactions are retried once after a short random delay. Other writes are not retried. |
| Low | Nothing told a load balancer or uptime check whether the API could reach its database: `/health` doesn't touch it, by design. | `GET /ready` checks the database with a 2 s timeout. |
| Low | A hung close could keep a stopping server alive indefinitely. | Shutdown exits after 10 s regardless. |
| Low | The dashboard showed a raw error while the API was briefly unavailable. | Queries retry network errors and 5xx with backoff (honouring `Retry-After`), never 4xx, under a "retrying" banner; mutations are not retried. |

Not done: a server-side `statement_timeout`. Neon's pooled endpoint rejects it as a startup parameter, so it would have to be set on the database role (see README, Resilience).
