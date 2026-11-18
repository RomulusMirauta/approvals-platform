// Entry point: reads configuration from the environment, opens the database and starts listening.
import { buildApp } from './app.js';
import { jwtSecret } from './config.js';
import { LOCAL_DATA_DIR, openDatabase } from './db/client.js';

const databaseUrl = process.env.DATABASE_URL || LOCAL_DATA_DIR;
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const secret = jwtSecret({ allowDevSecret: process.argv.includes('--dev') });

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
