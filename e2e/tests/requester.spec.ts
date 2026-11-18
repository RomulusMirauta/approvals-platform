import { purchaseRequest } from '../support/data.ts';
import { expect, test } from '../support/fixtures.ts';
import { users } from '../support/users.ts';

test.describe('Requester', () => {
  test('creates a request, sees it, and cannot decide on it', async ({ id, signInAs }) => {
    const title = `Standing desk for the QA lab ${id}`;
    const dashboard = await signInAs('alice');

    await dashboard.newRequestButton.click();
    await dashboard.newRequestForm.create({
      title,
      type: 'Purchase',
      priority: 'High',
      description: 'Two desks, height adjustable.',
      amount: '1250.50',
      currency: 'EUR',
      tags: ['office', `e2e-${id}`],
    });

    // The new request opens straight away and shows up in the list.
    await expect(dashboard.newRequestForm.root).toBeHidden();
    await expect(dashboard.panel.title).toHaveText(title);
    await expect(dashboard.panel.status).toHaveText('Pending');
    await expect(dashboard.panel.root).toContainText(`${users.alice.name},`);
    await expect(dashboard.panel.root).toContainText('€1,250.50');
    await expect(dashboard.panel.root).toContainText(`#e2e-${id}`);
    await expect(dashboard.row(title)).toBeVisible();

    // Nobody decides on their own request, and requesters can't decide at all.
    await expect(dashboard.panel.approveButton).toBeHidden();
    await expect(dashboard.panel.rejectButton).toBeHidden();
    await expect(dashboard.panel.cancelRequestButton).toBeVisible();
  });

  test('only sees their own requests', async ({ api, id, signInAs }) => {
    const own = await api.createRequest('alice', purchaseRequest(`${id}-own`));
    const someoneElses = await api.createRequest('carol', purchaseRequest(`${id}-carol`));

    const dashboard = await signInAs('alice');
    await dashboard.filters.searchFor(id);

    await expect(dashboard.row(own.title)).toBeVisible();
    await expect(dashboard.row(someoneElses.title)).toBeHidden();
    await expect(dashboard.rows).toHaveCount(1);
  });

  test('cancels their own pending request', async ({ api, id, signInAs }) => {
    const request = await api.createRequest('alice', purchaseRequest(id));
    const dashboard = await signInAs('alice');

    await dashboard.filters.searchFor(id);
    await dashboard.open(request.title);
    await dashboard.panel.cancelRequestButton.click();

    await expect(dashboard.panel.status).toHaveText('Cancelled');
    await expect(dashboard.panel.cancelRequestButton).toBeHidden();
    await expect(dashboard.row(request.title)).toContainText('Cancelled');
  });

  test('the form checks the title before sending', async ({ signInAs }) => {
    const dashboard = await signInAs('alice');
    await dashboard.newRequestButton.click();

    await dashboard.newRequestForm.create({ title: 'ab' });

    await expect(dashboard.newRequestForm.root).toBeVisible();
    await expect(dashboard.newRequestForm.root.getByText(/at least 3|>=3/)).toBeVisible();
  });
});
