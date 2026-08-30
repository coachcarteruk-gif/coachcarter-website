const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { normalizeEnquiryAttribution } = require('../api/_enquiry-attribution');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

async function fillConsultationForm(page) {
  await page.locator('#consultName').fill('Alex Driver');
  await page.locator('#consultPhone').fill('07123 456 789');
  await page.locator('#consultEmail').fill('alex@example.test');
  await page.locator('#consultExperience').selectOption('11 to 20 hours');
  await page.locator('#consultPostcode').fill('rg1 1aa');
  await page.locator('#consultStuck').fill('Roundabouts and hesitation');
  await page.locator('#consultConsent').check();
}

async function enableCapturedAnalytics(page, variant) {
  await page.route('**/posthog-loader.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '',
  }));
  await page.addInitScript((assignedVariant) => {
    localStorage.setItem('cc_cookie_consent', JSON.stringify({
      analytics: true,
      version: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
    }));
    sessionStorage.setItem('cc_experiment_assignments', JSON.stringify({
      'free-consultation-v1': {
        variant: assignedVariant,
        assigned_at: '2026-01-01T00:00:00.000Z',
      },
    }));
    window.__capturedEvents = [];
    window.posthog = {
      capture(name, properties) {
        window.__capturedEvents.push({ name, properties });
      },
    };
  }, variant);
}

