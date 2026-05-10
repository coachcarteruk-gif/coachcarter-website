// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// Smoke tests run against a local static server (npx serve public) so they
// don't require Postgres or Vercel functions. Pure Node API checks hit
// vercel dev when CC_TEST_BASE_URL points at it. Keep these tests fast and
// hermetic — they are a guardrail against UI regressions in the offer flow,
// not a substitute for a manual end-to-end test in Stripe test mode.
module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.CC_TEST_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  // Auto-boot a static server so `npm test` works cold. If CC_TEST_BASE_URL is
  // set (e.g. pointing at `vercel dev` for the live-API tests), skip this.
  webServer: process.env.CC_TEST_BASE_URL ? undefined : {
    command: 'npx --yes serve public -l 3000 --no-clipboard',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
