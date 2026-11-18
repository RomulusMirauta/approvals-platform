import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../db/client.js';
import { resetDemo } from '../db/reset.js';
import { unauthorized } from '../errors.js';

// Operations endpoints, not for users: Vercel Cron (or an operator) calls these with Authorization: Bearer <CRON_SECRET>.
export const internalRoutes: FastifyPluginAsyncZod<{ db: Db; cronSecret: string }> = async (app, { db, cronSecret }) => {
  const expected = Buffer.from(`Bearer ${cronSecret}`);

  app.addHook('onRequest', async (request) => {
    const given = Buffer.from(request.headers.authorization ?? '');
    // timingSafeEqual needs equal lengths; comparing in constant time stops guessing the secret byte by byte.
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthorized('Missing or invalid cron secret');
  });

  app.get(
    '/reset-demo',
    {
      schema: {
        hide: true,
        response: { 200: z.object({ reset: z.literal(true), users: z.number(), requests: z.number() }) },
      },
    },
    async () => ({ reset: true as const, ...(await resetDemo(db)) }),
  );

  // For an operator, not the scheduler: proves the Sentry wiring after a deploy. The error goes through the real
  // error handler, answers 500 and should appear in Sentry tagged with this response's X-Request-Id.
  app.get('/sentry-check', { schema: { hide: true } }, async () => {
    throw new Error('Sentry check: a deliberate test error from GET /internal/sentry-check');
  });
};
