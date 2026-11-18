// Starts the real API for the end-to-end suite on a fresh, seeded, in-memory Postgres (PGlite).
// Every run starts from the same demo data and leaves nothing on disk.
//
// It builds the app the way src/index.ts does, with two differences for tests: the database lives in
// memory, and rate limiting is off, because the suite signs in far more than 10 times a minute.
import { buildApp } from '../../apps/api/src/app.js';
import { openDatabase } from '../../apps/api/src/db/client.js';
import { seed } from '../../apps/api/src/db/seed.js';
import { API_PORT } from '../support/env.ts';

const database = await openDatabase();
await seed(database.db);

const app = await buildApp({
  db: database.db,
  jwtSecret: process.env.JWT_SECRET ?? 'e2e-only-secret-not-for-production',
  logger: { level: process.env.E2E_API_LOG_LEVEL ?? 'warn' },
  rateLimit: false,
});

async function shutdown() {
  await app.close();
  await database.close();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await app.listen({ port: API_PORT, host: '127.0.0.1' });
console.log(`E2E API listening on http://127.0.0.1:${API_PORT}`);
