// Entry point: reads configuration from the environment, opens the database and starts listening.
import { buildApp } from './app.js';
import { LOCAL_DATA_DIR, openDatabase } from './db/client.js';

// This string is public (it's in the repo), so it is only ever used when the developer asks for it with --dev
// (npm run dev). Anywhere else, a missing or short secret stops the server: anyone could forge admin tokens.
const DEV_JWT_SECRET = 'dev-only-secret-not-for-any-real-deployment';
const MIN_SECRET_LENGTH = 32;

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.argv.includes('--dev')) {
    console.warn('JWT_SECRET is not set; using the public development secret (--dev).');
    return DEV_JWT_SECRET;
  }
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be set to at least ${MIN_SECRET_LENGTH} random characters (or run with --dev locally)`);
  }
  return secret;
}

const databaseUrl = process.env.DATABASE_URL || LOCAL_DATA_DIR;
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const secret = jwtSecret();

const database = await openDatabase(databaseUrl);
// TRUST_PROXY=true only when a proxy that sets X-Forwarded-For sits in front (Vercel, a load balancer).
const trustProxy = process.env.TRUST_PROXY === 'true';
const app = await buildApp({ db: database.db, jwtSecret: secret, logger: true, corsOrigin: process.env.CORS_ORIGIN, trustProxy });

// Stop taking new connections, let in-flight requests finish, then close the database.
async function shutdown(signal: string) {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await database.close();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await app.listen({ port, host });
