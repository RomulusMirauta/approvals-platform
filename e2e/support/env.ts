// Where the suite runs its own API and dashboard. Off the default dev ports (3000/5173), so a dev
// server left running doesn't get reused or polluted by test data.
export const API_PORT = Number(process.env.E2E_API_PORT ?? 3100);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174);
export const API_URL = `http://127.0.0.1:${API_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;

// The dashboard keeps its token here (apps/web/src/api.ts). Seeding it lets a test start signed in
// without going through the login form, which only the auth tests need to exercise.
export const TOKEN_STORAGE_KEY = 'approvals.token';
