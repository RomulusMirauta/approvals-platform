import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup();
});
afterAll(() => t.close());

const login = (payload: object) => t.app.inject({ method: 'POST', url: '/v1/auth/login', payload });

describe('auth', () => {
  it('logs in with the demo password and returns a token and the user', async () => {
    const response = await login({ email: 'bob@example.com', password: 'demo-password' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.expiresIn).toBe(8 * 60 * 60);
    expect(body.user).toMatchObject({ email: 'bob@example.com', role: 'approver' });
    expect(body.user.passwordHash).toBeUndefined();

    const me = await t.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${body.token}` } });
    expect(me.json()).toEqual(body.user);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrongPassword = await login({ email: 'bob@example.com', password: 'nope' });
    const unknownEmail = await login({ email: 'nobody@example.com', password: 'nope' });
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongPassword.headers['content-type']).toContain('application/problem+json');
    // Identical apart from the request id, which every response has its own of.
    expect(unknownEmail.json()).toEqual({ ...wrongPassword.json(), requestId: expect.any(String) });
  });

  it('rejects an invalid body with a 400 problem listing the fields', async () => {
    const response = await login({ email: 'not-an-email' });
    expect(response.statusCode).toBe(400);
    const problem = response.json();
    expect(problem).toMatchObject({ type: 'about:blank', title: 'Bad Request', status: 400 });
    expect(problem.errors.map((e: any) => e.path).sort()).toEqual(['email', 'password']);
  });

  it('answers 401 without a token or with a bad one', async () => {
    const missing = await t.app.inject({ method: 'GET', url: '/v1/requests' });
    const forged = await t.app.inject({ method: 'GET', url: '/v1/requests', headers: { authorization: 'Bearer abc.def.ghi' } });
    expect(missing.statusCode).toBe(401);
    expect(forged.statusCode).toBe(401);
    expect(missing.json()).toMatchObject({ status: 401, title: 'Unauthorized' });
  });

  it('answers unknown routes with a 404 problem', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('serves the health check without auth', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/health' });
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('login rate limit', () => {
  it('allows 10 login attempts a minute, then answers 429', async () => {
    const limited = await setup({ rateLimit: true });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) {
        // Invalid bodies are cheap (no bcrypt) and still count against the limit.
        const response = await limited.app.inject({ method: 'POST', url: '/v1/auth/login', payload: {} });
        codes.push(response.statusCode);
      }
      expect(codes.slice(0, 10).every((code) => code === 400)).toBe(true);
      expect(codes[10]).toBe(429);
    } finally {
      await limited.close();
    }
  });

  // TRUST_PROXY names the proxy (as compose.yaml does). With "true", a client reaching the API directly picked its
  // own IP with X-Forwarded-For, a new one per attempt, and was never limited.
  describe('behind a trusted proxy', () => {
    const proxy = '172.18.0.5';
    const attempt = (app: Awaited<ReturnType<typeof setup>>['app'], remoteAddress: string, forwardedFor: string) =>
      app.inject({ method: 'POST', url: '/v1/auth/login', payload: {}, remoteAddress, headers: { 'x-forwarded-for': forwardedFor } });

    it('ignores X-Forwarded-For from anyone else, so a direct client cannot escape the limit', async () => {
      const limited = await setup({ rateLimit: true, trustProxy: proxy });
      try {
        const codes: number[] = [];
        for (let i = 0; i < 11; i++) codes.push((await attempt(limited.app, '203.0.113.7', `10.0.0.${i}`)).statusCode);
        expect(codes[10]).toBe(429);
      } finally {
        await limited.close();
      }
    });

    it('limits each client the proxy forwards on its own', async () => {
      const limited = await setup({ rateLimit: true, trustProxy: proxy });
      try {
        for (let i = 0; i < 10; i++) await attempt(limited.app, proxy, '198.51.100.1');
        expect((await attempt(limited.app, proxy, '198.51.100.1')).statusCode).toBe(429);
        expect((await attempt(limited.app, proxy, '198.51.100.2')).statusCode).toBe(400);
      } finally {
        await limited.close();
      }
    });
  });
});
