// Queries for approval requests and the mapping from database rows to the API contract.
import { and, count, desc, eq, exists, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  Comment,
  CommentBody,
  CreateRequestBody,
  CreateRequestResponse,
  DecisionBody,
  ListRequestsQuery,
  RequestDetail,
  RequestPage,
  RequestSummary,
  UserRef,
} from '@approvals/contracts';
import { seesAllRequests, type TokenPayload } from '../auth.js';
import type { Db } from '../db/client.js';
import { inTransaction } from '../db/retry.js';
import { approvals, comments, requests, requestTags, tags } from '../db/schema.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { recordEvent } from './outbox.js';

// The parsed (output) types: defaults applied, strings trimmed.
type CreateInput = z.output<typeof CreateRequestBody>;
type ListQuery = z.output<typeof ListRequestsQuery>;
type DecisionInput = z.output<typeof DecisionBody>;

type RequestRow = typeof requests.$inferSelect & {
  requester: UserRef;
  requestTags: { tag: { name: string } }[];
};
type DetailRow = RequestRow & {
  approvals: (typeof approvals.$inferSelect & { approver: UserRef })[];
  comments: (typeof comments.$inferSelect & { author: UserRef })[];
};

const userRef = { columns: { id: true, name: true } } as const;

// Loaded together with each request, in the same SQL query (no N+1).
const summaryRelations = {
  requester: userRef,
  requestTags: { with: { tag: { columns: { name: true } } } },
} as const;

const iso = (date: Date) => date.toISOString();

function toSummary(row: RequestRow): RequestSummary {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    priority: row.priority,
    source: row.source,
    externalRef: row.externalRef,
    amount: row.amountMinor !== null && row.currency !== null ? { amountMinor: row.amountMinor, currency: row.currency } : null,
    requester: row.requester,
    tags: row.requestTags.map((rt) => rt.tag.name).sort(),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    decidedAt: row.decidedAt ? iso(row.decidedAt) : null,
  };
}

function toDetail(row: DetailRow): RequestDetail {
  return {
    ...toSummary(row),
    description: row.description,
    metadata: row.metadata,
    decisions: row.approvals.map((a) => ({
      id: a.id,
      approver: a.approver,
      decision: a.decision,
      comment: a.comment,
      createdAt: iso(a.createdAt),
    })),
    comments: row.comments.map((c) => ({ id: c.id, author: c.author, body: c.body, createdAt: iso(c.createdAt) })),
  };
}

// Row-level visibility: requesters and agents only ever query their own requests.
export function visibleTo(viewer: TokenPayload): SQL | undefined {
  return seesAllRequests(viewer) ? undefined : eq(requests.requesterId, viewer.sub);
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

export async function listRequests(db: Db, viewer: TokenPayload, query: ListQuery): Promise<RequestPage> {
  const pattern = query.q ? `%${escapeLike(query.q)}%` : undefined;
  const where = and(
    visibleTo(viewer),
    query.status ? eq(requests.status, query.status) : undefined,
    query.type ? eq(requests.type, query.type) : undefined,
    query.priority ? eq(requests.priority, query.priority) : undefined,
    query.source ? eq(requests.source, query.source) : undefined,
    pattern ? or(ilike(requests.title, pattern), ilike(requests.externalRef, pattern)) : undefined,
    query.tag
      ? exists(
          db
            .select({ one: sql`1` })
            .from(requestTags)
            .innerJoin(tags, eq(tags.id, requestTags.tagId))
            .where(and(eq(requestTags.requestId, requests.id), eq(tags.name, query.tag))),
        )
      : undefined,
  );

  const [rows, [totalRow]] = await Promise.all([
    db.query.requests.findMany({
      where,
      with: summaryRelations,
      orderBy: [desc(requests.createdAt), desc(requests.id)],
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    }),
    db.select({ total: count() }).from(requests).where(where),
  ]);

  return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total: totalRow?.total ?? 0 };
}

