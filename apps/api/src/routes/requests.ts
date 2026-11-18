import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  Comment,
  CommentBody,
  CreateRequestBody,
  CreateRequestResponse,
  DecisionBody,
  ListRequestsQuery,
  RequestDetail,
  RequestPage,
} from '@approvals/contracts';
import { authenticate, requireRole } from '../auth.js';
import type { Db } from '../db/client.js';
import { problems } from '../errors.js';
import {
  addComment,
  cancelRequest,
  createRequest,
  decideRequest,
  getRequest,
  listRequests,
} from '../services/requests.js';

const IdParams = z.object({ id: z.uuid() });

export const requestRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  // Every route in this plugin needs a valid token; the hook stays inside this plugin's scope.
  app.addHook('onRequest', authenticate(db));

  app.get(
    '/requests',
    {
      schema: {
        tags: ['requests'],
        summary: 'List requests, newest first',
        description: 'Requesters and agents see the requests they raised; approvers and admins see all.',
        querystring: ListRequestsQuery,
        response: { 200: RequestPage, ...problems(400, 401) },
      },
    },
    async (request) => listRequests(db, request.user, request.query),
  );

  app.post(
    '/requests',
    {
      preHandler: requireRole('requester', 'agent', 'admin'),
      schema: {
        tags: ['requests'],
        summary: 'Raise a request (idempotent per source and externalRef)',
        description:
          'Returns 201 when created. If a pending request with the same source and externalRef exists, returns it with 200 and created: false.',
        body: CreateRequestBody,
        response: { 200: CreateRequestResponse, 201: CreateRequestResponse, ...problems(400, 401, 403, 409) },
      },
    },
    async (request, reply) => {
      const result = await createRequest(db, request.user, request.body);
      return reply.code(result.created ? 201 : 200).send(result);
    },
  );

  app.get(
    '/requests/:id',
    {
      schema: {
        tags: ['requests'],
        summary: 'A request with its decisions, comments and tags',
        params: IdParams,
        response: { 200: RequestDetail, ...problems(400, 401, 404) },
      },
    },
    async (request) => getRequest(db, request.user, request.params.id),
  );

  app.post(
    '/requests/:id/decision',
    {
      preHandler: requireRole('approver', 'admin'),
      schema: {
        tags: ['requests'],
        summary: 'Approve or reject a pending request',
        description: 'A rejection needs a comment. Nobody can decide on a request they raised.',
        params: IdParams,
        body: DecisionBody,
        response: { 200: RequestDetail, ...problems(400, 401, 403, 404, 409) },
      },
    },
    async (request) => decideRequest(db, request.user, request.params.id, request.body),
  );

  app.post(
    '/requests/:id/cancel',
    {
      schema: {
        tags: ['requests'],
        summary: 'Cancel a pending request (its requester or an admin)',
        params: IdParams,
        response: { 200: RequestDetail, ...problems(400, 401, 403, 404, 409) },
      },
    },
    async (request) => cancelRequest(db, request.user, request.params.id),
  );

  app.post(
    '/requests/:id/comments',
    {
      schema: {
        tags: ['requests'],
        summary: 'Comment on a request you can see',
        params: IdParams,
        body: CommentBody,
        response: { 201: Comment, ...problems(400, 401, 404) },
      },
    },
    async (request, reply) => reply.code(201).send(await addComment(db, request.user, request.params.id, request.body)),
  );
};
