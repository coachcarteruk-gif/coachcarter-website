const { test, expect } = require('@playwright/test');
const { setupLearner, date } = require('./helpers/learner-clutter-fixture');

test.use({ serviceWorkers: 'block' });

test('phone dashboard prioritises the next lesson and keeps both balance scopes', async ({ page }) => {
  const requests = await setupLearner(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/learner/');
  await expect(page.locator('#nl-time')).toContainText('10:00');
  expect((await page.locator('#next-lesson-card').boundingBox()).y).toBeLessThan(220);
  await expect(page.locator('.nl-btn')).toBeInViewport();
  expect((await page.locator('.unlogged-banner-text').boundingBox()).width).toBeGreaterThan(200);
  await expect(page.locator('#curriculum-reflection-prompt')).toBeHidden();
  await expect(page.locator('#stat-balance-value')).toHaveText('8');
  await expect(page.locator('#credit-balance-line')).toHaveText('5 hrs Flexible Hours · 3 hrs Lesson Credit');
  await expect(page.locator('#profile-cta')).toBeHidden();
  await page.locator('#profile-card summary').click();
  await expect(page.locator('#profile-cta')).toBeVisible();
  expect(requests.filter(r => r.method !== 'GET')).toEqual([]);
});

test('dashboard keeps real reflection prompts and empty/guest booking paths', async ({ page }) => {
  await setupLearner(page, { reflection: true, empty: true });
  await page.goto('/learner/');
  await expect(page.locator('#next-lesson-empty')).toBeVisible();
  await expect(page.locator('#curriculum-reflection-prompt')).toContainText('Rate your last lesson');
  await page.evaluate(() => localStorage.removeItem('cc_learner'));
  // Use a separate page without the signed-in init script for the guest state.
  const guest = await page.context().newPage();
  await setupLearner(guest, { guest: true });
  await guest.goto('/learner/');
  await expect(guest.locator('#guest-dashboard-gate')).toBeVisible();
  await expect(guest.locator('.stat-row')).toBeHidden();
  await expect(guest.locator('.dashboard-link')).toBeHidden();
});

for (const width of [390, 1440]) {
  test(`booking keeps dates and validated lesson types reachable at ${width}px`, async ({ page }) => {
    const requests = await setupLearner(page, { guest: true });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto('/learner/book.html');
    await expect(page.locator('.date-cell-open').first()).toBeVisible();
    expect(await page.locator('.date-cell-open').count()).toBeLessThanOrEqual(7);
    if (width === 390) {
      const time = await page.locator('[data-action="select-slot"]').first().boundingBox();
      expect(time.y + time.height).toBeLessThan(764);
      await page.locator('#lessonLengthSelect').selectOption('3');
      await expect.poll(() => requests.some(r => r.action === 'available' && r.params.lesson_type_id === '3')).toBe(true);
    }
    await expect(page.locator('.lesson-length-name')).toHaveText(['Standard Lesson', 'Driving Ability Check']);
    if (width === 1440) {
      const dates = await page.locator('.booking-dates').boundingBox();
      const times = await page.locator('.booking-times').boundingBox();
      expect(times.x).toBeGreaterThan(dates.x + dates.width);
      expect(Math.abs(times.y - dates.y)).toBeLessThan(4);
    }
    await page.getByRole('button', { name: 'Show later dates' }).click();
    await expect(page.locator(`[data-date="${date(70)}"]`)).toBeVisible();
    await page.locator(`[data-date="${date(70)}"]`).click();
    await expect(page.locator('[data-selected-date-heading]')).toContainText('2 December');
    await page.locator('[data-action="select-slot"]').first().click();
    await page.locator('[data-action="continue-selected-slot"]').click();
    await expect.poll(() => requests.some(r => r.action === 'durations-for-slot')).toBe(true);
    expect(requests.filter(r => r.method !== 'GET')).toEqual([]);
  });
}

test('test-day booking remains available without displacing ordinary lesson choices', async ({ page }) => {
  const requests = await setupLearner(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/learner/book.html');
  await expect(page.locator('#testDatePanel')).toBeVisible();
  await expect(page.locator('#btnBookTestDate')).toBeHidden();
  await expect(page.locator('.date-cell-open').first()).toBeInViewport();
  await page.locator('#testDatePanel summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#btnBookTestDate')).toBeEnabled();
  await expect(page.locator('#btnBookTestDate')).toHaveText('Book with credit');
  await expect(page.locator('#testDateStartOptions')).toContainText('09:30-11:00 recommended');
  expect(requests.filter(r => r.method !== 'GET')).toEqual([]);
});

test('Manage lesson works by keyboard and retains reschedule and cancellation review', async ({ page }) => {
  const requests = await setupLearner(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/learner/lessons.html');
  const card = page.locator('.lesson-card').first();
  await expect(card).toBeVisible();
  expect((await card.boundingBox()).y).toBeLessThan(422);
  await expect(card.getByRole('button', { name: 'Cancel', exact: true })).toBeHidden();
  await card.locator('summary').focus();
  await page.keyboard.press('Enter');
  await card.getByRole('button', { name: 'Reschedule lesson' }).click();
  await expect(page.locator('#rescheduleModal')).toHaveClass(/open/);
  await page.locator('#rescheduleModal .btn-modal-cancel').click();
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#cancelPolicyNote')).not.toBeEmpty();
  await page.getByRole('button', { name: 'Keep lesson' }).click();
  expect(requests.filter(r => r.method !== 'GET')).toEqual([]);
});

test('booking shortcuts suppress automatic installation and keep compact cookie choices', async ({ page }) => {
  await setupLearner(page, { guest: true, consent: false });
  await page.goto('/simon');
  await expect(page.locator('#cc-consent-categories')).toBeHidden();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = () => { throw new Error('Installation must require an explicit Profile action'); };
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(event);
  });
  await expect(page.locator('#cc-install-banner')).toHaveCount(0);
});

