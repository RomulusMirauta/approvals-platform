// Sentry: off without a DSN; with one, only the errors the API answers with 500 are reported, tagged with the
// request id and the user id (never the email). Events are recorded by beforeSend and dropped, so nothing is sent.
import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db/client.js';
import { initSentry, sentryOptions } from '../src/sentry.js';

const CRON_SECRET = 'c'.repeat(32);
const env = {
  SENTRY_DSN: 'https://public@sentry.example.invalid/1',
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_SHA: 'abc123',
};

const events: ErrorEvent[] = [];
const record = {
  beforeSend: (event: ErrorEvent) => {
    events.push(event);
    return null;
  },
  beforeSendTransaction: () => null,
};

// The routes under test throw before touching the database, so no database is needed.
async function app() {
  const instance = await buildApp({ db: {} as Db, jwtSecret: 'test-secret', rateLimit: false, cronSecret: CRON_SECRET });
  instance.get('/bug', async (request) => {
    // As authenticate would have left it for a signed-in user.
    Object.assign(request, { user: { sub: 'user-1', role: 'approver', name: 'Bob Ionescu' } });
    throw new TypeError("Cannot read properties of undefined (reading 'id')");
  });
  instance.get('/unique-violation', async () => {
    throw Object.assign(new Error('Failed query'), { cause: Object.assign(new Error('duplicate key'), { code: '23505' }) });
  });
  instance.get('/database-waking-up', async () => {
    throw Object.assign(new Error('Failed query'), { cause: Object.assign(new Error('starting up'), { code: '57P03' }) });
  });
  return instance;
}

afterAll(() => Sentry.close());
beforeEach(() => {
  events.length = 0;
});

describe('Sentry', () => {
  it('stays off without SENTRY_DSN, and the API answers as usual', async () => {
    expect(initSentry({}, record)).toBe(false);
    expect(Sentry.isInitialized()).toBe(false);
    const api = await app();
    expect((await api.inject({ method: 'GET', url: '/bug' })).statusCode).toBe(500);
    expect(events).toHaveLength(0);
    await api.close();
  });

  it('takes the environment and release from Vercel, and samples every preview trace but a tenth in production', () => {
    expect(sentryOptions(env)).toMatchObject({ environment: 'preview', release: 'abc123', tracesSampleRate: 1 });
    expect(sentryOptions({ ...env, VERCEL_ENV: 'production' }).tracesSampleRate).toBe(0.1);
    expect(sentryOptions({ SENTRY_DSN: env.SENTRY_DSN, NODE_ENV: 'development' }).environment).toBe('development');
  });

  it('starts with a DSN and collects nothing personal by itself', () => {
    expect(initSentry(env, record)).toBe(true);
    expect(Sentry.isInitialized()).toBe(true);
    expect(Sentry.getClient()!.getOptions().dataCollection).toMatchObject({ userInfo: false, cookies: false, httpHeaders: false, httpBodies: [] });
  });

  it('reports a 500 with the request id and the user id, but no email', async () => {
    const api = await app();
    const response = await api.inject({ method: 'GET', url: '/bug', headers: { 'x-request-id': 'trace-500' } });
    expect(response.statusCode).toBe(500);
    expect(events).toHaveLength(1);
    expect(events[0]!.exception?.values?.[0]).toMatchObject({ type: 'TypeError' });
    expect(events[0]!.tags).toMatchObject({ requestId: 'trace-500' });
    expect(events[0]!.user).toEqual({ id: 'user-1' });
    await api.close();
  });

  it('reports the deliberate error from GET /internal/sentry-check, which needs the cron secret', async () => {
    const api = await app();
    expect((await api.inject({ method: 'GET', url: '/internal/sentry-check' })).statusCode).toBe(401);
    expect(events).toHaveLength(0);

    const response = await api.inject({ method: 'GET', url: '/internal/sentry-check', headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(response.statusCode).toBe(500);
    expect(events).toHaveLength(1);
    expect(events[0]!.exception?.values?.[0]?.value).toMatch(/Sentry check/);
    expect(events[0]!.tags).toMatchObject({ requestId: response.headers['x-request-id'] });
    await api.close();
  });

  it('does not report 4xx, or a 503 for a database that is briefly away', async () => {
    const api = await app();
    expect((await api.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    expect((await api.inject({ method: 'GET', url: '/nothing-here' })).statusCode).toBe(404);
    expect((await api.inject({ method: 'GET', url: '/unique-violation' })).statusCode).toBe(409);
    expect((await api.inject({ method: 'GET', url: '/database-waking-up' })).statusCode).toBe(503);
    expect(events).toHaveLength(0);
    await api.close();
  });
});
