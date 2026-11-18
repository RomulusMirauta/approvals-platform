import { isIP } from 'node:net';

// Settings read from the environment, shared by the long-running server (index.ts) and the serverless entry.

// This string is public (it's in the repo), so it is only ever used when the developer asks for it with --dev
// (npm run dev). Anywhere else, a missing or short secret stops the server: anyone could forge admin tokens.
const DEV_JWT_SECRET = 'dev-only-secret-not-for-any-real-deployment';
const MIN_SECRET_LENGTH = 32;

export function jwtSecret({ allowDevSecret = false } = {}): string {
  const secret = process.env.JWT_SECRET;
  if (!secret && allowDevSecret) {
    console.warn('JWT_SECRET is not set; using the public development secret (--dev).');
    return DEV_JWT_SECRET;
  }
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be set to at least ${MIN_SECRET_LENGTH} random characters (or run with --dev locally)`);
  }
  return secret;
}

// Optional: without it the demo-reset route doesn't exist. A short one would let anyone guess it and wipe the demo.
export function cronSecret(): string | undefined {
  const secret = process.env.CRON_SECRET;
  if (!secret) return undefined;
  if (secret.length < MIN_SECRET_LENGTH) throw new Error(`CRON_SECRET must be at least ${MIN_SECRET_LENGTH} random characters`);
  return secret;
}

// The names proxy-addr knows: loopback (127.0.0.1/8, ::1), linklocal and uniquelocal (10/8, 172.16/12, 192.168/16, fc00::/7).
const PROXY_RANGE_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isAddressOrRange(entry: string) {
  if (PROXY_RANGE_NAMES.has(entry)) return true;
  const [address = '', prefix, ...rest] = entry.split('/');
  const version = isIP(address);
  if (!version || rest.length > 0) return false;
  return prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128));
}

// TRUST_PROXY: whose X-Forwarded-For to believe for the client's IP (the login rate limit counts per IP).
// - unset, "" or "false": nobody's; request.ip is the socket address.
// - "true": anyone's, left-most entry wins. Only right when every request comes through a proxy that replaces the
//   header (Vercel does); a proxy that appends to it lets the client choose its IP, e.g. a new one per login attempt.
// - addresses, CIDR ranges or proxy-addr names, comma-separated ("10.0.0.5", "uniquelocal"): only those peers'.
// A hop count ("1") is refused: Fastify 5.12 ignores it (trusts no one), since it can't tell the proxy from a direct
// client. Anything else is a typo and stops the server, instead of quietly trusting too much or too little.
export function trustProxy(value = process.env.TRUST_PROXY): boolean | string {
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  const entries = value.split(',').map((entry) => entry.trim());
  if (entries.every(isAddressOrRange)) return entries.join(',');
  throw new Error('TRUST_PROXY must be "true", "false" or the proxy addresses (IPs, CIDR ranges, "loopback", "uniquelocal"), comma-separated');
}
