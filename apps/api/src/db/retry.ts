// One retry, only where repeating the work is known to be safe. Callers choose which errors qualify.
import { setTimeout as sleep } from 'node:timers/promises';
import { isSerializationFailure } from '../errors.js';
import type { Db } from './client.js';

// Short enough to stay well inside a request's time budget. The random part keeps two requests that failed
// together (two sides of a deadlock) from retrying at the same instant and colliding again.
const BASE_DELAY_MS = 50;

export async function retryOnce<T>(operation: () => Promise<T>, shouldRetry: (error: unknown) => boolean, delayMs = BASE_DELAY_MS): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!shouldRetry(error)) throw error;
    await sleep(delayMs + Math.random() * delayMs);
    return operation();
  }
}

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

// A transaction that Postgres aborted with a serialization failure or a deadlock rolled back completely, so
// running it again from the start is safe; that's the remedy the Postgres docs give. Any other error is not retried.
export function inTransaction<T>(db: Db, body: (tx: Transaction) => Promise<T>): Promise<T> {
  return retryOnce(() => db.transaction(body), isSerializationFailure);
}
