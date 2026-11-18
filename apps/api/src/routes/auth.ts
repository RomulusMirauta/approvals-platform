import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { LoginBody, LoginResponse, User } from '@approvals/contracts';
import { authenticate, TOKEN_TTL_SECONDS } from '../auth.js';
import type { Db } from '../db/client.js';
import { problems, unauthorized } from '../errors.js';
import { getUser, verifyCredentials } from '../services/users.js';

export const authRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.post(
    '/auth/login',
    {
      // Much stricter than the global limit: slows down password guessing.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Exchange email and password for a JWT',
        security: [],
        body: LoginBody,
        response: { 200: LoginResponse, ...problems(400, 401, 429) },
      },
    },
    async (request) => {
      const user = await verifyCredentials(db, request.body.email, request.body.password);
      // One message for unknown email and wrong password, so the API doesn't reveal which emails exist.
      if (!user) throw unauthorized('Wrong email or password');
      const token = app.jwt.sign({ sub: user.id, role: user.role, name: user.name }, { expiresIn: TOKEN_TTL_SECONDS });
      return { token, expiresIn: TOKEN_TTL_SECONDS, user };
    },
  );

  app.get(
    '/me',
    {
      onRequest: authenticate,
      schema: { tags: ['auth'], summary: 'The signed-in user', response: { 200: User, ...problems(401) } },
    },
    async (request) => {
      const user = await getUser(db, request.user.sub);
      if (!user) throw unauthorized('The user no longer exists');
      return user;
    },
  );
};
