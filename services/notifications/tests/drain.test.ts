import { createHmac, randomBytes } from 'node:crypto';
import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { EventType, RequestEvent } from '@approvals/contracts';
import { openDatabase, type Database } from '@approvals/api/db/client';
import { notifications, outboxEvents, requests, users as usersTable } from '@approvals/api/db/schema';
import { REDACT_CENSOR, REDACT_PATHS } from '@approvals/api/redact';
import { initSentry } from '@approvals/api/sentry';
import { backoffSeconds, drainOnce, MAX_ATTEMPTS } from '../src/drain.js';

let database: Database;
let users: Record<'alice' | 'bob' | 'carol' | 'agent', { sub: string; name: string }>;
let request: { id: string; title: string };

// The service only knows the database, so the fixtures are rows: one user per role and a request from Alice.
beforeAll(async () => {
  database = await openDatabase();
  const rows = await database.db
    .insert(usersTable)
    .values(
      (['requester', 'approver', 'admin', 'agent'] as const).map((role, i) => ({
        email: `${role}@example.com`,
        name: ['Alice Popescu', 'Bob Ionescu', 'Carol Dumitru', 'ERP Agent'][i]!,
        role,
        passwordHash: 'not-used',
      })),
    )
    .returning();
  const [alice, bob, carol, agent] = rows.map((row) => ({ sub: row.id, name: row.name }));
  users = { alice: alice!, bob: bob!, carol: carol!, agent: agent! };
  const [inserted] = await database.db
    .insert(requests)
    .values({ title: 'New laptop', type: 'purchase', requesterId: users.alice.sub })
    .returning({ id: requests.id, title: requests.title });
  request = inserted!;
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.db.delete(notifications);
  await database.db.delete(outboxEvents);
});

// Puts an event about Alice's request on the queue, as the API would.
async function emit(type: EventType, overrides: Partial<RequestEvent> = {}, httpRequestId: string | null = null) {
  const payload: RequestEvent = {
    requestId: request.id,
    requesterId: users.alice.sub,
    title: request.title,
    type: 'purchase',
    priority: 'normal',
    source: 'manual',
    externalRef: null,
    actor: { id: users.bob.sub, name: users.bob.name },
    ...overrides,
  };
  const [row] = await database.db.insert(outboxEvents).values({ type, payload, httpRequestId }).returning();
  return row!;
}

const eventRow = async (id: string) => (await database.db.select().from(outboxEvents).where(eq(outboxEvents.id, id)))[0]!;
const notificationsFor = (eventId: string) => database.db.select().from(notifications).where(eq(notifications.eventId, eventId));
// Skips the backoff wait, so a failed event is due again now.
const makeDue = () => database.db.update(outboxEvents).set({ availableAt: sql`now()` });

const respond = (status: number) => vi.fn<typeof fetch>(async () => new Response(null, { status }));
const webhook = (fetch: typeof globalThis.fetch) => ({ url: 'https://hooks.example.com/approvals', fetch });

