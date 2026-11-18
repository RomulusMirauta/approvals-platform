import { defineConfig, devices } from '@playwright/test';
import { API_URL, EXTRA_HEADERS, REMOTE_URL, WEB_PORT, WEB_URL } from './support/env.ts';

const isCI = !!process.env.CI;

// Same locale and time zone everywhere, so money and dates render the same on a laptop and in CI.
const browserDefaults = { ...devices['Desktop Chrome'], locale: 'en-US', timezoneId: 'Europe/Bucharest' };

export default defineConfig({
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  timeout: 15_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: WEB_URL,
    extraHTTPHeaders: EXTRA_HEADERS,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // The suite: `npm run test:e2e` from the repo root.
    { name: 'chromium', testDir: './tests', use: browserDefaults },
    // README screenshots, run on demand only: `npm run screenshots` from the repo root.
    {
      name: 'screenshots',
      testDir: './screenshots',
      testMatch: '*.screenshots.ts',
      use: { ...browserDefaults, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light' },
    },
  ],

  // Locally both servers start fresh for the run: the API on an in-memory database seeded with the demo data,
  // and the dashboard's dev server with its /v1 proxy pointed at that API. Against a deployment, nothing starts.
  webServer: REMOTE_URL ? [] : [
    {
      name: 'api',
      command: 'node --import tsx ./scripts/start-api.ts',
      url: `${API_URL}/health`,
      env: { JWT_SECRET: 'e2e-only-secret-not-for-production' },
      reuseExistingServer: !isCI,
      timeout: 60_000,
      stdout: 'pipe',
    },
    {
      name: 'web',
      command: `npm run dev -w @approvals/web -- --port ${WEB_PORT} --strictPort`,
      cwd: '..',
      url: WEB_URL,
      env: { API_URL },
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
  ],
});
