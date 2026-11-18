import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { User } from '@approvals/contracts';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';

// Compared against when the email is unknown, so a wrong email takes as long as a wrong password
// and response times don't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

type UserRow = typeof users.$inferSelect;

const toUser = (row: UserRow): User => ({ id: row.id, name: row.name, email: row.email, role: row.role });

export async function verifyCredentials(db: Db, email: string, password: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  const ok = await bcrypt.compare(password, row?.passwordHash ?? DUMMY_HASH);
  return row && ok ? toUser(row) : null;
}

export async function getUser(db: Db, id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ? toUser(row) : null;
}
