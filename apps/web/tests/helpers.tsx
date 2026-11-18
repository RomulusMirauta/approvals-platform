import type { RequestDetail, RequestPage, Stats, User } from '@approvals/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../src/App';

export const alice: User = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Alice Requester',
  email: 'alice@example.com',
  role: 'requester',
};
export const bob: User = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Bob Approver',
  email: 'bob@example.com',
  role: 'approver',
};

export const stats: Stats = {
  byStatus: { pending: 3, approved: 5, rejected: 1, cancelled: 0 },
  pendingByType: { invoice_exception: 2, purchase: 1, access: 0, other: 0 },
  pendingHighPriority: 1,
};

export function makeRequest(overrides: Partial<RequestDetail> = {}): RequestDetail {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    title: 'Invoice INV-1003 does not match the purchase order',
    type: 'invoice_exception',
    status: 'pending',
    priority: 'high',
    source: 'erp-procurement-mcp',
    externalRef: 'INV-1003',
    amount: { amountMinor: 1_250_050, currency: 'RON' },
    requester: { id: alice.id, name: alice.name },
    tags: ['finance'],
    createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    updatedAt: new Date().toISOString(),
    decidedAt: null,
    description: 'Unit price differs from the PO.',
    metadata: { exceptionCodes: ['PRICE_MISMATCH'] },
    decisions: [],
    comments: [],
    ...overrides,
  };
}

export function pageOf(items: RequestDetail[]): RequestPage {
  return { items, page: 1, pageSize: 20, total: items.length };
}

type Handler = (body: unknown, url: URL) => { status?: number; body: unknown; headers?: Record<string, string> };

// A tiny fake API: routes are "METHOD /path" and the handler returns the response.
// Every call is recorded so tests can assert on what the dashboard sent.
export function mockApi(routes: Record<string, Handler>) {
  const calls: { method: string; url: URL; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const url = new URL(input, 'http://localhost');
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });

    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    const response = handler(body, url);
    const status = response.status ?? 200;
    const contentType = status >= 400 ? 'application/problem+json' : 'application/json';
    return new Response(JSON.stringify(response.body), { status, headers: { 'Content-Type': contentType, ...response.headers } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

// Retries are off by default so a failing call shows its error at once; the retry tests pass the real client.
export function renderApp(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}
