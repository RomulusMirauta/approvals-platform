// Opens the database and applies migrations. With DATABASE_URL set (Neon, any Postgres) it uses node-postgres.
// Without it, it uses PGlite: the real Postgres engine compiled to WebAssembly, running in-process, so local
// development and tests need no Docker and still hit real Postgres constraints.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { isTransientDbError } from '../errors.js';
import { retryOnce } from './retry.js';
import * as schema from './schema.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  close: () => Promise<void>;
}

// Resolves the same way from src/db (development) and dist/db (build).
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

// Where PGlite keeps local data when DATABASE_URL is not set: apps/api/.data/pglite (gitignored).
export const LOCAL_DATA_DIR = fileURLToPath(new URL('../../.data/pglite', import.meta.url));

// url: a postgres:// connection string, a folder for PGlite to keep its data in, or nothing for in-memory.
// migrate: false on serverless, where the deploy pipeline has already applied migrations.
export async function openDatabase(url?: string, { migrate = true } = {}): Promise<Database> {
  if (url?.startsWith('postgres://') || url?.startsWith('postgresql://')) {
    const pool = new pg.Pool({
      connectionString: url,
      // A serverless instance handles one request at a time, and Neon's pooled endpoint (PgBouncer) multiplexes
      // our connections onto a few real ones. 5 covers a transaction plus a parallel query or two, and many
      // function instances times a small pool stays far below the pooler's client limit.
      max: 5,
      // The default is to wait forever for a connection. Neon wakes a suspended compute in about a second, so
      // 3 s is generous, and a timeout plus one retry (below) still fits in Vercel's 10 s function limit.
      connectionTimeoutMillis: 3_000,
      // Close connections idle for 10 s. A frozen serverless instance can't notice the server dropping them, so
      // fewer idle connections means fewer dead ones when it thaws; opening a new one is cheap.
      idleTimeoutMillis: 10_000,
      // TCP keepalive notices a peer that vanished without closing the socket (a NAT or proxy dropping it).
      keepAlive: true,
      // Client-side limit per query, so a stuck query ends in a 503 instead of holding the function until Vercel
      // kills it at 10 s; every query here takes milliseconds. A server-side statement_timeout can't be sent in
      // the startup packet: Neon's pooler rejects it ("unsupported startup parameter"). It can be set on the
      // database role instead (see README, Resilience).
      query_timeout: 5_000,
    });
    // A connection that dies while idle in the pool (database restart, network drop, an admin closing it)
    // emits 'error' on the pool. Unhandled, that crashes the process; the pool replaces the connection itself.
    pool.on('error', (error) => console.error('Idle database connection lost:', error.message));
    // The first connection after a cold start is the one most likely to fail: Neon may be waking a suspended
    // compute. Nothing has been written yet, so one retry is safe; a second failure goes to the caller.
    try {
      await retryOnce(() => pool.query('select 1'), isTransientDbError, 200);
    } catch (error) {
      await pool.end();
      throw error;
    }
    const db = drizzlePg(pool, { schema });
    if (migrate) await migratePg(db, { migrationsFolder });
    return { db, close: () => pool.end() };
  }
  // PGlite creates only the last folder of a data path itself (memory:// and idb:// aren't paths).
  if (url && !url.includes('://')) mkdirSync(url, { recursive: true });
  const client = new PGlite(url);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
