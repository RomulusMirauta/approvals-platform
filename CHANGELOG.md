# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
All workspaces share one version.

## [Unreleased]

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
