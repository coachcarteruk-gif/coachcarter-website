// @ts-check
// Static contract tests for instructor-controlled learner advance booking windows.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

test.describe('instructor advance booking window', () => {
  test('migration adds capped instructor booking-window column', () => {
    const migration = read('db/migration.sql');
    const step = read('db/migrations/028_instructor_max_booking_days_ahead.sql');

    for (const source of [migration, step]) {
      expect(source).toContain('ADD COLUMN IF NOT EXISTS max_booking_days_ahead INTEGER DEFAULT 84');
      expect(source).toContain('chk_instructors_max_booking_days_ahead');
      expect(source).toContain('CHECK (max_booking_days_ahead BETWEEN 1 AND 84)');
    }
  });

  test('instructor profile API returns, validates, and persists the setting', () => {
    const api = read('api/instructor.js');

    expect(api).toContain('COALESCE(max_booking_days_ahead, 84) AS max_booking_days_ahead');
    expect(api).toContain('name, phone, bio, photo_url, buffer_minutes, max_booking_days_ahead');
    expect(api).toContain('Advance booking window must be between 1 and 84 days');
    expect(api).toContain('max_booking_days_ahead = COALESCE(${maxBookingDaysVal}, max_booking_days_ahead)');
  });

  test('instructor profile UI exposes the setting in scheduling and posts it', () => {
    const js = read('public/instructor/profile.js');

    expect(js).toContain('id="inputMaxBookingDays"');
    expect(js).toContain('How far ahead learners can book');
    expect(js).toContain('12 weeks ahead (default)');
    expect(js).toContain("const max_booking_days_ahead = parseInt(document.getElementById('inputMaxBookingDays').value);");
    expect(js).toContain('buffer_minutes, max_booking_days_ahead, reminder_hours');
  });

  test('slot availability and booking entry points enforce the instructor window', () => {
    const slots = read('api/slots.js');

    expect(slots).toContain('function normaliseMaxBookingDaysAhead');
    expect(slots).toContain('function isDateWithinBookingWindow');
    expect(slots).toContain('function advanceWindowError');
    expect(slots).toContain('COALESCE(i.max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead');
    expect(slots).toContain('max_booking_days_ahead: normaliseMaxBookingDaysAhead(w.max_booking_days_ahead)');
    expect(slots).toContain('if (!isDateWithinBookingWindow(cursor, instructor.max_booking_days_ahead)) continue;');
    expect(slots).toContain("fits = false; reason = 'advance';");
    expect(slots.match(/advanceWindowError\(/g)?.length || 0).toBeGreaterThanOrEqual(4);
    expect(slots.match(/slotFitsActiveAvailability\(sql/g)?.length || 0).toBeGreaterThanOrEqual(4);
  });

  test('learner booking modal explains stale slots outside the instructor window', () => {
    const js = read('public/learner/book.js');

    expect(js).toContain("reasons.includes('advance')");
    expect(js).toContain("this date is outside the instructor\\'s booking window");
    expect(js).toContain("d.reason === 'advance' ? 'too far ahead'");
  });
});
