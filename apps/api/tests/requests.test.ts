import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newRequest, setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup();
});
afterAll(() => t.close());

describe('listing requests', () => {
  it('shows approvers everything and requesters only their own, newest first', async () => {
    const all = (await t.as('bob', 'GET', '/v1/requests?pageSize=100')).json();
    const own = (await t.as('alice', 'GET', '/v1/requests?pageSize=100')).json();
    expect(all.total).toBe(12);
    expect(own.total).toBe(6);
    expect(own.items.every((r: any) => r.requester.id === t.users.alice.sub)).toBe(true);
    const times = all.items.map((r: any) => r.createdAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it('paginates with the total of all matches', async () => {
    const page = (await t.as('bob', 'GET', '/v1/requests?page=3&pageSize=5')).json();
    expect(page).toMatchObject({ page: 3, pageSize: 5, total: 12 });
    expect(page.items).toHaveLength(2);
  });

  it('filters by status, by tag (through request_tags) and by text', async () => {
    const pending = (await t.as('bob', 'GET', '/v1/requests?status=pending')).json();
    expect(pending.total).toBe(7);

    const priceVariance = (await t.as('bob', 'GET', '/v1/requests?tag=price-variance')).json();
    expect(priceVariance.items.map((r: any) => r.externalRef).sort()).toEqual(['INV-1003', 'INV-1008']);
    expect(priceVariance.items[0].tags).toContain('finance');

    const byRef = (await t.as('bob', 'GET', '/v1/requests?q=inv-1005')).json();
    expect(byRef.items).toHaveLength(1);
  });

  it('rejects an unknown filter value with 400', async () => {
    const response = await t.as('bob', 'GET', '/v1/requests?status=lost');
    expect(response.statusCode).toBe(400);
    expect(response.json().errors[0].path).toBe('status');
  });
});

describe('creating requests', () => {
  const invoice = {
    title: 'INV-2001: price above PO',
    type: 'invoice_exception',
    source: 'erp-procurement-mcp',
    externalRef: 'INV-2001',
    tags: ['finance', 'new-tag', 'finance'],
  };

  it('creates with 201, then returns the same pending request with 200 on a retry', async () => {
    const first = await t.as('erp-agent', 'POST', '/v1/requests', invoice);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ created: true, request: { status: 'pending', tags: ['finance', 'new-tag'] } });

    const retry = await t.as('erp-agent', 'POST', '/v1/requests', invoice);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().created).toBe(false);
    expect(retry.json().request.id).toBe(first.json().request.id);
  });

  it('stays idempotent when the same item arrives twice at once', async () => {
    const body = { ...invoice, externalRef: 'INV-2002' };
    const [a, b] = await Promise.all([
      t.as('erp-agent', 'POST', '/v1/requests', body),
      t.as('erp-agent', 'POST', '/v1/requests', body),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(a.json().request.id).toBe(b.json().request.id);
  });

  it('allows the same item again once the first request is decided', async () => {
    const body = { ...invoice, externalRef: 'INV-2003' };
    const first = (await t.as('erp-agent', 'POST', '/v1/requests', body)).json();
    await t.as('bob', 'POST', `/v1/requests/${first.request.id}/decision`, { decision: 'approved' });
    const again = await t.as('erp-agent', 'POST', '/v1/requests', body);
    expect(again.statusCode).toBe(201);
    expect(again.json().request.id).not.toBe(first.request.id);
  });

  it('does not let approvers raise requests', async () => {
    const response = await t.as('bob', 'POST', '/v1/requests', newRequest());
    expect(response.statusCode).toBe(403);
  });

  it('validates the body', async () => {
    const body = newRequest({ title: 'x', amount: { amountMinor: 100, currency: 'ron' } });
    const response = await t.as('alice', 'POST', '/v1/requests', body);
    expect(response.statusCode).toBe(400);
    expect(response.json().errors.map((e: any) => e.path).sort()).toEqual(['amount.currency', 'title']);
  });
});

describe('reading and commenting', () => {
  it('returns the detail with decisions, comments and user names', async () => {
    const list = (await t.as('bob', 'GET', '/v1/requests?q=INV-1005')).json();
    const detail = (await t.as('bob', 'GET', `/v1/requests/${list.items[0].id}`)).json();
    expect(detail.metadata).toMatchObject({ supplier: 'Transilvania Logistics SRL' });
    expect(detail.decisions).toEqual([
      expect.objectContaining({ decision: 'rejected', approver: { id: t.users.carol.sub, name: 'Carol Dumitru' } }),
    ]);
  });

  it("answers 404 when a requester asks for someone else's request", async () => {
    const agentRequest = (await t.as('erp-agent', 'GET', '/v1/requests')).json().items[0];
    expect((await t.as('alice', 'GET', `/v1/requests/${agentRequest.id}`)).statusCode).toBe(404);
    const comment = await t.as('alice', 'POST', `/v1/requests/${agentRequest.id}/comments`, { body: 'hi' });
    expect(comment.statusCode).toBe(404);
  });

  it('adds a comment that shows up on the request', async () => {
    const own = (await t.as('alice', 'GET', '/v1/requests')).json().items[0];
    const response = await t.as('alice', 'POST', `/v1/requests/${own.id}/comments`, { body: '  Any update?  ' });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ body: 'Any update?', author: { name: 'Alice Popescu' } });
    const detail = (await t.as('bob', 'GET', `/v1/requests/${own.id}`)).json();
    expect(detail.comments.at(-1).body).toBe('Any update?');
  });

  it('answers 400 for an id that is not a uuid', async () => {
    expect((await t.as('bob', 'GET', '/v1/requests/123')).statusCode).toBe(400);
  });
});
