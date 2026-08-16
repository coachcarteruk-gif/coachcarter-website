const { test, expect } = require('@playwright/test');
const path = require('path');

const FLEXIBLE_ACKNOWLEDGEMENT = 'I have read and accept the Flexible Hours terms, cancellation rules and unused-value refund basis.';
const FLEXIBLE_IMMEDIATE_ACCESS = 'I expressly request immediate access to my Flexible Hours during the 14-day cancellation period and understand that properly used or late-cancelled value may be deducted.';

function product({ id, slug, type, price, content, eligibility, rights = null }) {
  return {
    id,
    slug,
    product_type: type,
    product_version_id: id * 10,
    version_number: slug === 'flexible-30-hours' ? 2 : 1,
    price_pence: price,
    currency: 'GBP',
    content,
    consumer_rights: rights,
    eligibility,
  };
}

function catalogue({ signedIn }) {
  const flexibleEligibility = signedIn
    ? { state: 'live_checkout_available', purchase_eligible: true, checkout_available: true }
    : { state: 'authentication_required', purchase_eligible: false, checkout_available: false };
  const unavailable = { state: 'available_to_compare', purchase_eligible: false, checkout_available: false };
  const flexibleRights = {
    ready: true,
    disclosure_version: 'flexible-hours-consumer-rights-v1',
    checkout_acknowledgement: FLEXIBLE_ACKNOWLEDGEMENT,
    immediate_access_request: FLEXIBLE_IMMEDIATE_ACCESS,
  };
  return {
    ok: true,
    phase: 'catalogue_only',
    flexible_live_purchasing_enabled: true,
    viewer: {
      signed_in_as_learner: signedIn,
      learner_id: signedIn ? 41 : null,
      learner_name: signedIn ? 'Alex Taylor' : null,
    },
    full_curriculum_eligibility: { test_booking: null, has_active_enrolment: false },
    products: [
      product({
        id: 8, slug: 'flexible-15-hours', type: 'flexible_hours', price: 81000,
        content: {
          name: '15-hour Flexible Hours package',
          short_description: 'Fifteen school-wide lesson hours, usable with any eligible active instructor.',
          highlights: ['15 school-wide hours', 'GBP 54 per hour', 'No expiry', 'Used in exact 30-minute units'],
          entitlement: { hours: 15, units: 30, unit_minutes: 30, scope: 'school' },
          checkout_disclosure: 'Pay by Bank. Access is created only after verified signed webhook confirmation.',
        },
        eligibility: flexibleEligibility,
        rights: flexibleRights,
      }),
      product({
        id: 1, slug: 'flexible-30-hours', type: 'flexible_hours', price: 159000,
        content: {
          name: '30-hour Flexible Hours package',
          short_description: 'Thirty school-wide lesson hours, usable with any eligible active instructor.',
          highlights: ['30 school-wide hours', 'GBP 53 per hour', 'No expiry', 'Used in exact 30-minute units'],
          entitlement: { hours: 30, units: 60, unit_minutes: 30, scope: 'school' },
          checkout_disclosure: 'Pay by Bank. Access is created only after verified signed webhook confirmation.',
        },
        eligibility: flexibleEligibility,
        rights: flexibleRights,
      }),
      product({
        id: 5, slug: 'full-curriculum', type: 'full_curriculum', price: 200000,
        content: {
          name: 'Full Curriculum',
          short_description: 'Internal Phase 1, Phase 2 and Phase 3 programme.',
          highlights: ['One 90-minute lesson opportunity per programme week'],
          checkout_disclosure: 'Adults-only controlled pilot.',
        },
        eligibility: unavailable,
      }),
      product({
        id: 6, slug: 'manoeuvres', type: 'manoeuvres', price: 15000,
        content: {
          name: 'Manoeuvres', variant: 'ordinary',
          short_description: 'Three specialist sessions.',
          highlights: ['Three immutable GBP 50 session units for future accounting'],
          checkout_disclosure: 'Comparison only. Session units are not available in Phase 1.',
        },
        eligibility: unavailable,
      }),
      product({
        id: 7, slug: 'manoeuvres-challenge', type: 'manoeuvres', price: 15000,
        content: {
          name: 'Manoeuvres Challenge', variant: 'challenge',
          short_description: 'Optional promotional tasks.',
          highlights: ['Qualifying reward choice: original-method refund or programme credit'],
          checkout_disclosure: 'Fulfilment is not implemented in this test foundation.',
        },
        eligibility: unavailable,
      }),
    ],
  };
}

