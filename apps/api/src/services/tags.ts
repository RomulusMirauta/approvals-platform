import { asc, count, eq } from 'drizzle-orm';
import type { Tag } from '@approvals/contracts';
import type { Db } from '../db/client.js';
import { requestTags, tags } from '../db/schema.js';

// One grouped query; the left join keeps tags that no request uses any more (count 0).
export async function listTags(db: Db): Promise<Tag[]> {
  return db
    .select({ id: tags.id, name: tags.name, requestCount: count(requestTags.requestId) })
    .from(tags)
    .leftJoin(requestTags, eq(requestTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(asc(tags.name));
}
