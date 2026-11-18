// Test setup: a fresh in-memory Postgres per test file, migrated and seeded, and the app driven with inject().
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/client.js';
import { DEMO_PASSWORD, seed } from '../src/db/seed.js';

export async function setup({ rateLimit = false } = {}) {
  const database = await openDatabase();
  const users = await seed(database.db);
  const app = await buildApp({ db: database.db, jwtSecret: 'test-secret', rateLimit });

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
  async function as(user: 'alice' | 'bob' | 'carol' | 'erp-agent', method: 'GET' | 'POST', url: string, payload?: object) {
    const token = await login(`${user}@example.com`);
    return app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
  }

  async function close() {
    await app.close();
    await database.close();
  }

  return { app, db: database.db, users, as, close };
}

export const newRequest = (overrides: object = {}) => ({ title: 'New laptop', type: 'purchase', ...overrides });
