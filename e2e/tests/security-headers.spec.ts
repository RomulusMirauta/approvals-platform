import { DashboardPage } from '../pages/DashboardPage.ts';
import { REMOTE_URL } from '../support/env.ts';
import { expect, test } from '../support/fixtures.ts';
import { DEMO_PASSWORD, users } from '../support/users.ts';

// vercel.json sends these with the dashboard's static files. The API sends its own (helmet), and /docs relaxes
// its CSP to load Swagger UI from a CDN, so vercel.json leaves those routes alone.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

test.describe('Security headers', () => {
  test.skip(!REMOTE_URL, 'The headers come from vercel.json, which the Vite dev server ignores: set E2E_BASE_URL to a deployment');

  test('the dashboard is served with them', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.headers()).toMatchObject({
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'cross-origin-opener-policy': 'same-origin',
    });
  });

  test('the API and /docs keep their own CSP', async ({ request }) => {
    // script-src-attr is in helmet's default policy and not in the dashboard's.
    const health = await request.get('/health');
    expect(health.headers()['content-security-policy']).toContain("script-src-attr 'none'");

    const docs = await request.get('/docs');
    expect(docs.headers()['content-security-policy']).toContain('https://cdn.jsdelivr.net');
  });

  test('the dashboard loads and signs in without CSP violations', async ({ page, loginPage }) => {
    // The browser reports a blocked script, style or request as a securitypolicyviolation event on the page.
    // Logging it as a console error lets one listener collect those and any other errors.
    await page.addInitScript(() =>
      document.addEventListener('securitypolicyviolation', (event) =>
        console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI}`),
      ),
    );
    const errors: string[] = [];
    page.on('console', (message) => {
      // Vercel can inject its toolbar (vercel.live) into preview deployments; it isn't part of the app.
      if (message.type() === 'error' && !message.text().includes('vercel.live')) errors.push(message.text());
    });

    // Signing in exercises script-src and style-src (the bundle) and connect-src (the API calls).
    await loginPage.goto();
    await loginPage.signIn(users.bob.email, DEMO_PASSWORD);
    const dashboard = new DashboardPage(page);
    await dashboard.expectSignedInAs(users.bob);
    await dashboard.stat('Pending');

    expect(errors).toEqual([]);
  });
});
