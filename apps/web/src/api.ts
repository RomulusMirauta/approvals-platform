import type {
  Comment,
  CreateRequestBody,
  CreateRequestResponse,
  DecisionBody,
  ListRequestsQuery,
  LoginResponse,
  Problem,
  RequestDetail,
  RequestPage,
  Stats,
  Tag,
  User,
} from '@approvals/contracts';

// The token lives in memory and is mirrored to sessionStorage so a page reload keeps you signed in.
// sessionStorage is scoped to the tab and cleared when it closes, so the token lingers less than in
// localStorage. Like localStorage it is readable by any script on the page, so an XSS bug could leak it;
// an httpOnly cookie would avoid that, but needs CSRF protection and cookie auth on the API, which
// uses Bearer tokens so that agents can call it too.
const TOKEN_KEY = 'approvals.token';
let token: string | null = sessionStorage.getItem(TOKEN_KEY);

export function getToken() {
  return token;
}

export function setToken(value: string | null) {
  token = value;
  if (value) sessionStorage.setItem(TOKEN_KEY, value);
  else sessionStorage.removeItem(TOKEN_KEY);
}

// The app registers a handler that sends the user back to the login screen when the token expires.
let onUnauthorized = () => {};
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

export type FieldError = { path: string; message: string };

export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
  readonly fieldErrors: FieldError[];

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.status = problem.status;
    this.title = problem.title;
    this.detail = problem.detail;
    this.fieldErrors = problem.errors ?? [];
  }
}

// Where the API lives. Empty by default, so paths stay relative (/v1/...) and the Vite dev server proxies
// them. Set VITE_API_URL at build time (for example https://api.example.com) when the dashboard and the
// API are deployed on different origins. A trailing slash is dropped so the paths join cleanly.
const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.ok) return (await response.json()) as T;

  // A 401 on an authenticated call means the session is over. A 401 from the login form itself
  // (no token yet) is just a wrong password and is shown on the form.
  if (response.status === 401 && token) {
    setToken(null);
    onUnauthorized();
  }
  throw new ApiError(await readProblem(response));
}

// Errors are RFC 9457 problem details, but a proxy or a crash can still return something else.
async function readProblem(response: Response): Promise<Problem> {
  const fallback = { type: 'about:blank', title: response.statusText || 'Request failed', status: response.status };
  try {
    const body = (await response.json()) as Partial<Problem>;
    return typeof body.title === 'string' ? { ...fallback, ...body } : fallback;
  } catch {
    return fallback;
  }
}

function toQueryString(query: ListRequestsQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>('POST', '/v1/auth/login', { email, password }),
  me: () => request<User>('GET', '/v1/me'),
  listRequests: (query: ListRequestsQuery) => request<RequestPage>('GET', `/v1/requests?${toQueryString(query)}`),
  getRequest: (id: string) => request<RequestDetail>('GET', `/v1/requests/${id}`),
  createRequest: (body: CreateRequestBody) => request<CreateRequestResponse>('POST', '/v1/requests', body),
  decide: (id: string, body: DecisionBody) => request<RequestDetail>('POST', `/v1/requests/${id}/decision`, body),
  cancel: (id: string) => request<RequestDetail>('POST', `/v1/requests/${id}/cancel`),
  addComment: (id: string, body: string) => request<Comment>('POST', `/v1/requests/${id}/comments`, { body }),
  tags: () => request<Tag[]>('GET', '/v1/tags'),
  stats: () => request<Stats>('GET', '/v1/stats'),
};