export async function getRequest(db: Db, viewer: TokenPayload, id: string): Promise<RequestDetail> {
  const row = await db.query.requests.findFirst({
    where: and(eq(requests.id, id), visibleTo(viewer)),
    with: {
      ...summaryRelations,
      approvals: { with: { approver: userRef }, orderBy: [approvals.createdAt] },
      comments: { with: { author: userRef }, orderBy: [comments.createdAt] },
    },
  });
  // Someone else's request answers 404, not 403, so ids of other people's requests leak nothing.
  if (!row) throw notFound();
  return toDetail(row);
}

// httpRequestId (here and below): the API call's X-Request-Id, recorded with the event; see recordEvent.
export async function createRequest(
  db: Db,
  viewer: TokenPayload,
  body: CreateInput,
  httpRequestId?: string,
): Promise<CreateRequestResponse> {
  // Only agent accounts speak for a source system. Otherwise anyone could file a fake "INV-1003" first and
  // block the real agent's submission with a 409, or put a fake item in the approvers' exception queue.
  if (viewer.role !== 'agent' && (body.source !== 'manual' || body.externalRef !== undefined)) {
    throw forbidden('Only agent accounts can submit requests for a source system (source and externalRef)');
  }
  // One retry covers the rare case where the conflicting request was decided between our insert and our select.
  return (await tryCreate(db, viewer, body, httpRequestId)) ?? (await tryCreate(db, viewer, body, httpRequestId)) ?? raceLost();
}

const raceLost = (): never => {
  throw conflict('The request changed while it was being created; try again');
};

async function tryCreate(
  db: Db,
  viewer: TokenPayload,
  body: CreateInput,
  httpRequestId: string | undefined,
): Promise<CreateRequestResponse | undefined> {
  return inTransaction(db, async (tx) => {
    // The partial unique index allows one pending request per (source, externalRef). Under a race the second
    // insert waits for the first transaction, then does nothing, so a retrying agent never gets a duplicate.
    const [inserted] = await tx
      .insert(requests)
      .values({
        title: body.title,
        description: body.description,
        type: body.type,
        priority: body.priority,
        source: body.source,
        externalRef: body.externalRef,
        amountMinor: body.amount?.amountMinor,
        currency: body.amount?.currency,
        metadata: body.metadata,
        requesterId: viewer.sub,
      })
      // The target and predicate name the partial unique index (requests_pending_external_ref).
      .onConflictDoNothing({
        target: [requests.source, requests.externalRef],
        where: sql`status = 'pending' and external_ref is not null`,
      })
      .returning({ id: requests.id });

    if (inserted) {
      await attachTags(tx, inserted.id, body.tags);
      // Only a real insert is an event: an idempotent retry that finds the existing request changes nothing.
      await recordEvent(
        tx,
        'request.created',
        {
          requestId: inserted.id,
          requesterId: viewer.sub,
          title: body.title,
          type: body.type,
          priority: body.priority,
          source: body.source,
          externalRef: body.externalRef ?? null,
        },
        viewer,
        httpRequestId,
      );
      return { created: true, request: await getRequest(tx, viewer, inserted.id) };
    }

    // Only reachable with an externalRef: without one there is nothing to conflict with.
    const [existing] = await tx
      .select({ id: requests.id, requesterId: requests.requesterId })
      .from(requests)
      .where(
        and(eq(requests.source, body.source), eq(requests.externalRef, body.externalRef ?? ''), eq(requests.status, 'pending')),
      );
    if (!existing) return undefined;
    // Raised by someone this caller may not see: say it exists, but don't return it.
    if (!seesAllRequests(viewer) && existing.requesterId !== viewer.sub) {
      throw conflict('A pending request for this source item already exists');
    }
    return { created: false, request: await getRequest(tx, viewer, existing.id) };
  });
}

