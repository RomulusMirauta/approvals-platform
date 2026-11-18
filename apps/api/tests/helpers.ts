// Test setup: a fresh, migrated and seeded Postgres per test file, and the app driven with inject().
// By default that is an in-memory PGlite. With TEST_DATABASE_URL set (the api-postgres CI job) it is a real Postgres
// server, so the concurrency tests race over separate connections instead of PGlite's one-at-a-time transactions.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp, type AppOptions } from '../src/app.js';
import { openDatabase } from '../src/db/client.js';
import { DEMO_PASSWORD, seed } from '../src/db/seed.js';

// Each test file gets its own throwaway database on the shared server. Vitest runs files in parallel, and a
// database (unlike a schema) isolates everything, enums and migration bookkeeping included, with no search_path tricks.
async function createTestDatabase(serverUrl: string) {
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;

  async function drop() {
    const admin = new pg.Client({ connectionString: serverUrl });
    await admin.connect();
    try {
      // FORCE ends connections a failed test may have left open, so the drop can't hang or fail.
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
  return { url: url.toString(), drop };
}

async function openTestDatabase() {
  const serverUrl = process.env.TEST_DATABASE_URL;
  if (!serverUrl) return openDatabase();
  const testDb = await createTestDatabase(serverUrl);
  try {
    const database = await openDatabase(testDb.url);
    return {
      db: database.db,
      close: async () => {
        try {
          await database.close();
        } finally {
          await testDb.drop();
        }
      },
    };
  } catch (error) {
    await testDb.drop();
    throw error;
  }
}

// logger: e.g. loggerOptions(stream), for tests that read the log lines.
export async function setup({
  rateLimit = false,
  logger,
  trustProxy,
}: { rateLimit?: boolean; logger?: AppOptions['logger']; trustProxy?: AppOptions['trustProxy'] } = {}) {
  const database = await openTestDatabase();
  const users = await seed(database.db);
  const app = await buildApp({ db: database.db, jwtSecret: 'test-secret', rateLimit, logger, trustProxy });

  const tokens = new Map<string, string>();
  async function login(email: string) {
    const cached = tokens.get(email);
    if (cached) return cached;
    const response = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: DEMO_PASSWORD } });
    const token: string = response.json().token;
    tokens.set(email, token);
    return token;
  }

  // Sends a request as one of the demo users, e.g. as('bob', 'GET', '/v1/requests').
  async function as(
    user: 'alice' | 'bob' | 'carol' | 'erp-agent',
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) {
    const token = await login(`${user}@example.com`);
    return app.inject({ method, url, payload, headers: { ...headers, authorization: `Bearer ${token}` } });
  }

  async function close() {
    try {
      await app.close();
    } finally {
      await database.close();
    }
  }

  return { app, db: database.db, users, as, close };
}

export const newRequest = (overrides: object = {}) => ({ title: 'New laptop', type: 'purchase', ...overrides });
