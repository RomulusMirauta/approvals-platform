// Entry point for serverless platforms (Vercel). Each function instance builds the app once, on its first
// request, and reuses it for the requests that follow. Migrations and demo data run in the deploy pipeline,
// not here, so a cold start only opens a connection pool.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '../app.js';
import { cronSecret, jwtSecret } from '../config.js';
import { openDatabase } from '../db/client.js';

let app: ReturnType<typeof start> | undefined;

async function start() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set');
  const database = await openDatabase(url, { migrate: false });
  // Behind Vercel's proxy, the client IP comes from X-Forwarded-For; the dashboard is on the same origin.
  const instance = await buildApp({ db: database.db, jwtSecret: jwtSecret(), logger: true, trustProxy: true, cronSecret: cronSecret() });
  await instance.ready();
  return instance;
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  app ??= start();
  const instance = await app;
  instance.server.emit('request', request, response);
}
