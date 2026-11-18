import { count } from 'drizzle-orm';
import { REQUEST_STATUSES, REQUEST_TYPES, type Stats } from '@approvals/contracts';
import type { TokenPayload } from '../auth.js';
import type { Db } from '../db/client.js';
import { requests } from '../db/schema.js';
import { visibleTo } from './requests.js';

const zeros = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

// One grouped query, folded into the three counters. Every enum key is present, zeros included,
// so the dashboard never has to guess about missing keys.
export async function getStats(db: Db, viewer: TokenPayload): Promise<Stats> {
  const groups = await db
    .select({ status: requests.status, type: requests.type, priority: requests.priority, n: count() })
    .from(requests)
    .where(visibleTo(viewer))
    .groupBy(requests.status, requests.type, requests.priority);

  const stats: Stats = { byStatus: zeros(REQUEST_STATUSES), pendingByType: zeros(REQUEST_TYPES), pendingHighPriority: 0 };
  for (const { status, type, priority, n } of groups) {
    stats.byStatus[status] += n;
    if (status !== 'pending') continue;
    stats.pendingByType[type] += n;
    if (priority === 'high') stats.pendingHighPriority += n;
  }
  return stats;
}
