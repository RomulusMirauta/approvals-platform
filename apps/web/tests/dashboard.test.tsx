import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '../src/api';
import { alice, bob, makeRequest, mockApi, pageOf, renderApp, stats } from './helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setToken(null);
});

// Signed in as Bob the approver, with one pending invoice exception from Alice in the queue.
function signedInAsApprover(extraRoutes: Parameters<typeof mockApi>[0] = {}) {
  setToken('bob-token');
  let request = makeRequest();
  const calls = mockApi({
    'GET /v1/me': () => ({ body: bob }),
    'GET /v1/stats': () => ({ body: stats }),
    'GET /v1/tags': () => ({ body: [] }),
    'GET /v1/requests': () => ({ body: pageOf([request]) }),
    'GET /v1/notifications': () => ({ body: { items: [], unread: 0 } }),
    [`GET /v1/requests/${request.id}`]: () => ({ body: request }),
    [`POST /v1/requests/${request.id}/decision`]: (body: any) => {
      const decision = { id: crypto.randomUUID(), approver: bob, createdAt: new Date().toISOString(), ...body };
      request = makeRequest({ status: 'approved', decisions: [decision] });
      return { body: request };
    },
    ...extraRoutes,
  });
  return { calls, request };
}

async function openRequest(title: string) {
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(title) }));
  return screen.findByRole('complementary', { name: 'Request details' });
}

