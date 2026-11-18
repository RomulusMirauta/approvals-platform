// What other code may use: a cron job or serverless function can drain the outbox without the worker loop.
export { drainOnce, MAX_ATTEMPTS, type DrainOptions, type DrainResult } from './drain.js';
