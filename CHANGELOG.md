# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
All workspaces share one version.

## [Unreleased]

### Added

- Request ids: every API response has an `X-Request-Id` header (a caller's sane id is kept, otherwise a UUID) and every problem+json body a `requestId` (optional field in the `Problem` contract).
- The request id is stored with each outbox event (migration `0003`); the notification worker logs it and sends it to the webhook as `X-Request-Id`.
- Structured JSON logs: one line per API request (method, route, status, duration, request id, user id, Vercel id), `LOG_LEVEL`, and redaction of authorization headers, cookies, passwords, tokens and database URLs; the worker logs JSON too.
- Sentry error reporting when `SENTRY_DSN` is set: unexpected 500s from the API (tagged with the request id and user id, flushed before the response), dead-lettered events and failed drains from the worker. `GET /internal/sentry-check` (behind `CRON_SECRET`) checks the wiring.
- Docker: `docker compose up` runs Postgres, a one-shot migrate-and-seed job, the API, the notification worker and the dashboard (nginx, proxying the API on the same origin) as separate services, from one multi-stage Dockerfile with non-root images that hold only production dependencies. CI builds them and walks an approval through the running stack (`Docker Compose smoke test`).

### Changed

- Dependabot no longer proposes major `@types/node` updates: the types follow the oldest supported Node (22).
- `tsx` is a runtime dependency of the notification service, which runs its TypeScript sources directly.

## [0.2.0] - 2026-11-18

### Added

- Deployment to Vercel (API as a serverless function) with Neon Postgres; live demo.
- Nightly reset of the public demo through Vercel Cron (`/internal/reset-demo`, guarded by `CRON_SECRET`).
- Request events written to a transactional outbox in the same transaction as the change.
- Notification service (`services/notifications`) consuming the outbox with `FOR UPDATE SKIP LOCKED`, retries with backoff and an optional webhook; scheduled every 5 minutes in GitHub Actions for the demo.
- `GET /v1/notifications` and `POST /v1/notifications/:id/read`, and a notification bell in the dashboard.
- CI: API tests on a real Postgres 17 server, and Playwright against every pull request's preview deployment (`Preview E2E` commit status).

### Changed

- Demo data uses the ERP Procurement MCP server's real invoices, suppliers and exception codes.

### Fixed

- The API failed on Vercel (`ERR_REQUIRE_ESM` from the Swagger UI plugin); `/docs` now loads Swagger UI from a CDN.
- An idle database connection closed by the server crashed the process.
- Flaky dashboard tests that checked page 1 before its refetch.

## [0.1.0] - 2026-11-18

Initial version (not tagged at the time).

### Added

- npm workspaces monorepo: shared zod contract, Drizzle schema and SQL migrations (PGlite locally).
- Versioned REST API (`/v1`) on Fastify with JWT roles (requester, approver, admin, agent) and generated OpenAPI docs.
- React dashboard: request list and filters, exception queue, approve/reject with comments.
- Playwright end-to-end suite and CI job; README with screenshots.

### Security

- Fixes from the first code review, logged in [FINDINGS.md](FINDINGS.md): no fallback JWT secret outside `--dev`, only agents may set `source`/`externalRef`, the role is reloaded on every request, and more.

[Unreleased]: https://github.com/RomulusMirauta/approvals-platform/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/RomulusMirauta/approvals-platform/compare/43815fe...v0.2.0
[0.1.0]: https://github.com/RomulusMirauta/approvals-platform/tree/43815fe
