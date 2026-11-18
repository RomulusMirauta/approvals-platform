// Regression tests for the issues found in the code review (see FINDINGS.md).
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema.js';
import { newRequest, setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup();
});
afterAll(async () => {
  await t.close();
});

describe('only agents speak for a source system', () => {
  it('refuses a requester who sets source and externalRef', async () => {
    const body = newRequest({ type: 'invoice_exception', source: 'erp-procurement-mcp', externalRef: 'INV-9999' });
    const response = await t.as('alice', 'POST', '/v1/requests', body);
    expect(response.statusCode).toBe(403);
    // So the real agent can still file the item.
    const agent = await t.as('erp-agent', 'POST', '/v1/requests', { ...body, title: 'INV-9999: duplicate' });
    expect(agent.statusCode).toBe(201);
  });

  it('still lets a requester raise a manual request', async () => {
    expect((await t.as('alice', 'POST', '/v1/requests', newRequest())).statusCode).toBe(201);
  });
});

describe('roles come from the database, not only the token', () => {
  it('stops a demoted approver at once, with the token they already have', async () => {
    const { request } = (await t.as('alice', 'POST', '/v1/requests', newRequest({ title: 'Monitor' }))).json();
    await t.as('bob', 'GET', '/v1/me'); // signs bob in while he is still an approver
    await t.db.update(users).set({ role: 'requester' }).where(eq(users.email, 'bob@example.com'));

    const response = await t.as('bob', 'POST', `/v1/requests/${request.id}/decision`, { decision: 'approved' });
    expect(response.statusCode).toBe(403);
    await t.db.update(users).set({ role: 'approver' }).where(eq(users.email, 'bob@example.com'));
  });
});

describe('input edge cases', () => {
  it('stores amounts above the 32-bit integer range', async () => {
    const body = newRequest({ amount: { amountMinor: 3_000_000_000, currency: 'RON' } });
    const response = await t.as('alice', 'POST', '/v1/requests', body);
    expect(response.statusCode).toBe(201);
    expect(response.json().request.amount.amountMinor).toBe(3_000_000_000);
  });

  it('rejects metadata over 10 KB', async () => {
    const body = newRequest({ metadata: { blob: 'x'.repeat(11_000) } });
    const response = await t.as('alice', 'POST', '/v1/requests', body);
    expect(response.statusCode).toBe(400);
    expect(response.json().errors[0].path).toBe('metadata');
  });

  it('accepts a bodyless POST that still sends Content-Type: application/json', async () => {
    const { request } = (await t.as('alice', 'POST', '/v1/requests', newRequest({ title: 'Chair' }))).json();
    const token = (
      await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'alice@example.com', password: 'demo-password' } })
    ).json().token;
    const response = await t.app.inject({
      method: 'POST',
      url: `/v1/requests/${request.id}/cancel`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('cancelled');
  });
});

describe('timestamps', () => {
  it('never records a decision before the request was created', async () => {
    const { request } = (await t.as('alice', 'POST', '/v1/requests', newRequest({ title: 'Desk' }))).json();
    const decided = (await t.as('bob', 'POST', `/v1/requests/${request.id}/decision`, { decision: 'approved' })).json();
    expect(Date.parse(decided.decidedAt)).toBeGreaterThanOrEqual(Date.parse(decided.createdAt));
  });
});
