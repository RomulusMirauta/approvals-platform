// One id per HTTP request, carried into the logs, the problem+json body, Sentry and the outbox event.
import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

// A caller (a proxy, the ERP agent) may send its own id so its logs and ours line up. UUIDs, ULIDs and trace ids
// fit; newlines, quotes or a megabyte of text, which would forge or bloat log lines and headers, don't.
const SANE_REQUEST_ID = /^[\w.:-]{1,128}$/;

export function requestIdFrom(headers: IncomingHttpHeaders): string {
  const given = headers['x-request-id'];
  return typeof given === 'string' && SANE_REQUEST_ID.test(given) ? given : randomUUID();
}
