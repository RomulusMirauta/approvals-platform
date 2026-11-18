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
export async function openDatabase(url?: string): Promise<Database> {
  if (url?.startsWith('postgres://') || url?.startsWith('postgresql://')) {
    const pool = new pg.Pool({ connectionString: url });
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder });
    return { db, close: () => pool.end() };
  }
  // PGlite creates only the last folder of a data path itself (memory:// and idb:// aren't paths).
  if (url && !url.includes('://')) mkdirSync(url, { recursive: true });
  const client = new PGlite(url);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
