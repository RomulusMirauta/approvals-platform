// The notification service as a long-running process: drains the outbox in a loop until it is told to stop.
// Run: DATABASE_URL=postgres://... npm run worker -w @approvals/notifications
// With --once (npm run drain) it empties the outbox and exits, for a scheduler such as the GitHub Actions job.
import { setTimeout as sleep } from 'node:timers/promises';
import * as Sentry from '@sentry/node';
import { openDatabase } from '@approvals/api/db/client';
import { initSentry } from '@approvals/api/sentry';
import { drainOnce } from './drain.js';
import { logger } from './logger.js';

const BATCH_SIZE = 20;
// Long enough to send the events of a failed run, short enough not to hold a stopping process.
const SENTRY_CLOSE_TIMEOUT_MS = 2_000;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 2_000);
const once = process.argv.includes('--once');

// Same settings as the API (off without SENTRY_DSN); one Sentry project for both, told apart by the service tag.
initSentry(process.env, { initialScope: { tags: { service: 'notifications' } } });

// PGlite runs inside one process, so the worker can't share the API's local database: it needs a real Postgres.
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set to the Postgres database the API uses');
// The API owns the schema and applies the migrations; the worker only reads and writes rows.
const database = await openDatabase(url, { migrate: false });

// On SIGINT/SIGTERM the current batch finishes (its transaction commits) before the process exits.
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info(`${signal} received, stopping after the current batch`);
    stop.abort();
  });
}

logger.info('Notification worker started');
while (!stop.signal.aborted) {
  try {
    const result = await drainOnce(database.db, { batchSize: BATCH_SIZE });
    if (result.claimed > 0) logger.info(result, 'Batch drained');
    // A full batch means more may be waiting: go again without sleeping.
    if (result.claimed === BATCH_SIZE) continue;
    if (once) break;
  } catch (error) {
    // A database blip shouldn't kill the worker; the next poll tries again. A one-off run reports it instead.
    logger.error({ err: error }, 'Draining the outbox failed');
    Sentry.captureException(error);
    if (once) {
      process.exitCode = 1;
      break;
    }
  }
  await sleep(POLL_INTERVAL_MS, undefined, { signal: stop.signal }).catch(() => undefined);
}

await database.close();
// Sends whatever is still queued (a dead-lettered event, a failed drain) before the process exits.
await Sentry.close(SENTRY_CLOSE_TIMEOUT_MS);
