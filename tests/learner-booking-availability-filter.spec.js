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

test.describe('learner booking availability filter', () => {
  test('adds an auth-only saved availability filter beside the instructor filter', () => {
    const html = read('public/learner/book.html');
    const js = read('public/learner/book.js');

    expect(html).toContain('id="availabilityFilterWrap" hidden');
    expect(html).toContain('id="availabilityFilter"');
    expect(html).toContain('Only show times I&rsquo;m usually free');
    expect(html).toContain('href="/learner/profile.html#availability"');
    expect(js).toContain("let availabilityFilterMode = localStorage.getItem('cc_booking_availability_filter') === '1';");
    expect(js).toContain("if (availabilityFilter) availabilityFilter.addEventListener('change', onAvailabilityFilterChange);");
  });

  test('keeps availability inside Profile and out of top-level navigation', () => {
    const availabilityHtml = read('public/learner/availability.html');
    const availabilityJs = read('public/learner/availability.js');
    const profileHtml = read('public/learner/profile.html');
    const sidebar = read('public/sidebar.js');

    expect(availabilityHtml).toContain('/learner/profile.html#availability');
    expect(availabilityJs).toContain('/api/learner?action=my-availability');
    expect(availabilityJs).toContain('/api/learner?action=set-availability');
    expect(profileHtml).toContain('id="availability"');
    expect(profileHtml).toContain('id="availDays"');
    expect(profileHtml).toContain('id="btnSaveAvail"');
    expect(profileHtml).toContain('src="/learner/availability.js"');
    expect(sidebar).not.toContain("label: 'Availability', href: '/learner/availability.html', authOnly: true");
    expect(sidebar).toContain("label: 'Profile', href: '/learner/profile.html'");
    expect(sidebar).toContain("activeOn: ['/learner/availability']");
  });

  test('filters only the client-side slot cache and keeps the server request contract unchanged', () => {
    const js = read('public/learner/book.js');
    const fetchFeedSlots = section(js, 'async function fetchFeedSlots(fromDate, toDate) {', 'function getDateRangeStrings(fromDate, toDate) {');
    const visibleSlots = section(js, 'function getVisibleSlotsFromCache(cache) {', 'function getAvailableDateStrings(cache) {');
    const availableDates = section(js, 'function getAvailableDateStrings(cache) {', 'function getDateGridRangeStrings(cache) {');
    const calendar = section(js, 'function renderBookingCalendar(cache, opts) {', 'function selectDate(dateStr) {');

    expect(js).toContain('function slotMatchesLearnerAvailability(slot) {');
    expect(js).toContain("new Date(slot.date + 'T00:00:00').getDay()");
    expect(js).toContain('start >= timeToMinutes(w.start_time)');
    expect(js).toContain('end <= timeToMinutes(w.end_time)');
    expect(fetchFeedSlots).not.toContain('availability');
    expect(visibleSlots).toContain('getFilteredSlotCache(cache)');
    expect(availableDates).toContain('getFilteredSlotCache(cache)');
    expect(calendar).toContain('const visibleCache = getFilteredSlotCache(cache);');
  });

  test('scopes learner availability reads and writes by school_id', () => {
    const api = read('api/learner.js');
    const getHandler = section(api, 'async function handleMyAvailability(req, res) {', 'async function handleSetAvailability(req, res) {');
    const setHandler = section(api, 'async function handleSetAvailability(req, res) {', '// ═════');

    expect(getHandler).toContain('const schoolId = user.school_id || 1;');
    expect(getHandler).toContain('WHERE learner_id = ${user.id} AND school_id = ${schoolId} AND active = true');
    expect(setHandler).toContain('const schoolId = user.school_id || 1;');
    expect(setHandler).toContain('DELETE FROM learner_availability WHERE learner_id = ${user.id} AND school_id = ${schoolId}');
    expect(setHandler).toContain('INSERT INTO learner_availability (learner_id, school_id, day_of_week, start_time, end_time)');
  });
});
