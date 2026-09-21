const { test, expect } = require('@playwright/test');

async function fixture(page, { active = true, guest = false, request = false, single = false, credit = 0 } = {}) {
  const state = { active, checkout: null, statusReads: 0 };
  const expiry = new Date(Date.now() + 3600000).toISOString();
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const types = () => [
    { id: 1, lesson_type_id: 1, slug: 'standard', name: 'Standard lesson', duration_minutes: 90, price_pence: 8250 },
    ...single ? [] : [{ id: 2, lesson_type_id: 2, slug: '2hr', name: 'Two hours', duration_minutes: 120, price_pence: 11000 }],
  ].map(t => ({ ...t, fits: true,
    checkout_price_pence: state.active && !guest ? Math.round(t.price_pence * 0.9) : t.price_pence,
    post_trial_discount_pct: state.active && !guest ? 10 : 0,
    post_trial_eligible_until: state.active && !guest ? expiry : null,
    social_video_price_pence: Math.round(t.price_pence * 0.95),
    social_video_checkout_price_pence: state.active && !guest ? Math.round(Math.round(t.price_pence * 0.95) * 0.9) : Math.round(t.price_pence * 0.95),
  }));
  await page.addInitScript(({ guest }) => {
    if (!guest) localStorage.setItem('cc_learner', JSON.stringify({ user: { id: 42, school_id: 1, name: 'Learner' } }));
    localStorage.setItem('cc_cookie_consent', JSON.stringify({ analytics: false, marketing: false, version: 2, timestamp: new Date().toISOString() }));
  }, { guest });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    let body = {};
    if (action === 'post-trial-discount') {
      state.statusReads++;
      if (guest) return route.fulfill({ status: 401, json: { error: 'Unauthorised' } });
      body = { eligible: state.active, discountPct: state.active ? 10 : 0, eligibleUntil: state.active ? expiry : null };
    } else if (url.pathname === '/api/lesson-types') body = { lesson_types: types() };
    else if (url.pathname === '/api/instructors') body = { instructors: [{ id: 7, name: 'Alex', transmission_type: 'manual', max_booking_days_ahead: 28 }] };
    else if (action === 'balance') body = { balance_minutes: credit, selected_instructor_balance_minutes: credit, payments_enabled: true, remaining_minutes: 0 };
    else if (action === 'profile') body = { profile: { name: 'Learner', phone: '07700900123', pickup_address: '1 Test Road, SW1A 1AA' } };
    else if (action === 'available') body = { slots: { [date]: [{ date, start_time: '10:00', end_time: '11:30', instructor_id: 7, instructor_name: 'Alex', transmission_type: 'manual' }] } };
    else if (action === 'durations-for-slot') body = { durations: types(), social_video_opt_in: true, social_video_discount_pct: 5, request_to_book: request };
    else if (action === 'checkout-slot' || action === 'checkout-request') {
      state.checkout = JSON.parse(route.request().postData());
      return route.fulfill({ status: 400, json: { error: 'Fixture checkout stopped' } });
    }
    return route.fulfill({ json: body });
  });
  await page.goto('/learner/book.html');
  await expect(page.locator('#lessonLengthControls [data-lesson-type-id="1"]')).toBeVisible();
  await page.locator('[data-action="select-slot"]').first().click();
  await page.locator('[data-action="continue-selected-slot"]').click();
  await expect(page.locator('#mdLoadingRow')).toBeHidden();
  return state;
}

test('discount is visible in length choices, modal, filming price and payment button on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  const choice = page.locator('#lessonLengthControls [data-lesson-type-id="1"]');
  await expect(choice.locator('s')).toHaveText('£82.50');
  await expect(choice).toContainText('£74.25');
  await expect(choice).toContainText('10% post-trial discount');
  await expect(page.locator('#mdLessonTypeSelect option:checked')).toContainText('£74.25 (was £82.50, 10% off)');
  await expect(page.locator('#mdPostTrialSaving')).toContainText('save £8.25');
  await expect(page.locator('#payBtnLabel')).toHaveText('Pay £74.25 & book');
  await page.locator('#mdSocialVideoConsent').check();
  await expect(page.locator('#payBtnLabel')).toHaveText('Pay £70.54 & book');
  await expect(page.locator('#mdPostTrialSaving')).toContainText('save £7.84');
  await page.locator('#mdLessonTypeSelect').selectOption('2');
  await expect(page.locator('#payBtnLabel')).toHaveText('Pay £94.05 & book');
  await page.screenshot({ path: test.info().outputPath('discount-picker-mobile.png'), fullPage: true });
  await page.locator('#btnPayAndBook').click();
  await expect.poll(() => state.checkout).not.toBeNull();
  expect(state.checkout).not.toHaveProperty('price_pence');
  expect(state.checkout).not.toHaveProperty('amount_pence');
  await expect(page.locator('#payBtnLabel')).toHaveText('Pay £94.05 & book');
});

test('single available length and request-to-book show the discounted hold', async ({ page }) => {
  await fixture(page, { single: true, request: true });
  await expect(page.locator('#mdSingleType')).toContainText('£74.25 (was £82.50, 10% off)');
  await expect(page.locator('#payBtnLabel')).toHaveText('Request — hold £74.25');
  await expect(page.locator('#socialVideoOption')).toBeHidden();
});

for (const options of [{ active: false }, { guest: true }]) {
  test(`standard prices remain for ${options.guest ? 'guests' : 'ineligible learners'}`, async ({ page }) => {
    await fixture(page, options);
    await expect(page.locator('#payBtnLabel')).toHaveText('Pay £82.50 & book');
    await expect(page.locator('#mdPostTrialSaving')).toBeHidden();
    await expect(page.locator('#lessonLengthControls s')).toHaveCount(0);
  });
}

test('spending existing credit still uses the full lesson duration', async ({ page }) => {
  await fixture(page, { credit: 120 });
  await expect(page.locator('#modalPayPath')).toBeHidden();
  await expect(page.locator('#mdDeductHours')).toHaveText('1.5 hours');
});

test('an open picker refreshes when the trial ends and removes the discount when eligibility ends', async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page, { active: false });
  await expect.poll(() => state.statusReads).toBeGreaterThan(0);
  await expect(page.locator('#payBtnLabel')).toHaveText('Pay £82.50 & book');
  state.active = true;
  await page.clock.fastForward(61000);
  await expect(page.locator('#payBtnLabel')).toHaveText('Pay £74.25 & book');
  await expect(page.locator('.post-trial-discount-banner')).toHaveCount(1);
  state.active = false;
  await page.clock.fastForward(61000);
  await expect(page.locator('#payBtnLabel')).toHaveText('Pay £82.50 & book');
  await expect(page.locator('#mdPostTrialSaving')).toBeHidden();
  await expect(page.locator('.post-trial-discount-banner')).toHaveCount(0);
});
