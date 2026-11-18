// Reading notifications. The notification service writes them; the API only shows each user their own.
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Notification, NotificationList } from '@approvals/contracts';
import type { TokenPayload } from '../auth.js';
import type { Db } from '../db/client.js';
import { notifications } from '../db/schema.js';
import { notFound } from '../errors.js';

const PAGE_SIZE = 50;

const toNotification = (row: typeof notifications.$inferSelect): Notification => ({
  id: row.id,
  event: row.event,
  requestId: row.requestId,
  message: row.message,
  read: row.readAt !== null,
  createdAt: row.createdAt.toISOString(),
});

export async function listNotifications(db: Db, viewer: TokenPayload): Promise<NotificationList> {
  const mine = eq(notifications.recipientId, viewer.sub);
  const [rows, [unreadRow]] = await Promise.all([
    db.select().from(notifications).where(mine).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(PAGE_SIZE),
    db.select({ unread: count() }).from(notifications).where(and(mine, isNull(notifications.readAt))),
  ]);
  return { items: rows.map(toNotification), unread: unreadRow?.unread ?? 0 };
}

export async function markRead(db: Db, viewer: TokenPayload, id: string): Promise<Notification> {
  // coalesce keeps the first read time, so marking twice is harmless. Someone else's notification is a 404.
  const [row] = await db
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.id, id), eq(notifications.recipientId, viewer.sub)))
    .returning();
  if (!row) throw notFound('Notification not found');
  return toNotification(row);
}
