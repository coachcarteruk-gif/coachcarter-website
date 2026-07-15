// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const learnerAuthScript = fs.readFileSync(
  path.join(repoRoot, 'public', 'shared', 'learner-auth.js'),
  'utf8'
);

test.describe('learner login recovery', () => {
  test.use({
    viewport: { width: 375, height: 812 },
    serviceWorkers: 'block',
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cc_cookie_consent', JSON.stringify({
        analytics: false,
        version: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
      }));
    });
  });

  test('a genuine guest 401 does not show a signed-out prompt', async ({ page }) => {
    await page.route('**/api/guest-probe', (route) => route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unauthorised' }),
    }));
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.addScriptTag({ content: learnerAuthScript });

    await page.evaluate(() => window.ccAuth.fetchAuthed('/api/guest-probe'));

    await expect(page.getByRole('dialog').filter({ hasText: 'Sign in again' })).toHaveCount(0);
  });

  test('a previously signed-in learner with a missing cookie gets a precise sign-in prompt', async ({ page }) => {
    await page.route('**/api/guest-probe', (route) => route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unauthorised' }),
    }));
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('cc_learner', JSON.stringify({ user: { id: 7, name: 'Test Learner' } }));
    });
    await page.addScriptTag({ content: learnerAuthScript });

    await page.evaluate(() => window.ccAuth.fetchAuthed('/api/guest-probe'));

    const dialog = page.getByRole('dialog').filter({ hasText: 'Sign in again' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Sign in again');
    await expect(dialog).toContainText("couldn't confirm an active sign-in");
    await expect.poll(() => page.evaluate(() => localStorage.getItem('cc_learner'))).toBeNull();
  });

  test('an offline learner can reveal and submit the existing account form', async ({ page }) => {
    let signupPayload;
    await page.route('**/api/learner-auth?action=signup', async (route) => {
      signupPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          user: { id: 42, name: 'Alex Rider', email: 'alex@example.test', school_id: 1 },
          is_new_user: true,
          needs_name: false,
          terms_accepted: false,
        }),
      });
    });
    await page.goto('/learner/login.html');

    await page.getByRole('button', { name: 'Already had a lesson or trial? Create your learner account' }).click();
    await expect(page.locator('#signup-form')).toBeVisible();
    await expect(page.locator('#signin-form')).toBeHidden();

    await page.locator('#signup-name').fill('Alex Rider');
    await page.locator('#signup-email').fill('alex@example.test');
    await page.locator('#signup-password').fill('safe-password-123');
    await page.locator('#signup-btn').click();

    await expect(page.locator('#screen-terms')).toHaveClass(/active/);
    expect(signupPayload).toMatchObject({
      name: 'Alex Rider',
      email: 'alex@example.test',
      password: 'safe-password-123',
    });
  });

  test('unknown-email code screen uses privacy-safe copy and offers account creation', async ({ page }) => {
    await page.route('**/api/magic-link?action=send-email-code', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'If that email matches an account, a code has been sent.' }),
    }));
    await page.goto('/learner/login.html');
    await page.locator('#signin-email').fill('offline@example.test');
    await page.locator('#signin-btn').click();

    await expect(page.locator('#screen-migration-code')).toHaveClass(/active/);
    await expect(page.locator('#migration-sub')).toContainText('If this email belongs to an existing account');
    await expect(page.locator('#migration-account-recovery')).toBeVisible();

    await page.locator('#btn-code-offline-signup').click();
    await expect(page.locator('#signup-form')).toBeVisible();
    await expect(page.locator('#signup-email')).toHaveValue('offline@example.test');
  });

  test('a failed email-code resend shows an error and restores the retry button', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/magic-link?action=send-email-code', (route) => {
      requests += 1;
      return route.fulfill({
        status: requests === 1 ? 200 : 503,
        contentType: 'application/json',
        body: JSON.stringify(requests === 1
          ? { success: true }
          : { error: 'delivery_unavailable', message: 'Email service is temporarily unavailable.' }),
      });
    });
    await page.goto('/learner/login.html');
    await page.locator('#signin-email').fill('learner@example.test');
    await page.locator('#signin-btn').click();
    await page.locator('#migration-resend-btn').click();

    await expect(page.locator('#migration-code-error')).toContainText('Email service is temporarily unavailable.');
    await expect(page.locator('#migration-resend-btn')).toBeEnabled();
    await expect(page.locator('#migration-resend-btn')).toHaveText("Didn't get it? Send again");
  });

  test('account-recovery controls stay touch-friendly without horizontal overflow', async ({ page }) => {
    await page.goto('/learner/login.html');

    const recoveryButton = page.locator('#btn-offline-signup');
    const recoveryBox = await recoveryButton.boundingBox();
    expect(recoveryBox && recoveryBox.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await recoveryButton.click();
    await page.setViewportSize({ width: 812, height: 375 });
    await expect(page.locator('#signup-form')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const backBox = await page.locator('#btn-back-from-signup').boundingBox();
    expect(backBox && backBox.height).toBeGreaterThanOrEqual(44);
  });
});
