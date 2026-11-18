import { purchaseRequest } from '../support/data.ts';
import { expect, test } from '../support/fixtures.ts';

test('requester and approver discuss a request in its comment thread', async ({ api, id, dashboardAs }) => {
  const request = await api.createRequest('alice', purchaseRequest(id));
  const question = `Is the EUR price final? (${id})`;
  const answer = `Yes, the quote is valid until Friday. (${id})`;

  // Bob asks in his own browser...
  const bob = await dashboardAs('bob');
  await bob.showAllRequests();
  await bob.filters.searchFor(id);
  await bob.open(request.title);
  await expect(bob.panel.root).toContainText('No comments yet.');
  await expect(bob.panel.commentButton).toBeDisabled();

  await bob.panel.addComment(question);

  await expect(bob.panel.entry(question)).toContainText('Bob Ionescu');
  await expect(bob.panel.newComment).toHaveValue('');

  // ...and Alice, signed in separately, sees the question and answers.
  const alice = await dashboardAs('alice');
  await alice.filters.searchFor(id);
  await alice.open(request.title);
  await expect(alice.panel.entry(question)).toBeVisible();

  await alice.panel.addComment(answer);

  await expect(alice.panel.entry(answer)).toContainText('Alice Popescu');
  await expect(alice.panel.root.getByRole('listitem')).toHaveCount(2);
});
