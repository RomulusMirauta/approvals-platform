// Webhook signatures in the Standard Webhooks format (standardwebhooks.com), so a receiver can check that a delivery
// came from us and was not changed or replayed. The receiver verifies with any Standard Webhooks library, or with
// verifyWebhook below.
import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'whsec_';
// The spec asks for 24 to 64 random bytes; fewer is too easy to guess.
const MIN_SECRET_BYTES = 24;
// How far the timestamp may be from the receiver's clock: older deliveries are refused as possible replays.
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

// whsec_<base64> to the key bytes. Throws on anything else, without echoing the value, so a typo fails at startup
// instead of every delivery being signed with a key the receiver doesn't have.
export function parseSigningSecret(secret: string): Buffer {
  const encoded = secret.startsWith(PREFIX) ? secret.slice(PREFIX.length) : '';
  const bytes = /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
  if (bytes.length < MIN_SECRET_BYTES) {
    throw new Error(`WEBHOOK_SIGNING_SECRET must be "${PREFIX}" followed by at least ${MIN_SECRET_BYTES} base64-encoded random bytes`);
  }
  return bytes;
}

// v1,<base64 HMAC-SHA256 of "id.timestamp.body">. body must be the exact bytes sent: re-serializing the JSON on
// the other side can reorder or re-space it and break the signature.
export function signWebhook(secret: string | Buffer, webhookId: string, timestamp: number, body: string) {
  const key = typeof secret === 'string' ? parseSigningSecret(secret) : secret;
  return `v1,${createHmac('sha256', key).update(`${webhookId}.${timestamp}.${body}`).digest('base64')}`;
}

export interface VerifyOptions {
  toleranceSeconds?: number;
  // Milliseconds, like Date.now(); injected so tests can move the clock.
  now?: number;
}

// The receiver's side, here to pin the format in tests and for a receiver written in TypeScript. headers are the
// request's, lower-case. The signature header may list several space-separated signatures (during a secret
// rotation); one match is enough.
export function verifyWebhook(
  secret: string | Buffer,
  headers: Record<string, string | undefined>,
  body: string,
  { toleranceSeconds = DEFAULT_TOLERANCE_SECONDS, now = Date.now() }: VerifyOptions = {},
): boolean {
  const id = headers['webhook-id'];
  const timestamp = Number(headers['webhook-timestamp']);
  const signatures = headers['webhook-signature'];
  if (!id || !signatures || !Number.isInteger(timestamp)) return false;
  if (Math.abs(now / 1_000 - timestamp) > toleranceSeconds) return false;

  const expected = Buffer.from(signWebhook(secret, id, timestamp, body));
  // Constant time, so response timing doesn't reveal how much of a forged signature was right.
  return signatures.split(' ').some((candidate) => {
    const given = Buffer.from(candidate);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
