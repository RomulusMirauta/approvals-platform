// Authentication (who are you: a valid JWT) and authorization (what may you do: your role).
import type { FastifyRequest } from 'fastify';
import type { Role } from '@approvals/contracts';
import { forbidden, unauthorized } from './errors.js';

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

export async function authenticate(request: FastifyRequest) {
  try {
    await request.jwtVerify();
  } catch {
    throw unauthorized();
  }
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
