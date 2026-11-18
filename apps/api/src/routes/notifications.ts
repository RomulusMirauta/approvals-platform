import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Notification, NotificationList } from '@approvals/contracts';
import { authenticate } from '../auth.js';
import type { Db } from '../db/client.js';
import { problems } from '../errors.js';
import { listNotifications, markRead } from '../services/notifications.js';

const IdParams = z.object({ id: z.uuid() });

// The notification service writes notifications; reading them goes through the API so auth stays in one place.
export const notificationRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.addHook('onRequest', authenticate(db));

  app.get(
    '/notifications',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Your notifications, newest first, and how many are unread',
        response: { 200: NotificationList, ...problems(401) },
      },
    },
    async (request) => listNotifications(db, request.user),
  );

  app.post(
    '/notifications/:id/read',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Mark one of your notifications as read',
        params: IdParams,
        response: { 200: Notification, ...problems(400, 401, 404) },
      },
    },
    async (request) => markRead(db, request.user, request.params.id),
  );
};
