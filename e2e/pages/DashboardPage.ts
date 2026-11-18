import { expect, type Locator, type Page } from '@playwright/test';
import type { DemoUser } from '../support/users.ts';
import { NewRequestForm } from './NewRequestForm.ts';
import { RequestPanel } from './RequestPanel.ts';

export type StatLabel = 'Pending' | 'High priority pending' | 'Approved' | 'Rejected';

export class RequestFilters {
  readonly root: Locator;
  readonly status: Locator;
  readonly type: Locator;
  readonly priority: Locator;
  readonly tag: Locator;
  readonly search: Locator;

  constructor(page: Page) {
    this.root = page.getByRole('search');
    this.status = this.root.getByLabel('Status');
    this.type = this.root.getByLabel('Type');
    this.priority = this.root.getByLabel('Priority');
    this.tag = this.root.getByLabel('Tag');
    this.search = this.root.getByRole('searchbox', { name: 'Search' });
  }

  // The search box applies on Enter, not on every keystroke.
  async searchFor(text: string) {
    await this.search.fill(text);
    await this.search.press('Enter');
  }
}

export class DashboardPage {
  readonly header: Locator;
  readonly signOutButton: Locator;
  readonly summary: Locator;
  readonly exceptionQueueTab: Locator;
  readonly allRequestsTab: Locator;
  readonly newRequestButton: Locator;
  readonly requestList: Locator;
  readonly rows: Locator;
  readonly pagination: Locator;
  readonly filters: RequestFilters;
  readonly newRequestForm: NewRequestForm;
  readonly panel: RequestPanel;

  constructor(readonly page: Page) {
    this.header = page.getByRole('banner');
    this.signOutButton = this.header.getByRole('button', { name: 'Sign out' });
    this.summary = page.getByRole('region', { name: 'Summary' });
    const views = page.getByRole('group', { name: 'View' });
    this.exceptionQueueTab = views.getByRole('button', { name: 'Exception queue' });
    this.allRequestsTab = views.getByRole('button', { name: 'All requests' });
    this.newRequestButton = page.getByRole('button', { name: 'New request' });
    this.requestList = page.getByRole('region', { name: 'Requests' });
    this.rows = this.requestList.getByRole('listitem');
    this.pagination = this.requestList.getByRole('navigation', { name: 'Pages' });
    this.filters = new RequestFilters(page);
    this.newRequestForm = new NewRequestForm(page);
    this.panel = new RequestPanel(page);
  }

  async goto() {
    await this.page.goto('/');
  }

  async expectSignedInAs(user: DemoUser) {
    await expect(this.header).toContainText(user.name);
    await expect(this.header).toContainText(user.role);
  }

  // A row's accessible name holds its title, type, source and reference, so any of them finds it.
  row(text: string): Locator {
    return this.requestList.getByRole('button', { name: text });
  }

  async open(title: string) {
    await this.row(title).click();
    await expect(this.panel.title).toHaveText(title);
  }

  async showAllRequests() {
    await this.allRequestsTab.click();
    await expect(this.allRequestsTab).toHaveAttribute('aria-pressed', 'true');
  }

  // The tiles have no ARIA semantics of their own, so a tile is the element holding its exact label.
  statValue(label: StatLabel): Locator {
    return this.summary
      .locator('div')
      .filter({ has: this.page.getByText(label, { exact: true }) })
      .getByText(/^(\d+|–)$/);
  }

  // Waits until the stats have loaded (a tile shows a dash before that) and reads the number.
  async stat(label: StatLabel): Promise<number> {
    const value = this.statValue(label);
    await expect(value).toHaveText(/^\d+$/);
    return Number(await value.textContent());
  }
}