describe('dashboard', () => {
  it('signs in, keeps the token and shows the dashboard', async () => {
    const calls = mockApi({
      'POST /v1/auth/login': () => ({ body: { token: 'alice-token', expiresIn: 3600, user: alice } }),
      'GET /v1/stats': () => ({ body: stats }),
      'GET /v1/tags': () => ({ body: [] }),
      'GET /v1/requests': () => ({ body: pageOf([]) }),
    });
    renderApp();

    await userEvent.click(screen.getByRole('button', { name: /alice@example.com/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Alice Requester')).toBeTruthy();
    expect(sessionStorage.getItem('approvals.token')).toBe('alice-token');
    expect(calls[0]?.body).toEqual({ email: 'alice@example.com', password: 'demo-password' });
    // Later calls carry the token.
    const statsCall = vi.mocked(fetch).mock.calls.find(([url]) => url === '/v1/stats');
    expect((statsCall?.[1]?.headers as Record<string, string>).Authorization).toBe('Bearer alice-token');
  });

  it('shows the exception queue to approvers', async () => {
    const { calls } = signedInAsApprover();
    renderApp();

    const list = await screen.findByRole('region', { name: 'Requests' });
    expect(within(list).getByText('Invoice INV-1003 does not match the purchase order')).toBeTruthy();
    expect(within(list).getByText(/erp-procurement-mcp \/ INV-1003/)).toBeTruthy();
    expect(within(list).getByText('High')).toBeTruthy();
    expect(within(list).getByText(/12,500\.50/)).toBeTruthy();

    const listCall = calls.find((call) => call.url.pathname === '/v1/requests');
    expect(listCall?.url.searchParams.get('type')).toBe('invoice_exception');
    expect(listCall?.url.searchParams.get('status')).toBe('pending');
  });

  it('blocks a rejection without a comment', async () => {
    const { calls } = signedInAsApprover();
    renderApp();

    const panel = await openRequest('INV-1003');
    await userEvent.click(await within(panel).findByRole('button', { name: 'Reject' }));

    expect(within(panel).getByRole('alert').textContent).toBe('A rejection needs a comment explaining why');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('approves a request and refreshes the queue', async () => {
    const { calls, request } = signedInAsApprover();
    renderApp();

    const panel = await openRequest('INV-1003');
    const listCallsBefore = calls.filter((call) => call.url.pathname === '/v1/requests').length;
    await userEvent.type(within(panel).getByLabelText(/Comment/), 'Price agreed by phone');
    await userEvent.click(within(panel).getByRole('button', { name: 'Approve' }));

    expect(await within(panel).findByText('Approved by Bob Approver')).toBeTruthy();
    const decision = calls.find((call) => call.method === 'POST');
    expect(decision?.url.pathname).toBe(`/v1/requests/${request.id}/decision`);
    expect(decision?.body).toEqual({ decision: 'approved', comment: 'Price agreed by phone' });
    expect(within(panel).queryByRole('button', { name: 'Approve' })).toBeNull();
    const listCallsAfter = calls.filter((call) => call.url.pathname === '/v1/requests').length;
    expect(listCallsAfter).toBeGreaterThan(listCallsBefore);
  });

  it('shows unread notifications and opens the request of the one you choose', async () => {
    const notification = {
      id: '20000000-0000-4000-8000-000000000001',
      event: 'request.created',
      requestId: makeRequest().id,
      message: 'New invoice exception: "INV-1003"',
      read: false,
      createdAt: new Date().toISOString(),
    };
    const { calls } = signedInAsApprover({
      'GET /v1/notifications': () => ({ body: { items: [notification], unread: 1 } }),
      [`POST /v1/notifications/${notification.id}/read`]: () => ({ body: { ...notification, read: true } }),
    });
    renderApp();

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    const list = screen.getByRole('region', { name: 'Notifications' });
    await userEvent.click(within(list).getByRole('button', { name: /New invoice exception/ }));

    expect(await screen.findByRole('complementary', { name: 'Request details' })).toBeTruthy();
    expect(calls.some((call) => call.method === 'POST' && call.url.pathname.endsWith('/read'))).toBe(true);
  });

  it('shows problem details from the API', async () => {
    const request = makeRequest();
    signedInAsApprover({
      [`POST /v1/requests/${request.id}/decision`]: () => ({
        status: 409,
        body: { type: 'about:blank', title: 'Conflict', status: 409, detail: 'This request was already decided.' },
      }),
    });
    renderApp();

    const panel = await openRequest('INV-1003');
    await userEvent.click(within(panel).getByRole('button', { name: 'Approve' }));

    const alert = await within(panel).findByRole('alert');
    expect(alert.textContent).toContain('Conflict');
    expect(alert.textContent).toContain('This request was already decided.');
  });

  it('refreshes the request when someone else decided it first', async () => {
    const carol = { id: '00000000-0000-4000-8000-000000000003', name: 'Carol Approver' };
    let request = makeRequest();
    signedInAsApprover({
      [`GET /v1/requests/${request.id}`]: () => ({ body: request }),
      [`POST /v1/requests/${request.id}/decision`]: () => {
        // Carol approved it a moment before Bob clicked.
        const decision = { id: crypto.randomUUID(), decision: 'approved' as const, comment: '', approver: carol, createdAt: new Date().toISOString() };
        request = makeRequest({ status: 'approved', decisions: [decision] });
        return {
          status: 409,
          body: { type: 'about:blank', title: 'Conflict', status: 409, detail: 'This request was already decided.' },
        };
      },
    });
    renderApp();

    const panel = await openRequest('INV-1003');
    await userEvent.click(within(panel).getByRole('button', { name: 'Approve' }));

    expect(await within(panel).findByText('Approved by Carol Approver')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('steps back a page when the last item on the last page is decided', async () => {
    const request = makeRequest();
    const others = Array.from({ length: 20 }, (_, i) =>
      makeRequest({ id: `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title: `Other request ${i + 1}` }),
    );
    let total = 21;
    const { calls } = signedInAsApprover({
      // 20 per page: page 1 is full and page 2 holds the invoice, until it is approved and leaves the queue.
      'GET /v1/requests': (_body, url) => {
        const page = Number(url.searchParams.get('page'));
        const items = page === 1 ? others : total > 20 ? [request] : [];
        return { body: { items, page, pageSize: 20, total } };
      },
      [`POST /v1/requests/${request.id}/decision`]: () => {
        total = 20;
        return { body: makeRequest({ status: 'approved' }) };
      },
    });
    renderApp();

    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/Page 2 of 2/)).toBeTruthy();
    const panel = await openRequest('INV-1003');
    await userEvent.click(within(panel).getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText(/Page 1 of 1 · 20 requests/)).toBeTruthy();
    expect(screen.getByText('Other request 1')).toBeTruthy();
    expect(screen.queryByText(/Page 2 of 1/)).toBeNull();
    // Page 1 first shows from cache, then refetches; wait for that request instead of checking at once.
    const decidedAt = calls.findIndex((call) => call.url.pathname.endsWith('/decision'));
    await waitFor(() => {
      const pagesAfter = calls.slice(decidedAt).filter((call) => call.url.pathname === '/v1/requests');
      expect(pagesAfter.map((call) => call.url.searchParams.get('page'))).toContain('1');
    });
  });

  it('hides approve and reject on your own request', async () => {
    setToken('alice-token');
    const request = makeRequest();
    mockApi({
      'GET /v1/me': () => ({ body: { ...alice, role: 'admin' } }),
      'GET /v1/stats': () => ({ body: stats }),
      'GET /v1/tags': () => ({ body: [] }),
      'GET /v1/requests': () => ({ body: pageOf([request]) }),
      [`GET /v1/requests/${request.id}`]: () => ({ body: request }),
    });
    renderApp();

    const panel = await openRequest('INV-1003');
    expect(await within(panel).findByRole('button', { name: 'Cancel request' })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Approve' })).toBeNull();
    // Opening the panel moves focus to its heading.
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { level: 2 }));
  });

  it('goes back to the login screen when the session expires', async () => {
    setToken('expired-token');
    mockApi({
      'GET /v1/me': () => ({ status: 401, body: { type: 'about:blank', title: 'Unauthorized', status: 401 } }),
    });
    renderApp();

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(sessionStorage.getItem('approvals.token')).toBeNull();
  });
});
