const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test.describe('free trial passwordless journey', () => {
  test.use({
    viewport: { width: 375, height: 812 },
    serviceWorkers: 'block',
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('cc_cookie_consent')) {
        localStorage.setItem('cc_cookie_consent', JSON.stringify({
          analytics: false,
          marketing: false,
          version: 2,
          timestamp: '2026-01-01T00:00:00.000Z',
        }));
      }
    });

    await page.route('**/api/slots?action=available**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          slots: {
            '2030-07-20': [{
              start_time: '10:00:00',
              end_time: '11:00:00',
              transmission_type: 'manual',
              instructor_id: 7,
              instructor_name: 'Fraser Carter',
            }],
            '2030-07-21': [{
              start_time: '15:00:00',
              end_time: '16:00:00',
              transmission_type: 'automatic',
              instructor_id: 8,
              instructor_name: 'Simon Carter',
            }],
          },
        }),
      });
    });
  });

  test('explains code sign-in and guides a missing slot back to step 1', async ({ page }) => {
    await page.goto('/free-trial.html');

    await expect(page.getByText('No password is needed')).toBeVisible();
    await expect(page.getByText('6-digit code')).toBeVisible();
    await expect(page.getByText('Your contact details are required. Course preferences are optional.')).toBeVisible();

    const submit = page.getByRole('button', { name: 'Choose a time above' });
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveClass(/needs-slot/);

    await submit.click();
    await expect(page.getByText('Choose an available time before continuing.')).toBeVisible();
    await expect(page.getByRole('heading', { name: '1 Pick a time' })).toBeFocused();
  });

  test('shows one day of times at a time without naming instructors', async ({ page }) => {
    await page.goto('/free-trial.html');

    await expect(page.getByRole('group', { name: 'Choose a date' })).toBeVisible();
    await expect(page.getByRole('button', { name: /10:00/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /15:00/ })).toHaveCount(0);
    await expect(page.getByText(/Fraser|Simon/)).toHaveCount(0);

    await page.getByRole('button', { name: /21 July/ }).click();
    await expect(page.getByRole('button', { name: /15:00/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /10:00/ })).toHaveCount(0);
    await expect(page.getByText(/Fraser|Simon/)).toHaveCount(0);
  });

  test('shows inline field errors and submits the selected trial without auth friction', async ({ page }) => {
    let submittedPayload = null;
    await page.route('**/api/slots?action=book-free-trial', async (route) => {
      submittedPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, booking_id: 91, redirect_url: '/free-trial-success.html' }),
      });
    });

    await page.goto('/free-trial.html');
    await expect(page.getByRole('group', { name: 'Choose a date' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Fraser/i })).toHaveCount(0);
    await expect(page.getByText('Fraser Carter')).toHaveCount(0);
    await page.getByRole('button', { name: /10:00/ }).click();

    const submit = page.getByRole('button', { name: 'Book my free trial' });
    await expect(submit).toBeEnabled();
    await expect(submit).not.toHaveClass(/needs-slot/);
    await expect(page.locator('#slotSelectionError')).toBeEmpty();
    await expect(page.locator('#summaryBar')).not.toContainText('Fraser');

    await submit.click();
    await expect(page.locator('#guest_name_error')).toHaveText('Enter your full name.');
    await expect(page.locator('#guest_email_error')).toHaveText('Enter your email address.');
    await expect(page.locator('#guest_phone_error')).toHaveText('Enter your UK mobile number.');
    await expect(page.locator('#guest_pickup_address_error')).toHaveText('Enter your pickup address.');
    await expect(page.locator('#guest_name')).toBeFocused();
    await expect(page.locator('#guest_name')).toHaveAttribute('aria-invalid', 'true');

    await page.locator('#guest_name').fill('Alex Driver');
    await page.locator('#guest_email').fill('alex@example.test');
    await page.locator('#guest_phone').fill('07123 456 789');
    await page.locator('#guest_pickup_address').fill('24 Station Road, RG1 1AA');

    await submit.click();
    await expect(page).toHaveURL(/\/free-trial-success(?:\.html)?$/);
    expect(submittedPayload).toMatchObject({
      instructor_id: 7,
      guest_name: 'Alex Driver',
      guest_email: 'alex@example.test',
      guest_phone: '07123 456 789',
      guest_pickup_address: '24 Station Road, RG1 1AA',
    });
  });

  test('records one consented Meta Lead only after the booking is confirmed', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cc_cookie_consent', JSON.stringify({
        analytics: false,
        marketing: true,
        version: 2,
        timestamp: '2026-09-14T00:00:00.000Z',
      }));
    });
    await page.route('https://connect.facebook.net/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '',
    }));
    await page.route('**/api/slots?action=book-free-trial', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, booking_id: 92, redirect_url: '/free-trial-success.html' }),
    }));

    await page.goto('/free-trial.html');

    await page.getByRole('button', { name: /10:00/ }).click();
    await page.locator('#guest_name').fill('Alex Driver');
    await page.locator('#guest_email').fill('alex@example.test');
    await page.locator('#guest_phone').fill('07123 456 789');
    await page.locator('#guest_pickup_address').fill('24 Station Road, RG1 1AA');
    await page.getByRole('button', { name: 'Book my free trial' }).click();

    await expect(page).toHaveURL(/\/free-trial-success(?:\.html)?$/);
    await expect.poll(() => page.evaluate(() => Boolean(
      window.fbq && window.fbq.queue.some((args) => Array.from(args).join('|') === 'track|Lead')
    ))).toBe(true);
    const firstQueue = await page.evaluate(() => window.fbq && window.fbq.queue.map((args) => Array.from(args)));
    expect(firstQueue).toContainEqual(['track', 'Lead']);
    expect(await page.evaluate(() => sessionStorage.getItem('cc_meta_lead_pending'))).toBeNull();

    await page.reload();
    const reloadQueue = await page.evaluate(() => window.fbq && window.fbq.queue.map((args) => Array.from(args)));
    expect(reloadQueue).not.toContainEqual(['track', 'Lead']);
  });

  test('keeps every confirmation surface consistent with six-digit code sign-in', () => {
    const form = read('public/free-trial.html');
    const success = read('public/free-trial-success.html');
    const slotsApi = read('api/slots.js');

    expect(form).not.toContain('sign-in link');
    expect(success).not.toContain('one-click sign-in link');
    expect(success).toContain('6-digit code');
    expect(slotsApi).toContain('use learner sign-in and request a 6-digit code');
  });

  test('publishes the booking flow at /free and redirects the legacy URL', () => {
    const vercelConfig = JSON.parse(read('vercel.json'));
    const form = read('public/free-trial.html');
    const sitemap = read('public/sitemap.xml');

    expect(vercelConfig.rewrites).toContainEqual({
      source: '/free',
      destination: '/free-trial.html',
    });
    expect(vercelConfig.redirects).toContainEqual({
      source: '/free-trial.html',
      destination: '/free',
      permanent: true,
    });
    expect(form).toContain('<link rel="canonical" href="https://www.coachcarter.uk/free">');
    expect(sitemap).toContain('<loc>https://www.coachcarter.uk/free</loc>');
  });
});
