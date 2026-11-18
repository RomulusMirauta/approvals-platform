import { expect, type APIRequestContext } from '@playwright/test';
import type { CreateRequestBody, CreateRequestResponse, DecisionBody, LoginResponse, RequestDetail } from '@approvals/contracts';
import { API_URL } from './env.ts';
import { DEMO_PASSWORD, users, type UserKey } from './users.ts';

// Arranges test data through the public API, the same way an agent or the dashboard would.
// Every call asserts its status, so a broken precondition fails where it happens, not three steps later.
export class ApiClient {
  constructor(
    private readonly request: APIRequestContext,
    // Shared per worker: one login per user per worker instead of one per test.
    private readonly tokens: Map<UserKey, string>,
  ) {}

  async tokenFor(user: UserKey): Promise<string> {
    const cached = this.tokens.get(user);
    if (cached) return cached;
    const response = await this.request.post(`${API_URL}/v1/auth/login`, {
      data: { email: users[user].email, password: DEMO_PASSWORD },
    });
    expect(response.status(), `login as ${user}`).toBe(200);
    const { token } = (await response.json()) as LoginResponse;
    this.tokens.set(user, token);
    return token;
  }

  async createRequest(as: UserKey, body: CreateRequestBody): Promise<RequestDetail> {
    const response = await this.post(as, '/v1/requests', body);
    expect(response.status(), 'create request').toBe(201);
    return ((await response.json()) as CreateRequestResponse).request;
  }

  async decide(as: UserKey, id: string, body: DecisionBody): Promise<RequestDetail> {
    const response = await this.post(as, `/v1/requests/${id}/decision`, body);
    expect(response.status(), 'decide').toBe(200);
    return (await response.json()) as RequestDetail;
  }

  async cancel(as: UserKey, id: string): Promise<RequestDetail> {
    const response = await this.post(as, `/v1/requests/${id}/cancel`);
    expect(response.status(), 'cancel').toBe(200);
    return (await response.json()) as RequestDetail;
  }

  async comment(as: UserKey, id: string, body: string): Promise<void> {
    const response = await this.post(as, `/v1/requests/${id}/comments`, { body });
    expect(response.status(), 'comment').toBe(201);
  }

  // Raw access for tests that assert on the HTTP contract itself.
  async post(as: UserKey, path: string, data?: unknown) {
    return this.request.post(`${API_URL}${path}`, {
      data,
      headers: { Authorization: `Bearer ${await this.tokenFor(as)}` },
    });
  }
}
