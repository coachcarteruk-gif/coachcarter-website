// @ts-check

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  normaliseSlotStartInterval,
  firstSlotStartForWindow,
} = require('../api/_slot-starts');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

test.describe('instructor slot start interval', () => {
  test('keeps 30 minutes as the default and aligns hourly starts to the hour', () => {
    expect(normaliseSlotStartInterval(undefined)).toBe(30);
    expect(normaliseSlotStartInterval(30)).toBe(30);
    expect(normaliseSlotStartInterval(60)).toBe(60);
    expect(normaliseSlotStartInterval(45)).toBe(30);

    expect(firstSlotStartForWindow(8 * 60, 60)).toBe(8 * 60);
    expect(firstSlotStartForWindow(8 * 60 + 30, 60)).toBe(9 * 60);
    expect(firstSlotStartForWindow(8 * 60 + 30, 30)).toBe(8 * 60 + 30);
  });

  test('migration stores a constrained instructor preference', () => {
    const aggregate = read('db/migration.sql');
    const step = read('db/migrations/036_instructor_slot_start_interval.sql');

    for (const source of [aggregate, step]) {
      expect(source).toContain(
        'ADD COLUMN IF NOT EXISTS slot_start_interval_minutes INTEGER NOT NULL DEFAULT 30'
      );
      expect(source).toContain('chk_instructors_slot_start_interval_minutes');
      expect(source).toContain('CHECK (slot_start_interval_minutes IN (30, 60))');
    }
  });

  test('instructor profile API returns, validates, and persists the preference', () => {
    const api = read('api/instructor.js');

    expect(api).toContain('COALESCE(slot_start_interval_minutes, 30) AS slot_start_interval_minutes');
    expect(api).toContain('Slot start interval must be 30 or 60 minutes');
    expect(api).toContain(
      'slot_start_interval_minutes = COALESCE(${slotStartIntervalVal}, slot_start_interval_minutes)'
    );
  });

  test('instructor profile UI explains and posts both choices', () => {
    const profile = read('public/instructor/profile.js');

    expect(profile).toContain('id="inputSlotStartInterval"');
    expect(profile).toContain('Every 30 minutes');
    expect(profile).toContain('Every hour, on the hour');
    expect(profile).toContain('Hourly slots are aligned to :00.');
    expect(profile).toContain(
      "const slot_start_interval_minutes = parseInt(document.getElementById('inputSlotStartInterval').value);"
    );
    expect(profile).toContain('slot_start_interval_minutes,');
  });

  test('slot generation loads the tenant-scoped preference and applies it per instructor', () => {
    const slots = read('api/slots.js');

    expect(slots).toContain('const slotStartIntervalsPromise = instructor_id');
    expect(slots).toContain(
      "COALESCE((to_jsonb(i)->>'slot_start_interval_minutes')::integer, 30) AS slot_start_interval_minutes"
    );
    expect(slots).toContain('AND i.school_id = ${schoolId}');
    expect(slots).toContain('slot_start_interval_minutes: normaliseSlotStartInterval(');
    expect(slots).toContain(
      'let slotStart = firstSlotStartForWindow(window.start, slotStartIncrementMinutes);'
    );
  });
});
