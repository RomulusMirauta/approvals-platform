// Puts the public demo back to its seeded state: visitors can approve everything and leave an empty queue.
import { count, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import type { Db } from './client.js';
import * as schema from './schema.js';
import { seed } from './seed.js';
import { requests, users } from './schema.js';

// Every table in the schema module, so a table added later is emptied too without touching this file.
const tables = Object.values(schema).filter((value) => is(value, PgTable));

export async function resetDemo(db: Db) {
  // One transaction: if the seed fails halfway, the old data stays instead of a half-empty demo.
  return db.transaction(async (tx) => {
    // RESTART IDENTITY resets any sequences; CASCADE because the tables reference each other.
    await tx.execute(sql`truncate table ${sql.join(tables, sql`, `)} restart identity cascade`);
    await seed(tx);
    const [userCount] = await tx.select({ n: count() }).from(users);
    const [requestCount] = await tx.select({ n: count() }).from(requests);
    return { users: userCount!.n, requests: requestCount!.n };
  });
}
