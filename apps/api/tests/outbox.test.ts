import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc } from 'drizzle-orm';
import { outboxEvents } from '../src/db/schema.js';
import { recordEvent } from '../src/services/outbox.js';
import { newRequest, setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.db.delete(outboxEvents);
});

const events = () => t.db.select().from(outboxEvents).orderBy(asc(outboxEvents.createdAt));

async function raise() {
  const response = await t.as('alice', 'POST', '/v1/requests', newRequest({ priority: 'high' }));
  return response.json().request.id as string;
}

describe('transactional outbox', () => {
  it('records request.created with the request and who raised it', async () => {
    const id = await raise();
    expect(await events()).toEqual([
      expect.objectContaining({
        type: 'request.created',
        processedAt: null,
        attempts: 0,
        payload: {
          requestId: id,
          requesterId: t.users.alice.sub,
          title: 'New laptop',
          type: 'purchase',
          priority: 'high',
          source: 'manual',
          externalRef: null,
          actor: { id: t.users.alice.sub, name: t.users.alice.name },
        },
      }),
    ]);
  });

  it('records nothing for an idempotent retry that finds the existing request', async () => {
    const body = newRequest({ type: 'invoice_exception', source: 'erp-procurement-mcp', externalRef: 'INV-9001' });
    expect((await t.as('erp-agent', 'POST', '/v1/requests', body)).statusCode).toBe(201);
    expect((await t.as('erp-agent', 'POST', '/v1/requests', body)).statusCode).toBe(200);
    expect(await events()).toHaveLength(1);
  });

  it('records the decision with its comment and the approver', async () => {
    const id = await raise();
    await t.as('bob', 'POST', `/v1/requests/${id}/decision`, { decision: 'rejected', comment: 'Over budget' });
    expect((await events())[1]).toMatchObject({
      type: 'request.rejected',
      payload: { requestId: id, decision: 'rejected', comment: 'Over budget', actor: { id: t.users.bob.sub } },
    });
  });

  it('records request.cancelled', async () => {
    const id = await raise();
    await t.as('alice', 'POST', `/v1/requests/${id}/cancel`);
    expect((await events()).map((e) => e.type)).toEqual(['request.created', 'request.cancelled']);
  });

  it('records nothing when the change is refused', async () => {
    const id = await raise();
    await t.as('bob', 'POST', `/v1/requests/${id}/decision`, { decision: 'approved' });
    const conflict = await t.as('carol', 'POST', `/v1/requests/${id}/decision`, { decision: 'rejected', comment: 'No' });
    expect(conflict.statusCode).toBe(409);
    const ownRequest = await t.as('carol', 'POST', '/v1/requests', newRequest());
    expect((await t.as('carol', 'POST', `/v1/requests/${ownRequest.json().request.id}/decision`, { decision: 'approved' })).statusCode).toBe(403);

    expect((await events()).map((e) => e.type)).toEqual(['request.created', 'request.approved', 'request.created']);
  });

  it('rolls the event back with the transaction it was written in', async () => {
    const id = await raise();
    await t.db.delete(outboxEvents);
    const fields = { requestId: id, requesterId: t.users.alice.sub, title: 'x', type: 'other', priority: 'low', source: 'manual', externalRef: null } as const;
    await expect(
      t.db.transaction(async (tx) => {
        await recordEvent(tx, 'request.cancelled', fields, t.users.alice, undefined);
        throw new Error('the state change failed');
      }),
    ).rejects.toThrow('the state change failed');
    expect(await events()).toHaveLength(0);
  });
});

describe('request ids on outbox events', () => {
  it('stores the X-Request-Id of the call that caused each event, for the worker to log and pass on', async () => {
    const created = await t.as('alice', 'POST', '/v1/requests', newRequest(), { 'x-request-id': 'agent-run-42' });
    const id = created.json().request.id;
    const decided = await t.as('bob', 'POST', `/v1/requests/${id}/decision`, { decision: 'approved' });

    const [createdEvent, approvedEvent] = await events();
    expect(createdEvent!.httpRequestId).toBe('agent-run-42');
    // Without a header the API makes one up, and the event gets that one.
    expect(approvedEvent!.httpRequestId).toBe(decided.headers['x-request-id']);
  });
});
