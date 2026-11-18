// Entry point: reads configuration from the environment, opens the database and starts listening.
import { buildApp } from './app.js';
import { jwtSecret, trustProxy } from './config.js';
import { LOCAL_DATA_DIR, openDatabase } from './db/client.js';
import { loggerOptions } from './logging.js';
import { initSentry } from './sentry.js';

const databaseUrl = process.env.DATABASE_URL || LOCAL_DATA_DIR;
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const secret = jwtSecret({ allowDevSecret: process.argv.includes('--dev') });
// Whether X-Forwarded-For names the client (TRUST_PROXY, see config.ts): read before anything starts, so a typo fails fast.
const proxyTrust = trustProxy();

// Before buildApp: Sentry's Fastify integration hooks into the instance as it is created.
initSentry();
const database = await openDatabase(databaseUrl);
const app = await buildApp({ db: database.db, jwtSecret: secret, logger: loggerOptions(), corsOrigin: process.env.CORS_ORIGIN, trustProxy: proxyTrust });

// A request stuck on a dead connection (or a pool that never drains) would otherwise keep the process alive
// until the platform kills it without logs. 10 s is well inside the usual 30 s grace period after SIGTERM.
const SHUTDOWN_TIMEOUT_MS = 10_000;

// Stop taking new connections, let in-flight requests finish, then close the database.
async function shutdown(signal: string) {
  app.log.info(`${signal} received, shutting down`);
  // unref: the timer alone must not keep the process running once everything has closed.
  setTimeout(() => {
    app.log.error(`Shutdown took longer than ${SHUTDOWN_TIMEOUT_MS} ms, exiting anyway`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  try {
    await app.close();
    await database.close();
  } catch (error) {
    app.log.error(error, 'Shutdown failed');
    process.exit(1);
  }
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await app.listen({ port, host });
