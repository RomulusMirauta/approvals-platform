import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, setToken } from '../src/api';
import { createQueryClient, retryDelay, shouldRetry } from '../src/retry';
import { alice, mockApi, pageOf, renderApp, stats } from './helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setToken(null);
});

const apiError = (status: number, retryAfterSeconds?: number) =>
  new ApiError({ type: 'about:blank', title: 'Error', status }, retryAfterSeconds);
// What fetch throws when the network is down or the server can't be reached.
const networkError = new TypeError('Failed to fetch');

describe('retry policy', () => {
  it('retries network errors and server errors', () => {
    expect(shouldRetry(0, networkError)).toBe(true);
    expect(shouldRetry(0, apiError(503))).toBe(true);
    expect(shouldRetry(0, apiError(500))).toBe(true);
  });

  it('never retries client errors: they fail the same way every time', () => {
    for (const status of [400, 401, 403, 404, 409, 429]) expect(shouldRetry(0, apiError(status))).toBe(false);
  });

  it('stops after three retries', () => {
    expect(shouldRetry(2, apiError(503))).toBe(true);
    expect(shouldRetry(3, apiError(503))).toBe(false);
  });

  it("waits as long as the server's Retry-After asks, otherwise backs off exponentially", () => {
    expect(retryDelay(0, apiError(503, 2))).toBe(2000);
    expect([0, 1, 2].map((failures) => retryDelay(failures, networkError))).toEqual([1000, 2000, 4000]);
    // A huge Retry-After doesn't leave the screen waiting for minutes.
    expect(retryDelay(0, apiError(503, 3600))).toBe(30_000);
  });

  it('does not retry mutations, which could apply a decision twice', () => {
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });
});

describe('when the API is unavailable', () => {
  const unavailable = {
    status: 503,
    headers: { 'Retry-After': '1' },
    body: { type: 'about:blank', title: 'Service Unavailable', status: 503, detail: 'The service is temporarily unavailable' },
  };

  function signedInAsAlice(me: () => { status?: number; body: unknown; headers?: Record<string, string> }) {
    setToken('alice-token');
    mockApi({
      'GET /v1/me': me,
      'GET /v1/stats': () => ({ body: stats }),
      'GET /v1/tags': () => ({ body: [] }),
      'GET /v1/requests': () => ({ body: pageOf([]) }),
      'GET /v1/notifications': () => ({ body: { items: [], unread: 0 } }),
    });
  }

  it('shows a calm banner while retrying, then the dashboard once the API answers', async () => {
    let calls = 0;
    signedInAsAlice(() => (++calls === 1 ? unavailable : { body: alice }));
    renderApp(createQueryClient());

    expect((await screen.findByRole('status')).textContent).toBe('Service temporarily unavailable, retrying…');
    // The retry waits the 1 s Retry-After, then succeeds.
    expect(await screen.findByText('Alice Requester', {}, { timeout: 3000 })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(calls).toBe(2);
  });

  it('explains a 503 that outlasted the retries instead of showing the raw error', async () => {
    signedInAsAlice(() => unavailable);
    renderApp();

    expect((await screen.findByRole('alert')).textContent).toBe('The service is temporarily unavailable. Please try again in a moment.');
  });
});
