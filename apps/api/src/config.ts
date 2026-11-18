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
