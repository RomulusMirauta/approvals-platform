import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { invoiceException } from '../support/data.ts';
import { expect, test } from '../support/fixtures.ts';

// WCAG 2.1 levels A and AA: what accessibility laws and procurement rules usually ask for.
const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// axe rates each violation minor, moderate, serious or critical. The build fails on the last two, which block
// or seriously hinder someone (no accessible name, unreadable contrast); the rest are listed in the report.
const BLOCKING = ['serious', 'critical'];

async function scan(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_21_AA).analyze();
  // The summary goes into the report, so a failure says which rule broke where without re-running it.
  const summary = violations.map(({ id, impact, help, nodes }) => ({ id, impact, help, targets: nodes.map((node) => node.target) }));
  await test.info().attach('axe violations', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
  return summary.filter((violation) => BLOCKING.includes(violation.impact ?? ''));
}

test.describe('Accessibility (axe, WCAG 2.1 AA)', () => {
  test('sign-in page', async ({ loginPage, page }) => {
    await loginPage.goto();
    await expect(loginPage.signInButton).toBeVisible();

    expect(await scan(page)).toEqual([]);
  });

  test('exception queue', async ({ api, id, signInAs, page }) => {
    const invoice = await api.createRequest('agent', invoiceException(id));
    const dashboard = await signInAs('bob');
    await expect(dashboard.row(invoice.title)).toBeVisible();
    // The tiles show a dash until the stats load; scan the finished page.
    await dashboard.stat('Pending');

    expect(await scan(page)).toEqual([]);
  });

  test('open request panel', async ({ api, id, signInAs, page }) => {
    const invoice = await api.createRequest('agent', invoiceException(id));
    await api.comment('bob', invoice.id, 'Asked purchasing about the new price list.');
    const dashboard = await signInAs('bob');
    await dashboard.open(invoice.title);
    await expect(dashboard.panel.entry('Asked purchasing')).toBeVisible();

    expect(await scan(page)).toEqual([]);
  });
});
