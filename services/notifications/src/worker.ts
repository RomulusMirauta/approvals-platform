// The notification service as a long-running process: drains the outbox in a loop until it is told to stop.
// Run: DATABASE_URL=postgres://... npm run worker -w @approvals/notifications
// With --once (npm run drain) it empties the outbox and exits, for a scheduler such as the GitHub Actions job.
import { setTimeout as sleep } from 'node:timers/promises';
import { openDatabase } from '@approvals/api/db/client';
import { drainOnce } from './drain.js';

const BATCH_SIZE = 20;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 2_000);
const once = process.argv.includes('--once');

// PGlite runs inside one process, so the worker can't share the API's local database: it needs a real Postgres.
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set to the Postgres database the API uses');
// The API owns the schema and applies the migrations; the worker only reads and writes rows.
const database = await openDatabase(url, { migrate: false });

// On SIGINT/SIGTERM the current batch finishes (its transaction commits) before the process exits.
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, stopping after the current batch`);
    stop.abort();
  });
}

console.log('Notification worker started');
while (!stop.signal.aborted) {
  try {
    const result = await drainOnce(database.db, { batchSize: BATCH_SIZE });
    if (result.claimed > 0) console.log(`Delivered ${result.delivered}, failed ${result.failed}`);
    // A full batch means more may be waiting: go again without sleeping.
    if (result.claimed === BATCH_SIZE) continue;
    if (once) break;
  } catch (error) {
    // A database blip shouldn't kill the worker; the next poll tries again. A one-off run reports it instead.
    console.error('Draining the outbox failed', error);
    if (once) {
      process.exitCode = 1;
      break;
    }
  }
  await sleep(POLL_INTERVAL_MS, undefined, { signal: stop.signal }).catch(() => undefined);
}

await database.close();
