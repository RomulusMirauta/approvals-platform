// Builds the Fastify app without starting it, so tests can drive it with app.inject() and no open port.
import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db/client.js';
import { registerDocs } from './docs.js';
import { problems, registerErrorHandlers, serviceUnavailable } from './errors.js';
import { RequestLog } from './logging.js';
import { requestIdFrom } from './request-id.js';
import { authRoutes } from './routes/auth.js';
import { internalRoutes } from './routes/internal.js';
import { notificationRoutes } from './routes/notifications.js';
import { reportRoutes } from './routes/reports.js';
import { requestRoutes } from './routes/requests.js';

export interface AppOptions {
  db: Db;
  jwtSecret: string;
  logger?: FastifyServerOptions['logger'];
  corsOrigin?: string;
  // Tests turn it off so many logins in a row don't hit the login limit.
  rateLimit?: boolean;
  // Behind a proxy (Vercel, a load balancer) every request comes from the proxy's IP. Trusting it makes
  // request.ip the real client, so the rate limits apply per client instead of to everyone at once.
  // true trusts every peer's X-Forwarded-For (the proxy must replace the header); a string only the listed proxies'.
  trustProxy?: FastifyServerOptions['trustProxy'];
  // Set only on the public demo: adds GET /internal/reset-demo for the nightly cron.
  cronSecret?: string;
}

// A readiness probe must answer quickly either way: a database that takes longer than this is not ready.
const READY_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function buildApp({ db, jwtSecret, logger = false, corsOrigin, rateLimit: limit = true, trustProxy = false, cronSecret }: AppOptions) {
  const app = Fastify({
    logger,
    trustProxy,
    logController: new RequestLog(),
    // Explicitly off (Fastify 5's default): with a header name set, Fastify would trust the value as it comes and skip
    // genReqId. requestIdFrom reads X-Request-Id itself and checks it first.
    requestIdHeader: false,
    genReqId: (request) => requestIdFrom(request.headers),
  }).withTypeProvider<ZodTypeProvider>();

  // The zod schemas from @approvals/contracts validate input, serialize output (dropping unknown fields)
  // and generate the OpenAPI document.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandlers(app);
  // Added before every other hook (rate limit, auth), so every response carries it, errors included: a client can
  // quote it in a bug report, and a caller that sent its own id sees which one we used.
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });

  // Actions like POST /cancel have no body. Many clients still send Content-Type: application/json with
  // nothing after it, which Fastify rejects by default; treat that as "no body" instead.
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) =>
    body === '' ? done(null, undefined) : parseJson(request, body.toString(), done),
  );

  // Default security headers, including a strict CSP. Only /docs relaxes it (see docs.ts).
  await app.register(helmet);
  // Response headers are not readable cross-origin unless exposed: the dashboard times its retries with Retry-After,
  // and X-Request-Id lets it (or a developer in the browser console) name the request that failed.
  await app.register(cors, { origin: corsOrigin ?? process.env.CORS_ORIGIN ?? 'http://localhost:5173', exposedHeaders: ['Retry-After', 'X-Request-Id'] });
  if (limit) await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  // Pinning the algorithm means a token can't pick a weaker one (or none) for itself.
  await app.register(jwt, { secret: jwtSecret, sign: { algorithm: 'HS256' }, verify: { algorithms: ['HS256'] } });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Approvals API',
        version: '1.0.0',
        description: 'Human-in-the-loop approvals for AI agents. Errors use RFC 9457 problem details.',
      },
      tags: [
        { name: 'auth', description: 'Sign in and the current user' },
        { name: 'requests', description: 'Approval requests, decisions and comments' },
        { name: 'reports', description: 'Tags and counters for the dashboard' },
        { name: 'notifications', description: 'Notifications delivered by the notification service' },
        { name: 'health', description: 'Liveness (/health) and readiness (/ready) checks' },
      ],
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      // Every route needs a token unless it says security: [].
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  registerDocs(app);

  // Liveness: the process is up and answering. It never touches the database, so a database outage doesn't
  // make a platform restart healthy API instances, which would not fix the database.
  app.get(
    '/health',
    { schema: { tags: ['health'], security: [], response: { 200: z.object({ status: z.literal('ok') }) } } },
    async () => ({ status: 'ok' as const }),
  );

  // Readiness: this instance can serve real requests, database included. A load balancer or uptime check uses it
  // to stop sending traffic (or to alert) while the database is unreachable, then resumes once it answers.
  app.get(
    '/ready',
    {
      schema: {
        tags: ['health'],
        security: [],
        response: { 200: z.object({ status: z.literal('ready') }), ...problems(503) },
      },
    },
    async (request) => {
      try {
        await withTimeout(db.execute(sql`select 1`), READY_TIMEOUT_MS);
      } catch (error) {
        request.log.warn({ err: error }, 'Readiness check failed');
        throw serviceUnavailable('The database is not reachable');
      }
      return { status: 'ready' as const };
    },
  );

  // Version prefix: a breaking change would ship as /v2 next to /v1.
  await app.register(
    async (v1) => {
      await v1.register(authRoutes, { db });
      await v1.register(requestRoutes, { db });
      await v1.register(reportRoutes, { db });
      await v1.register(notificationRoutes, { db });
    },
    { prefix: '/v1' },
  );

  // Outside /v1: an operations job, not part of the public API.
  if (cronSecret) await app.register(internalRoutes, { db, cronSecret, prefix: '/internal' });

  return app;
}
