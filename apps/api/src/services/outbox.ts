// Writes events to the transactional outbox. Callers pass their transaction, so the event exists if and only if
// the state change it describes committed. Publishing to a broker next to the commit instead would be a dual
// write: a crash between the two loses the event, or announces a change that was rolled back.
import type { EventType, RequestEvent } from '@approvals/contracts';
import type { TokenPayload } from '../auth.js';
import type { Db } from '../db/client.js';
import { outboxEvents } from '../db/schema.js';

type RequestFields = Omit<RequestEvent, 'actor' | 'decision' | 'comment'>;

export async function recordEvent(
  tx: Db,
  type: EventType,
  request: RequestFields,
  actor: TokenPayload,
  extra: Pick<RequestEvent, 'decision' | 'comment'> = {},
) {
  const payload: RequestEvent = { ...request, ...extra, actor: { id: actor.sub, name: actor.name } };
  await tx.insert(outboxEvents).values({ type, payload });
}
