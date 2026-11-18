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

// Documents the error responses of a route in OpenAPI, e.g. { ...problems(400, 404) }.
export function problems(...codes: number[]) {
  return Object.fromEntries(codes.map((code) => [code, Problem]));
}

// Drizzle wraps driver errors, so the Postgres SQLSTATE code may sit on the cause.
function postgresCode(error: unknown): string | undefined {
  const withCode = (value: unknown) =>
    typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string'
      ? value.code
      : undefined;
  return withCode((error as { cause?: unknown }).cause) ?? withCode(error);
}

const POSTGRES_ERRORS: Record<string, { status: number; detail: string }> = {
  '23505': { status: 409, detail: 'A record with these values already exists' },
  '23503': { status: 409, detail: 'The change conflicts with related records' },
  '23514': { status: 400, detail: 'The data breaks a database rule' },
};

export function registerErrorHandlers(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const send = (status: number, extra: Omit<Problem, 'type' | 'title' | 'status'> = {}) => {
      const body: Problem = { type: 'about:blank', title: STATUS_CODES[status] ?? 'Error', status, ...extra };
      return reply.code(status).type('application/problem+json').send(body);
    };

    if (hasZodFastifySchemaValidationErrors(error)) {
      const errors = error.validation.map((issue) => ({
        path: issue.instancePath.slice(1).replaceAll('/', '.'),
        message: issue.message ?? 'Invalid value',
      }));
      return send(400, { detail: 'The request is not valid', errors });
    }

    const pg = POSTGRES_ERRORS[postgresCode(error) ?? ''];
    if (pg) return send(pg.status, { detail: pg.detail });

    const status = error.statusCode ?? 500;
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
