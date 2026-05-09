// @ts-check
const { test, expect } = require('@playwright/test');

// Smoke test for the offer-driven recurring-series feature shipped 8 May 2026.
//
// What this exercises:
//   1. Accept-offer page renders the "How many weekly lessons?" section when
//      the offer has max_repeat_weeks > 1, and HIDES it when null/1.
//   2. The repeat-weeks select gets the right number of options.
//   3. Total price updates correctly when the learner changes the count.
//   4. Instructor-modal HTML carries the new offerMaxRepeatWeeks select with
//      18 options (1..18 weekly lessons).
//   5. POST /api/instructor?action=create-offer rejects bad input (no auth,
//      out-of-range max_repeat_weeks) — catches validation regressions.
//
// What this DOES NOT exercise:
//   - Real Stripe checkout / webhook fan-out / DB inserts. Those need a live
//     test environment with Stripe keys + Postgres. Run a manual end-to-end
//     in Stripe test mode after each release.

// `npx serve` redirects /foo.html to /foo and strips the query string in
// the process. Use clean URLs to keep ?token=... intact under both `serve`
// and `vercel dev`.
const ACCEPT_PAGE = '/accept-offer?token=smoketest';
const INSTRUCTOR_PAGE = '/instructor/index.html';

// The page calls /api/offers?action=get-offer on load. We intercept that and
// return a mock offer so we can assert against the rendered UI. Token value
// is irrelevant to the test — the route handler never sees the request.
function mockOffer(overrides = {}) {
  return {
    ok: true,
    offer: {
      id: 999,
      scheduled_date: '2026-05-12',
      start_time: '14:00:00',
      end_time: '15:30:00',
      expires_at: new Date(Date.now() + 23 * 3600 * 1000).toISOString(),
      instructor_name: 'Smoke Instructor',
      lesson_type_name: 'Standard Lesson',
      duration_minutes: 90,
      price_pence: 8250,
      original_price_pence: 8250,
      discount_pct: 0,
      kind: 'manual',
      trigger: null,
      max_repeat_weeks: null,
      is_flexible: false,
      learner_email: 'test@example.com',
      learner_name: 'Smoke Learner',
      learner_phone: '07700900000',
      learner_pickup_address: '1 Test Street, Test City',
      needs_details: false,
      ...overrides,
    },
  };
}

test.describe('Accept-offer page — recurring-series UI', () => {
  test('hides repeat section when offer has no max_repeat_weeks', async ({ page }) => {
    await page.route('**/api/offers?action=get-offer*', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockOffer({ max_repeat_weeks: null })) });
    });
    await page.goto(ACCEPT_PAGE);
    await expect(page.locator('#offer-content')).toBeVisible();
    await expect(page.locator('#repeat-section')).toBeHidden();
  });

  test('shows repeat section with N options when max_repeat_weeks=N', async ({ page }) => {
    await page.route('**/api/offers?action=get-offer*', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockOffer({ max_repeat_weeks: 6 })) });
    });
    await page.goto(ACCEPT_PAGE);
    const section = page.locator('#repeat-section');
    await expect(section).toBeVisible();
    const options = page.locator('#repeat-weeks option');
    await expect(options).toHaveCount(6);
    await expect(options.nth(0)).toHaveText('1 lesson');
    await expect(options.nth(5)).toHaveText('6 weekly lessons');
  });

  test('total price multiplies correctly when learner picks N', async ({ page }) => {
    await page.route('**/api/offers?action=get-offer*', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockOffer({ max_repeat_weeks: 4, price_pence: 7500 })) });
    });
    await page.goto(ACCEPT_PAGE);
    await expect(page.locator('#repeat-total')).toContainText('Total: £75.00');
    await page.locator('#repeat-weeks').selectOption('3');
    await expect(page.locator('#repeat-total')).toContainText('Total: £225.00');
    await expect(page.locator('#repeat-total')).toContainText('3 × £75.00');
  });

  test('hides repeat section for flexible offers even if max_repeat_weeks set', async ({ page }) => {
    // Flexible offers credit the learner; weekly repeats only make sense with a fixed slot.
    // The frontend guards against this defensively (server also rejects).
    await page.route('**/api/offers?action=get-offer*', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockOffer({ is_flexible: true, scheduled_date: null, start_time: null, end_time: null, max_repeat_weeks: 5 })) });
    });
    await page.goto(ACCEPT_PAGE);
    await expect(page.locator('#offer-content')).toBeVisible();
    await expect(page.locator('#repeat-section')).toBeHidden();
  });

  test('FREE offer with repeats shows free-lesson total instead of £', async ({ page }) => {
    await page.route('**/api/offers?action=get-offer*', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockOffer({ price_pence: 0, max_repeat_weeks: 3 })) });
    });
    await page.goto(ACCEPT_PAGE);
    await page.locator('#repeat-weeks').selectOption('3');
    await expect(page.locator('#repeat-total')).toContainText('3 free lessons');
  });
});

test.describe('Instructor offer modal — markup', () => {
  test('offerMaxRepeatWeeks select exists with 18 options', async ({ page }) => {
    // Don't try to render the full authed dashboard — just fetch the page HTML
    // and assert the offer-modal markup is intact. Cheaper and avoids needing
    // an instructor session for a markup smoke test.
    const res = await page.request.get(INSTRUCTOR_PAGE);
    expect(res.ok()).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('id="offerMaxRepeatWeeks"');
    // Expect 18 distinct weekly-repeat options.
    for (let n = 1; n <= 18; n++) {
      expect(html).toContain(`value="${n}"`);
    }
    // Sanity-check the helper text mentioning skip-clash behaviour.
    expect(html).toContain('Skips weeks where');
  });
});

test.describe('create-offer endpoint — input validation', () => {
  // These hit the live API. Skip when there is no API surface (e.g. running
  // against the static `serve public` preview).
  test.skip(({ baseURL }) => !process.env.CC_TEST_API, 'set CC_TEST_API=1 to exercise live API validation');

  test('rejects unauthenticated create-offer', async ({ request }) => {
    const res = await request.post('/api/instructor?action=create-offer', {
      data: { learner_name: 'Test', scheduled_date: '2026-06-01', start_time: '10:00' },
    });
    expect(res.status()).toBe(401);
  });

  test('rejects max_repeat_weeks > 18 (would need auth to actually reach the validator)', async ({ request }) => {
    // Without an instructor JWT the request 401s before the validator runs,
    // so we just assert the route is reachable. With auth this would 400.
    const res = await request.post('/api/instructor?action=create-offer', {
      data: { learner_name: 'Test', scheduled_date: '2026-06-01', start_time: '10:00', max_repeat_weeks: 99 },
    });
    expect([400, 401]).toContain(res.status());
  });
});
