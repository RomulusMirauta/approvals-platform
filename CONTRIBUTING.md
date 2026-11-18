# Contributing

## Setup

Requires Node.js 22.12 or newer. No Docker: locally the API runs on PGlite (in-process Postgres).

```bash
npm ci
npm run dev:api    # API on fresh seeded data, docs at /docs
npm run dev:web    # dashboard
```

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build
npm run test:e2e   # Playwright; run `npx playwright install chromium` once first
```

Tests live in each workspace's `tests/` folder (Vitest) and in `e2e/` (Playwright).
A bug fix comes with a test that fails without it.

## Pull requests

`main` is protected: open a pull request. It merges when CI (lint/typecheck/test/build,
API tests on real Postgres, Playwright) passes. Merging deploys production on Vercel.

## Commits

[Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`, `refactor:`.
Bugs found in review go in [FINDINGS.md](FINDINGS.md). User-facing changes go in [CHANGELOG.md](CHANGELOG.md).
