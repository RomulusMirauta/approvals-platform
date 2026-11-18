// The database schema. Relations:
//   users 1:N requests (requester), users 1:N approvals (approver), users 1:N comments (author)
//   requests 1:N approvals, requests 1:N comments
//   requests N:M tags, through request_tags
//   users 1:N notifications (recipient); outbox_events stands alone (it is a queue, not domain data)
// Rules that must never break live in the database as constraints, not only in application code.
import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { DECISIONS, PRIORITIES, REQUEST_STATUSES, REQUEST_TYPES, ROLES, type EventType, type RequestEvent } from '@approvals/contracts';

export const roleEnum = pgEnum('user_role', ROLES);
export const requestTypeEnum = pgEnum('request_type', REQUEST_TYPES);
export const requestStatusEnum = pgEnum('request_status', REQUEST_STATUSES);
export const priorityEnum = pgEnum('priority', PRIORITIES);
export const decisionEnum = pgEnum('decision', DECISIONS);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

export const requests = pgTable(
  'requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    type: requestTypeEnum('type').notNull(),
    status: requestStatusEnum('status').notNull().default('pending'),
    priority: priorityEnum('priority').notNull().default('normal'),
    source: text('source').notNull().default('manual'),
    externalRef: text('external_ref'),
    // bigint: 2^31 bani is only 21 million RON, a realistic invoice. mode 'number' is safe up to 2^53.
    amountMinor: bigint('amount_minor', { mode: 'number' }),
    currency: text('currency'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    // RESTRICT: a user who raised requests can't be deleted and leave them without a requester.
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [
    check('requests_title_length', sql`char_length(${table.title}) between 3 and 200`),
    check('requests_amount_non_negative', sql`${table.amountMinor} >= 0`),
    // An amount and its currency come together or not at all.
    check('requests_amount_has_currency', sql`(${table.amountMinor} is null) = (${table.currency} is null)`),
    // Only finished requests have a decision time.
    check('requests_decided_at_matches_status', sql`(${table.status} = 'pending') = (${table.decidedAt} is null)`),
    // Idempotency for agents: one pending request per item in the source system. A retry finds this row
    // instead of creating a second one. Once decided, the same item may be raised again.
    uniqueIndex('requests_pending_external_ref')
      .on(table.source, table.externalRef)
      .where(sql`${table.status} = 'pending' and ${table.externalRef} is not null`),
    // The dashboard's main query: requests by status, newest first.
    index('requests_status_created_at').on(table.status, table.createdAt),
    index('requests_requester_id').on(table.requesterId),
  ],
);

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // CASCADE: decisions belong to their request and go with it.
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    approverId: uuid('approver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    decision: decisionEnum('decision').notNull(),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
  },
  (table) => [
    unique('approvals_one_per_approver').on(table.requestId, table.approverId),
    check('approvals_rejection_has_comment', sql`${table.decision} = 'approved' or char_length(${table.comment}) > 0`),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check('comments_body_not_empty', sql`char_length(${table.body}) > 0`),
    index('comments_request_id').on(table.requestId),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
  },
  (table) => [check('tags_name_lowercase', sql`${table.name} = lower(${table.name})`)],
);

// The join table for requests N:M tags. The composite primary key stops the same tag twice on one request.
export const requestTags = pgTable(
  'request_tags',
  {
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.requestId, table.tagId] }), index('request_tags_tag_id').on(table.tagId)],
);

// The transactional outbox: the API inserts an event in the same transaction as the change it describes, and
// the notification service (services/notifications) consumes it. The table doubles as the queue.
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').$type<EventType>().notNull(),
    payload: jsonb('payload').$type<RequestEvent>().notNull(),
    createdAt: createdAt(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    // Not before this time: a failed event waits here for its retry (exponential backoff).
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    // The X-Request-Id of the API call that caused the event, so the worker's log lines and the webhook can be
    // matched to it. A column, not part of the payload: the payload's requestId is the approval request's id, and
    // the contract describes the event, not how it was transported. Null for events not caused by a request (seed).
    httpRequestId: text('http_request_id'),
  },
  (table) => [
    // Partial: the worker only looks for unprocessed events, and processed ones would make the index grow forever.
    index('outbox_events_unprocessed').on(table.availableAt).where(sql`${table.processedAt} is null`),
  ],
);

// Written by the notification service, read through the API.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // No foreign key: processed outbox events may be pruned, and the notification outlives them.
    eventId: uuid('event_id').notNull(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    event: text('event').$type<EventType>().notNull(),
    message: text('message').notNull(),
    createdAt: createdAt(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (table) => [
    // Idempotency: delivery is at-least-once, so an event delivered twice must not notify anyone twice.
    unique('notifications_once_per_event').on(table.eventId, table.recipientId),
    index('notifications_recipient_created_at').on(table.recipientId, table.createdAt),
  ],
);

export const usersRelations =relations(users, ({ many }) => ({
  requests: many(requests),
  approvals: many(approvals),
  comments: many(comments),
}));

export const requestsRelations = relations(requests, ({ one, many }) => ({
  requester: one(users, { fields: [requests.requesterId], references: [users.id] }),
  approvals: many(approvals),
  comments: many(comments),
  requestTags: many(requestTags),
}));

export const approvalsRelations = relations(approvals, ({ one }) => ({
  request: one(requests, { fields: [approvals.requestId], references: [requests.id] }),
  approver: one(users, { fields: [approvals.approverId], references: [users.id] }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  request: one(requests, { fields: [comments.requestId], references: [requests.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  requestTags: many(requestTags),
}));

export const requestTagsRelations = relations(requestTags, ({ one }) => ({
  request: one(requests, { fields: [requestTags.requestId], references: [requests.id] }),
  tag: one(tags, { fields: [requestTags.tagId], references: [tags.id] }),
}));
