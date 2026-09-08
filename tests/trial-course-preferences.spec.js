const { test, expect } = require('@playwright/test');
const { parseTrialPreferences } = require('../api/_trial-preferences');

test('validates explicit opt-ins and upcoming month boundaries', () => {
  const now = new Date('2026-12-15T12:00:00Z');
  expect(parseTrialPreferences({}, now).requested).toBe(false);
  expect(() => parseTrialPreferences({ email_course_opt_in: 'true' }, now)).toThrow();
  expect(() => parseTrialPreferences({ intensive_months: ['2026-11'] }, now)).toThrow();
  expect(() => parseTrialPreferences({ intensive_months: ['2027-12'] }, now)).toThrow();
  expect(() => parseTrialPreferences({ intensive_months: 'January' }, now)).toThrow();
  const result = parseTrialPreferences({ intensive_interest: true, intensive_months: ['2027-01', '2026-12', '2027-01'] }, now);
  expect(result.requested).toBe(true);
  expect(result.message).toContain('2026-12, 2027-01');
  expect(result.message).toContain('email course: No');
  expect(parseTrialPreferences({ intensive_interest: false, intensive_months: ['2027-01'] }, now).message).not.toContain('2027-01');
});

test('reveals multiple months, clears deselected interest and submits preferences', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => localStorage.setItem('cc_cookie_consent', JSON.stringify({
    analytics: false, version: 1, timestamp: '2026-01-01T00:00:00.000Z'
  })));
  await page.route('**/api/slots?action=available**', route => route.fulfill({ json: { slots: {
    '2030-07-20': [{ start_time: '10:00:00', end_time: '11:00:00', instructor_id: 7, instructor_name: 'Fraser Carter', transmission_type: 'manual' }]
  } } }));
  let payload;
  await page.route('**/api/slots?action=book-free-trial', route => {
    payload = route.request().postDataJSON();
    return route.fulfill({ json: { ok: true, redirect_url: '/free-trial-success.html' } });
  });
  await page.goto('/free-trial.html');
  const interest = page.locator('#intensive_interest');
  const months = page.locator('#monthOptions input');
  await expect(interest).not.toBeChecked();
  await expect(page.locator('#email_course_opt_in')).not.toBeChecked();
  await expect(page.locator('#intensiveMonths')).toBeHidden();
  await interest.check();
  await expect(months).toHaveCount(12);
  await months.nth(0).check();
  await months.nth(1).check();
  await interest.uncheck();
  await expect(page.locator('#intensiveMonths')).toBeHidden();
  await interest.check();
  await expect(months.nth(0)).not.toBeChecked();
  await months.nth(0).check();
  await months.nth(1).check();
  const selected = [await months.nth(0).inputValue(), await months.nth(1).inputValue()];
  await page.locator('#email_course_opt_in').check();
  await page.getByRole('button', { name: /10:00/ }).click();
  await page.locator('#guest_name').fill('Alex Driver');
  await page.locator('#guest_email').fill('alex@example.test');
  await page.locator('#guest_phone').fill('07123456789');
  await page.locator('#guest_pickup_address').fill('24 Station Road');
  await page.getByRole('button', { name: 'Book my free trial' }).click();
  await expect(page).toHaveURL(/free-trial-success/);
  expect(payload).toMatchObject({ email_course_opt_in: true, intensive_interest: true, intensive_months: selected });
});
