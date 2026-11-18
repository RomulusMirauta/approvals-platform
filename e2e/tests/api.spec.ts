import type { CreateRequestResponse, Problem } from '@approvals/contracts';
import { invoiceException } from '../support/data.ts';
import { API_URL } from '../support/env.ts';
import { expect, test } from '../support/fixtures.ts';

// Contract checks for what agents rely on, straight against the API with no browser.
test.describe('API', () => {
  test('an agent that retries a submission gets the existing request back', async ({ api, id }) => {
    const body = invoiceException(id);

    const first = await api.post('agent', '/v1/requests', body);
    expect(first.status()).toBe(201);
    const created = (await first.json()) as CreateRequestResponse;
    expect(created.created).toBe(true);

    const retry = await api.post('agent', '/v1/requests', body);
    expect(retry.status()).toBe(200);
    const existing = (await retry.json()) as CreateRequestResponse;
    expect(existing.created).toBe(false);
    expect(existing.request.id).toBe(created.request.id);

    // Only one *pending* request per source item: once decided, the same reference can come back.
    await api.decide('bob', created.request.id, { decision: 'approved' });
    const resubmitted = await api.post('agent', '/v1/requests', body);
    expect(resubmitted.status()).toBe(201);
    expect(((await resubmitted.json()) as CreateRequestResponse).request.id).not.toBe(created.request.id);
  });

  test('a call without a token gets a problem response', async ({ request }) => {
    const response = await request.get(`${API_URL}/v1/requests`);

    expect(response.status()).toBe(401);
    expect(response.headers()['content-type']).toContain('application/problem+json');
    expect((await response.json()) as Problem).toMatchObject({ status: 401, title: 'Unauthorized' });
  });
});