describe('drainOnce', () => {
  it('tells the requester about a decision, once', async () => {
    const event = await emit('request.rejected', { decision: 'rejected', comment: 'Over budget' });

    expect(await drainOnce(database.db)).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    const rows = await notificationsFor(event.id);
    expect(rows).toEqual([
      expect.objectContaining({ recipientId: users.alice.sub, event: 'request.rejected', message: `Bob Ionescu rejected "${request.title}": Over budget` }),
    ]);
    expect((await eventRow(event.id)).processedAt).not.toBeNull();

    // Processed events are never claimed again.
    expect(await drainOnce(database.db)).toEqual({ claimed: 0, delivered: 0, failed: 0 });
  });

  it('tells approvers and admins about invoice exceptions and high-priority requests, but not the raiser', async () => {
    const invoice = await emit('request.created', { type: 'invoice_exception', actor: { id: users.alice.sub, name: users.alice.name } });
    const urgent = await emit('request.created', { requesterId: users.carol.sub, priority: 'high' });
    const routine = await emit('request.created');
    await drainOnce(database.db);

    const recipients = async (id: string) => (await notificationsFor(id)).map((n) => n.recipientId).sort();
    expect(await recipients(invoice.id)).toEqual([users.bob.sub, users.carol.sub].sort());
    expect(await recipients(urgent.id)).toEqual([users.bob.sub]);
    expect(await recipients(routine.id)).toEqual([]);
  });

  it('never gives the same event to two workers draining at once', async () => {
    const events = await Promise.all(Array.from({ length: 6 }, () => emit('request.approved', { decision: 'approved' })));
    const results = await Promise.all([1, 2, 3].map(() => drainOnce(database.db, { batchSize: 4 })));

    expect(results.reduce((sum, r) => sum + r.delivered, 0)).toBe(events.length);
    expect(await database.db.select().from(notifications)).toHaveLength(events.length);
  });

  it('posts the event to the webhook with its id as the idempotency key', async () => {
    const fetch = respond(204);
    const event = await emit('request.cancelled');
    await drainOnce(database.db, { webhook: webhook(fetch) });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://hooks.example.com/approvals');
    expect(init?.headers).toMatchObject({ 'idempotency-key': event.id });
    expect(JSON.parse(String(init?.body))).toMatchObject({ id: event.id, type: 'request.cancelled', payload: { requestId: request.id } });
  });

  it('signs the delivery the Standard Webhooks way when there is a signing secret', async () => {
    const fetch = respond(204);
    const secret = randomBytes(32);
    const now = Date.UTC(2026, 10, 18, 12);
    const event = await emit('request.approved', { decision: 'approved' }, 'trace-signed-1');
    await drainOnce(database.db, { webhook: { ...webhook(fetch), secret, now: () => now } });

    const init = fetch.mock.calls[0]![1]!;
    const body = String(init.body);
    // Computed here from the spec, not with the code under test: v1, then base64 HMAC-SHA256 of "id.timestamp.body".
    const expected = createHmac('sha256', secret).update(`${event.id}.${now / 1_000}.${body}`).digest('base64');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'idempotency-key': event.id,
      'x-request-id': 'trace-signed-1',
      'webhook-id': event.id,
      'webhook-timestamp': String(now / 1_000),
      'webhook-signature': `v1,${expected}`,
    });
    expect(Object.keys(JSON.parse(body))).toEqual(['id', 'type', 'createdAt', 'payload']);
  });

  it('still delivers, unsigned, without a signing secret', async () => {
    const fetch = respond(204);
    const event = await emit('request.rejected', { decision: 'rejected', comment: 'Over budget' });
    expect(await drainOnce(database.db, { webhook: webhook(fetch) })).toMatchObject({ delivered: 1 });

    const headers = fetch.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers).toMatchObject({ 'webhook-id': event.id, 'webhook-timestamp': expect.stringMatching(/^\d+$/) });
    expect(headers).not.toHaveProperty('webhook-signature');
  });

  it('retries a failed delivery later, with backoff, and rolls back its notifications meanwhile', async () => {
    const event = await emit('request.approved', { decision: 'approved' });

    expect(await drainOnce(database.db, { webhook: webhook(respond(503)) })).toMatchObject({ delivered: 0, failed: 1 });
    const failed = await eventRow(event.id);
    expect(failed).toMatchObject({ processedAt: null, attempts: 1, lastError: 'Webhook answered 503' });
    expect(failed.availableAt.getTime()).toBeGreaterThan(Date.now() + 5_000);
    expect(await notificationsFor(event.id)).toHaveLength(0);

    // Not due yet: nothing to claim.
    expect((await drainOnce(database.db, { webhook: webhook(respond(200)) })).claimed).toBe(0);

    await makeDue();
    expect(await drainOnce(database.db, { webhook: webhook(respond(200)) })).toMatchObject({ delivered: 1 });
    expect(await eventRow(event.id)).toMatchObject({ attempts: 2 });
    expect(await notificationsFor(event.id)).toHaveLength(1);
  });

  it('gives up on a webhook that does not answer in time', async () => {
    const hang = vi.fn<typeof fetch>(
      (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    );
    const event = await emit('request.cancelled');
    await drainOnce(database.db, { webhook: { ...webhook(hang), timeoutMs: 20 } });
    expect((await eventRow(event.id)).lastError).toMatch(/timeout|aborted/i);
  });

  it('dead-letters an event after the maximum number of attempts', async () => {
    const event = await emit('request.approved', { decision: 'approved' });
    const failing = webhook(respond(500));
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await makeDue();
      expect(await drainOnce(database.db, { webhook: failing })).toMatchObject({ failed: 1 });
    }

    await makeDue();
    expect((await drainOnce(database.db, { webhook: failing })).claimed).toBe(0);
    expect(await eventRow(event.id)).toMatchObject({ processedAt: null, attempts: MAX_ATTEMPTS, lastError: 'Webhook answered 500' });
  });

  it('dead-letters a malformed event instead of notifying anyone', async () => {
    const [event] = await database.db
      .insert(outboxEvents)
      .values({ type: 'request.approved', payload: { requestId: 'not-a-uuid' } as unknown as RequestEvent, attempts: MAX_ATTEMPTS - 1 })
      .returning();
    expect(await drainOnce(database.db)).toMatchObject({ failed: 1 });
    expect(await notificationsFor(event!.id)).toHaveLength(0);
  });

  it('is idempotent when an event is delivered again', async () => {
    const fetch = respond(200);
    const event = await emit('request.created', { type: 'invoice_exception' });
    await drainOnce(database.db, { webhook: webhook(fetch) });
    // A replay: someone re-drives the event, or a broker redelivers it after a lost acknowledgement.
    await database.db.update(outboxEvents).set({ processedAt: null }).where(eq(outboxEvents.id, event.id));
    expect(await drainOnce(database.db, { webhook: webhook(fetch) })).toMatchObject({ delivered: 1 });

    expect(await notificationsFor(event.id)).toHaveLength(2);
    // The webhook does get it twice, with the same key, so the receiver can drop the repeat.
    expect(fetch.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)['idempotency-key'])).toEqual([event.id, event.id]);
  });
});

