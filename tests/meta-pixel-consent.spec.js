// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PAGE = '/free-trial.html';
const root = path.resolve(__dirname, '..');

async function blockTracking(page) {
  const calls = [];
  await page.route('https://connect.facebook.net/**', (route) => {
    calls.push(route.request().url());
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  await page.route('https://www.facebook.com/tr/**', (route) => {
    calls.push(route.request().url());
    route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/*posthog*/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/slots?action=available**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{"slots":{}}',
  }));
  await page.route('**/api/config?action=record-consent', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{"ok":true}',
  }));
  return calls;
}

test.describe('Meta Pixel consent gate', () => {
  test.use({ serviceWorkers: 'block' });

  test('does not initialise or request Meta before a choice', async ({ page }) => {
    const calls = await blockTracking(page);
    await page.goto(PAGE);

    expect(await page.evaluate(() => typeof window.fbq)).toBe('undefined');
    expect(calls).toHaveLength(0);
  });

  test('analytics consent alone does not load Meta', async ({ page }) => {
    const calls = await blockTracking(page);
    await page.addInitScript(() => {
      localStorage.setItem('cc_cookie_consent', JSON.stringify({
        analytics: true,
        marketing: false,
        version: 2,
        timestamp: '2026-09-14T00:00:00.000Z',
      }));
    });
    await page.goto(PAGE);

    expect(await page.evaluate(() => typeof window.fbq)).toBe('undefined');
    expect(calls.filter((url) => url.includes('facebook'))).toHaveLength(0);
  });

  test('marketing consent loads Pixel 2271167423422360 and queues PageView', async ({ page }) => {
    const calls = await blockTracking(page);
    await page.addInitScript(() => {
      localStorage.setItem('cc_cookie_consent', JSON.stringify({
        analytics: false,
        marketing: true,
        version: 2,
        timestamp: '2026-09-14T00:00:00.000Z',
      }));
    });
    await page.goto(PAGE);

    await expect.poll(() => calls.some((url) => url === 'https://connect.facebook.net/en_US/fbevents.js')).toBe(true);
    const queue = await page.evaluate(() => window.fbq && window.fbq.queue.map((args) => Array.from(args)));
    expect(queue).toContainEqual(['init', '2271167423422360']);
    expect(queue).toContainEqual(['track', 'PageView']);
  });

  test('a fresh visitor can grant marketing without granting analytics', async ({ page }) => {
    const calls = await blockTracking(page);
    await page.goto(PAGE);

    await page.locator('#cc-marketing-toggle').check();
    await page.locator('#cc-save-prefs').click();

    await expect.poll(() => calls.includes('https://connect.facebook.net/en_US/fbevents.js')).toBe(true);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cc_cookie_consent') || 'null'));
    expect(stored).toMatchObject({ analytics: false, marketing: true, version: 2 });
    const queue = await page.evaluate(() => window.fbq && window.fbq.queue.map((args) => Array.from(args)));
    expect(queue).toContainEqual(['init', '2271167423422360']);
    expect(queue).toContainEqual(['track', 'PageView']);
  });

  test('revoking marketing consent tells an already-loaded Pixel to stop', async ({ page }) => {
    await blockTracking(page);
    await page.addInitScript(() => {
      localStorage.setItem('cc_cookie_consent', JSON.stringify({
        analytics: false,
        marketing: true,
        version: 2,
        timestamp: '2026-09-14T00:00:00.000Z',
      }));
    });
    await page.goto(PAGE);

    await page.evaluate(() => window.ccCookieConsent.show());
    await page.locator('#cc-marketing-toggle').uncheck();
    await page.locator('#cc-save-prefs').click();

    const queue = await page.evaluate(() => window.fbq && window.fbq.queue.map((args) => Array.from(args)));
    expect(queue).toContainEqual(['consent', 'revoke']);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cc_cookie_consent') || 'null'));
    expect(stored).toMatchObject({ analytics: false, marketing: false, version: 2 });
  });

  test('the page uses the external gated loader and no consent-bypassing noscript pixel', () => {
    const html = fs.readFileSync(path.join(root, 'public/free-trial.html'), 'utf8');
    const middleware = fs.readFileSync(path.join(root, 'middleware.js'), 'utf8');
    const migration = fs.readFileSync(path.join(root, 'db/migrations/065_cookie_consent_marketing.sql'), 'utf8');
    expect(html).toContain('<script src="/meta-pixel-loader.js"></script>');
    expect(html).not.toContain('facebook.com/tr?id=2271167423422360');
    expect(middleware).toContain('https://connect.facebook.net');
    expect(middleware).toContain('https://www.facebook.com');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS marketing BOOLEAN NOT NULL DEFAULT FALSE');
  });
});
