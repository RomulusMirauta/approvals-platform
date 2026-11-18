import type { Locator, Page } from '@playwright/test';

const STATUS = /^(Pending|Approved|Rejected|Cancelled)$/;

// The details panel that opens next to the list when a request is selected.
export class RequestPanel {
  readonly root: Locator;
  readonly title: Locator;
  readonly status: Locator;
  readonly alert: Locator;

  readonly decisionComment: Locator;
  readonly approveButton: Locator;
  readonly rejectButton: Locator;
  readonly cancelRequestButton: Locator;

  readonly newComment: Locator;
  readonly commentButton: Locator;

  constructor(page: Page) {
    this.root = page.getByRole('complementary', { name: 'Request details' });
    this.title = this.root.getByRole('heading', { level: 2 });
    // The only element in the panel whose whole text is a status is the badge next to the title.
    this.status = this.root.getByText(STATUS);
    this.alert = this.root.getByRole('alert');

    const decision = this.root.getByRole('region', { name: 'Decision' });
    this.decisionComment = decision.getByLabel('Comment (required to reject)');
    this.approveButton = decision.getByRole('button', { name: 'Approve' });
    this.rejectButton = decision.getByRole('button', { name: 'Reject' });
    this.cancelRequestButton = this.root.getByRole('button', { name: 'Cancel request' });

    this.newComment = this.root.getByLabel('Add a comment');
    this.commentButton = this.root.getByRole('button', { name: 'Comment', exact: true });
  }

  // An entry in the decision history or the comment thread, e.g. "Rejected by Bob Ionescu".
  entry(text: string): Locator {
    return this.root.getByRole('listitem').filter({ hasText: text });
  }

  async approve(comment = '') {
    if (comment) await this.decisionComment.fill(comment);
    await this.approveButton.click();
  }

  async reject(comment: string) {
    await this.decisionComment.fill(comment);
    await this.rejectButton.click();
  }

  async addComment(body: string) {
    await this.newComment.fill(body);
    await this.commentButton.click();
  }
}
