// Writes events to the transactional outbox. Callers pass their transaction, so the event exists if and only if
// the state change it describes committed. Publishing to a broker next to the commit instead would be a dual
// write: a crash between the two loses the event, or announces a change that was rolled back.
import type { EventType, RequestEvent } from '@approvals/contracts';
import type { TokenPayload } from '../auth.js';
import type { Db } from '../db/client.js';
import { outboxEvents } from '../db/schema.js';

type DecisionFields = 'decision' | 'comment' | 'decidedBy' | 'decidedAt';
type RequestFields = Omit<RequestEvent, 'actor' | DecisionFields>;

// httpRequestId: the X-Request-Id of the API call behind the event (undefined outside one, e.g. the seed), so the
// worker can log it and pass it on. Not optional, so a new caller can't forget it by accident.
export async function recordEvent(
  tx: Db,
  type: EventType,
  request: RequestFields,
  actor: TokenPayload,
  httpRequestId: string | undefined,
  extra: Pick<RequestEvent, DecisionFields> = {},
) {
  const payload: RequestEvent = { ...request, ...extra, actor: { id: actor.sub, name: actor.name } };
  await tx.insert(outboxEvents).values({ type, payload, httpRequestId });
}
