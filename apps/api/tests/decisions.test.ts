import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newRequest, setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup();
});
afterAll(() => t.close());

// A fresh pending request raised by the given user.
async function raise(user: 'alice' | 'carol' = 'alice') {
  const response = await t.as(user, 'POST', '/v1/requests', newRequest());
  return response.json().request.id as string;
}

const decide = (user: 'alice' | 'bob' | 'carol', id: string, body: object) =>
  t.as(user, 'POST', `/v1/requests/${id}/decision`, body);

describe('decisions', () => {
  it('approves a pending request and records who decided', async () => {
    const id = await raise();
    const response = await decide('bob', id, { decision: 'approved' });
    expect(response.statusCode).toBe(200);
    const detail = response.json();
    expect(detail.status).toBe('approved');
    expect(detail.decidedAt).not.toBeNull();
    expect(detail.decisions[0]).toMatchObject({ decision: 'approved', approver: { id: t.users.bob.sub } });
  });

  it('needs a comment to reject', async () => {
    const id = await raise();
    const without = await decide('bob', id, { decision: 'rejected' });
    expect(without.statusCode).toBe(400);
    expect(without.json().errors).toEqual([{ path: 'comment', message: 'A rejection needs a comment explaining why' }]);

    const withComment = await decide('bob', id, { decision: 'rejected', comment: 'Over budget' });
    expect(withComment.json()).toMatchObject({ status: 'rejected', decisions: [{ comment: 'Over budget' }] });
  });

  it('answers 409 to a second decision', async () => {
    const id = await raise();
    await decide('bob', id, { decision: 'approved' });
    const second = await decide('carol', id, { decision: 'rejected', comment: 'Too late?' });
    expect(second.statusCode).toBe(409);
  });

  it('lets exactly one of two simultaneous decisions win', async () => {
    const id = await raise();
    const results = await Promise.all([
      decide('bob', id, { decision: 'approved' }),
      decide('carol', id, { decision: 'rejected', comment: 'No' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });

  it('forbids deciding on your own request (separation of duties)', async () => {
    const id = await raise('carol');
    expect((await decide('carol', id, { decision: 'approved' })).statusCode).toBe(403);
  });

  it('forbids requesters from deciding', async () => {
    const id = await raise();
    expect((await decide('alice', id, { decision: 'approved' })).statusCode).toBe(403);
  });
});

describe('cancelling', () => {
  it('lets the requester cancel a pending request once', async () => {
    const id = await raise();
    const response = await t.as('alice', 'POST', `/v1/requests/${id}/cancel`);
    expect(response.json()).toMatchObject({ status: 'cancelled' });
    expect((await t.as('alice', 'POST', `/v1/requests/${id}/cancel`)).statusCode).toBe(409);
  });

  it('lets an admin cancel, but not an approver or another requester', async () => {
    const id = await raise();
    expect((await t.as('bob', 'POST', `/v1/requests/${id}/cancel`)).statusCode).toBe(403);
    expect((await t.as('erp-agent', 'POST', `/v1/requests/${id}/cancel`)).statusCode).toBe(404);
    expect((await t.as('carol', 'POST', `/v1/requests/${id}/cancel`)).statusCode).toBe(200);
  });
});
