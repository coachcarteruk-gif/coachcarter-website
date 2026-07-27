const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test.describe('driving ability check booking page', () => {
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

    await page.route('**/api/lesson-types?action=list**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          lesson_types: [{
            id: 528,
            name: 'Driving Ability Check',
            slug: 'check',
            duration_minutes: 90,
            price_pence: 8250,
            active: true,
          }],
        }),
      });
    });

    await page.route('**/api/slots?action=available**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          slots: {
            '2030-07-20': [{
              start_time: '10:00:00',
              end_time: '11:30:00',
              transmission_type: 'manual',
              instructor_id: 7,
              instructor_name: 'Fraser Carter',
              request_to_book: false,
            }],
          },
        }),
      });
    });
  });

  test('presents the assessment and guides a missing slot back to step 1', async ({ page }) => {
    await page.goto('/check-my-driving');

    await expect(page.getByRole('heading', { name: /Find out where your driving really stands/ })).toBeVisible();
    await expect(page.getByText('90 minutes', { exact: true })).toBeVisible();
    await expect(page.getByText('£82.50', { exact: true })).toBeVisible();

    const submit = page.getByRole('button', { name: 'Choose a time above' });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText('Choose an available time before continuing.')).toBeVisible();
    await expect(page.getByRole('heading', { name: '1 Pick a time' })).toBeFocused();
  });

  test('validates guest details and sends the selected assessment to Stripe checkout', async ({ page }) => {
    let submittedPayload = null;
    await page.route('**/api/slots?action=checkout-slot-guest', async route => {
      submittedPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: '/stripe-checkout-test' }),
      });
    });
    await page.route('**/stripe-checkout-test', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<title>Stripe test checkout</title>',
      });
    });

    await page.goto('/check-my-driving');
    await page.getByRole('button', { name: /10:00/ }).click();

    const submit = page.getByRole('button', { name: 'Continue to secure payment • £82.50' });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.locator('#guest_name_error')).toHaveText('Enter your full name.');
    await expect(page.locator('#guest_terms_error')).toHaveText('Agree to the terms to continue.');
    await expect(page.locator('#guest_name')).toBeFocused();

    await page.locator('#guest_name').fill('Alex Driver');
    await page.locator('#guest_email').fill('alex@example.test');
    await page.locator('#guest_phone').fill('07123 456 789');
    await page.locator('#guest_pickup_address').fill('24 Station Road, RG1 1AA');
    await page.locator('#guest_terms').check();
    await submit.click();

    await expect(page).toHaveURL(/\/stripe-checkout-test$/);
    expect(submittedPayload).toMatchObject({
      instructor_id: 7,
      lesson_type_id: 528,
      date: '2030-07-20',
      start_time: '10:00:00',
      end_time: '11:30:00',
      guest_name: 'Alex Driver',
      guest_email: 'alex@example.test',
      guest_phone: '07123 456 789',
      guest_pickup_address: '24 Station Road, RG1 1AA',
    });
  });

  test('uses Stripe card authorization for request-to-book instructors', async ({ page }) => {
    await page.unroute('**/api/slots?action=available**');
    await page.route('**/api/slots?action=available**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          slots: {
            '2030-07-20': [{
              start_time: '10:00:00',
              end_time: '11:30:00',
              transmission_type: 'manual',
              instructor_id: 7,
              instructor_name: 'Fraser Carter',
              request_to_book: true,
            }],
          },
        }),
      });
    });

    let submittedPayload = null;
    await page.route('**/api/slots?action=checkout-request', async route => {
      submittedPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, url: '/stripe-request-test' }),
      });
    });
    await page.route('**/stripe-request-test', async route => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Stripe request</title>' });
    });

    await page.goto('/check-my-driving');
    await page.getByRole('button', { name: /10:00/ }).click();
    await expect(page.locator('#summaryBar')).toContainText(
      'Your card will only be charged if the instructor accepts your request.'
    );

    await page.locator('#guest_name').fill('Alex Driver');
    await page.locator('#guest_email').fill('alex@example.test');
    await page.locator('#guest_phone').fill('07123 456 789');
    await page.locator('#guest_pickup_address').fill('24 Station Road, RG1 1AA');
    await page.locator('#guest_terms').check();
    await page.getByRole('button', { name: 'Secure my request • £82.50' }).click();

    await expect(page).toHaveURL(/\/stripe-request-test$/);
    expect(submittedPayload).toMatchObject({
      lesson_type_id: 528,
      pickup_address: '24 Station Road, RG1 1AA',
    });
    expect(submittedPayload).not.toHaveProperty('guest_pickup_address');
  });

  test('uses a clean route and resolves the lesson type by slug without a hardcoded id', () => {
    const config = read('vercel.json');
    const page = read('public/check-my-driving.html');
    const script = read('public/check-my-driving.js');

    expect(config).toContain(
      '{ "source": "/check-my-driving", "destination": "/check-my-driving.html" }'
    );
    expect(page).toContain('https://coachcarter.uk/check-my-driving');
    expect(page).toContain('/cookie-consent.js');
    expect(page).toContain('/posthog-loader.js');
    expect(page).toContain('/sidebar.js');
    expect(page).toContain('/shared/branding.js');
    expect(script).toContain("var LESSON_TYPE_SLUG = 'check';");
    expect(script).toContain('lesson_type_slug=');
    expect(script).not.toContain('lesson_type_id=528');
    expect(script).not.toContain('price_pence: 8250');
  });
});
