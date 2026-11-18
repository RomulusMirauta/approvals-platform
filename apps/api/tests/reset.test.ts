// The nightly demo reset: only the cron secret can trigger it, and it brings back exactly the seeded data.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DEMO_PASSWORD } from '../src/db/seed.js';
import { newRequest, setup } from './helpers.js';

const CRON_SECRET = 'c'.repeat(32);

let t: Awaited<ReturnType<typeof setup>>;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  t = await setup();
  app = await buildApp({ db: t.db, jwtSecret: 'test-secret', rateLimit: false, cronSecret: CRON_SECRET });
});
afterAll(async () => {
  await app.close();
  await t.close();
});

const reset = (authorization?: string) =>
  app.inject({ method: 'GET', url: '/internal/reset-demo', headers: authorization ? { authorization } : {} });

describe('GET /internal/reset-demo', () => {
  it('restores the seeded data after visitors change it', async () => {
    const seeded = (await t.as('bob', 'GET', '/v1/requests?status=pending')).json().total;
    const { request } = (await t.as('alice', 'POST', '/v1/requests', newRequest())).json();
    await t.as('bob', 'POST', `/v1/requests/${request.id}/decision`, { decision: 'approved' });
    const pending = (await t.as('bob', 'GET', '/v1/requests?status=pending')).json().items;
    await t.as('bob', 'POST', `/v1/requests/${pending[0].id}/decision`, { decision: 'approved' });

    const response = await reset(`Bearer ${CRON_SECRET}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reset: true, users: 4, requests: 12 });
    // The users were recreated with new ids, so the cached tokens point at nobody: sign in again.
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'bob@example.com', password: DEMO_PASSWORD } });
    const headers = { authorization: `Bearer ${login.json().token}` };
    const after = await app.inject({ method: 'GET', url: '/v1/requests?status=pending', headers });
    expect(after.json().total).toBe(seeded);
  });

  it('answers 401 without the secret or with a wrong one', async () => {
    for (const authorization of [undefined, 'Bearer wrong', `Bearer ${'x'.repeat(32)}`, CRON_SECRET]) {
      const response = await reset(authorization);
      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain('application/problem+json');
    }
  });

  it('does not exist without a cron secret', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/internal/reset-demo' })).statusCode).toBe(404);
  });
});
