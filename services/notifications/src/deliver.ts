// Delivers one outbox event: in-app notifications for the people who should know, then the webhook if set.
import { EventType, RequestEvent } from '@approvals/contracts';
import type { Db } from '@approvals/api/db/client';
import { notifications, type outboxEvents } from '@approvals/api/db/schema';
import { recipientsFor } from './recipients.js';
import { postWebhook, type WebhookOptions } from './webhook.js';

export type OutboxEvent = typeof outboxEvents.$inferSelect;

export interface DeliveryOptions {
  webhook?: WebhookOptions;
}

export async function deliver(tx: Db, event: OutboxEvent, { webhook }: DeliveryOptions) {
  // The event crossed a service boundary, so check it against the shared contract. A malformed one fails here,
  // is retried and ends up dead-lettered instead of producing wrong notifications.
  const type = EventType.parse(event.type);
  const payload = RequestEvent.parse(event.payload);

  const recipients = await recipientsFor(tx, type, payload);
  if (recipients.length > 0) {
    await tx
      .insert(notifications)
      .values(recipients.map((r) => ({ ...r, eventId: event.id, requestId: payload.requestId, event: type })))
      // At-least-once delivery means the same event can arrive again (a replay, or a broker redelivering it).
      // The unique (event_id, recipient_id) turns the repeat into a no-op instead of a second notification.
      .onConflictDoNothing({ target: [notifications.eventId, notifications.recipientId] });
  }

  if (webhook) await postWebhook(event, webhook);
}
