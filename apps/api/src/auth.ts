// Authentication (who are you: a valid JWT) and authorization (what may you do: your role).
import type { FastifyRequest } from 'fastify';
import type { Role } from '@approvals/contracts';
import type { Db } from './db/client.js';
import { forbidden, unauthorized } from './errors.js';
import { getUser } from './services/users.js';

export interface TokenPayload {
  sub: string;
  role: Role;
  name: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

export const TOKEN_TTL_SECONDS = 8 * 60 * 60;

// The token proves who you are; your role comes from the database on every request (one primary-key lookup),
// so demoting or removing a user takes effect at once instead of when their 8-hour token expires.
export function authenticate(db: Db) {
  return async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw unauthorized();
    }
    const user = await getUser(db, request.user.sub);
    if (!user) throw unauthorized('The user no longer exists');
    request.user = { sub: user.id, role: user.role, name: user.name };
  };
}

// Runs after authenticate, so request.user is set.
export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest) => {
    if (!roles.includes(request.user.role)) throw forbidden();
  };
}

// Requesters and agents work with the requests they raised; approvers and admins see everything.
export function seesAllRequests(user: TokenPayload) {
  return user.role === 'approver' || user.role === 'admin';
}
