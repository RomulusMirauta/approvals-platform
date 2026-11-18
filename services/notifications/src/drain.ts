// Consumes the outbox: claims a batch of due events, delivers each one and records the outcome.
import * as Sentry from '@sentry/node';
import { and, asc, eq, isNull, lt, lte, sql } from 'drizzle-orm';
import type { Db } from '@approvals/api/db/client';
import { outboxEvents } from '@approvals/api/db/schema';
import { deliver, type DeliveryOptions } from './deliver.js';
import { logger as defaultLogger, type Logger } from './logger.js';
import { webhookFromEnv, type WebhookOptions } from './webhook.js';

// After this many failed attempts an event is dead-lettered: it stays in the table (processed_at null, with
// its last_error) for a person to look at, but no worker picks it up again.
export const MAX_ATTEMPTS = 5;

export interface DrainOptions extends DeliveryOptions {
  batchSize?: number;
  maxAttempts?: number;
  // Injected so tests can read the log lines.
  logger?: Logger;
}

export interface DrainResult {
  claimed: number;
  delivered: number;
  failed: number;
}

// 10 s, 20 s, 40 s, ... capped at an hour: a receiver that is down gets time to recover instead of a flood.
export const backoffSeconds = (attempts: number) => Math.min(10 * 2 ** (attempts - 1), 3_600);

// Read once per process, so the "sent unsigned" warning is logged once, not on every drain. A malformed signing
// secret throws here; the worker calls this when it starts.
let envWebhook: { value: WebhookOptions | undefined } | undefined;
export const defaultWebhook = () => (envWebhook ??= { value: webhookFromEnv(process.env, defaultLogger) }).value;

// One batch in one transaction. A cron job or serverless function can call this too; the worker calls it in a loop.
export async function drainOnce(
  db: Db,
  { batchSize = 20, maxAttempts = MAX_ATTEMPTS, webhook = defaultWebhook(), logger = defaultLogger }: DrainOptions = {},
): Promise<DrainResult> {
  return db.transaction(async (tx) => {
    // FOR UPDATE locks the claimed rows until this transaction ends. SKIP LOCKED makes other workers pass over
    // them instead of waiting, so several workers share the queue and never process the same event at once.
    // If this worker crashes, the transaction rolls back and the events become available again.
    const batch = await tx
      .select()
      .from(outboxEvents)
      .where(and(isNull(outboxEvents.processedAt), lt(outboxEvents.attempts, maxAttempts), lte(outboxEvents.availableAt, sql`now()`)))
      .orderBy(asc(outboxEvents.availableAt))
      .limit(batchSize)
      .for('update', { skipLocked: true });

    const result: DrainResult = { claimed: batch.length, delivered: 0, failed: 0 };
    for (const event of batch) {
      const attempts = event.attempts + 1;
      // requestId is the API call that caused the event: searching both services' logs for it shows its whole path.
      const log = logger.child({ eventId: event.id, eventType: event.type, requestId: event.httpRequestId, attempts });
      try {
        // A savepoint: if delivery fails, its notification rows roll back but the rest of the batch carries on.
        await tx.transaction((savepoint) => deliver(savepoint, event, { webhook }));
        await tx.update(outboxEvents).set({ processedAt: sql`now()`, attempts }).where(eq(outboxEvents.id, event.id));
        result.delivered++;
        log.info('Event delivered');
      } catch (error) {
        await tx
          .update(outboxEvents)
          .set({
            attempts,
            lastError: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
            availableAt: sql`now() + make_interval(secs => ${backoffSeconds(attempts)})`,
          })
          .where(eq(outboxEvents.id, event.id));
        result.failed++;
        if (attempts < maxAttempts) {
          // A warning: the receiver may just be down for a while, and the event will be retried.
          log.warn({ err: error }, 'Event delivery failed, will retry');
        } else {
          // Nobody retries it any more, so a person has to look. Sentry is a no-op unless SENTRY_DSN is set.
          log.error({ err: error }, 'Event dead-lettered');
          Sentry.captureException(error, { tags: { requestId: event.httpRequestId ?? undefined, eventId: event.id, eventType: event.type } });
        }
      }
    }
    return result;
  });
}
