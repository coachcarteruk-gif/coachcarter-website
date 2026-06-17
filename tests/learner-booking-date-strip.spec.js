const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

function section(source, start, end) {
  const s = source.indexOf(start);
  expect(s).toBeGreaterThanOrEqual(0);
  const e = source.indexOf(end, s + start.length);
  expect(e).toBeGreaterThan(s);
  return source.slice(s, e);
}

test.describe('learner booking date strip', () => {
  test('keeps a selected future date visible after the calendar rerenders', () => {
    const js = read('public/learner/book.js');
    const helper = section(js, 'function scrollSelectedDateIntoView() {', 'function selectDate(dateStr) {');
    const selectDate = section(js, 'function selectDate(dateStr) {', 'function slotDatasetFromButton(buttonEl) {');
    const renderFeed = section(js, 'function renderFeed(opts) {', 'function updateFeedFooter(slotCount) {');

    expect(js).toContain('function currentDateStripScrollLeft() {');
    expect(js).toContain('function restoreDateStripScrollLeft(scrollLeft) {');
    expect(js).toContain('data-selected-date-heading');
    expect(selectDate).toContain('const dateStripScrollLeft = currentDateStripScrollLeft();');
    expect(helper).toContain("document.querySelector('.date-chip[aria-current=\"date\"]')");
    expect(helper).toContain("selectedChip.closest('.date-strip-wrap')");
    expect(helper).toContain('scroller.scrollTo({');
    expect(helper).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(selectDate).toContain('renderFeed({ scrollSelectedDate: true, dateStripScrollLeft });');
    expect(renderFeed).toContain('opts = opts || {};');
    expect(renderFeed.match(/restoreDateStripScrollLeft\(opts\.dateStripScrollLeft\);/g)).toHaveLength(2);
    expect(renderFeed.match(/if \(opts\.scrollSelectedDate\) scrollSelectedDateIntoView\(\);/g)).toHaveLength(2);
  });

  test('scroll helper moves the horizontal strip to the selected chip', async ({ page }) => {
    const js = read('public/learner/book.js');
    const helper = section(js, 'function scrollSelectedDateIntoView() {', 'function selectDate(dateStr) {');
    const chips = Array.from({ length: 21 }, (_, index) => {
      const selected = index === 14;
      return `<button class="date-chip" ${selected ? 'aria-current="date"' : ''}>Day ${index + 1}</button>`;
    }).join('');

    await page.setContent(`
      <style>
        .date-strip-wrap { width: 240px; overflow-x: auto; }
        .date-strip { display: flex; gap: 8px; }
        .date-chip { flex: 0 0 80px; height: 52px; }
      </style>
      <div class="date-strip-wrap"><div class="date-strip">${chips}</div></div>
    `);
    await page.addScriptTag({ content: helper });
    await page.evaluate(() => {
      window.matchMedia = () => ({ matches: true });
      scrollSelectedDateIntoView();
    });

    await expect.poll(
      () => page.locator('.date-strip-wrap').evaluate(el => el.scrollLeft),
      { timeout: 3000 }
    ).toBeGreaterThan(0);
    await expect(page.locator('.date-chip[aria-current="date"]')).toBeInViewport();
  });

  test('clicking a date chip updates the visible selected date and times', async ({ page }) => {
    const html = read('public/learner/book.html');
    const js = read('public/learner/book.js');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const fmt = d => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const todayStr = fmt(today);
    const tomorrowStr = fmt(tomorrow);
    const tomorrowFull = tomorrow.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/learner/book.html') {
        await route.fulfill({ status: 200, contentType: 'text/html', body: html });
      } else if (url.pathname === '/learner/book.js') {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: js });
      } else if (url.pathname === '/shared/learner-auth.js') {
        await route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: 'window.ccAuth = { getAuth: () => null, fetchAuthed: url => fetch(url) };'
        });
      } else if (url.pathname === '/api/instructors') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ instructors: [{ id: 1, name: 'Fraser Carter' }] })
        });
      } else if (url.pathname === '/api/lesson-types') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            lesson_types: [{ id: 1, name: 'Standard Lesson', slug: 'standard', duration_minutes: 60, price_pence: 6000 }]
          })
        });
      } else if (url.pathname === '/api/slots' && url.searchParams.get('action') === 'available') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            slots: {
              [todayStr]: [{
                date: todayStr,
                start_time: '09:00',
                end_time: '10:00',
                instructor_id: 1,
                instructor_name: 'Fraser Carter',
                transmission_type: 'manual'
              }],
              [tomorrowStr]: [{
                date: tomorrowStr,
                start_time: '14:00',
                end_time: '15:00',
                instructor_id: 1,
                instructor_name: 'Fraser Carter',
                transmission_type: 'manual'
              }]
            },
            travel_hidden: 0
          })
        });
      } else if (url.pathname.endsWith('.css')) {
        await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      } else if (url.pathname.endsWith('.js')) {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      } else {
        await route.fulfill({ status: 204, body: '' });
      }
    });

    await page.goto('http://coachcarter.test/learner/book.html');
    await expect(page.locator('[data-selected-date-heading]')).toContainText(todayStr.slice(0, 4));
    await expect(page.locator('.time-slot-button')).toContainText('09:00');

    const scroller = page.locator('.date-strip-wrap');
    await scroller.evaluate(el => { el.scrollLeft = 40; });
    await page.locator(`.date-chip[data-date="${tomorrowStr}"]`).click();

    await expect(page.locator('[data-selected-date-heading] strong')).toHaveText(tomorrowFull);
    await expect(page.locator('.time-slot-button')).toContainText('14:00');
    await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  });
});
