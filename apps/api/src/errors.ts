// Every error leaves the API as RFC 9457 problem details, so clients handle one error shape.
import { STATUS_CODES } from 'node:http';
import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { Problem } from '@approvals/contracts';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = (detail = 'Missing or invalid token') => new HttpError(401, detail);
export const forbidden = (detail = 'Your role does not allow this action') => new HttpError(403, detail);
export const notFound = (detail = 'Request not found') => new HttpError(404, detail);
export const conflict = (detail: string) => new HttpError(409, detail);
export const serviceUnavailable = (detail: string) => new HttpError(503, detail);

// How long clients should wait before trying again after a 503: about what Neon needs to wake a suspended
// compute or the pool needs to replace a dropped connection, and short enough that a person barely notices.
export const RETRY_AFTER_SECONDS = 2;

// Documents the error responses of a route in OpenAPI, e.g. { ...problems(400, 404) }, with the content type
// the error handler really sends. Every route can also answer 429 (rate limit), 500 and 503 (database briefly
// unavailable), so those are always listed.
export function problems(...codes: number[]) {
  return Object.fromEntries(
    [...new Set([...codes, 429, 500, 503])].map((code) => [
      code,
      { description: STATUS_CODES[code] ?? 'Error', content: { 'application/problem+json': { schema: Problem } } },
    ]),
  );
}

// Drizzle wraps driver errors, so the Postgres SQLSTATE code may sit on the cause.
function postgresCode(error: unknown): string | undefined {
  const withCode = (value: unknown) =>
    typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string'
      ? value.code
      : undefined;
  return withCode((error as { cause?: unknown }).cause) ?? withCode(error);
}

// Failures that mean "the database is briefly unavailable or busy", not "this request is wrong": the same request
// will likely work a moment later, so the client gets 503 with Retry-After instead of a 500.
// SQLSTATE class 08 is connection exceptions. 57P01-57P03: the server is shutting down or starting up (Neon
// suspending or waking a compute). 53300: too many connections. 40001/40P01: serialization failure and deadlock
// (already retried once by inTransaction). 57014: a statement cancelled by statement_timeout.
const TRANSIENT_POSTGRES_CODES = new Set(['57P01', '57P02', '57P03', '53300', '40001', '40P01', '57014']);
// Socket errors from Node, which node-postgres passes on with their code.
const TRANSIENT_NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN']);
// node-postgres raises its own timeouts and dropped connections without a code, so the message is all there is.
const TRANSIENT_MESSAGE = /timeout exceeded when trying to connect|Connection terminated|Query read timeout/i;

export function isTransientDbError(error: unknown): boolean {
  const code = postgresCode(error);
  if (code && (code.startsWith('08') || TRANSIENT_POSTGRES_CODES.has(code) || TRANSIENT_NETWORK_CODES.has(code))) {
    return true;
  }
  return [error, (error as { cause?: unknown } | undefined)?.cause].some(
    (value) => value instanceof Error && TRANSIENT_MESSAGE.test(value.message),
  );
}

// The two failures Postgres says to fix by running the whole transaction again.
export function isSerializationFailure(error: unknown): boolean {
  const code = postgresCode(error);
  return code === '40001' || code === '40P01';
}

const POSTGRES_ERRORS: Record<string, { status: number; detail: string }> = {
  '23505': { status: 409, detail: 'A record with these values already exists' },
  '23503': { status: 409, detail: 'The change conflicts with related records' },
  '23514': { status: 400, detail: 'The data breaks a database rule' },
  '22003': { status: 400, detail: 'A number is out of range' },
};

export function registerErrorHandlers(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const send = (status: number, extra: Omit<Problem, 'type' | 'title' | 'status'> = {}) => {
      const body: Problem = { type: 'about:blank', title: STATUS_CODES[status] ?? 'Error', status, ...extra };
      return reply.code(status).type('application/problem+json').send(body);
    };
    const unavailable = (detail: string) => {
      reply.header('Retry-After', String(RETRY_AFTER_SECONDS));
      return send(503, { detail });
    };

    if (hasZodFastifySchemaValidationErrors(error)) {
      const errors = error.validation.map((issue) => ({
        path: issue.instancePath.slice(1).replaceAll('/', '.'),
        message: issue.message ?? 'Invalid value',
      }));
      return send(400, { detail: 'The request is not valid', errors });
    }

    if (isTransientDbError(error)) {
      // A warning, not an error: expected now and then (cold starts, dropped connections); many in a row is an outage.
      request.log.warn({ err: error }, 'Transient database error');
      return unavailable('The service is temporarily unavailable; try again in a moment');
    }

    const pg = POSTGRES_ERRORS[postgresCode(error) ?? ''];
    if (pg) return send(pg.status, { detail: pg.detail });

    const status = error.statusCode ?? 500;
    if (status === 503) return unavailable(error.message);
    if (status >= 500) {
      // Log the real error, but never send internals (SQL, stack traces) to the client.
      request.log.error(error);
      return send(500, { detail: 'Something went wrong on our side' });
    }
    return send(status, { detail: error.message });
  });

  app.setNotFoundHandler((request, reply) => {
    const body: Problem = { type: 'about:blank', title: 'Not Found', status: 404, detail: `No route for ${request.method} ${request.url}` };
    return reply.code(404).type('application/problem+json').send(body);
  });
}
