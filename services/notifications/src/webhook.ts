// Forwards an event to an outside system (Slack, email gateway, the ERP) over HTTP, signed so it can trust it.
import type { Logger } from './logger.js';
import { parseSigningSecret, signWebhook } from './signature.js';

export interface WebhookOptions {
  url: string;
  // The decoded WEBHOOK_SIGNING_SECRET. Without it deliveries go out unsigned.
  secret?: Buffer;
  // Injected so tests can fake the receiver without a server.
  fetch?: typeof fetch;
  timeoutMs?: number;
  // Milliseconds, like Date.now(); injected so tests can pin the signed timestamp.
  now?: () => number;
}

export interface WebhookEvent {
  id: string;
  type: string;
  createdAt: Date;
  payload: unknown;
  httpRequestId: string | null;
}

// Reads NOTIFY_WEBHOOK_URL and WEBHOOK_SIGNING_SECRET. A malformed secret throws even without a URL, so it is
// found when the worker starts, not when someone turns the webhook on.
export function webhookFromEnv(env: NodeJS.ProcessEnv, logger: Logger): WebhookOptions | undefined {
  const secret = env.WEBHOOK_SIGNING_SECRET ? parseSigningSecret(env.WEBHOOK_SIGNING_SECRET) : undefined;
  const url = env.NOTIFY_WEBHOOK_URL;
  if (!url) return undefined;
  if (secret) return { url, secret };
  // Deploys from before signing keep working; the receiver just can't tell our deliveries from anyone else's.
  logger.warn('NOTIFY_WEBHOOK_URL is set but WEBHOOK_SIGNING_SECRET is not: webhooks are sent unsigned');
  return { url };
}

export async function postWebhook(
  event: WebhookEvent,
  { url, secret, fetch: send = fetch, timeoutMs = 5_000, now = Date.now }: WebhookOptions,
) {
  // Serialized once: the signature covers these exact bytes.
  const body = JSON.stringify({ id: event.id, type: event.type, createdAt: event.createdAt.toISOString(), payload: event.payload });
  // The time of this attempt, not of the event: a retry an hour later must still pass the receiver's replay window.
  const timestamp = Math.floor(now() / 1_000);
  const response = await send(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Delivery is at-least-once, so the receiver may see an event twice; the key lets it drop the repeat.
      'idempotency-key': event.id,
      // The API call that caused the event, so the receiver's logs can be matched with ours.
      ...(event.httpRequestId && { 'x-request-id': event.httpRequestId }),
      // Standard Webhooks: the event's id, so it is the same on every retry, like the idempotency key.
      'webhook-id': event.id,
      'webhook-timestamp': String(timestamp),
      ...(secret && { 'webhook-signature': signWebhook(secret, event.id, timestamp, body) }),
    },
    body,
    // A receiver that hangs must not hold the batch, and its row locks, forever.
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Anything but 2xx counts as not delivered, so the event is retried.
  if (!response.ok) throw new Error(`Webhook answered ${response.status}`);
}
