import { and, asc, count, eq } from 'drizzle-orm';
import type { Tag } from '@approvals/contracts';
import type { TokenPayload } from '../auth.js';
import type { Db } from '../db/client.js';
import { requests, requestTags, tags } from '../db/schema.js';
import { visibleTo } from './requests.js';

// One grouped query. Counts only include requests the viewer can see, the same rule as the request list,
// so a requester's tag filter never hints at other people's requests. Tags with no visible request show 0.
export async function listTags(db: Db, viewer: TokenPayload): Promise<Tag[]> {
  return db
    .select({ id: tags.id, name: tags.name, requestCount: count(requests.id) })
    .from(tags)
    .leftJoin(requestTags, eq(requestTags.tagId, tags.id))
    .leftJoin(requests, and(eq(requests.id, requestTags.requestId), visibleTo(viewer)))
    .groupBy(tags.id)
    .orderBy(asc(tags.name));
}