test.describe('free consultation advertising landing page', () => {
  test.use({ serviceWorkers: 'block' });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cc_cookie_consent', JSON.stringify({
        analytics: false,
        version: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
      }));
    });
  });

  test('states Variant A clearly and submits structured attribution', async ({ page }) => {
    let payload = null;
    await page.route('**/api/enquiries?action=submit', async (route) => {
      payload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, dbSaved: true }),
      });
    });

    await page.goto('/free-consultation?cc_variant=A&utm_source=meta&utm_medium=paid-social&utm_campaign=road-to-pass&utm_content=learner-video');

    await expect(page.getByRole('heading', { name: /Know exactly what to work on/ })).toBeVisible();
    await expect(page.getByText('£0. No card needed.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'This is genuinely free.' })).toBeVisible();

    await fillConsultationForm(page);
    await page.locator('#consultSubmit').click();

    await expect(page.getByText('Your request is in.')).toBeVisible();
    expect(payload).toMatchObject({
      name: 'Alex Driver',
      phone: '07123 456 789',
      email: 'alex@example.test',
      enquiryType: 'free-consultation',
      marketing: false,
      experiment_key: 'free-consultation-v1',
      experiment_variant: 'A',
      utm_source: 'meta',
      utm_medium: 'paid-social',
      utm_campaign: 'road-to-pass',
      utm_content: 'learner-video',
    });
    expect(payload).not.toHaveProperty('school_id');
    expect(payload.message).toContain('Driving experience: 11 to 20 hours');
    expect(payload.message).toContain('Preferred pickup postcode: RG1 1AA');
    expect(payload.message).toContain('Currently stuck on: Roundabouts and hesitation');
    expect(payload.message).not.toContain('Ad attribution');
  });

  test('renders the shorter Variant B and excludes detailed-only content', async ({ page }) => {
    await page.goto('/free-consultation?cc_variant=B');

    await expect(page.getByRole('heading', { name: /Find out how close you are to test-ready/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Stop guessing whether you are nearly ready.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'See your real level' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Know exactly what to work on/ })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Why progress stalls' })).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-experiment-variant', 'B');
  });

  test('keeps a random assignment stable for the browser visit and preserves UTMs', async ({ page }) => {
    await page.goto('/free-consultation?utm_source=google&utm_medium=cpc&utm_campaign=consultation&utm_content=search-a');
    const first = await page.locator('html').getAttribute('data-experiment-variant');
    expect(['A', 'B']).toContain(first);

    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-experiment-variant', first);
    expect(new URL(page.url()).searchParams.get('utm_source')).toBe('google');
    expect(new URL(page.url()).searchParams.get('utm_content')).toBe('search-a');
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('cc_experiment_assignments')));
    expect(stored['free-consultation-v1'].variant).toBe(first);
  });

  test('assigns Variant B before its content can render', async ({ page }) => {
    await page.addInitScript(() => {
      window.__variantPaintMismatch = false;
      new MutationObserver(() => {
        const root = document.documentElement;
        const control = document.querySelector('[data-variant-only="A"]');
        if (control && root.dataset.experimentVariant === 'B' && getComputedStyle(control).display !== 'none') {
          window.__variantPaintMismatch = true;
        }
      }).observe(document, { subtree: true, childList: true, attributes: true });
    });

    await page.goto('/free-consultation?cc_variant=B');

    expect(await page.evaluate(() => window.__variantPaintMismatch)).toBe(false);
    const html = read('public/free-consultation.html');
    expect(html.indexOf('/experiment-assignment.js')).toBeLessThan(html.indexOf('<body>'));
  });

  test('counts only a confirmed database save as the conversion', async ({ page }) => {
    await enableCapturedAnalytics(page, 'B');
    await page.route('**/api/enquiries?action=submit', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, dbSaved: true }),
    }));
    await page.goto('/free-consultation?utm_source=meta&utm_medium=paid-social&utm_campaign=test-ready&utm_content=short-copy');

    await fillConsultationForm(page);
    await page.locator('#consultSubmit').click();
    await expect(page.getByText('Your request is in.')).toBeVisible();

    const events = await page.evaluate(() => window.__capturedEvents);
    expect(events.map((event) => event.name)).toEqual(expect.arrayContaining([
      'free_consultation_page_viewed',
      'free_consultation_form_started',
      'free_consultation_requested',
    ]));
    expect(events.some((event) => event.name === 'free_consultation_submission_error')).toBe(false);
    for (const event of events) {
      expect(event.properties).toMatchObject({
        experiment_key: 'free-consultation-v1',
        experiment_variant: 'B',
        utm_source: 'meta',
        utm_medium: 'paid-social',
        utm_campaign: 'test-ready',
        utm_content: 'short-copy',
        '$feature/free-consultation-v1': 'B',
      });
      expect(JSON.stringify(event.properties)).not.toContain('alex@example.test');
      expect(JSON.stringify(event.properties)).not.toContain('07123');
    }
  });

  test('records a diagnostic event but no conversion when the save is unconfirmed', async ({ page }) => {
    await enableCapturedAnalytics(page, 'A');
    await page.route('**/api/enquiries?action=submit', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, dbSaved: false }),
    }));
    await page.goto('/free-consultation');

    await fillConsultationForm(page);
    await page.locator('#consultSubmit').click();
    await expect(page.getByText('We could not confirm your request was saved. Please try again.')).toBeVisible();

    const events = await page.evaluate(() => window.__capturedEvents);
    expect(events.some((event) => event.name === 'free_consultation_requested')).toBe(false);
    const diagnostic = events.find((event) => event.name === 'free_consultation_submission_error');
    expect(diagnostic.properties.error_category).toBe('save_unconfirmed');
  });

  test('works with PostHog absent and analytics declined', async ({ page }) => {
    await page.route('**/api/enquiries?action=submit', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, dbSaved: true }),
    }));
    await page.goto('/free-consultation?cc_variant=B');

    expect(await page.evaluate(() => typeof window.posthog)).toBe('undefined');
    await fillConsultationForm(page);
    await page.locator('#consultSubmit').click();
    await expect(page.getByText('Your request is in.')).toBeVisible();
  });

  test('uses privacy-safe PostHog settings and lets visitors change consent', async ({ page }) => {
    await page.route('**/api/config?action=record-consent', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    }));
    await page.route('https://eu-assets.i.posthog.com/**', (route) => route.fulfill({
      status: 204,
      body: '',
    }));

    await page.goto('/free-consultation?cc_variant=A');
    await expect(page.locator('#consultationForm')).toHaveClass(/ph-no-capture/);

    const settings = page.getByRole('button', { name: 'Cookie Settings' });
    await expect(settings).toBeVisible();
    await settings.click();
    await expect(page.locator('#cc-consent-overlay')).toBeVisible();
    await page.locator('#cc-accept-all').click();

    const config = await page.evaluate(() => window.posthog && window.posthog._i && window.posthog._i[0][1]);
    expect(config).toMatchObject({
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_performance: false,
      disable_session_recording: true,
      disable_surveys: true,
      person_profiles: 'never',
    });
    await expect(page.locator('script[src="/posthog-tracking.js"]')).toHaveCount(0);
    const minimisedEvents = await page.evaluate(() => {
      const beforeSend = window.posthog._i[0][1].before_send;
      return {
        automatic: beforeSend({ event: '$autocapture', properties: { email: 'alex@example.test' } }),
        consultation: beforeSend({
          event: 'free_consultation_requested',
          properties: {
            experiment_variant: 'A',
            utm_source: 'meta',
            email: 'alex@example.test',
            $current_url: 'https://coachcarter.uk/free-consultation?email=alex@example.test',
          },
        }),
      };
    });
    expect(minimisedEvents.automatic).toBeNull();
    expect(minimisedEvents.consultation.properties).toEqual({
      experiment_variant: 'A',
      utm_source: 'meta',
    });

    await settings.click();
    await page.locator('#cc-analytics-toggle').uncheck();
    await page.locator('#cc-save-prefs').click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cc_cookie_consent')));
    expect(stored).toMatchObject({ analytics: false, version: 1 });
  });

  test('offers complete experience bands and submits a typed postcode without an address lookup', async ({ page }) => {
    let payload = null;
    let addressLookupRequested = false;
    page.on('request', (request) => {
      if (request.url().includes('/api/public-address-lookup')) addressLookupRequested = true;
    });
    await page.route('**/api/enquiries?action=submit', async (route) => {
      payload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, dbSaved: true }),
      });
    });
    await page.goto('/free-consultation?cc_variant=A');

    await expect(page.locator('#consultTransmission')).toHaveCount(0);
    await expect(page.locator('#consultExperience option')).toHaveText([
      'Choose one',
      '0 hours',
      '1 to 10 hours',
      '11 to 20 hours',
      '21 to 30 hours',
      'More than 30 hours',
    ]);

    await page.locator('#consultName').fill('Alex Driver');
    await page.locator('#consultPhone').fill('07123 456 789');
    await page.locator('#consultEmail').fill('alex@example.test');
    await page.locator('#consultExperience').selectOption('More than 30 hours');
    await page.locator('#consultPostcode').fill('rg1   1aa');
    await page.locator('#consultConsent').check();
    await page.locator('#consultSubmit').click();

    await expect(page.getByText('Your request is in.')).toBeVisible();
    expect(payload.message).toContain('Driving experience: More than 30 hours');
    expect(payload.message).toContain('Preferred pickup postcode: RG1 1AA');
    expect(addressLookupRequested).toBe(false);
  });

  test('publishes a clean ad URL and stores structured experiment fields', () => {
    const vercelConfig = JSON.parse(read('vercel.json'));
    const api = read('api/enquiries.js');
    const admin = read('public/admin/dashboard.js');
    const sitemap = read('public/sitemap.xml');
    const migration = read('db/migrations/056_enquiry_experiment_attribution.sql');
    const reviewSeed = read('db/migrations/016_seed_google_reviews.sql');
    const landing = read('public/free-consultation.html');
    const privacy = read('public/privacy.html');

    expect(vercelConfig.rewrites).toContainEqual({
      source: '/free-consultation',
      destination: '/free-consultation.html',
    });
    expect(api).toContain("'free-consultation': 'Free Learner Driver Consultation'");
    expect(api).toContain('experiment_key, experiment_variant, utm_source, utm_medium, utm_campaign, utm_content');
    expect(admin).toContain("'free-consultation': 'Free Consultation'");
    expect(admin).toContain('Ad source:');
    expect(sitemap).toContain('<loc>https://coachcarter.uk/free-consultation</loc>');
    expect(migration).toContain('ALTER TABLE enquiries');
    expect(migration).toContain('ON enquiries (school_id, experiment_key, experiment_variant, submitted_at DESC)');
    expect(landing).not.toContain('—');
    expect(landing).not.toContain('almost giving up to passing');
    expect(landing).not.toContain('sales lesson');
    expect(landing).toContain('id="consultExperience"');
    expect(landing).toContain('id="consultPostcode"');
    expect(landing).not.toContain('consultFindAddress');
    expect(landing).not.toContain('consultAddressPicker');
    expect(fs.existsSync(path.join(root, 'api/public-address-lookup.js'))).toBe(false);
    expect(privacy).not.toContain('<strong>getAddress.io</strong>');
    const peteExcerpt = 'in just a few lessons I went from a liability on the road, to passing on the first try!';
    expect(landing).toContain(peteExcerpt);
    expect(reviewSeed).toContain(peteExcerpt);
  });

  test('normalizes structured attribution without accepting arbitrary identifiers', () => {
    expect(normalizeEnquiryAttribution({
      experiment_key: ' free-consultation-v1 ',
      experiment_variant: 'B',
      utm_source: ' meta ',
      utm_medium: 'paid-social',
      utm_campaign: 'road-to-pass',
      utm_content: 'video-a',
    })).toEqual({
      experiment_key: 'free-consultation-v1',
      experiment_variant: 'B',
      utm_source: 'meta',
      utm_medium: 'paid-social',
      utm_campaign: 'road-to-pass',
      utm_content: 'video-a',
    });
    expect(normalizeEnquiryAttribution({
      experiment_key: '<script>',
      experiment_variant: 'B!',
    })).toMatchObject({ experiment_key: '', experiment_variant: '' });
  });

  test('keeps postcode validation deliberately limited to a required text value', async ({ page }) => {
    await page.goto('/free-consultation?cc_variant=A');

    const postcode = page.locator('#consultPostcode');
    await expect(postcode).toHaveAttribute('required', '');
    await expect(postcode).not.toHaveAttribute('pattern');
    await postcode.fill('rg1');
    await expect(postcode).toHaveValue('RG1');
  });

  for (const variant of ['A', 'B']) {
    test(`has no horizontal overflow on a mobile viewport in Variant ${variant}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/free-consultation?cc_variant=${variant}`);

      const stickyAction = page.locator('.mobile-cta');
      await expect(stickyAction).toBeVisible();
      const hasHorizontalOverflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(hasHorizontalOverflow).toBe(false);
    });

    test(`prioritises a compact, touch-friendly mobile journey in Variant ${variant}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/free-consultation?cc_variant=${variant}`);

      await expect(page.locator('.photo-frame')).toBeHidden();
      await expect(page.locator('.result-card')).toBeVisible();
      await expect(page.locator('.closing .brand-signoff')).toBeVisible();
      await expect(page.locator('.closing')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(page.locator('.closing .brand-signoff')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      expect(await page.locator('.site-head').evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(150);
      expect(await page.locator('#consultName').evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      expect(await page.locator('#consultSubmit').evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

      const stickyAction = page.locator('.mobile-cta');
      await stickyAction.getByRole('link').click();
      await expect(page.locator('#claim')).toBeInViewport();
      await expect(stickyAction).toHaveClass(/is-hidden/);

      await page.setViewportSize({ width: 812, height: 375 });
      await page.reload();
      const landscapeHasHorizontalOverflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(landscapeHasHorizontalOverflow).toBe(false);
      await expect(page.locator('.hero .button')).toBeVisible();
    });
  }
});
