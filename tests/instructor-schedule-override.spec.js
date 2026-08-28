// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  SCHEDULE_OVERRIDE_REQUIRED,
  buildInstructorScheduleWarnings,
} = require('../api/_instructor-schedule-warnings');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

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

  test('server routes require an exact boolean override and audit confirmed exceptions', () => {
    const api = read('api/instructor.js');

    expect(SCHEDULE_OVERRIDE_REQUIRED).toBe('SCHEDULE_OVERRIDE_REQUIRED');
    expect(api).toContain('const scheduleOverrideConfirmed = availability_override === true;');
    expect(api).toContain('return sendScheduleOverrideRequired(res, scheduleWarnings);');
    expect(api).toContain("action: adminImpersonation\n      ? 'admin.instructor_schedule_override'\n      : 'instructor.schedule_override'");
    expect(api).toContain("targetType: 'lesson_booking'");
    expect(api).toContain("targetType: 'lesson_offer'");
    expect(api).toContain("targetType: 'lesson_offer_batch'");
  });

  test('all instructor lesson and offer forms use the warning-confirm-retry helper', () => {
    const shared = read('public/shared/instructor-booking-actions.js');
    const calendar = read('public/instructor/index.js');
    const dashboard = read('public/instructor/dashboard.js');

    expect(shared).toContain("data.code === 'SCHEDULE_OVERRIDE_REQUIRED'");
    expect(shared).toContain('payload.availability_override = true;');
    expect(shared).toContain('Existing lesson, offer and request clashes will still be blocked.');
    expect(shared).toContain('postWithScheduleOverride: postWithScheduleOverride');
    expect(shared).toContain("'/api/instructor?action=create-booking'");

    expect(calendar.match(/BookingActions\.postWithScheduleOverride/g)?.length).toBeGreaterThanOrEqual(4);
    expect(calendar).toContain("'/api/instructor?action=create-broadcast-offer'");
    expect(calendar).toContain("'/api/instructor?action=create-offer'");
    expect(calendar).toContain("'/api/instructor?action=create-booking'");

    expect(dashboard.match(/BookingActions\.postWithScheduleOverride/g)?.length).toBe(2);
    expect(dashboard).toContain("'/api/instructor?action=create-offer'");
    expect(dashboard).toContain("'/api/instructor?action=create-booking'");
  });
});
