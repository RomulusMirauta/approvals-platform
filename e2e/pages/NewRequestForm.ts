import type { Locator, Page } from '@playwright/test';

export interface NewRequestInput {
  title: string;
  type?: 'Purchase' | 'Access' | 'Invoice exception' | 'Other';
  priority?: 'Low' | 'Normal' | 'High';
  description?: string;
  amount?: string;
  currency?: string;
  tags?: string[];
}

export class NewRequestForm {
  readonly root: Locator;
  readonly createButton: Locator;

  constructor(page: Page) {
    this.root = page.getByRole('form', { name: 'New request' });
    this.createButton = this.root.getByRole('button', { name: 'Create request' });
  }

  async create(input: NewRequestInput) {
    const form = this.root;
    await form.getByLabel('Title').fill(input.title);
    if (input.type) await form.getByLabel('Type').selectOption({ label: input.type });
    if (input.priority) await form.getByLabel('Priority').selectOption({ label: input.priority });
    if (input.description) await form.getByLabel('Description').fill(input.description);
    if (input.amount) await form.getByLabel('Amount (optional)').fill(input.amount);
    if (input.currency) await form.getByLabel('Currency').fill(input.currency);
    if (input.tags) await form.getByLabel('Tags, separated by commas').fill(input.tags.join(', '));
    await this.createButton.click();
  }
}
