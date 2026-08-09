const { test, expect } = require('@playwright/test');

const OFFER = {
  id: 77,
  scheduled_date: '2026-08-20',
  start_time: '10:00:00',
  end_time: '11:30:00',
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  instructor_name: 'Test Instructor',
  lesson_type_name: 'Standard Lesson',
  duration_minutes: 90,
  price_pence: 8250,
  original_price_pence: 8250,
  discount_pct: 0,
  max_repeat_weeks: 6,
  is_flexible: false,
  incompatible_products_retired: true,
  learner_email: 'learner@example.test',
  learner_name: 'Test Learner',
  learner_phone: '07700900123',
  learner_pickup_address: '1 Test Street',
  needs_details: false,
};

test.describe('Slice 3 active offer UI', () => {
  test('a grandfathered repeat-capable fixed offer renders as one lesson only', async ({ page }) => {
    await page.route('**/api/offers?action=get-offer*', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, offer: OFFER }),
    }));

    await page.goto('/accept-offer?token=slice3-fixed');
    await expect(page.locator('#offer-content')).toBeVisible();
    await expect(page.locator('#repeat-section')).toBeHidden();
    await expect(page.locator('#repeat-weeks option')).toHaveCount(0);
  });

  test('the stable retirement response replaces a flexible offer acceptance page', async ({ page }) => {
    await page.route('**/api/offers?action=get-offer*', route => route.fulfill({
      status: 410,
      contentType: 'application/json',
      body: JSON.stringify({
        error: true,
        code: 'PRODUCT_CREATION_RETIRED',
        retired_product: 'flexible_offer',
        message: 'New flexible lesson offers are retired.',
      }),
    }));

    await page.goto('/accept-offer?token=slice3-flexible');
    await expect(page.locator('#error-state')).toBeVisible();
    await expect(page.locator('#error-title')).toHaveText('Offer no longer available');
    await expect(page.locator('#error-text')).toContainText('one specific lesson');
    await expect(page.locator('#offer-content')).toBeHidden();
  });
});
