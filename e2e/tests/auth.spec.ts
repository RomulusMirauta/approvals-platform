import { DashboardPage } from '../pages/DashboardPage.ts';
import { expect, test } from '../support/fixtures.ts';
import { DEMO_PASSWORD, users } from '../support/users.ts';

test.describe('Sign in', () => {
  const roles = [
    { user: users.alice, landsOn: 'All requests', canCreate: true },
    { user: users.bob, landsOn: 'Exception queue', canCreate: false },
    { user: users.carol, landsOn: 'Exception queue', canCreate: true },
  ] as const;

  for (const { user, landsOn, canCreate } of roles) {
    test(`${user.role} signs in and out`, async ({ page, loginPage }) => {
      const dashboard = new DashboardPage(page);

      await loginPage.goto();
      await loginPage.signIn(user.email, DEMO_PASSWORD);

      await dashboard.expectSignedInAs(user);
      await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name: landsOn })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(dashboard.newRequestButton).toBeVisible({ visible: canCreate });

      await dashboard.signOutButton.click();
      await expect(loginPage.signInButton).toBeVisible();
      await expect(dashboard.header).toBeHidden();
    });
  }

  test('a demo account button fills in the credentials', async ({ page, loginPage }) => {
    await loginPage.goto();
    await loginPage.demoAccount(users.bob.email).click();

    await expect(loginPage.email).toHaveValue(users.bob.email);
    await expect(loginPage.password).toHaveValue(DEMO_PASSWORD);
    await loginPage.signInButton.click();
    await new DashboardPage(page).expectSignedInAs(users.bob);
  });

  test('a wrong password shows an error and keeps you on the form', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.signIn(users.bob.email, 'not-the-password');

    await expect(loginPage.error).toContainText('Wrong email or password');
    await expect(loginPage.signInButton).toBeEnabled();
    await expect(loginPage.password).toHaveValue('not-the-password');
  });

  test('the session survives a page reload', async ({ page, signInAs }) => {
    const dashboard = await signInAs('carol');

    await page.reload();

    await dashboard.expectSignedInAs(users.carol);
  });
});
