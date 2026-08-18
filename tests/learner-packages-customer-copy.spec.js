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

function catalogue({ signedIn, flexibleBalanceMinutes = 0, emailVerified = true }) {
  const flexibleEligibility = signedIn
    ? !emailVerified
      ? { state: 'email_verification_required', purchase_eligible: false, checkout_available: false, reason: 'Verify your account email with a one-time sign-in code before buying Flexible Hours.' }
      : flexibleBalanceMinutes > 0
      ? { state: 'existing_flexible_balance', purchase_eligible: false, checkout_available: false, remaining_minutes: flexibleBalanceMinutes }
      : { state: 'live_checkout_available', purchase_eligible: true, checkout_available: true }
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
    pricing: { pay_as_you_go_hourly_pence: 5500 },
    viewer: {
      signed_in_as_learner: signedIn,
      learner_id: signedIn ? 41 : null,
      learner_name: signedIn ? 'Alex Taylor' : null,
      email_verified: signedIn && emailVerified,
      flexible_hours_remaining_minutes: flexibleBalanceMinutes,
    },
    full_curriculum_eligibility: { test_booking: null, has_active_enrolment: false },
    products: [
      product({
        id: 9, slug: 'flexible-10-hours', type: 'flexible_hours', price: 55000,
        content: {
          name: '10-hour Flexible Hours package',
          short_description: 'For learners who prefer one payment over 10 separate payments when booking.',
          highlights: ['10 school-wide hours', 'GBP 55 per hour', 'No expiry', 'Used in exact 30-minute units'],
          entitlement: { hours: 10, units: 20, unit_minutes: 30, scope: 'school' },
          checkout_disclosure: 'Pay by Bank. Access is created only after verified signed webhook confirmation.',
        },
        eligibility: flexibleEligibility,
        rights: flexibleRights,
      }),
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

async function preparePage(page, { signedIn, viewport, productTypes, productSlugs, flexibleBalanceMinutes = 0, emailVerified = true, theme = 'auto' }) {
  await page.setViewportSize(viewport);
  await page.addInitScript(({ signedIn: isSignedIn, selectedTheme }) => {
    localStorage.setItem('cc_cookie_consent', JSON.stringify({ analytics: false, version: 1 }));
    localStorage.setItem('cc_dark_mode', selectedTheme);
    if (isSignedIn) localStorage.setItem('cc_learner', JSON.stringify({ user: { id: 41, name: 'Alex Taylor', school_id: 1 } }));
  }, { signedIn, selectedTheme: theme });
  await page.route('**/api/packages?action=feature-state**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, enabled: true }),
  }));
  const catalogueResponse = catalogue({ signedIn, flexibleBalanceMinutes, emailVerified });
  if (productTypes) catalogueResponse.products = catalogueResponse.products.filter(product => productTypes.includes(product.product_type));
  if (productSlugs) catalogueResponse.products = catalogueResponse.products.filter(product => productSlugs.includes(product.slug));
  await page.route('**/api/packages?action=catalogue**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(catalogueResponse),
  }));
  await page.route('**/api/packages?action=programme-status**', route => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ error: true }),
  }));
  await page.route('**/api/flexible-packages?action=balance**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, remaining_minutes: flexibleBalanceMinutes, sources: [] }),
  }));
  await page.goto('/learner/packages.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#catalogue-content').waitFor({ state: 'visible' });
}

