// @ts-check
// Static contract tests for transmission-aware recurring instructor availability.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test.describe('weekly instructor availability transmission', () => {
  test('migration adds transmission type to recurring availability windows', () => {
    const sql = read('db/migration.sql');
    const step = read('db/migrations/026_weekly_availability_transmission.sql');

    for (const source of [sql, step]) {
      expect(source).toContain('ALTER TABLE instructor_availability');
      expect(source).toContain('ADD COLUMN IF NOT EXISTS transmission_type');
      expect(source).toContain("CHECK (transmission_type IN ('manual','automatic','both'))");
      expect(source).toContain('chk_instructor_availability_transmission_type');
    }

    expect(step).toContain("COALESCE(i.transmission_type, 'manual') IN ('automatic', 'both')");
    expect(sql).toContain('Existing');
    expect(sql).toContain('dual-car instructors keep both');
  });

  test('instructor availability API round-trips and validates window transmission', () => {
    const js = read('api/instructor.js');

    expect(js).toContain("COALESCE(transmission_type, 'both') AS transmission_type");
    expect(js).toContain('normaliseAvailabilityTransmissionType(w.transmission_type)');
    expect(js).toContain('instructorCanOfferAvailabilityTransmission(instructorTransmissionType, cleanTransmissionType)');
    expect(js).toContain('INSERT INTO instructor_availability (instructor_id, day_of_week, start_time, end_time, transmission_type, school_id)');
    expect(js).toContain('VALUES (${instructor.id}, ${w.day_of_week}, ${w.start_time}, ${w.end_time}, ${w.transmission_type}, ${schoolId})');
    expect(js).toContain('transmission_type must be manual, automatic, or both');
  });

  test('learner slot feed and duration modal use weekly window transmission', () => {
    const slots = read('api/slots.js');
    const webhook = read('api/webhook.js');

    expect(slots).toContain("COALESCE(ia.transmission_type, 'both') AS transmission_type");
    expect(slots).toContain("COALESCE(i.transmission_type, 'manual') AS instructor_transmission_type");
    expect(slots).toContain('const windowTransmissionType = clampSlotTransmissionType(w.transmission_type, w.instructor_transmission_type)');
    expect(slots).toContain("COALESCE(transmission_type, 'both') AS transmission_type");
    expect(slots).toContain('transmission_type: clampSlotTransmissionType(w.transmission_type, instructorTransmissionType)');
    expect(slots).toContain('slotSupportsTransmission(w.transmission_type, transmissionType)');
    expect(slots).toContain('slotSupportsTransmission(window.transmission_type, requestedTransmissionType)');
    expect(slots).toContain('function concreteLessonTransmissionType');
    expect(slots).toContain('bookingTransmissionType: preview.anchor.transmission_type');
    expect(slots).toContain('transmission_type: bookingTransmissionType');
    expect(webhook).toContain('const bookingTransmissionType = concreteLessonTransmissionType(metadata.transmission_type)');
    expect(webhook).toContain('lesson_type_id, transmission_type, minutes_deducted, school_id');
  });

  test('reserved weekly moves also respect weekly window transmission', () => {
    const slots = read('api/slots.js');

    expect(slots).toContain('const requestedTransmission = normaliseSlotTransmissionType(booking.transmission_type)');
    expect(slots).toContain('...weeklyWindows.rows');
    expect(slots).toContain('transmission_type: clampSlotTransmissionType(w.transmission_type, instructorTransmission)');
    expect(slots).toContain('slotSupportsTransmission(w.transmission_type, requestedTransmission)');
  });

  test('instructor availability UI exposes transmission selector for dual-car profiles', () => {
    const html = read('public/instructor/availability.html');
    const js = read('public/instructor/availability.js');

    expect(js).toContain("ccAuth.fetchAuthed('/api/instructor?action=profile')");
    expect(js).toContain("instructorTransmissionType === 'both'");
    expect(js).toContain('class="window-transmission"');
    expect(js).toContain('data-field="transmission_type"');
    expect(js).toContain('defaultAvailabilityTransmission()');
    expect(js).toContain('Transmission choice does not match your instructor profile');
    expect(html).toContain('.window-transmission');
    expect(html).toContain('.window-transmission-badge');
  });
});