describe('backoffSeconds', () => {
  it('doubles each attempt and caps at an hour', () => {
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([10, 20, 40, 80]);
    expect(backoffSeconds(20)).toBe(3_600);
  });
});

describe('request ids', () => {
  // A pino logger that writes into an array, to read back what the worker logged.
  function capture() {
    const lines: Record<string, unknown>[] = [];
    const logger = pino({ redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR } }, { write: (line: string) => lines.push(JSON.parse(line)) });
    return { lines, logger };
  }

  it('logs the request id of the API call behind each event and sends it to the webhook', async () => {
    const fetch = respond(204);
    const { lines, logger } = capture();
    const event = await emit('request.approved', { decision: 'approved' }, 'trace-approve-1');
    await drainOnce(database.db, { webhook: webhook(fetch), logger });

    expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({ 'x-request-id': 'trace-approve-1' });
    expect(lines).toContainEqual(
      expect.objectContaining({ msg: 'Event delivered', requestId: 'trace-approve-1', eventId: event.id, eventType: 'request.approved' }),
    );
  });

  it('sends no X-Request-Id for an event no API call caused', async () => {
    const fetch = respond(204);
    await emit('request.cancelled');
    await drainOnce(database.db, { webhook: webhook(fetch), logger: capture().logger });
    expect(fetch.mock.calls[0]![1]?.headers).not.toHaveProperty('x-request-id');
  });

  it('logs a failure as a warning and a dead-lettered event as an error, and reports the latter to Sentry', async () => {
    const reported: ErrorEvent[] = [];
    initSentry({ SENTRY_DSN: 'https://public@sentry.example.invalid/1' }, {
      beforeSend: (event) => {
        reported.push(event);
        return null;
      },
    });
    const { lines, logger } = capture();
    await emit('request.approved', { decision: 'approved' }, 'trace-dead-1');
    const failing = webhook(respond(500));
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await makeDue();
      await drainOnce(database.db, { webhook: failing, logger });
    }
    await Sentry.flush(1_000);
    await Sentry.close();

    const levels = lines.map((line) => [line.msg, line.level]);
    expect(levels).toEqual([...Array(MAX_ATTEMPTS - 1).fill(['Event delivery failed, will retry', 40]), ['Event dead-lettered', 50]]);
    expect(reported).toHaveLength(1);
    expect(reported[0]!.tags).toMatchObject({ requestId: 'trace-dead-1', eventType: 'request.approved' });
  });
});
