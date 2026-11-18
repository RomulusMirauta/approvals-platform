import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requests } from '../src/db/schema.js';
import { setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup();
});
afterAll(() => t.close());

describe('tags and stats', () => {
  it('lists tags with how many requests use each', async () => {
    const tags = (await t.as('bob', 'GET', '/v1/tags')).json();
    expect(tags.find((tag: any) => tag.name === 'finance').requestCount).toBe(6);
    expect(tags.find((tag: any) => tag.name === 'duplicate-invoice').requestCount).toBe(1);
  });

  it('counts only the requests the caller can see', async () => {
    // The finance requests were all raised by the agent, so a requester sees the tag with nothing behind it.
    const tags = (await t.as('alice', 'GET', '/v1/tags')).json();
    expect(tags.find((tag: any) => tag.name === 'finance').requestCount).toBe(0);
  });

  it('counts requests for every status and type, zeros included', async () => {
    const stats = (await t.as('bob', 'GET', '/v1/stats')).json();
    expect(stats).toEqual({
      byStatus: { pending: 7, approved: 2, rejected: 2, cancelled: 1 },
      pendingByType: { invoice_exception: 4, purchase: 1, access: 1, other: 1 },
      pendingHighPriority: 1,
    });
    const agentStats = (await t.as('erp-agent', 'GET', '/v1/stats')).json();
    expect(agentStats.pendingByType).toEqual({ invoice_exception: 4, purchase: 0, access: 0, other: 0 });
  });
});

describe('OpenAPI', () => {
  it('documents the versioned routes and the bearer scheme', async () => {
    const doc = (await t.app.inject({ method: 'GET', url: '/docs/json' })).json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.paths['/v1/requests']).toBeDefined();
    expect(doc.paths['/v1/requests/{id}/decision'].post).toBeDefined();
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
  });
});

describe('database constraints', () => {
  const base = { title: 'Direct insert', type: 'purchase' as const };

  it('rejects an amount without a currency', async () => {
    const insert = t.db.insert(requests).values({ ...base, requesterId: t.users.alice.sub, amountMinor: 100 });
    await expect(insert).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('rejects a second pending request for the same source item', async () => {
    const row = { ...base, requesterId: t.users.alice.sub, source: 'erp', externalRef: 'X-1' };
    await t.db.insert(requests).values(row);
    await expect(t.db.insert(requests).values(row)).rejects.toMatchObject({ cause: { code: '23505' } });
  });
});
