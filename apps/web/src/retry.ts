// When the dashboard retries a failed request on its own, and how long it waits in between.
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

const MAX_RETRIES = 3;
const MAX_DELAY_MS = 30_000;

// Worth retrying: the network failed (fetch rejects, so there is no status) or the server had a problem (5xx,
// including the API's 503 while the database wakes up). Never a 4xx: a bad filter, a missing request or a
// missing permission fails the same way every time.
export function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500;
  return true;
}

export function shouldRetry(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_RETRIES && isRetryable(error);
}

// failureCount counts the failures before this one (0 after the first), as TanStack Query passes it.
// The server's Retry-After when it sent one (it knows best), otherwise exponential backoff: 1 s, 2 s, 4 s.
export function retryDelay(failureCount: number, error: unknown): number {
  const fromServer = error instanceof ApiError ? error.retryAfterSeconds : undefined;
  const delay = fromServer !== undefined ? fromServer * 1000 : 1000 * 2 ** failureCount;
  return Math.min(delay, MAX_DELAY_MS);
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, retryDelay, staleTime: 15_000 },
      // Mutations (approve, reject, create, comment) are not retried automatically: they change data, and if
      // the response was lost after the server committed, sending it again could act twice. The person sees
      // the error and decides. (TanStack's default is already no retry; this makes it explicit.)
      mutations: { retry: false },
    },
  });
}
