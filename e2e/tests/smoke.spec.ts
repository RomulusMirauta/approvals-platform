import { DashboardPage } from '../pages/DashboardPage.ts';
import { API_URL } from '../support/env.ts';
import { expect, test } from '../support/fixtures.ts';
import { DEMO_PASSWORD, users } from '../support/users.ts';

// The smoke subset: `npm run smoke -w @approvals/e2e` runs only the @smoke tests. production-smoke.yml runs them
// every night against the live demo, so everything here only reads: sign in, look, open. Nothing is created,
// decided or commented, and the route below makes sure of it.
test.describe('Smoke', { tag: '@smoke' }, () => {
  const blocked: string[] = [];

  // Signing in is a POST that changes no data; any other write is stopped before it leaves the browser.
  test.beforeEach(async ({ page }) => {
    blocked.length = 0;
    await page.route('**/v1/**', async (route) => {
      const request = route.request();
      if (request.method() === 'GET' || new URL(request.url()).pathname === '/v1/auth/login') return route.fallback();
      blocked.push(`${request.method()} ${request.url()}`);
      return route.abort('blockedbyclient');
    });
  });

  test.afterEach(() => {
    expect(blocked, 'smoke tests must not write data').toEqual([]);
  });

  test('the API is up', async ({ request }) => {
    const response = await request.get(`${API_URL}/health`);

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('an approver signs in and opens an invoice from the exception queue', async ({ page, loginPage }) => {
    const dashboard = new DashboardPage(page);

    await loginPage.goto();
    await loginPage.signIn(users.bob.email, DEMO_PASSWORD);

    await dashboard.expectSignedInAs(users.bob);
    await expect(dashboard.exceptionQueueTab).toHaveAttribute('aria-pressed', 'true');
    // Production data belongs to whoever used the demo last (the nightly reset refills the queue at 03:00 UTC),
    // so the test opens whatever is first instead of a known request.
    await dashboard.rows.first().getByRole('button').click();

    await expect(dashboard.panel.title).not.toBeEmpty();
    await expect(dashboard.panel.root).toContainText('Invoice exception');
  });
});
