// Entry point for serverless platforms (Vercel). Each function instance builds the app once, on its first
// request, and reuses it for the requests that follow. Migrations and demo data run in the deploy pipeline,
// not here, so a cold start only opens a connection pool.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Problem } from '@approvals/contracts';
import { buildApp } from '../app.js';
import { cronSecret, jwtSecret } from '../config.js';
import { openDatabase } from '../db/client.js';
import { isTransientDbError, RETRY_AFTER_SECONDS } from '../errors.js';
import { loggerOptions } from '../logging.js';
import { requestIdFrom } from '../request-id.js';
import { initSentry, reportError } from '../sentry.js';

// Once per function instance, before the app (and its Fastify instance) is built.
initSentry();

let app: ReturnType<typeof start> | undefined;

async function start() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set');
  const database = await openDatabase(url, { migrate: false });
  // Behind Vercel's proxy, the client IP comes from X-Forwarded-For, which Vercel overwrites (a client can't add
  // entries), so the whole header is trusted. The dashboard is on the same origin.
  const instance = await buildApp({ db: database.db, jwtSecret: jwtSecret(), logger: loggerOptions(), trustProxy: true, cronSecret: cronSecret() });
  await instance.ready();
  return instance;
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  // Forget a failed start, so the next request tries again instead of getting the same rejected promise
  // for as long as this instance lives.
  app ??= start().catch((error: unknown) => {
    app = undefined;
    throw error;
  });

  let instance: Awaited<typeof app>;
  try {
    instance = await app;
  } catch (error) {
    // The database didn't answer on a cold start, even after one retry: tell the client to come back shortly,
    // in the same problem format as every other error. Anything else (a missing secret) is a real failure.
    // No Fastify request exists yet to carry an id, so make one the same way Fastify would.
    const requestId = requestIdFrom(request.headers);
    if (!isTransientDbError(error)) {
      // The platform logs the crash, but nobody reads those until someone complains.
      await reportError(error, { requestId });
      throw error;
    }
    console.warn('Cold start could not reach the database:', error instanceof Error ? error.message : error);
    const body: Problem = {
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
      detail: 'The service is starting up; try again in a moment',
      requestId,
    };
    response.writeHead(503, {
      'Content-Type': 'application/problem+json',
      'Retry-After': String(RETRY_AFTER_SECONDS),
      'X-Request-Id': requestId,
    });
    response.end(JSON.stringify(body));
    return;
  }
  instance.server.emit('request', request, response);
}
