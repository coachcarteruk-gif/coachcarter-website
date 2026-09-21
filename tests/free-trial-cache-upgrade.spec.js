const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const publicRoot = path.resolve(__dirname, '../public');
const questionnaire = {
  enabled: true, version: 'qualification_v1',
  supported_centres: ['Reading', 'Greenham', 'Farnborough', 'Basingstoke'],
  maximum_hourly_pence: 5500, lower_budget_pence: 5000, lowest_budget_pence: 4500,
};

// A real HTTP cache is necessary here: Playwright route interception disables it.
// Model an old cached initializer which knows nothing about the questionnaire.
for (const enabled of [false, true]) {
  test(`a returning browser escapes the old trial script with questionnaire ${enabled ? 'enabled' : 'disabled'}`, async ({ browser }) => {
    let oldScriptReads = 0;
    let freshScriptReads = 0;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      function send(type, body) {
        res.setHeader('Content-Type', type);
        res.end(body);
      }
      if (url.pathname === '/prime') {
        return send('text/html', '<script src="/free-trial.js"></script>');
      }
      if (url.pathname === '/free-trial.js' && !url.search) {
        oldScriptReads++;
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return send('application/javascript', 'window.oldTrialInitializer = true;');
      }
      if (url.pathname === '/free-trial.js') freshScriptReads++;
      if (url.pathname === '/api/schools') {
        return send('application/json', JSON.stringify({
          ok: true, trial_questionnaire: enabled ? questionnaire : null,
          test_date_trial_funnel_enabled: false, local_date: '2030-07-01',
        }));
      }
      if (url.pathname === '/api/slots') {
        return send('application/json', JSON.stringify(url.searchParams.get('action') === 'trial-window-context'
          ? { from: '2030-07-01', to: '2030-07-29', days_ahead: 28 }
          : { slots: {} }));
      }
      const filename = path.resolve(publicRoot, '.' + (url.pathname === '/free' ? '/free-trial.html' : url.pathname));
      if (!filename.startsWith(publicRoot + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        res.statusCode = 404;
        return res.end();
      }
      // Block external resources through CSP without disabling the HTTP cache.
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
      send(types[path.extname(filename)] || 'application/octet-stream', fs.readFileSync(filename));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await context.addInitScript(() => localStorage.setItem('cc_cookie_consent', JSON.stringify({
        analytics: false, marketing: false, version: 2, timestamp: new Date().toISOString(),
      })));
      const page = await context.newPage();
      const base = `http://127.0.0.1:${server.address().port}`;
      await page.goto(base + '/prime');
      expect(await page.evaluate(() => window.oldTrialInitializer)).toBe(true);
      await page.goto(base + '/free');
      if (enabled) {
        await expect(page.getByRole('heading', { name: 'Do you have a practical driving test booked?' })).toBeVisible();
        await expect(page.locator('#trialBookingFlow')).toBeHidden();
      } else {
        await expect(page.locator('#trialQuestionnaire')).toBeHidden();
        await expect(page.locator('#trialBookingFlow')).toBeVisible();
        await expect(page.locator('#slotPicker')).toContainText('No free trial slots');
      }
      await expect(page.getByText('Loading your free trial…', { exact: true })).toBeHidden();
      expect(await page.evaluate(() => window.oldTrialInitializer)).toBeUndefined();
      expect(freshScriptReads).toBe(1);
      // Prove the old URL was still cached: returning to it does not hit the server.
      await page.goto(base + '/prime');
      expect(await page.evaluate(() => window.oldTrialInitializer)).toBe(true);
      expect(oldScriptReads).toBe(1);
    } finally {
      await context.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
