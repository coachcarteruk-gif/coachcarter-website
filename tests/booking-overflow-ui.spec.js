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
    const filterHelper = section(bookJs, 'function filterSlotCacheByInstructor(cache, instructorId, opts) {', 'function sortSlots');

    expect(filterHelper).toContain('opts.exclude ? !sameInstructor : sameInstructor');
    expect(initFeed).toContain('const selectedInstructorCache = filterSlotCacheByInstructor(overflowCache, instructorId);');
    expect(initFeed).toContain('slotCache = selectedInstructorCache;');
    expect(initFeed).toContain('overflowCache = filterSlotCacheByInstructor(overflowCache, instructorId, { exclude: true });');
    expect(initFeed).toContain('overflowMode = true;');
  });
});
