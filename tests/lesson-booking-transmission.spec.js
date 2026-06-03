// @ts-check
// Static contract tests for per-booking lesson transmission selection.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test.describe('lesson booking transmission', () => {
  test('migration adds a concrete manual/automatic field to lesson bookings', () => {
    const sql = read('db/migration.sql');
    const step = read('db/migrations/025_lesson_booking_transmission_type.sql');

    for (const source of [sql, step]) {
      expect(source).toContain('ALTER TABLE lesson_bookings');
      expect(source).toContain('ADD COLUMN IF NOT EXISTS transmission_type');
      expect(source).toContain("CHECK (transmission_type IN ('manual','automatic'))");
      expect(source).toContain('chk_lesson_bookings_transmission_type');
    }
  });

  test('instructor create/edit APIs validate, persist, and return lesson transmission', () => {
    const js = read('api/instructor.js');

    expect(js).toContain('normaliseLessonTransmissionType');
    expect(js).toContain('instructorCanTeachLessonTransmission');
    expect(js).toContain('transmission_type must be manual or automatic');
    expect(js).toContain('transmission_type = ${newTransmissionType}');
    expect(js).toContain('transmissionType: bookingTransmissionType');
    expect(js).toContain('transmission_type: bookingTransmissionType');
    expect(js).toContain('COALESCE(lb.transmission_type');
    expect(js).toContain('AS transmission_type');
  });

  test('instructor calendar UI can select and show lesson transmission', () => {
    const html = read('public/instructor/index.html');
    const js = read('public/instructor/index.js');

    expect(html).toContain('id="editBookingTransmission"');
    expect(html).toContain('id="addLessonTransmission"');
    expect(js).toContain('configureLessonTransmissionSelect');
    expect(js).toContain('bookingTransmissionBadge');
    expect(js).toContain('transmission_type: newTransmission');
    expect(js).toContain('transmission_type: transmission');
  });
});
