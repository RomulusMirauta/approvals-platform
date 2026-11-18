import type { RequestDetail } from '@approvals/contracts';
import { invoiceException, purchaseRequest } from '../support/data.ts';
import { expect, test as base } from '../support/fixtures.ts';

// Every test starts with a fresh invoice exception, submitted by the ERP agent through the API.
const test = base.extend<{ invoice: RequestDetail }>({
  invoice: async ({ api, id }, use) => use(await api.createRequest('agent', invoiceException(id))),
});

// The approver's main job: work through the invoices the ERP agent escalated.
test.describe('Exception queue', () => {
  test('lists only pending invoice exceptions', async ({ api, id, invoice, signInAs }) => {
    const purchase = await api.createRequest('alice', purchaseRequest(id));
    const decided = await api.createRequest('agent', invoiceException(`${id}-done`));
    await api.decide('carol', decided.id, { decision: 'approved' });

    const dashboard = await signInAs('bob');

    await expect(dashboard.exceptionQueueTab).toHaveAttribute('aria-pressed', 'true');
    await expect(dashboard.row(invoice.title)).toBeVisible();
    await expect(dashboard.row(purchase.title)).toBeHidden();
    await expect(dashboard.row(decided.title)).toBeHidden();
  });

  test('approver approves an invoice exception', async ({ invoice, signInAs }) => {
    const dashboard = await signInAs('bob');
    const approvedBefore = await dashboard.stat('Approved');

    await dashboard.open(invoice.title);
    await expect(dashboard.panel.status).toHaveText('Pending');
    await expect(dashboard.panel.root).toContainText('PRICE_VARIANCE');
    await dashboard.panel.approve('Price increase agreed with purchasing.');

    await expect(dashboard.panel.status).toHaveText('Approved');
    await expect(dashboard.panel.entry('Approved by Bob Ionescu')).toContainText('Price increase agreed with purchasing.');
    await expect(dashboard.panel.approveButton).toBeHidden();
    // Decided requests leave the queue, and the tiles count it (other tests may approve in parallel).
    await expect(dashboard.row(invoice.title)).toBeHidden();
    await expect.poll(() => dashboard.stat('Approved')).toBeGreaterThan(approvedBefore);
  });

  test('a rejection needs a comment', async ({ invoice, signInAs }) => {
    const dashboard = await signInAs('bob');
    const rejectedBefore = await dashboard.stat('Rejected');
    await dashboard.open(invoice.title);

    await dashboard.panel.rejectButton.click();

    await expect(dashboard.panel.alert).toHaveText('A rejection needs a comment explaining why');
    await expect(dashboard.panel.decisionComment).toHaveAttribute('aria-invalid', 'true');
    await expect(dashboard.panel.status).toHaveText('Pending');

    await dashboard.panel.reject('Supplier invoiced the old price list; asked for a credit note.');

    await expect(dashboard.panel.status).toHaveText('Rejected');
    await expect(dashboard.panel.entry('Rejected by Bob Ionescu')).toContainText('asked for a credit note');
    await expect(dashboard.panel.alert).toBeHidden();
    await expect.poll(() => dashboard.stat('Rejected')).toBeGreaterThan(rejectedBefore);
  });
});