test.describe('Learner Packages customer copy', () => {
  test('renders a production-shaped Flexible Hours-only catalogue', async ({ page }) => {
    await preparePage(page, {
      signedIn: true,
      viewport: { width: 1280, height: 900 },
      productTypes: ['flexible_hours'],
    });

    await expect(page.locator('#catalogue-content')).toBeVisible();
    await expect(page.locator('#catalogue-status')).toBeHidden();
    await expect(page.getByRole('heading', { name: '10 Flexible Hours', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '15 Flexible Hours', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '30 Flexible Hours', exact: true })).toBeVisible();
    await expect(page.getByText('Book in 30-minute steps', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Cannot be transferred to another learner', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Available now with Pay by Bank. Your hours will appear after your bank confirms the payment.', { exact: true })).toHaveCount(0);
    await expect(page.locator('.price-was s')).toHaveText(['£825', '£1,650']);
    await expect(page.locator('.price-saving')).toHaveText(['Save £15', 'Save £60']);
    await expect(page.getByText('Review and buy', { exact: true })).toHaveCount(0);
    await expect(page.getByText('For learners who prefer one payment over 10 separate payments when booking.', { exact: true })).toBeVisible();
    await expect(page.locator('.purchase-review summary')).toHaveText(['Book 10hrs', 'Book 15hrs', 'Book 30hrs']);
    await expect(page.getByRole('link', { name: 'Book 10hrs Flexible Hours package' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Book 15hrs Flexible Hours package' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Book 30hrs Flexible Hours package' })).toBeVisible();
    await page.getByRole('link', { name: 'Book 15hrs Flexible Hours package' }).click();
    await expect(page.locator('[data-flexible-purchase-panel="8"]')).toHaveAttribute('open', '');
    await expect(page.locator('#full-curriculum-section')).toBeHidden();
    await expect(page.locator('#manoeuvres-section')).toBeHidden();
    await expect(page.locator('#flexible-truth-panel')).toBeVisible();
    await expect(page.getByText('Catalogue not ready')).toHaveCount(0);
    const desktopLayout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(desktopLayout.scrollWidth).toBeLessThanOrEqual(desktopLayout.width);
    if (process.env.CC_PACKAGES_SCREENSHOT_DIR) {
      await page.screenshot({
        path: path.join(process.env.CC_PACKAGES_SCREENSHOT_DIR, 'packages-flexible-only-desktop.png'),
        fullPage: true,
      });
    }
  });

  test('renders whichever individual Flexible Hours products are visible', async ({ page }) => {
    await preparePage(page, {
      signedIn: false,
      viewport: { width: 390, height: 844 },
      productSlugs: ['flexible-15-hours'],
    });

    await expect(page.getByRole('heading', { name: '15 Flexible Hours', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '30 Flexible Hours', exact: true })).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Package availability at a glance' })).toHaveCount(0);
    await expect(page.locator('#flexible-section-copy')).toContainText('Buy 15 hours upfront.');
    await expect(page.getByRole('link', { name: 'Book 15hrs Flexible Hours package' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Book 30hrs Flexible Hours package' })).toHaveCount(0);
    const mobileLayout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.width);
    if (process.env.CC_PACKAGES_SCREENSHOT_DIR) {
      await page.screenshot({
        path: path.join(process.env.CC_PACKAGES_SCREENSHOT_DIR, 'packages-single-flexible-mobile.png'),
        fullPage: true,
      });
    }
  });

  test('blocks an unverified signed-in learner before terms or Checkout are shown', async ({ page }) => {
    await preparePage(page, {
      signedIn: true,
      emailVerified: false,
      viewport: { width: 390, height: 844 },
      productSlugs: ['flexible-15-hours'],
    });

    await expect(page.getByText('Email verification needed', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify email to buy' })).toBeVisible();
    await expect(page.locator('[data-flexible-checkout]')).toHaveCount(0);
    await expect(page.locator('.purchase-review')).toHaveCount(0);
    await expect(page.locator('[data-flexible-shortcut]')).toHaveCount(0);
  });

  test('signed-out visitors can understand the live choice without implementation language', async ({ page }) => {
    await preparePage(page, { signedIn: false, viewport: { width: 390, height: 844 } });

    await expect(page.getByRole('heading', { name: 'Find the package that fits.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '10 Flexible Hours', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '15 Flexible Hours', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '30 Flexible Hours', exact: true })).toBeVisible();
    await expect(page.getByText('£55 per hour', { exact: true })).toBeVisible();
    await expect(page.getByText('£54 per hour', { exact: true })).toBeVisible();
    await expect(page.getByText('£53 per hour', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in to buy' })).toHaveCount(3);
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

    const review = page.locator('.purchase-review summary').filter({ hasText: 'Book 15hrs' });
    await expect(review).toBeVisible();
    await review.click();
    const openReview = page.locator('.purchase-review[open]');
    await expect(openReview.locator('.checkout-owner')).toHaveText('Buying for: Alex Taylor');
    await expect(openReview.getByLabel(FLEXIBLE_ACKNOWLEDGEMENT + ' ' + FLEXIBLE_IMMEDIATE_ACCESS, { exact: true })).toBeVisible();
    await expect(page.locator('[name="immediate_access_requested"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pay £810 by bank' })).toBeVisible();
    await expect(page.locator('#test-booking-panel')).toBeHidden();

    const visibleCopy = await page.locator('body').innerText();
    expect(visibleCopy).not.toMatch(/immutable|fulfilment|School 1|signed webhook|test foundation|product version|source units|test mode/i);
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  });

  test('shows the booking route and hides repeat purchase while Flexible Hours remain', async ({ page }) => {
    await preparePage(page, {
      signedIn: true,
      viewport: { width: 1280, height: 900 },
      productTypes: ['flexible_hours'],
      flexibleBalanceMinutes: 150,
    });

    await expect(page.locator('#flexible-balance-status')).toContainText('2.5 hours remaining');
    await expect(page.getByRole('link', { name: 'Book with your Flexible Hours' })).toHaveCount(4);
    await expect(page.getByText('Review and buy', { exact: true })).toHaveCount(0);
    await expect(page.locator('#flexible-purchase-shortcuts')).toBeHidden();
    await expect(page.getByText('Hours ready to use', { exact: true })).toHaveCount(3);
  });

  test('keeps the mobile package hierarchy readable in explicit dark mode', async ({ page }) => {
    await preparePage(page, {
      signedIn: true,
      viewport: { width: 375, height: 844 },
      productTypes: ['flexible_hours'],
      theme: 'dark',
    });

    await expect(page.locator('html')).toHaveClass(/dark-mode/);
    const colours = await page.evaluate(() => {
      function rgb(value) {
        const parts = value.match(/[\d.]+/g).slice(0, 3).map(Number);
        return parts.map(channel => {
          const normal = channel / 255;
          return normal <= 0.04045 ? normal / 12.92 : Math.pow((normal + 0.055) / 1.055, 2.4);
        });
      }
      function contrast(foreground, background) {
        const fg = rgb(foreground);
        const bg = rgb(background);
        const luminance = channels => 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        const lighter = Math.max(luminance(fg), luminance(bg));
        const darker = Math.min(luminance(fg), luminance(bg));
        return (lighter + 0.05) / (darker + 0.05);
      }
      const body = getComputedStyle(document.body).backgroundColor;
      const title = getComputedStyle(document.querySelector('.packages-hero h1')).color;
      const intro = getComputedStyle(document.querySelector('.hero-intro')).color;
      const card = document.querySelector('.product-shell');
      const cardStyle = getComputedStyle(card);
      const featureStyle = getComputedStyle(card.querySelector('.product-details li'));
      const shortcut = document.querySelector('.flexible-purchase-shortcuts a');
      const shortcutStyle = getComputedStyle(shortcut);
      return {
        titleContrast: contrast(title, body),
        introContrast: contrast(intro, body),
        cardFeatureContrast: contrast(featureStyle.color, cardStyle.backgroundColor),
        shortcutContrast: contrast(shortcutStyle.color, shortcutStyle.backgroundColor),
        shortcutHeight: shortcut.getBoundingClientRect().height,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
      };
    });
    expect(colours.titleContrast).toBeGreaterThanOrEqual(4.5);
    expect(colours.introContrast).toBeGreaterThanOrEqual(4.5);
    expect(colours.cardFeatureContrast).toBeGreaterThanOrEqual(4.5);
    expect(colours.shortcutContrast).toBeGreaterThanOrEqual(4.5);
    expect(colours.shortcutHeight).toBeGreaterThanOrEqual(44);
    expect(colours.scrollWidth).toBeLessThanOrEqual(colours.viewportWidth);
  });
});
