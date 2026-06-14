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

test.describe('learner reschedule duration preservation', () => {
  test('booking page locks reschedule feed to the existing booking duration', () => {
    const bookJs = read('public/learner/book.js');
    const init = section(bookJs, 'function init() {', 'function dismissWelcome() {');
    const chooser = section(bookJs, 'function chooseLessonTypeForExistingBooking(booking) {', 'function lessonLengthLabel(lt) {');

    expect(init).toContain('await loadLessonTypes();');
    expect(init).toContain('chooseLessonTypeForExistingBooking(booking);');
    expect(chooser).toContain('booking.lesson_type_id');
    expect(chooser).toContain('parseInt(booking.duration_minutes, 10)');
    expect(bookJs).toContain("showToast('Rescheduled lessons keep their original duration.', '');");
  });

  test('API falls back to booking time span before defaulting to 90 minutes', () => {
    const slotsJs = read('api/slots.js');
    const reschedule = section(slotsJs, 'async function handleReschedule(req, res) {', '// ── GET /api/slots?action=my-bookings');
    const myBookings = section(slotsJs, 'async function handleMyBookings(req, res) {', '// ── GET /api/slots?action=series-info');

    const timeSpanFallback = 'ROUND(EXTRACT(EPOCH FROM (lb.end_time - lb.start_time)) / 60)::int';
    expect(reschedule).toContain(timeSpanFallback);
    expect(reschedule).toContain('AS type_duration_minutes');
    expect(myBookings).toContain(timeSpanFallback);
    expect(myBookings).toContain('AS duration_minutes');
  });
});
