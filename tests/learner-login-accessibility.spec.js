// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('learner login form controls have programmatic labels', async ({ page }) => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public/learner/login.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  await page.setContent(source);

  const unlabelled = await page.locator('input:not([type="hidden"]), select, textarea').evaluateAll((controls) =>
    controls.filter((control) => {
      const ariaLabel = control.getAttribute('aria-label');
      const labelledBy = control.getAttribute('aria-labelledby');
      return !ariaLabel && !labelledBy && (!control.labels || control.labels.length === 0);
    }).map((control) => control.id || control.outerHTML)
  );

  expect(unlabelled).toEqual([]);
  await expect(page.locator('main h1')).toHaveCount(1);
});
