// @ts-check
// Regression coverage for legacy CoachCarter bookings whose school_id predates
// the multi-tenant backfill.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function functionBody(source, name) {
  const marker = `async function ${name}`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test.describe('instructor agenda legacy school rows', () => {
  test('schedule read endpoints include legacy school 1 bookings with null school_id', () => {
    const source = read('api/instructor.js');

    for (const name of ['handleSchedule', 'handleScheduleRange']) {
      const body = functionBody(source, name);
      expect(body).toContain('AND COALESCE(lb.school_id, 1) = ${schoolId}');
      expect(body).toContain('JOIN learner_users lu ON lu.id = lb.learner_id AND COALESCE(lu.school_id, 1) = ${schoolId}');
      expect(body).toContain('JOIN instructors i ON i.id = lb.instructor_id AND COALESCE(i.school_id, 1) = ${schoolId}');
      expect(body).not.toContain('AND lb.school_id = ${schoolId}');
    }
  });

  test('schedule read endpoints fall back if booking transmission migration is pending', () => {
    const source = read('api/instructor.js');

    expect(source).toContain('function lessonBookingTransmissionColumnMissing(err)');
    for (const name of ['handleSchedule', 'handleScheduleRange']) {
      const body = functionBody(source, name);
      expect(body).toContain('if (!lessonBookingTransmissionColumnMissing(err)) throw err;');
      expect(body).toContain("CASE WHEN COALESCE(i.transmission_type, 'manual') = 'automatic' THEN 'automatic' ELSE 'manual' END AS transmission_type");
    }
  });
});
