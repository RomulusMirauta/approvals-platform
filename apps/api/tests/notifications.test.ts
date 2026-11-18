import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifications, requests } from '../src/db/schema.js';
import { setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
let ids: { aliceOld: string; aliceNew: string; bobs: string };

// The notification service writes these rows; here they are inserted directly to test the read side alone.
beforeAll(async () => {
  t = await setup();
  const [request] = await t.db.select({ id: requests.id }).from(requests).limit(1);
  const notify = async (recipientId: string, message: string, createdAt: Date) => {
    const [row] = await t.db
      .insert(notifications)
      .values({ eventId: randomUUID(), recipientId, requestId: request!.id, event: 'request.approved', message, createdAt })
      .returning();
    return row!.id;
  };
  ids = {
    aliceOld: await notify(t.users.alice.sub, 'older', new Date('2026-01-01T00:00:00Z')),
    aliceNew: await notify(t.users.alice.sub, 'newer', new Date('2026-01-02T00:00:00Z')),
    bobs: await notify(t.users.bob.sub, 'for bob', new Date('2026-01-03T00:00:00Z')),
  };
});
afterAll(() => t.close());

describe('notifications', () => {
  it('lists only your own, newest first, with the unread count', async () => {
    const response = await t.as('alice', 'GET', '/v1/notifications');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      unread: 2,
      items: [
        { id: ids.aliceNew, message: 'newer', read: false, event: 'request.approved' },
        { id: ids.aliceOld, message: 'older', read: false },
      ],
    });
  });

  it('marks one as read, and marking it again changes nothing', async () => {
    const first = await t.as('alice', 'POST', `/v1/notifications/${ids.aliceOld}/read`);
    expect(first.json()).toMatchObject({ id: ids.aliceOld, read: true });
    expect((await t.as('alice', 'POST', `/v1/notifications/${ids.aliceOld}/read`)).statusCode).toBe(200);
    expect((await t.as('alice', 'GET', '/v1/notifications')).json().unread).toBe(1);
  });

  it("answers 404 for someone else's notification and leaves it unread", async () => {
    expect((await t.as('alice', 'POST', `/v1/notifications/${ids.bobs}/read`)).statusCode).toBe(404);
    expect((await t.as('bob', 'GET', '/v1/notifications')).json()).toMatchObject({ unread: 1, items: [{ id: ids.bobs, read: false }] });
  });

  it('needs a token', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/v1/notifications' })).statusCode).toBe(401);
  });
});
