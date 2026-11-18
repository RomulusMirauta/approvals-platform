// Demo data: four users (one per role) and a dozen requests in different states.
// Requests go through the same service functions as the API, so the seed can't create data the API wouldn't.
// Run: npm run seed -w @approvals/api (skips if the users already exist).
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { CreateRequestBody, Role } from '@approvals/contracts';
import type { TokenPayload } from '../auth.js';
import { createRequest, decideRequest, cancelRequest, addComment } from '../services/requests.js';
import { LOCAL_DATA_DIR, openDatabase, type Db } from './client.js';
import { requests, users } from './schema.js';

// Demo only. Never use a shared, published password outside local development.
export const DEMO_PASSWORD = 'demo-password';

const DEMO_USERS = [
  { key: 'alice', email: 'alice@example.com', name: 'Alice Popescu', role: 'requester' },
  { key: 'bob', email: 'bob@example.com', name: 'Bob Ionescu', role: 'approver' },
  { key: 'carol', email: 'carol@example.com', name: 'Carol Dumitru', role: 'admin' },
  { key: 'agent', email: 'erp-agent@example.com', name: 'ERP Procurement Agent', role: 'agent' },
] as const satisfies readonly { key: string; email: string; name: string; role: Role }[];

type UserKey = (typeof DEMO_USERS)[number]['key'];

interface SeedRequest {
  by: UserKey;
  hoursAgo: number;
  body: CreateRequestBody & { tags: string[] };
  outcome?: { by: UserKey; decision: 'approved' | 'rejected'; comment?: string } | 'cancelled';
  comments?: { by: UserKey; body: string }[];
}

const ERP = 'erp-procurement-mcp';

const invoice = (ref: string, title: string, supplier: string, exceptionCodes: string[], amountMinor: number, currency: string) => ({
  title: `${ref}: ${title}`,
  type: 'invoice_exception' as const,
  source: ERP,
  externalRef: ref,
  amount: { amountMinor, currency },
  metadata: { exceptionCodes, supplier },
});

