// Forwards an event to an outside system (Slack, email gateway, the ERP) over HTTP.
export interface WebhookOptions {
  url: string;
  // Injected so tests can fake the receiver without a server.
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface WebhookEvent {
  id: string;
  type: string;
  createdAt: Date;
  payload: unknown;
  httpRequestId: string | null;
}

export async function postWebhook(event: WebhookEvent, { url, fetch: send = fetch, timeoutMs = 5_000 }: WebhookOptions) {
  const response = await send(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Delivery is at-least-once, so the receiver may see an event twice; the key lets it drop the repeat.
      'idempotency-key': event.id,
      // The API call that caused the event, so the receiver's logs can be matched with ours.
      ...(event.httpRequestId && { 'x-request-id': event.httpRequestId }),
    },
    body: JSON.stringify({ id: event.id, type: event.type, createdAt: event.createdAt.toISOString(), payload: event.payload }),
    // A receiver that hangs must not hold the batch, and its row locks, forever.
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Anything but 2xx counts as not delivered, so the event is retried.
  if (!response.ok) throw new Error(`Webhook answered ${response.status}`);
}
