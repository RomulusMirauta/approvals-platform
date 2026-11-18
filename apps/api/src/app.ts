// Builds the Fastify app without starting it, so tests can drive it with app.inject() and no open port.
import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from './db/client.js';
import { registerDocs } from './docs.js';
import { registerErrorHandlers } from './errors.js';
import { authRoutes } from './routes/auth.js';
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
  trustProxy?: boolean;
}

export async function buildApp({ db, jwtSecret, logger = false, corsOrigin, rateLimit: limit = true, trustProxy = false }: AppOptions) {
  const app = Fastify({ logger, trustProxy }).withTypeProvider<ZodTypeProvider>();

  // The zod schemas from @approvals/contracts validate input, serialize output (dropping unknown fields)
  // and generate the OpenAPI document.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandlers(app);

  // Actions like POST /cancel have no body. Many clients still send Content-Type: application/json with
  // nothing after it, which Fastify rejects by default; treat that as "no body" instead.
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) =>
    body === '' ? done(null, undefined) : parseJson(request, body.toString(), done),
  );

  // Default security headers, including a strict CSP. Only /docs relaxes it (see docs.ts).
  await app.register(helmet);
  await app.register(cors, { origin: corsOrigin ?? process.env.CORS_ORIGIN ?? 'http://localhost:5173' });
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
        { name: 'health', description: 'Liveness check' },
      ],
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      // Every route needs a token unless it says security: [].
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  registerDocs(app);

  app.get(
    '/health',
    { schema: { tags: ['health'], security: [], response: { 200: z.object({ status: z.literal('ok') }) } } },
    async () => ({ status: 'ok' as const }),
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

  return app;
}
