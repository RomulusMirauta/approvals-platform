// The API contract, shared by the server and the dashboard. The API validates requests and serializes
// responses with these schemas and generates its OpenAPI document from them, so the docs, the server and
// the client can't drift apart.
import { z } from 'zod';

export const ROLES = ['requester', 'approver', 'admin', 'agent'] as const;
export const REQUEST_TYPES = ['invoice_exception', 'purchase', 'access', 'other'] as const;
export const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const PRIORITIES = ['low', 'normal', 'high'] as const;
export const DECISIONS = ['approved', 'rejected'] as const;

export const Role = z.enum(ROLES);
export const RequestType = z.enum(REQUEST_TYPES);
export const RequestStatus = z.enum(REQUEST_STATUSES);
export const Priority = z.enum(PRIORITIES);
export const DecisionValue = z.enum(DECISIONS);

const id = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const tagName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Tags are lowercase letters, digits and dashes, up to 40 characters');

// Money in minor units (bani, cents), as in the ERP.
export const Money = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, for example RON'),
});

export const UserRef = z.object({ id, name: z.string() });
export const User = UserRef.extend({ email: z.email(), role: Role });

// --- Auth ---

export const LoginBody = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const LoginResponse = z.object({
  token: z.string(),
  expiresIn: z.number().int().describe('Seconds until the token expires'),
  user: User,
});

// --- Requests ---

export const CreateRequestBody = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).default(''),
  type: RequestType,
  priority: Priority.default('normal'),
  source: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .default('manual')
    .describe('System that raised the request, for example erp-procurement-mcp'),
  externalRef: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Id in the source system, for example INV-1003. One pending request per source and reference.'),
  amount: Money.optional(),
  tags: z.array(tagName).max(10).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}).describe('Free-form details from the source, for example exception codes'),
});

export const RequestSummary = z.object({
  id,
  title: z.string(),
  type: RequestType,
  status: RequestStatus,
  priority: Priority,
  source: z.string(),
  externalRef: z.string().nullable(),
  amount: Money.nullable(),
  requester: UserRef,
  tags: z.array(z.string()),
  createdAt: timestamp,
  updatedAt: timestamp,
  decidedAt: timestamp.nullable(),
});

export const Decision = z.object({
  id,
  approver: UserRef,
  decision: DecisionValue,
  comment: z.string(),
  createdAt: timestamp,
});

export const Comment = z.object({
  id,
  author: UserRef,
  body: z.string(),
  createdAt: timestamp,
});

export const RequestDetail = RequestSummary.extend({
  description: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  decisions: z.array(Decision),
  comments: z.array(Comment),
});

export const CreateRequestResponse = z.object({
  created: z.boolean().describe('false when a pending request with the same source and externalRef already existed'),
  request: RequestDetail,
});

export const ListRequestsQuery = z.object({
  status: RequestStatus.optional(),
  type: RequestType.optional(),
  priority: Priority.optional(),
  tag: tagName.optional(),
  source: z.string().optional(),
  q: z.string().trim().min(1).max(100).optional().describe('Text to find in the title or external reference'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const RequestPage = z.object({
  items: z.array(RequestSummary),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const DecisionBody = z
  .object({
    decision: DecisionValue,
    comment: z.string().trim().max(2000).default(''),
  })
  .refine((body) => body.decision === 'approved' || body.comment.length > 0, {
    message: 'A rejection needs a comment explaining why',
    path: ['comment'],
  });

export const CommentBody = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const Tag = z.object({ id, name: z.string(), requestCount: z.number().int() });

export const Stats = z.object({
  byStatus: z.record(RequestStatus, z.number().int()),
  pendingByType: z.record(RequestType, z.number().int()),
  pendingHighPriority: z.number().int(),
});

// Error body for every 4xx/5xx response (RFC 9457 problem details).
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type Role = z.infer<typeof Role>;
export type RequestType = z.infer<typeof RequestType>;
export type RequestStatus = z.infer<typeof RequestStatus>;
export type Priority = z.infer<typeof Priority>;
export type DecisionValue = z.infer<typeof DecisionValue>;
export type Money = z.infer<typeof Money>;
export type UserRef = z.infer<typeof UserRef>;
export type User = z.infer<typeof User>;
export type LoginBody = z.infer<typeof LoginBody>;
export type LoginResponse = z.infer<typeof LoginResponse>;
export type CreateRequestBody = z.input<typeof CreateRequestBody>;
export type RequestSummary = z.infer<typeof RequestSummary>;
export type Decision = z.infer<typeof Decision>;
export type Comment = z.infer<typeof Comment>;
export type RequestDetail = z.infer<typeof RequestDetail>;
export type CreateRequestResponse = z.infer<typeof CreateRequestResponse>;
export type ListRequestsQuery = z.input<typeof ListRequestsQuery>;
export type RequestPage = z.infer<typeof RequestPage>;
export type DecisionBody = z.input<typeof DecisionBody>;
export type CommentBody = z.infer<typeof CommentBody>;
export type Tag = z.infer<typeof Tag>;
export type Stats = z.infer<typeof Stats>;
export type Problem = z.infer<typeof Problem>;