test('driving-test Save can scroll clear of the fixed phone navigation', async ({ page }) => {
  await setupLearner(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/learner/driving-test.html');
  await page.locator('#btnSaveTest').scrollIntoViewIfNeeded();
  const save = await page.locator('#btnSaveTest').boundingBox();
  const nav = await page.locator('.cc-bottom-bar').boundingBox();
  expect(save.y + save.height).toBeLessThanOrEqual(nav.y);
});

test('profile exposes separate balances on demand and installation requires a click', async ({ page }) => {
  await setupLearner(page);
  await page.goto('/learner/profile.html');
  await expect(page.locator('#creditBalanceBadge')).toHaveText('3 hrs total');
  await expect(page.locator('#creditBalanceRows')).toBeHidden();
  await page.locator('#credit-balances-card summary').click();
  await expect(page.locator('#creditBalanceRows')).toContainText('Fraser');
  await page.locator('#flexible-hours-card summary').click();
  await expect(page.locator('#flexibleBalanceAction')).toContainText('any active instructor');
  await page.evaluate(() => {
    window.installCalls = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = () => { window.installCalls++; };
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(event);
  });
  await expect(page.locator('#cc-install-banner')).toHaveCount(0);
  expect(await page.evaluate(() => window.installCalls)).toBe(0);
  await page.locator('#install-app summary').click();
  await page.locator('#btnInstallApp').click();
  expect(await page.evaluate(() => window.installCalls)).toBe(1);
});

test('driving plan retains further suggestions and their source labels behind disclosures', async ({ page }) => {
  await setupLearner(page);
  await page.goto('/learner/progress.html');
  await expect(page.locator('#next-actions-section .plan-action-card:visible')).toHaveCount(1);
  await page.getByText('See other suggestions', { exact: true }).click();
  await expect(page.locator('#next-actions-section .plan-action-card:visible')).toHaveCount(2);
  await expect(page.locator('#next-actions-section .source-badge').first()).toContainText('From your drive notes');
  await expect(page.locator('.weekly-summary-card')).toBeHidden();
  await page.getByText('See weekly detail', { exact: true }).click();
  await expect(page.locator('.weekly-summary-card')).toContainText('Strongest area');
});

test('learner cookie choices preserve explicit consent and keyboard focus', async ({ page }) => {
  const requests = await setupLearner(page, { guest: true, consent: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/learner/login.html');
  await expect(page.locator('#cc-consent-categories')).toBeHidden();
  expect((await page.locator('#cc-consent-banner').boundingBox()).height).toBeLessThan(400);
  await page.locator('#cc-customise').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#cc-consent-banner').getByRole('link', { name: 'Privacy Policy' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#cc-customise')).toBeFocused();
  await page.locator('#cc-customise').click();
  await expect(page.locator('#cc-customise')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#cc-marketing-toggle').check();
  await page.locator('#cc-save-prefs').click();
  const consent = await page.evaluate(() => JSON.parse(localStorage.getItem('cc_cookie_consent')));
  expect(consent).toMatchObject({ analytics: false, marketing: true, version: 2 });
  expect(requests.find(r => r.action === 'record-consent').body).toMatchObject({ analytics: false, marketing: true });
  await page.evaluate(() => window.ccCookieConsent.show());
  await expect(page.locator('#cc-consent-categories')).toBeVisible();
  await page.locator('#cc-reject-all').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cc_cookie_consent')))).toMatchObject({ analytics: false, marketing: false });
});