const SEED_REQUESTS: SeedRequest[] = [
  {
    by: 'agent',
    hoursAgo: 120,
    body: { ...invoice('INV-1002', 'quantity billed exceeds goods received', 'Dacia Parts SRL', ['QTY_OVER_RECEIPT'], 1_245_000, 'RON'), tags: ['finance', 'quantity-variance'] },
    outcome: { by: 'bob', decision: 'approved', comment: 'Remaining 20 units arrived this morning, receipt updated.' },
  },
  {
    by: 'agent',
    hoursAgo: 30,
    body: { ...invoice('INV-1003', 'unit price 8% above PO', 'Carpathian Steel SA', ['PRICE_ABOVE_PO'], 3_870_050, 'RON'), priority: 'high', tags: ['finance', 'price-variance'] },
    comments: [{ by: 'bob', body: 'Asked purchasing whether the steel surcharge was agreed.' }],
  },
  {
    by: 'agent',
    hoursAgo: 96,
    body: { ...invoice('INV-1005', 'possible duplicate of INV-0998', 'Transilvania Logistics SRL', ['DUPLICATE_SUSPECTED'], 560_000, 'RON'), priority: 'high', tags: ['finance', 'duplicate'] },
    outcome: { by: 'carol', decision: 'rejected', comment: 'Same delivery note as INV-0998, which is already paid.' },
  },
  {
    by: 'agent',
    hoursAgo: 20,
    body: { ...invoice('INV-1006', 'no matching purchase order', 'Euro Office Supplies GmbH', ['PO_NOT_FOUND'], 89_900, 'EUR'), tags: ['finance', 'missing-po'] },
  },
  {
    by: 'agent',
    hoursAgo: 6,
    body: { ...invoice('INV-1008', 'unit price 3% above PO and VAT mismatch', 'Carpathian Steel SA', ['PRICE_ABOVE_PO', 'VAT_MISMATCH'], 1_120_400, 'RON'), priority: 'high', tags: ['finance', 'price-variance', 'tax'] },
  },
  {
    by: 'agent',
    hoursAgo: 2,
    body: { ...invoice('INV-1009', 'invoice received before goods', 'Banat Agro Coop', ['NO_GOODS_RECEIPT'], 215_000, 'EUR'), priority: 'low', tags: ['finance'] },
  },
  {
    by: 'alice',
    hoursAgo: 72,
    body: { title: 'Two 27-inch monitors for the design team', description: 'Replacing monitors that flicker.', type: 'purchase', amount: { amountMinor: 280_000, currency: 'RON' }, tags: ['hardware'] },
    outcome: { by: 'bob', decision: 'approved' },
  },
  {
    by: 'alice',
    hoursAgo: 48,
    body: { title: 'Admin access to the production database', description: 'To debug the slow monthly report.', type: 'access', priority: 'high', tags: ['access', 'security'] },
    outcome: { by: 'carol', decision: 'rejected', comment: 'Read-only replica access is enough; please request that instead.' },
    comments: [{ by: 'alice', body: 'Understood, I will request replica access.' }],
  },
  {
    by: 'alice',
    hoursAgo: 40,
    body: { title: 'Read-only access to the reporting replica', type: 'access', tags: ['access'] },
  },
  {
    by: 'alice',
    hoursAgo: 24,
    body: { title: 'Conference ticket: JSConf EU', description: 'Two days, includes workshops.', type: 'other', amount: { amountMinor: 45_000, currency: 'EUR' }, priority: 'low', tags: ['training'] },
  },
  {
    by: 'alice',
    hoursAgo: 12,
    body: { title: 'Ergonomic chairs for the support team', type: 'purchase', amount: { amountMinor: 640_000, currency: 'RON' }, tags: ['office'] },
    outcome: 'cancelled',
  },
  {
    by: 'alice',
    hoursAgo: 1,
    body: { title: 'Annual licence for the diagramming tool', type: 'purchase', amount: { amountMinor: 120_000, currency: 'EUR' }, tags: ['software'] },
    comments: [{ by: 'carol', body: 'Check whether the team plan is cheaper for five seats.' }],
  },
];

export async function seed(db: Db) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const rows = await db
    .insert(users)
    .values(DEMO_USERS.map(({ email, name, role }) => ({ email, name, role, passwordHash })))
    .returning();
  const viewer = (key: UserKey): TokenPayload => {
    const demo = DEMO_USERS.find((u) => u.key === key)!;
    const row = rows.find((r) => r.email === demo.email)!;
    return { sub: row.id, role: row.role, name: row.name };
  };

  for (const item of SEED_REQUESTS) {
    const { request } = await createRequest(db, viewer(item.by), { description: '', priority: 'normal', source: 'manual', metadata: {}, ...item.body });
    // Spread creation times over the last days so the list looks lived-in.
    const createdAt = new Date(Date.now() - item.hoursAgo * 3_600_000);
    await db.update(requests).set({ createdAt, updatedAt: createdAt }).where(eq(requests.id, request.id));

    for (const comment of item.comments ?? []) await addComment(db, viewer(comment.by), request.id, { body: comment.body });
    if (item.outcome === 'cancelled') await cancelRequest(db, viewer(item.by), request.id);
    else if (item.outcome) {
      const { by, decision, comment = '' } = item.outcome;
      await decideRequest(db, viewer(by), request.id, { decision, comment });
    }
  }

  return Object.fromEntries(DEMO_USERS.map((u) => [u.key, viewer(u.key)])) as Record<UserKey, TokenPayload>;
}

// Run as a script: seed the local database unless it already has the demo users.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const database = await openDatabase(process.env.DATABASE_URL || LOCAL_DATA_DIR);
  const [existing] = await database.db.select().from(users).where(eq(users.email, DEMO_USERS[0].email));
  if (existing) {
    console.log('Demo data already present, nothing to do.');
  } else {
    await seed(database.db);
    console.log(`Seeded ${DEMO_USERS.length} users and ${SEED_REQUESTS.length} requests. Password for all: ${DEMO_PASSWORD}`);
  }
  await database.close();
}
