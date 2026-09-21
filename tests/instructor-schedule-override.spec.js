// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  SCHEDULE_UNAVAILABLE,
  buildInstructorScheduleWarnings,
} = require('../api/_instructor-schedule-warnings');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

test.describe('instructor schedule warning overrides', () => {
  test('reports busy, blackout, external-calendar, and outside-hours warnings together', () => {
    const warnings = buildInstructorScheduleWarnings({
      startTime: '18:00',
      endTime: '19:30',
      weeklyWindows: [{ start_time: '09:00', end_time: '17:00' }],
      busyBlocks: [{ start_time: '17:30', end_time: '18:30' }],
      blackoutDates: [{ id: 1 }],
      externalEvents: [{ start_time: '18:45', end_time: '20:00', is_all_day: false }],
    });

    expect(warnings.map(warning => warning.code)).toEqual([
      'BUSY_BLOCK',
      'BLACKOUT_DATE',
      'EXTERNAL_CALENDAR_EVENT',
      'OUTSIDE_NORMAL_HOURS',
    ]);
  });

  test('accepts recurring and one-off coverage and lets one-off availability supersede a blackout', () => {
    expect(buildInstructorScheduleWarnings({
      startTime: '10:00',
      endTime: '11:30',
      weeklyWindows: [{ start_time: '09:00:00', end_time: '17:00:00' }],
    })).toEqual([]);

    expect(buildInstructorScheduleWarnings({
      startTime: '18:00',
      endTime: '19:30',
      weeklyWindows: [{ start_time: '09:00', end_time: '17:00' }],
      oneOffWindows: [{ start_time: '17:30', end_time: '20:00' }],
      blackoutDates: [{ id: 1 }],
    })).toEqual([]);
  });

  test('booking screens submit once without an override confirmation', () => {
    const shared = read('public/shared/instructor-booking-actions.js');
    expect(shared).not.toContain('payload.availability_override');
    expect(shared).not.toContain('_confirmScheduleOverride');
    expect(shared).toContain('postWithScheduleCheck: postWithScheduleCheck');
    expect(SCHEDULE_UNAVAILABLE).toBe('SCHEDULE_UNAVAILABLE');
  });
});
