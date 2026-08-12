const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sidebarSource = fs.readFileSync(path.join(root, 'public', 'sidebar.js'), 'utf8');
const instructorStyles = fs.readFileSync(path.join(root, 'public', 'shared', 'instructor.css'), 'utf8');

async function openInstructorShell(page, wrapperClass) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('http://scroll.test/sidebar.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: sidebarSource,
  }));
  await page.route('http://scroll.test/Logo.png', route => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from(''),
  }));
  await page.route('http://scroll.test/instructor/dashboard.html', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html>
      <html><head>
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
        <style>${instructorStyles}</style>
        <style>
          .${wrapperClass.split(' ').join('.')} { padding: 20px 16px; }
          .test-card { height: 220px; margin-bottom: 16px; }
        </style>
        <script src="/sidebar.js"></script>
      </head><body>
        <div class="${wrapperClass}">
          ${Array.from({ length: 6 }, (_, index) => `<div class="test-card">${index + 1}</div>`).join('')}
        </div>
      </body></html>`,
  }));

  await page.goto('http://scroll.test/instructor/dashboard.html');
  await expect(page.locator('body')).toHaveClass(/cc-context-instructor/);
}

test.describe('instructor mobile scrolling', () => {
  test('uses native document scrolling for the dashboard wrapper', async ({ page }) => {
    await openInstructorShell(page, 'dash planner-page');

    const metrics = await page.evaluate(() => ({
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      documentScrollHeight: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
    }));

    expect(metrics.bodyOverflowY).toBe('auto');
    expect(metrics.documentScrollHeight).toBeGreaterThan(metrics.viewportHeight);

    await page.mouse.wheel(0, 700);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  });

  test('does not trap the calendar page in a nested scroll container', async ({ page }) => {
    await openInstructorShell(page, 'page planner-page');

    const metrics = await page.locator('.page').evaluate(element => ({
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
    }));

    expect(metrics.overflowY).toBe('visible');
    expect(metrics.clientHeight).toBe(metrics.scrollHeight);
  });
});
