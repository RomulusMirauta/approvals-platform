// Transient database failures: classified as 503 with Retry-After, retried once only where that is safe,
// and reported by the readiness check.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDatabase, type Db } from '../src/db/client.js';
import { retryOnce } from '../src/db/retry.js';
import { isSerializationFailure, isTransientDbError } from '../src/errors.js';

// Shaped like the errors the app really sees: node-postgres sets the SQLSTATE (or Node's socket error) on
// `code`, and Drizzle wraps it as the cause of its own "Failed query" error.
const pgError = (code: string, message = 'database error') => Object.assign(new Error(message), { code });
const wrapped = (cause: Error) => Object.assign(new Error('Failed query: select 1'), { cause });

describe('isTransientDbError', () => {
  it.each([
    ['admin shutdown', pgError('57P01')],
    ['database starting up', pgError('57P03')],
    ['too many connections', pgError('53300')],
    ['connection failure', pgError('08006')],
    ['serialization failure', pgError('40001')],
    ['deadlock', pgError('40P01')],
    ['connection refused', pgError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432')],
    ['connect timeout', new Error('timeout exceeded when trying to connect')],
    ['dropped connection', new Error('Connection terminated unexpectedly')],
    ['query timeout', new Error('Query read timeout')],
  ])('treats %s as transient, also when Drizzle wraps it', (_, error) => {
    expect(isTransientDbError(error)).toBe(true);
    expect(isTransientDbError(wrapped(error))).toBe(true);
  });

  it.each([
    ['unique violation', pgError('23505')],
    ['check violation', pgError('23514')],
    ['syntax error', pgError('42601')],
    ['a bug', new TypeError("Cannot read properties of undefined (reading 'id')")],
  ])('does not treat %s as transient', (_, error) => {
    expect(isTransientDbError(wrapped(error))).toBe(false);
  });
});

describe('error responses', () => {
  // The routes under test throw before touching the database, so no database is needed.
  async function appThrowing(error: Error) {
    const app = await buildApp({ db: {} as Db, jwtSecret: 'test-secret', rateLimit: false });
    app.get('/boom', async () => {
      throw error;
    });
    return app;
  }

  it('answers a transient database failure with 503 problem+json and Retry-After', async () => {
    const app = await appThrowing(wrapped(pgError('57P01', 'terminating connection due to administrator command')));
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.headers['retry-after']).toBe('2');
    // No internals in the body: the SQL and the driver's message stay in the log.
    expect(response.json()).toEqual({
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
      detail: 'The service is temporarily unavailable; try again in a moment',
      requestId: expect.any(String),
    });
    await app.close();
  });

  it('still answers a unique violation with 409 and a bug with 500, without Retry-After', async () => {
    for (const [error, status] of [
      [wrapped(pgError('23505')), 409],
      [new Error('bug'), 500],
    ] as const) {
      const app = await appThrowing(error);
      const response = await app.inject({ method: 'GET', url: '/boom' });
      expect(response.statusCode).toBe(status);
      expect(response.headers['retry-after']).toBeUndefined();
      await app.close();
    }
  });
});

describe('retryOnce', () => {
  it('retries a serialization failure once and returns the second result', async () => {
    const operation = vi.fn().mockRejectedValueOnce(wrapped(pgError('40001'))).mockResolvedValueOnce('committed');
    await expect(retryOnce(operation, isSerializationFailure, 0)).resolves.toBe('committed');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('gives up after the one retry', async () => {
    const deadlock = wrapped(pgError('40P01'));
    const operation = vi.fn().mockRejectedValue(deadlock);
    await expect(retryOnce(operation, isSerializationFailure, 0)).rejects.toBe(deadlock);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry a unique violation: running it again would fail the same way', async () => {
    const duplicate = wrapped(pgError('23505'));
    const operation = vi.fn().mockRejectedValue(duplicate);
    await expect(retryOnce(operation, isSerializationFailure, 0)).rejects.toBe(duplicate);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('GET /ready', () => {
  const opened: Awaited<ReturnType<typeof buildApp>>[] = [];
  afterAll(async () => {
    await Promise.all(opened.map((app) => app.close()));
  });

  it('is 200 while the database answers and 503 once it is gone, while /health stays 200', async () => {
    const database = await openDatabase();
    const app = await buildApp({ db: database.db, jwtSecret: 'test-secret', rateLimit: false });
    opened.push(app);

    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready' });

    // A closed database stands in for an unreachable one: every query now fails.
    await database.close();
    const notReady = await app.inject({ method: 'GET', url: '/ready' });
    expect(notReady.statusCode).toBe(503);
    expect(notReady.headers['retry-after']).toBe('2');
    expect(notReady.json().detail).toBe('The database is not reachable');

    // Liveness doesn't depend on the database: the process itself is fine.
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});
