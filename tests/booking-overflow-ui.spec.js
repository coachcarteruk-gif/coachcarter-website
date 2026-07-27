const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function section(source, start, end) {
  const s = source.indexOf(start);
  expect(s).toBeGreaterThanOrEqual(0);
  const e = source.indexOf(end, s + start.length);
  expect(e).toBeGreaterThan(s);
  return source.slice(s, e);
}

test.describe('booking overflow routing UI', () => {
  test('does not render selected instructor slots as other-instructor overflow', () => {
    const bookJs = read('public/learner/book.js');
    const initFeed = section(bookJs, 'async function initFeed() {', 'async function fetchFeedSlots');
    const fetchFeed = section(bookJs, 'async function fetchFeedSlots(fromDate, toDate) {', 'function getDateRangeStrings');
    const renderFeed = section(bookJs, 'function renderFeed() {', 'function updateFeedFooter');

    expect(initFeed).toContain("const instructorId = document.getElementById('instructorFilter').value;");
    expect(initFeed).toContain('if (instructorId) {');
    expect(fetchFeed).toContain('if (instructorId) url += `&instructor_id=${instructorId}`;');
    expect(renderFeed).toContain("const showInstructor = !document.getElementById('instructorFilter').value;");
    expect(bookJs).not.toContain('overflowCache');
    expect(bookJs).not.toContain('overflowMode');
    expect(bookJs).not.toContain('filterSlotCacheByInstructor');
  });
});
