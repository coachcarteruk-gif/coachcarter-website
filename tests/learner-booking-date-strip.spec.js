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

test.describe('learner booking date grid', () => {
  test('keeps each month in its own padded grid section', () => {
    const js = read('public/learner/book.js');
    const html = read('public/learner/book.html');
    const renderDateGrid = section(js, 'function renderDateGrid(cache) {', 'function slotStartMinutes(slot) {');

    expect(renderDateGrid).toContain('let currentMonthKey = null;');
    expect(renderDateGrid).toContain('const padMonthRow = () => {');
    expect(renderDateGrid).toContain('if (currentMonthKey) padMonthRow();');
    expect(renderDateGrid).toContain('const leadBlanks = (d.getDay() + 6) % 7;');
    expect(renderDateGrid).toContain('date-grid-month');
    expect(renderDateGrid).not.toContain('cellDates.push(null)');
    expect(renderDateGrid).not.toContain('date-cell-month-start');
    expect(html).not.toContain('.date-cell-month-start');
  });

  test('preserves date cell actions while removing inline month markers', () => {
    const js = read('public/learner/book.js');
    const renderDateGrid = section(js, 'function renderDateGrid(cache) {', 'function slotStartMinutes(slot) {');

    expect(renderDateGrid).toContain('data-action="select-date"');
    expect(renderDateGrid).toContain('data-date="${esc(ds)}"');
    expect(renderDateGrid).toContain('aria-current="date"');
    expect(renderDateGrid).toContain('<span class="date-cell-num">${dayNum}</span><span class="date-cell-dot"');
    expect(renderDateGrid).not.toContain('date-cell-month">${esc(MON_SHORT');
  });
});
