# CLAUDE.md

Human-in-the-loop approvals for AI agents: a versioned REST API (Fastify, Postgres/Drizzle) and a
React dashboard where people approve requests that agents such as erp-procurement-mcp submit.
npm workspaces: `packages/contracts`, `apps/api`, `apps/web`, `services/notifications`, `e2e`. See README.md.

## Commands

- `npm run dev:api` / `npm run dev:web`: run locally (PGlite, no Docker)
- `npm run lint && npm run typecheck && npm test && npm run build`: what CI runs
- `npm run test:e2e`: Playwright (starts its own API and dashboard)

## Conventions

- Tests go in each workspace's `tests/` folder (Vitest) or `e2e/` (Playwright); every bug fix gets a regression test.
- Bugs found in review are logged in `FINDINGS.md`; user-facing changes in `CHANGELOG.md`.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `ci:`, `chore:` ...). One version for all workspaces, semver;
  release = annotated tag `vX.Y.Z` + GitHub Release, made after the PR is merged.
- Work on a branch and open a pull request. The `main` ruleset requires these checks:
  "Lint, typecheck, test, build", "API tests on a real Postgres server", "End-to-end tests (Playwright)".
  The repository admin can bypass it (through a pull request) for emergencies only.
- Schema changes go through a new Drizzle migration in `apps/api/drizzle`, never by editing an old one.

## Don't

- Never commit secrets (`.env`, `JWT_SECRET`, `DATABASE_URL`, Vercel tokens).
- Never push to `main` directly, force-push or delete it: merging to `main` deploys production.
- Don't point tests or previews at the production database.
