import { test as base, expect, type Page } from '@playwright/test';
import { DashboardPage } from '../pages/DashboardPage.ts';
import { LoginPage } from '../pages/LoginPage.ts';
import { ApiClient } from './api-client.ts';
import { uniqueId } from './data.ts';
import { TOKEN_STORAGE_KEY, WEB_URL } from './env.ts';
import { users, type UserKey } from './users.ts';

interface TestFixtures {
  api: ApiClient;
  /** A short id unique to this test; put it in anything the test creates. */
  id: string;
  loginPage: LoginPage;
  /** Opens the dashboard in this test's page, already signed in as the user. */
  signInAs: (user: UserKey) => Promise<DashboardPage>;
  /** Opens the dashboard as the user in a second, separate browser context (another person). */
  dashboardAs: (user: UserKey) => Promise<DashboardPage>;
}

interface WorkerFixtures {
  tokens: Map<UserKey, string>;
}

// Starts the dashboard signed in by putting a token where the app keeps it, before any app script runs.
async function openSignedIn(page: Page, token: string, user: UserKey) {
  await page.addInitScript(({ key, value }) => window.sessionStorage.setItem(key, value), { key: TOKEN_STORAGE_KEY, value: token });
  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  await dashboard.expectSignedInAs(users[user]);
  return dashboard;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Playwright fixtures must destructure their first argument, even when they use no other fixture.
  // eslint-disable-next-line no-empty-pattern
  tokens: [async ({}, use) => use(new Map()), { scope: 'worker' }],

  api: async ({ request, tokens }, use) => use(new ApiClient(request, tokens)),

  // eslint-disable-next-line no-empty-pattern
  id: async ({}, use) => use(uniqueId()),

  loginPage: async ({ page }, use) => use(new LoginPage(page)),

  signInAs: async ({ page, api }, use) => {
    await use(async (user) => openSignedIn(page, await api.tokenFor(user), user));
  },

  dashboardAs: async ({ browser, api }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await use(async (user) => {
      const context = await browser.newContext({ baseURL: WEB_URL });
      contexts.push(context);
      return openSignedIn(await context.newPage(), await api.tokenFor(user), user);
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect };
