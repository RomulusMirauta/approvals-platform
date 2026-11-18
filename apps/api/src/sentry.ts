// Error reporting to Sentry. Off unless SENTRY_DSN is set (it is in Vercel production and preview), so local runs,
// tests and forks send nothing.
import * as Sentry from '@sentry/node';

// A crashing request must still answer in time; 2 s is enough to send one event and well inside Vercel's 10 s.
const FLUSH_TIMEOUT_MS = 2_000;

// The settings, apart from starting the SDK, so they can be tested without starting it (it can only start once).
export function sentryOptions(env: NodeJS.ProcessEnv): Sentry.NodeOptions {
  const environment = env.VERCEL_ENV ?? env.NODE_ENV;
  return {
    dsn: env.SENTRY_DSN,
    environment,
    // Vercel sets the commit on deployments, GitHub Actions on the worker's runs: an event names the code it came from.
    release: env.VERCEL_GIT_COMMIT_SHA ?? env.GITHUB_SHA,
    // What sendDefaultPii: false was before SDK v11 removed it: nothing personal is collected automatically. No user
    // from the IP, no cookies, headers, bodies or query strings, no SQL parameters and no local variables (the
    // login handler holds a password). reportError adds the user id itself.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    // Every preview request is worth a trace; in production a sample shows the slow endpoints at a fraction of the quota.
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    // Traces requests through Fastify's hooks and handlers (and does nothing in the worker, which has no Fastify).
    // Replaces the default one, which captures errors itself: it would send each 500 first, without the request id
    // and user, and Sentry's deduplication would then drop ours. Only the error handler knows the final status (a
    // unique violation is a 409, a dropped connection a 503), so reportError does the capturing.
    integrations: [Sentry.fastifyIntegration({ shouldHandleError: () => false })],
  };
}

// Call before the Fastify app is built: the Fastify integration hooks into each instance as it is created.
// extra: tests pass beforeSend to record events instead of sending them.
export function initSentry(env: NodeJS.ProcessEnv = process.env, extra: Sentry.NodeOptions = {}): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({ ...sentryOptions(env), ...extra });
  return true;
}

// For errors the API answers with 500, or a cold start that fails: a bug or an outage nobody planned for. 4xx are
// the client's mistakes and 503s are expected now and then (see errors.ts), so neither is reported.
export async function reportError(error: unknown, { requestId, userId }: { requestId: string; userId?: string }) {
  if (!Sentry.isInitialized()) return;
  // Only the user's id, never the email: enough for us to look them up, nothing personal in Sentry.
  Sentry.captureException(error, { tags: { requestId }, user: userId ? { id: userId } : undefined });
  // A serverless instance can be frozen as soon as the response is sent, with the event still queued. Waiting
  // here, before the 500 goes out, costs the failing request a moment and makes sure the event arrives.
  await Sentry.flush(FLUSH_TIMEOUT_MS);
}
