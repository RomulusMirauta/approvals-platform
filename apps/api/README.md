# @approvals/api

Fastify 5 REST API. Request and response schemas come from `@approvals/contracts` (zod); they validate input, serialize output and generate the OpenAPI document at `/docs`.

```bash
npm run build:contracts            # from the repo root, once
npm run seed -w @approvals/api     # demo users and requests (skips if already seeded)
npm run dev -w @approvals/api      # http://localhost:3000/docs
npm test -w @approvals/api         # Vitest, each file on a fresh in-memory Postgres (PGlite)
```

Configuration: see [.env.example](.env.example). Without `DATABASE_URL` the data lives in `apps/api/.data/pglite`.

Demo users (password `demo-password`, **demo only**): `alice@example.com` (requester), `bob@example.com` (approver), `carol@example.com` (admin), `erp-agent@example.com` (agent).

## Endpoints

| Method | Path | Who |
| --- | --- | --- |
| GET | `/health` | anyone |
| POST | `/v1/auth/login` | anyone (10/min) |
| GET | `/v1/me` | signed in |
| GET | `/v1/requests` | signed in; requesters and agents see their own |
| POST | `/v1/requests` | requester, agent, admin; idempotent per `source` + `externalRef` |
| GET | `/v1/requests/:id` | anyone who can see it (else 404) |
| POST | `/v1/requests/:id/decision` | approver, admin; not on your own request |
| POST | `/v1/requests/:id/cancel` | its requester or an admin |
| POST | `/v1/requests/:id/comments` | anyone who can see it |
| GET | `/v1/tags`, `/v1/stats` | signed in |

Errors are RFC 9457 problem details (`application/problem+json`).

## Layout

- `src/app.ts` builds the app (plugins, OpenAPI, routes) without listening; `src/index.ts` starts it.
- `src/routes/` are thin: schema, role check, one service call.
- `src/services/` hold the queries and the mapping from rows to the contract.
- `src/errors.ts` turns every error, including Postgres constraint violations, into a problem response.