async function preparePage(page, { signedIn, viewport }) {
  await page.setViewportSize(viewport);
  await page.addInitScript(({ signedIn: isSignedIn }) => {
    localStorage.setItem('cc_cookie_consent', JSON.stringify({ analytics: false, version: 1 }));
    if (isSignedIn) localStorage.setItem('cc_learner', JSON.stringify({ user: { id: 41, name: 'Alex Taylor', school_id: 1 } }));
  }, { signedIn });
  await page.route('**/api/packages?action=feature-state**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, enabled: true }),
  }));
  await page.route('**/api/packages?action=catalogue**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(catalogue({ signedIn })),
  }));
  await page.route('**/api/packages?action=programme-status**', route => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ error: true }),
  }));
  await page.route('**/api/flexible-packages?action=balance**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, remaining_minutes: 0, sources: [] }),
  }));
  await page.goto('/learner/packages.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#catalogue-content').waitFor({ state: 'visible' });
}

test.describe('Learner Packages customer copy', () => {
  test('signed-out visitors can understand the live choice without implementation language', async ({ page }) => {
    await preparePage(page, { signedIn: false, viewport: { width: 390, height: 844 } });

    await expect(page.getByRole('heading', { name: 'Find the package that fits.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '15 Flexible Hours', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '30 Flexible Hours', exact: true })).toBeVisible();
    await expect(page.getByText('£54 per hour', { exact: true })).toBeVisible();
    await expect(page.getByText('£53 per hour', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in to buy' })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Not available yet' })).toHaveCount(3);

    const visibleCopy = await page.locator('body').innerText();
    expect(visibleCopy).not.toMatch(/immutable|fulfilment|School 1|signed webhook|test foundation|product version|source units|test mode/i);
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
    if (process.env.CC_PACKAGES_SCREENSHOT_DIR) {
      await page.screenshot({
        path: path.join(process.env.CC_PACKAGES_SCREENSHOT_DIR, 'packages-after-mobile.png'),
        fullPage: true,
      });
      await page.locator('#flexible-products').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(process.env.CC_PACKAGES_SCREENSHOT_DIR, 'packages-after-mobile-cards.png'),
      });
    }
  });

  test('signed-in purchase details preserve the approved acknowledgements at the decision point', async ({ page }) => {
    await preparePage(page, { signedIn: true, viewport: { width: 1280, height: 900 } });
    await expect(page.locator('#flexible-balance-status')).toBeHidden();

    if (process.env.CC_PACKAGES_SCREENSHOT_DIR) {
      await page.screenshot({
        path: path.join(process.env.CC_PACKAGES_SCREENSHOT_DIR, 'packages-after-desktop.png'),
        fullPage: true,
      });
    }

    const review = page.getByText('Review and buy', { exact: true }).first();
    await expect(review).toBeVisible();
    await review.click();
    await expect(page.locator('.purchase-review[open] .checkout-owner')).toHaveText('Buying for: Alex Taylor');
    await expect(page.getByLabel(FLEXIBLE_ACKNOWLEDGEMENT, { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel(FLEXIBLE_IMMEDIATE_ACCESS, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pay £810 by bank' })).toBeVisible();
    await expect(page.locator('#test-booking-panel')).toBeHidden();

    const visibleCopy = await page.locator('body').innerText();
    expect(visibleCopy).not.toMatch(/immutable|fulfilment|School 1|signed webhook|test foundation|product version|source units|test mode/i);
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  });
});
