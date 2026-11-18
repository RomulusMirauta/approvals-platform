// Entry point: reads configuration from the environment, opens the database and starts listening.
import { buildApp } from './app.js';
import { LOCAL_DATA_DIR, openDatabase } from './db/client.js';

const DEV_JWT_SECRET = 'dev-only-secret-change-me';

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');
  console.warn('JWT_SECRET is not set; using an insecure development secret.');
  return DEV_JWT_SECRET;
}

const databaseUrl = process.env.DATABASE_URL || LOCAL_DATA_DIR;
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const secret = jwtSecret();

const database = await openDatabase(databaseUrl);
const app = await buildApp({ db: database.db, jwtSecret: secret, logger: true, corsOrigin: process.env.CORS_ORIGIN });

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
