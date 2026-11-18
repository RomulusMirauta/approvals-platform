// Where the suite runs. By default it starts its own API and dashboard, off the default dev ports
// (3000/5173), so a dev server left running doesn't get reused or polluted by test data.
// With E2E_BASE_URL set, it tests an already deployed environment instead (a Vercel preview on the dev
// database), where the dashboard and the API share one origin.
export const REMOTE_URL = process.env.E2E_BASE_URL?.replace(/\/+$/, '');
export const API_PORT = Number(process.env.E2E_API_PORT ?? 3100);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174);
export const API_URL = REMOTE_URL ?? `http://127.0.0.1:${API_PORT}`;
export const WEB_URL = REMOTE_URL ?? `http://localhost:${WEB_PORT}`;

// Vercel protects preview deployments with a login. This header lets CI through; the second one sets a
// cookie so the page's own requests (scripts, API calls) get through too.
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
export const EXTRA_HEADERS: Record<string, string> | undefined =
  REMOTE_URL && bypass ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' } : undefined;

// The dashboard keeps its token here (apps/web/src/api.ts). Seeding it lets a test start signed in
// without going through the login form, which only the auth tests need to exercise.
export const TOKEN_STORAGE_KEY = 'approvals.token';
