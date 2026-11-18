// Who hears about an event, and what they are told.
import { and, inArray, ne } from 'drizzle-orm';
import type { EventType, RequestEvent } from '@approvals/contracts';
import type { Db } from '@approvals/api/db/client';
import { users } from '@approvals/api/db/schema';

export interface Recipient {
  recipientId: string;
  message: string;
}

export async function recipientsFor(db: Db, type: EventType, event: RequestEvent): Promise<Recipient[]> {
  switch (type) {
    case 'request.approved':
    case 'request.rejected': {
      const verb = type === 'request.approved' ? 'approved' : 'rejected';
      const comment = event.comment ? `: ${event.comment}` : '';
      return [{ recipientId: event.requesterId, message: `${event.actor.name} ${verb} "${event.title}"${comment}` }];
    }
    case 'request.created': {
      const reason =
        event.type === 'invoice_exception' ? 'New invoice exception' : event.priority === 'high' ? 'New high-priority request' : null;
      if (!reason) return [];
      // Everyone who can decide, except whoever raised it: nobody decides on their own request.
      const deciders = await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.role, ['approver', 'admin']), ne(users.id, event.requesterId)));
      return deciders.map((user) => ({ recipientId: user.id, message: `${reason}: "${event.title}"` }));
    }
    // The requester cancelled it themselves (or an admin did); the webhook still hears about it.
    case 'request.cancelled':
      return [];
  }
}
