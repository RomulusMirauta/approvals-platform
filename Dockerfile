# syntax=docker/dockerfile:1
# One Dockerfile, one target per service (see compose.yaml): `api` (also runs the migrations and the seed),
# `worker` (the notification service) and `web` (the dashboard behind nginx). The stages share the
# dependency layers, so a code change rebuilds only what it touches.

# The Node major CI tests on (.github/workflows/ci.yml).
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
ENV npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false

# Only the manifests: these layers, and the installs below, are reused until a package.json or the lockfile
# changes. npm ci checks every workspace the root package.json names, so all of them are copied.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY services/notifications/package.json services/notifications/
COPY e2e/package.json e2e/

# --- Build: every dependency of the workspaces being built, dev ones included (TypeScript, Vite) ---

FROM manifests AS build-deps
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include-workspace-root -w @approvals/contracts -w @approvals/api -w @approvals/web

FROM build-deps AS contracts
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
RUN npm run build -w @approvals/contracts

FROM contracts AS api-build
COPY apps/api apps/api
RUN npm run build -w @approvals/api

FROM contracts AS web-build
COPY apps/web apps/web
RUN npm run build -w @approvals/web

# --- Runtime dependencies: production only ---

FROM manifests AS api-deps
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev -w @approvals/api

# The worker imports the API's database client and schema (@approvals/api/db/*), so it needs the API's
# dependencies too. tsx is a runtime dependency of the worker: it runs the TypeScript sources directly.
FROM manifests AS worker-deps
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev -w @approvals/notifications -w @approvals/api

# --- Final images ---

# The Fastify server (dist/index.js). The same image runs the one-shot migrate service (dist/db/seed.js).
FROM base AS api
ENV NODE_ENV=production
COPY --from=api-deps /app ./
COPY --from=contracts /app/packages/contracts/dist packages/contracts/dist
COPY apps/api/drizzle apps/api/drizzle
COPY --from=api-build /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:3000/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/index.js"]

# The notification worker in loop mode; `--once` drains the outbox and exits.
FROM base AS worker
ENV NODE_ENV=production
COPY --from=worker-deps /app ./
COPY --from=contracts /app/packages/contracts/dist packages/contracts/dist
COPY tsconfig.base.json ./
COPY apps/api/tsconfig.json apps/api/
COPY apps/api/src apps/api/src
COPY services/notifications/tsconfig.json services/notifications/
COPY services/notifications/src services/notifications/src
WORKDIR /app/services/notifications
USER node
CMD ["node", "--import", "tsx", "src/worker.ts"]

# The built dashboard, served by nginx, which also proxies the API paths to the api service (one origin).
FROM nginxinc/nginx-unprivileged:1.30-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
# Healthy = serves the dashboard and reaches a ready API through the proxy (catches a stale upstream address too).
HEALTHCHECK --interval=5s --timeout=3s --retries=10 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ && wget -q -O /dev/null http://127.0.0.1:8080/ready || exit 1
