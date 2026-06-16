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

    expect(helper).toContain("document.querySelector('.date-chip[aria-current=\"date\"]')");
    expect(helper).toContain("selectedChip.closest('.date-strip-wrap')");
    expect(helper).toContain('scroller.scrollTo({');
    expect(helper).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(selectDate).toContain('renderFeed({ scrollSelectedDate: true });');
    expect(renderFeed).toContain('opts = opts || {};');
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
});
