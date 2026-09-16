// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');

const shots = path.join(os.tmpdir(), 'coachcarter-pencil-review');
fs.mkdirSync(shots, { recursive: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cc_cookie_consent', JSON.stringify({
    analytics: false, marketing: false, version: 2, timestamp: new Date().toISOString()
  })));
});

async function dismissCookies(page) {
  const reject = page.getByRole('button', { name: 'Reject All' });
  if (await reject.isVisible().catch(() => false)) await reject.click();
}

test('instructor can select pencil and sends the explicit payload', async ({ page }) => {
  let submitted = null;
  await page.addInitScript(() => {
    localStorage.setItem('cc_instructor', JSON.stringify({ instructor: { id: 7, school_id: 3, name: 'Alex' } }));
  });
  await page.route('**/api/instructor**', async route => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    if (route.request().method() === 'POST' && action === 'create-offer') {
      submitted = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({ json: { ok: true, accept_url: '/accept-offer.html?token=pencil', pencilled: true } });
    }
    if (action === 'profile') return route.fulfill({ json: { instructor: { id: 7, slug: 'alex', transmission_type: 'manual' } } });
    if (action === 'school-learners') return route.fulfill({ json: { learners: [{ id: 42, name: 'Jamie Learner', email: 'jamie@example.test', is_your_learner: true }] } });
    if (action === 'lesson-types') return route.fulfill({ json: { lesson_types: [{ id: 9, name: 'Standard lesson', duration_minutes: 60, price_pence: 5000 }] } });
    return route.fulfill({ json: { availability: [], bookings: [], offers: [], requests: [] } });
  });
  await page.route('**/api/lesson-types**', route => route.fulfill({ json: { lesson_types: [{ id: 9, name: 'Standard lesson', duration_minutes: 60, price_pence: 5000 }] } }));

  await page.goto('/instructor/?add=offer');
  await dismissCookies(page);
  await page.waitForFunction(() => !!window.__ccOfferUi);
  await page.evaluate(() => { window.__ccOfferUi.open(); });
  await expect(page.locator('#offerLessonModal')).toHaveClass(/open/);
  await page.locator('#offerModeExisting').check();
  await page.locator('#offerModeExisting').dispatchEvent('change');
  await page.locator('#offerDate').fill('2026-11-20');
  await page.locator('#offerTime').fill('10:00');
  await page.locator('#offerLearnerSearch').fill('Jamie');
  await page.locator('[data-action="offer-select-learner"]').click();
  await page.locator('#offerLessonType').selectOption('9');
  await page.locator('#offerCustomPrice').fill('50');
  await page.locator('#offerPencilled').check();
  await expect(page.getByText('Pencil this slot in')).toBeVisible();
  await page.screenshot({ path: path.join(shots, 'pencilled-instructor.png'), fullPage: true });
  await page.locator('#offerSendBtn').click();
  await expect.poll(() => submitted).not.toBeNull();
  expect(submitted).toMatchObject({ learner_id: 42, pencilled: true, scheduled_date: '2026-11-20', start_time: '10:00', offer_price_pence: 5000 });
});

test('learner sees, can pay, and can cancel an unpaid pencil', async ({ page }) => {
  let cancelled = null;
  await page.addInitScript(() => {
    localStorage.setItem('cc_learner', JSON.stringify({ learner: { id: 42, school_id: 3, name: 'Jamie' } }));
  });
  await page.route('**/api/slots?action=my-bookings**', route => route.fulfill({ json: { upcoming: [], past: [], hasMorePast: false } }));
  await page.route('**/api/offers?action=my-pencilled-offers**', route => route.fulfill({ json: { offers: [{
    id: 81, scheduled_date: '2026-11-20', start_time: '10:00:00', end_time: '11:00:00',
    instructor_name: 'Alex Carter', offer_price_pence: 5000, pay_by: '2026-11-18T10:00:00.000Z', payment_url: '/accept-offer.html?token=pencil'
  }] } }));
  await page.route('**/api/offers?action=cancel-pencilled-offer', async route => {
    cancelled = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ json: { ok: true } });
  });
  page.on('dialog', dialog => dialog.accept());

  await page.goto('/learner/lessons.html');
  await dismissCookies(page);
  await expect(page.getByText('Pencilled in · unpaid')).toBeVisible();
  await expect(page.getByText(/Pay by/)).toBeVisible();
  await expect(page.getByText('Agreed price: £50.00')).toBeVisible();
  await page.screenshot({ path: path.join(shots, 'pencilled-learner.png'), fullPage: true });
  await expect(page.getByRole('button', { name: 'Pay now' })).toHaveAttribute('data-url', '/accept-offer.html?token=pencil');
  await page.locator('#lessonContent [data-action="cancel-pencilled"]').click();
  await expect.poll(() => cancelled).toEqual({ offer_id: 81 });
  await expect(page.getByText('Pencilled in · unpaid')).toHaveCount(0);
});

test('accept page renders discounted price and hard pay-by deadline', async ({ page }) => {
  await page.route('**/api/offers?action=get-offer**', route => route.fulfill({ json: { offer: {
    id: 81, token: 'pencil', pencilled: true, learner_id: 42, learner_name: 'Jamie Learner', learner_email: 'jamie@example.test',
    instructor_name: 'Alex Carter', lesson_type_name: 'Standard lesson', duration_minutes: 60,
    scheduled_date: '2026-11-20', start_time: '10:00:00', end_time: '11:00:00',
    original_price_pence: 5000, price_pence: 4500, expires_at: '2026-11-18T10:00:00.000Z',
    post_trial_discount_pct: 10, post_trial_eligible_until: '2026-10-01T10:00:00.000Z',
    max_repeat_weeks: 1, is_flexible: false, is_extension: false
  } } }));
  await page.goto('/accept-offer?token=pencil');
  await dismissCookies(page);
  await expect(page.locator('#page-title')).toHaveText('Your pencilled-in lesson');
  await expect(page.locator('#offer-price')).toContainText('£45.00');
  await expect(page.locator('#pay-by-exact')).toContainText('Pay by');
  await expect(page.locator('#expiry-text')).toContainText('Time remaining:');
  await expect(page.locator('#accept-btn')).toContainText('Pay for pencilled lesson');
  await expect(page.locator('#post-trial-discount-note')).toContainText('10% post-trial discount available until');
  await page.screenshot({ path: path.join(shots, 'pencilled-accept.png'), fullPage: true });
});
