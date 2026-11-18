import { purchaseRequest } from '../support/data.ts';
import { expect, test } from '../support/fixtures.ts';

test('filters and search narrow the request list', async ({ api, id, signInAs }) => {
  // Three of Alice's requests share this test's id, so the search alone isolates them from everything else.
  const tag = `e2e-${id}`;
  const monitor = await api.createRequest('alice', purchaseRequest(id, { title: `Monitor ${id}`, priority: 'high', tags: [tag] }));
  const vpn = await api.createRequest('alice', { title: `VPN access ${id}`, type: 'access', tags: [tag] });
  const course = await api.createRequest('alice', { title: `Playwright course ${id}`, type: 'other', priority: 'low' });
  await api.cancel('alice', course.id);

  const dashboard = await signInAs('alice');
  const { filters } = dashboard;

  await filters.searchFor(id);
  await expect(dashboard.rows).toHaveCount(3);
  await expect(dashboard.pagination).toContainText('3 requests');

  await filters.type.selectOption({ label: 'Access' });
  await expect(dashboard.rows).toHaveCount(1);
  await expect(dashboard.row(vpn.title)).toBeVisible();

  await filters.type.selectOption({ label: 'Any' });
  await filters.priority.selectOption({ label: 'High' });
  await expect(dashboard.rows).toHaveCount(1);
  await expect(dashboard.row(monitor.title)).toBeVisible();

  await filters.priority.selectOption({ label: 'Any' });
  await filters.status.selectOption({ label: 'Cancelled' });
  await expect(dashboard.rows).toHaveCount(1);
  await expect(dashboard.row(course.title)).toBeVisible();

  // The tag filter works on its own, without the search.
  await filters.status.selectOption({ label: 'Any' });
  await filters.searchFor('');
  await filters.tag.selectOption(tag);
  await expect(dashboard.rows).toHaveCount(2);
  await expect(dashboard.row(monitor.title)).toBeVisible();
  await expect(dashboard.row(vpn.title)).toBeVisible();

  // A search that matches nothing says so.
  await filters.tag.selectOption({ label: 'Any' });
  await filters.searchFor(`no-such-request-${id}`);
  await expect(dashboard.rows).toHaveCount(0);
  await expect(dashboard.requestList).toContainText('Nothing here.');
});
