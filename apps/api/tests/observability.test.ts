// Request ids and logs: every response and problem body names its request, and the log line for it does too,
// without secrets or email addresses.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loggerOptions } from '../src/logging.js';
import { setup } from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Every JSON line the app logs, parsed.
let lines: Record<string, unknown>[] = [];
let output = '';
const stream = {
  write(line: string) {
    output += line;
    lines.push(JSON.parse(line));
  },
};

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup({ logger: loggerOptions(stream) });
  t.app.get('/log-headers', async (request) => {
    // What a careless debugging line would do.
    request.log.info({ headers: request.headers, password: 'hunter2' }, 'headers');
    return {};
  });
});
afterAll(() => t.close());
beforeEach(() => {
  lines = [];
  output = '';
});

describe('request ids', () => {
  it('generates one when the caller sends none and returns it in X-Request-Id', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-request-id']).toMatch(UUID);
  });

  it("keeps a caller's sane id, so its logs and ours line up", async () => {
    for (const id of ['3f1c2a9e-7d4b-4e7a-9a51-0c2f7b9d1e3a', '01JD0Z8M4QK8V6R2X3Y5T7W9AB', 'fra1::iad1::abc-123', 'trace_1.2']) {
      const response = await t.app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': id } });
      expect(response.headers['x-request-id']).toBe(id);
    }
  });

  it('replaces an id that is too long or could forge log lines', async () => {
    for (const id of ['a'.repeat(129), 'abc def', 'abc"def', '<script>', '']) {
      const response = await t.app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': id } });
      expect(response.headers['x-request-id']).toMatch(UUID);
    }
  });

  it('puts the same id in every problem body as in the header', async () => {
    const responses = [
      await t.app.inject({ method: 'GET', url: '/v1/me' }), // 401 from a hook
      await t.app.inject({ method: 'GET', url: '/v1/nothing-here' }), // 404 from the not-found handler
      await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'not-an-email' } }), // 400 validation
      await t.app.inject({ method: 'GET', url: '/v1/me', headers: { 'x-request-id': 'support-ticket-7' } }),
    ];
    for (const response of responses) {
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json().requestId).toBe(response.headers['x-request-id']);
    }
    expect(responses[3]!.json().requestId).toBe('support-ticket-7');
  });

  it('exposes X-Request-Id to the dashboard on another origin', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://localhost:5173' } });
    expect(response.headers['access-control-expose-headers']).toContain('X-Request-Id');
  });
});

describe('logs', () => {
  it('writes one line per request with the route, status, duration, request id and user id, but no email', async () => {
    const response = await t.as('bob', 'GET', '/v1/me', undefined, { 'x-vercel-id': 'fra1::abcde-1' });
    const requestLines = lines.filter((line) => line.requestId === response.headers['x-request-id']);
    expect(requestLines).toEqual([
      expect.objectContaining({
        level: 30,
        msg: 'request completed',
        method: 'GET',
        route: '/v1/me',
        status: 200,
        durationMs: expect.any(Number),
        userId: t.users.bob.sub,
        vercelId: 'fra1::abcde-1',
      }),
    ]);
    expect(output).not.toContain('bob@example.com');
  });

  it('logs at the level LOG_LEVEL sets, info by default', () => {
    const before = process.env.LOG_LEVEL;
    try {
      delete process.env.LOG_LEVEL;
      expect(loggerOptions().level).toBe('info');
      process.env.LOG_LEVEL = 'warn';
      expect(loggerOptions().level).toBe('warn');
    } finally {
      if (before === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = before;
    }
  });

  it('redacts authorization headers, cookies and passwords even when code logs them', async () => {
    await t.app.inject({
      method: 'GET',
      url: '/log-headers',
      headers: { authorization: 'Bearer secret-token-value', cookie: 'session=secret-cookie-value' },
    });
    const line = lines.find((l) => l.msg === 'headers') as { headers: Record<string, string>; password: string };
    expect(line.headers.authorization).toBe('[redacted]');
    expect(line.headers.cookie).toBe('[redacted]');
    expect(line.password).toBe('[redacted]');
    expect(output).not.toMatch(/secret-token-value|secret-cookie-value|hunter2/);
  });
});
