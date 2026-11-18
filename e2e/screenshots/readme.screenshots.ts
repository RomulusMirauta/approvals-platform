// Saves the README screenshots to docs/screenshots. Not part of the suite; run it on demand:
//   npm run screenshots
// It expects the freshly seeded demo data, so run it on its own (it starts its own servers).
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { DashboardPage } from '../pages/DashboardPage.ts';
import { expect, test } from '../support/fixtures.ts';

const outDir = fileURLToPath(new URL('../../docs/screenshots/', import.meta.url));

// Lets the list settle (no refetch in flight) before taking the picture.
async function capture(page: Page, name: string) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.screenshot({ path: `${outDir}${name}.png`, animations: 'disabled', caret: 'hide' });
}

test.describe.configure({ mode: 'serial' });

test('login', async ({ page, loginPage }) => {
  await loginPage.goto();
  await loginPage.demoAccount('bob@example.com').click();
  // Move the pointer off the button so it isn't captured in its hover state.
  await page.mouse.move(0, 0);
  await capture(page, 'login');
});

test('exception queue', async ({ page, signInAs }) => {
  const dashboard: DashboardPage = await signInAs('bob');
  await expect(dashboard.statValue('Pending')).toHaveText(/^\d+$/);
  await expect(dashboard.rows).not.toHaveCount(0);
  await capture(page, 'exception-queue');
});

test('request detail', async ({ page, signInAs }) => {
  const dashboard = await signInAs('bob');
  await dashboard.open('INV-1003: unit price 8% above PO');
  await expect(dashboard.panel.entry('Asked purchasing')).toBeVisible();
  await expect(dashboard.statValue('Pending')).toHaveText(/^\d+$/);
  await capture(page, 'request-detail');
});
