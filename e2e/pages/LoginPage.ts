import type { Locator, Page } from '@playwright/test';

export class LoginPage {
  readonly heading: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly signInButton: Locator;
  readonly error: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Approvals', level: 1 });
    this.email = page.getByLabel('Email');
    this.password = page.getByLabel('Password');
    this.signInButton = page.getByRole('button', { name: 'Sign in' });
    this.error = page.getByRole('alert');
  }

  async goto() {
    await this.page.goto('/');
  }

  async signIn(email: string, password: string) {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.signInButton.click();
  }

  demoAccount(email: string): Locator {
    return this.page.getByRole('group', { name: 'Demo accounts' }).getByRole('button', { name: email });
  }
}