async function attachTags(tx: Db, requestId: string, names: string[]) {
  const unique = [...new Set(names)];
  if (unique.length === 0) return;
  await tx
    .insert(tags)
    .values(unique.map((name) => ({ name })))
    .onConflictDoNothing({ target: tags.name });
  const rows = await tx.select({ id: tags.id }).from(tags).where(inArray(tags.name, unique));
  await tx.insert(requestTags).values(rows.map((tag) => ({ requestId, tagId: tag.id })));
}

// Locks the request row until the transaction ends, so two people acting on it at once are serialized:
// the second one sees the first one's change and gets a 409.
async function lockRequest(tx: Db, viewer: TokenPayload, id: string) {
  const [row] = await tx
    .select({
      requestId: requests.id,
      status: requests.status,
      requesterId: requests.requesterId,
      title: requests.title,
      type: requests.type,
      priority: requests.priority,
      source: requests.source,
      externalRef: requests.externalRef,
    })
    .from(requests)
    .where(and(eq(requests.id, id), visibleTo(viewer)))
    .for('update');
  if (!row) throw notFound();
  const { status, ...eventFields } = row;
  return { status, requesterId: row.requesterId, eventFields };
}

export async function decideRequest(db: Db, viewer: TokenPayload, id: string, body: DecisionInput, httpRequestId?: string) {
  await inTransaction(db, async (tx) => {
    const row = await lockRequest(tx, viewer, id);
    // Separation of duties: nobody approves their own request.
    if (row.requesterId === viewer.sub) throw forbidden('You cannot decide on a request you raised');
    if (row.status !== 'pending') throw conflict(`The request is already ${row.status}`);

    // The database clock, like created_at: an app server with a skewed clock can't record a decision before creation.
    const [decided] = await tx
      .update(requests)
      .set({ status: body.decision, decidedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(requests.id, id))
      .returning({ decidedAt: requests.decidedAt });
    if (!decided?.decidedAt) throw new Error('Update returned no decision time');
    await tx.insert(approvals).values({ requestId: id, approverId: viewer.sub, decision: body.decision, comment: body.comment });
    // Everything the ERP needs to act on the decision without calling back: the decider by user id (the token has
    // no email), and the decision time the request itself records.
    await recordEvent(tx, `request.${body.decision}`, row.eventFields, viewer, httpRequestId, {
      decision: body.decision,
      // No comment, no key: the earlier contract had comment as an optional string, and its consumers reject null.
      ...(body.comment && { comment: body.comment }),
      decidedBy: viewer.sub,
      decidedAt: iso(decided.decidedAt),
    });
  });
  return getRequest(db, viewer, id);
}

export async function cancelRequest(db: Db, viewer: TokenPayload, id: string, httpRequestId?: string) {
  await inTransaction(db, async (tx) => {
    const row = await lockRequest(tx, viewer, id);
    if (row.requesterId !== viewer.sub && viewer.role !== 'admin') {
      throw forbidden('Only the requester or an admin can cancel a request');
    }
    if (row.status !== 'pending') throw conflict(`The request is already ${row.status}`);

    await tx.update(requests).set({ status: 'cancelled', decidedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(requests.id, id));
    await recordEvent(tx, 'request.cancelled', row.eventFields, viewer, httpRequestId);
  });
  return getRequest(db, viewer, id);
}

export async function addComment(db: Db, viewer: TokenPayload, id: string, body: CommentBody): Promise<Comment> {
  const [visible] = await db
    .select({ id: requests.id })
    .from(requests)
    .where(and(eq(requests.id, id), visibleTo(viewer)));
  if (!visible) throw notFound();

  const [row] = await db.insert(comments).values({ requestId: id, authorId: viewer.sub, body: body.body }).returning();
  if (!row) throw new Error('Insert returned no row');
  return { id: row.id, author: { id: viewer.sub, name: viewer.name }, body: row.body, createdAt: iso(row.createdAt) };
}
