import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Stats, Tag } from '@approvals/contracts';
import { authenticate } from '../auth.js';
import type { Db } from '../db/client.js';
import { problems } from '../errors.js';
import { getStats } from '../services/stats.js';
import { listTags } from '../services/tags.js';

// Read-only views for the dashboard: tag filter options and the counters on the home page.
export const reportRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.addHook('onRequest', authenticate(db));

  app.get(
    '/tags',
    {
      schema: {
        tags: ['reports'],
        summary: 'Tags with how many of your visible requests use each',
        response: { 200: z.array(Tag), ...problems(401) },
      },
    },
    async (request) => listTags(db, request.user),
  );

  app.get(
    '/stats',
    { schema: { tags: ['reports'], summary: 'Request counts for the dashboard', response: { 200: Stats, ...problems(401) } } },
    async (request) => getStats(db, request.user),
  );
};
