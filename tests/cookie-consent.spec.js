// @ts-check
const { test, expect } = require('@playwright/test');

// GDPR cookie-consent guardrail (CLAUDE.md hard rule: "Never load analytics
// without consent"). The risk this defends against is shipping a page that
// either skips the banner entirely or loads PostHog before the user clicks
// Accept — both are silent regressions in the browser and only surface as
// ICO complaints months later.
//
// What this exercises:
//   1. Banner auto-shows on a fresh visit (no localStorage).
//   2. PostHog is NOT loaded before the user makes a choice.
//   3. "Accept All" persists analytics=true and triggers PostHog load.
//   4. "Reject All" persists analytics=false and does NOT load PostHog.
//   5. Existing consent suppresses the banner on subsequent visits.
//   6. Escape key counts as "Reject All" (the contract in cookie-consent.js).
//   7. The consent record is POSTed to /api/config?action=record-consent.
//
// What this DOES NOT exercise:
//   - The actual /api/config record-consent server logic (intercepted here).
//   - PostHog network calls (we just assert window.posthog presence/absence,
//     which is the user-visible contract — the loader is a third-party blob).

const PAGE = '/'; // index.html — loads cookie-consent.js + posthog-loader.js

// Block PostHog assets so a real CDN call never happens during tests, and so
// we can assert "did the loader try?" via the route handler.
async function blockPostHog(page) {
  const calls = [];
  await page.route('**/*posthog*/**', (route) => {
    calls.push(route.request().url());
    route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/eu.i.posthog.com/**', (route) => {
    calls.push(route.request().url());
    route.fulfill({ status: 204, body: '' });
  });
  return calls;
}

// Stub the consent-recording endpoint so the test doesn't need a live API.
async function stubConsentRecord(page) {
  const recorded = [];
  await page.route('**/api/config?action=record-consent', async (route) => {
    const body = route.request().postDataJSON();
    recorded.push(body);
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  return recorded;
}

test.describe('Cookie consent — GDPR gate', () => {
  test('banner auto-shows on first visit', async ({ page }) => {
    await blockPostHog(page);
    await stubConsentRecord(page);
    await page.goto(PAGE);
    await expect(page.locator('#cc-consent-overlay')).toBeVisible();
    await expect(page.locator('#cc-consent-banner h3')).toHaveText('Cookie Preferences');
    // Necessary checkbox is locked on; analytics toggle starts off.
    await expect(page.locator('#cc-analytics-toggle')).not.toBeChecked();
  });

  test('PostHog does NOT load before consent', async ({ page }) => {
    const phCalls = await blockPostHog(page);
    await stubConsentRecord(page);
    await page.goto(PAGE);
    // Banner is up. window.posthog should be untouched (no init, no array stub).
    const hasPosthog = await page.evaluate(() => typeof window.posthog !== 'undefined');
    expect(hasPosthog).toBe(false);
    expect(phCalls).toHaveLength(0);
  });

  test('Accept All persists analytics=true and loads PostHog', async ({ page }) => {
    await blockPostHog(page);
    const recorded = await stubConsentRecord(page);
    await page.goto(PAGE);
    await page.locator('#cc-accept-all').click();
    // Banner closes.
    await expect(page.locator('#cc-consent-overlay')).toHaveCount(0);
    // localStorage holds the consent blob.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cc_cookie_consent') || 'null'));
    expect(stored).toMatchObject({ analytics: true, version: 1 });
    expect(stored.timestamp).toBeTruthy();
    // PostHog stub was installed by the loader's IIFE on consent-updated.
    await expect.poll(async () => page.evaluate(() => typeof window.posthog)).toBe('object');
    // Server was told.
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ analytics: true });
    expect(recorded[0].visitor_id).toMatch(/^v_/);
  });

  test('Reject All persists analytics=false and does NOT load PostHog', async ({ page }) => {
    const phCalls = await blockPostHog(page);
    const recorded = await stubConsentRecord(page);
    await page.goto(PAGE);
    await page.locator('#cc-reject-all').click();
    await expect(page.locator('#cc-consent-overlay')).toHaveCount(0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cc_cookie_consent') || 'null'));
    expect(stored).toMatchObject({ analytics: false, version: 1 });
    // Loader saw the event but should not have injected the PostHog stub.
    const hasPosthog = await page.evaluate(() => typeof window.posthog !== 'undefined');
    expect(hasPosthog).toBe(false);
    expect(phCalls).toHaveLength(0);
    expect(recorded[0]).toMatchObject({ analytics: false });
  });

  test('existing consent suppresses banner on next visit', async ({ page }) => {
    await blockPostHog(page);
    await stubConsentRecord(page);
    // Seed consent before the page's scripts run.
    await page.addInitScript(() => {
      localStorage.setItem('cc_cookie_consent', JSON.stringify({
        analytics: true, version: 1, timestamp: new Date().toISOString(),
      }));
    });
    await page.goto(PAGE);
    // Wait for the loader's PostHog injection to settle. Without this, the
    // dynamic <script> insert can destroy the evaluation context Playwright
    // uses to poll the locator, surfacing as flaky
    // "Execution context was destroyed" failures.
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#cc-consent-overlay')).toHaveCount(0);
    // PostHog should auto-load on this visit because consent was already true.
    await expect.poll(async () => page.evaluate(() => typeof window.posthog)).toBe('object');
  });

  test('Escape key is treated as Reject All', async ({ page }) => {
    await blockPostHog(page);
    const recorded = await stubConsentRecord(page);
    await page.goto(PAGE);
    await expect(page.locator('#cc-consent-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#cc-consent-overlay')).toHaveCount(0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cc_cookie_consent') || 'null'));
    expect(stored).toMatchObject({ analytics: false, version: 1 });
    expect(recorded[0]).toMatchObject({ analytics: false });
  });

  test('stale consent version triggers re-prompt', async ({ page }) => {
    // Bumping CONSENT_VERSION in cookie-consent.js must invalidate old consents
    // (e.g. when adding a new cookie category). Simulate an old v0 record.
    await blockPostHog(page);
    await stubConsentRecord(page);
    await page.addInitScript(() => {
      localStorage.setItem('cc_cookie_consent', JSON.stringify({
        analytics: true, version: 0, timestamp: '2024-01-01T00:00:00Z',
      }));
    });
    await page.goto(PAGE);
    await expect(page.locator('#cc-consent-overlay')).toBeVisible();
  });
});
