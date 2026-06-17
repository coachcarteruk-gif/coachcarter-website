// @ts-check
// Static contract tests for date-specific instructor availability overrides.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test.describe('instructor availability overrides', () => {
  test('migration creates tenant-scoped date-specific availability table', () => {
    const sql = read('db/migration.sql');
    const step = read('db/migrations/023_instructor_availability_overrides.sql');
    const transmissionStep = read('db/migrations/024_instructor_availability_override_transmission.sql');

    for (const source of [sql, step]) {
      expect(source).toContain('CREATE TABLE IF NOT EXISTS instructor_availability_overrides');
      expect(source).toContain('school_id       INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id)');
      expect(source).toContain('override_date   DATE NOT NULL');
      expect(source).toContain('transmission_type TEXT NOT NULL DEFAULT');
      expect(source).toContain("CHECK (transmission_type IN ('manual','automatic','both'))");
      expect(source).toContain('CHECK (start_time < end_time)');
      expect(source).toContain('uq_instructor_availability_override_slot');
      expect(source).toContain('idx_instructor_availability_overrides_lookup');
    }

    expect(step).toContain('CREATE TABLE IF NOT EXISTS schools');
    expect(step).toContain('ALTER TABLE instructors ADD COLUMN IF NOT EXISTS school_id');
    expect(step).toContain('ALTER TABLE instructor_availability ADD COLUMN IF NOT EXISTS school_id');
    expect(step).toContain('ALTER TABLE instructor_blackout_dates ADD COLUMN IF NOT EXISTS school_id');
    expect(step).toContain('ALTER TABLE instructor_external_events ADD COLUMN IF NOT EXISTS school_id');
    expect(step).toContain('CREATE INDEX IF NOT EXISTS idx_instructor_availability_school');
    expect(transmissionStep).toContain('ADD COLUMN IF NOT EXISTS transmission_type');
    expect(transmissionStep).toContain('chk_instructor_availability_overrides_transmission_type');
    expect(sql.indexOf('CREATE TABLE IF NOT EXISTS schools')).toBeLessThan(
      sql.indexOf('CREATE TABLE IF NOT EXISTS instructor_availability_overrides')
    );
  });

  test('instructor API exposes create, list, delete actions scoped to instructor and school', () => {
    const js = read('api/instructor.js');

    expect(js).toContain("action === 'availability-overrides'");
    expect(js).toContain("action === 'create-availability-override'");
    expect(js).toContain("action === 'delete-availability-override'");
    expect(js).toContain('FROM instructor_availability_overrides');
    expect(js).toContain('WHERE instructor_id = ${instructor.id}');
    expect(js).toContain('AND school_id = ${schoolId}');
    expect(js).toContain('ON CONFLICT (instructor_id, school_id, override_date, start_time, end_time)');
    expect(js).toContain('normaliseAvailabilityTransmissionType');
    expect(js).toContain('instructorCanOfferAvailabilityTransmission');
    expect(js).toContain('transmission_type must be manual, automatic, or both');
    expect(js).toContain('transmission_type = EXCLUDED.transmission_type');
    expect(js).toContain('min_booking_notice_hours');
    expect(js).toContain('Cannot add availability for a time that has already started');
    expect(js).toContain('Availability slot overlaps an existing one-off slot');
    expect(js).toContain('AND NOT (start_time = ${start_time}::time AND end_time = ${end_time}::time)');
    expect(js).toContain('FROM instructor_external_events');
    expect(js).toContain('AND is_all_day = true');
    expect(js).toContain('Your synced calendar has an all-day event on this date');
  });

  test('slot feed and duration checks include explicit date overrides', () => {
    const slots = read('api/slots.js');

    expect(slots).toContain('FROM instructor_availability_overrides iao');
    expect(slots).toContain('iao.override_date BETWEEN ${from} AND ${to}');
    expect(slots).toContain('override_date: w.override_date || null');
    expect(slots).toContain('transmission_type: clampSlotTransmissionType(w.transmission_type, instructorTransmissionType)');
    expect(slots).toContain('slotSupportsTransmission(window.transmission_type, requestedTransmissionType)');
    expect(slots).toContain('transmission_type: window.transmission_type');
    expect(slots).toContain('clampSlotTransmissionType(w.transmission_type, w.instructor_transmission_type)');
    expect(slots).toContain('const matchingOverrideWindows = overrideWindows.filter');
    expect(slots).toContain('const externalAllDayIndex = new Set()');
    expect(slots).toContain('externalAllDayIndex.add(`${e.instructor_id}|${e.event_date}`)');
    expect(slots).toContain('if (externalAllDayIndex.has(`${instructor.id}|${dateStr}`)) continue;');
    expect(slots).toContain('const daySlotKeys = new Set()');
    expect(slots).toContain('if (daySlotKeys.has(slotKey))');
    expect(slots).toContain('daySlotKeys.add(slotKey)');
    expect(slots).toContain('const dateWindows = instructor.windows.filter(w => w.override_date === dateStr)');
    expect(slots).toContain('const weeklyWindows = isBlackout');
    expect(slots).toContain('FROM instructor_availability_overrides');
    expect(slots).toContain('override_date = ${date}::date');
    expect(slots).toContain('AND iee.school_id = ${schoolId}');
    expect(slots).toContain('AND school_id = ${schoolId}');
  });

  test('booking entry points re-check active availability before reserving stale slots', () => {
    const slots = read('api/slots.js');

    expect(slots).toContain('async function slotFitsActiveAvailability');
    expect(slots).toContain('if (externalEvents.some(e => e.is_all_day)) return false');
    expect(slots).toContain('COALESCE(min_booking_notice_hours, 24) AS min_booking_notice_hours');
    expect(slots).toContain('if (((slotDateTime - new Date()) / 3600000) < minNoticeHours) return false');
    expect(slots).toContain('return [...weeklyWindows, ...overrideWindows].some');
    expect(slots).toContain('const unavailableDates = []');
    expect(slots).toContain('transmissionType: requestedTransmissionType');
    expect(slots).toContain('transmission_type: bookingTransmissionType');
    expect(slots).toContain("reason: 'outside availability'");
    expect(slots).toContain('action=checkout-slot');
    expect(slots).toContain('action=checkout-slot-guest');
    expect(slots).toContain("action === 'book-free-trial'");
    expect(slots.match(/slotFitsActiveAvailability\(sql/g)?.length || 0).toBeGreaterThanOrEqual(4);
  });

  test('duration checks use the longest matching availability window', () => {
    const slots = read('api/slots.js');

    expect(slots).toContain('if (windowEnd == null || we > windowEnd)');
    expect(slots).toContain('windowEnd = we');
    expect(slots).toContain('slotTransmissionType = normaliseSlotTransmissionType(w.transmission_type)');
    expect(slots).not.toContain('windowEnd = we; break;');
  });

  test('calendar UI creates and removes one-off slots without editing weekly windows', () => {
    const html = read('public/instructor/index.html');
    const js = read('public/instructor/index.js');
    const learnerJs = read('public/learner/book.js');

    expect(html).toContain('id="btn-open-avail"');
    expect(html).toContain('id="modalDate"');
    expect(html).toContain('id="modalTransmission"');
    expect(js).toContain("availabilityOverrideCache = {}");
    expect(js).toContain("create-availability-override");
    expect(js).toContain("delete-availability-override");
    expect(js).toContain("transmission_type: transmission");
    expect(js).toContain("availabilityTransmissionBadge");
    expect(learnerJs).toContain("&transmission_type=${encodeURIComponent(slot.transmission_type)}");
    expect(js).not.toContain("body: JSON.stringify({ windows: updated })");
  });
});
