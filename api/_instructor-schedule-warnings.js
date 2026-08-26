const SCHEDULE_OVERRIDE_REQUIRED = 'SCHEDULE_OVERRIDE_REQUIRED';

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function windowCoversSlot(window, startMinutes, endMinutes) {
  const windowStart = timeToMinutes(window?.start_time);
  const windowEnd = timeToMinutes(window?.end_time);
  return windowStart !== null && windowEnd !== null
    && startMinutes >= windowStart && endMinutes <= windowEnd;
}

function windowOverlapsSlot(window, startMinutes, endMinutes) {
  const windowStart = timeToMinutes(window?.start_time);
  const windowEnd = timeToMinutes(window?.end_time);
  return windowStart !== null && windowEnd !== null
    && startMinutes < windowEnd && endMinutes > windowStart;
}

function buildInstructorScheduleWarnings({
  startTime,
  endTime,
  weeklyWindows = [],
  oneOffWindows = [],
  busyBlocks = [],
  blackoutDates = [],
  externalEvents = [],
}) {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return [];

  const oneOffCoverage = oneOffWindows.some(window => windowCoversSlot(window, startMinutes, endMinutes));
  const normalHoursCoverage = oneOffCoverage
    || weeklyWindows.some(window => windowCoversSlot(window, startMinutes, endMinutes));
  const warnings = [];

  if (busyBlocks.some(block => windowOverlapsSlot(block, startMinutes, endMinutes))) {
    warnings.push({
      code: 'BUSY_BLOCK',
      message: 'This time overlaps a busy block on the instructor calendar.',
    });
  }

  // A one-off availability window is an intentional exception to a full-day
  // blackout, matching the learner slot engine's precedence rules.
  if (blackoutDates.length > 0 && !oneOffCoverage) {
    warnings.push({
      code: 'BLACKOUT_DATE',
      message: 'This date is marked as unavailable.',
    });
  }

  if (externalEvents.some(event => event?.is_all_day === true
      || windowOverlapsSlot(event, startMinutes, endMinutes))) {
    warnings.push({
      code: 'EXTERNAL_CALENDAR_EVENT',
      message: 'This time overlaps an event from the connected calendar.',
    });
  }

  if (!normalHoursCoverage) {
    warnings.push({
      code: 'OUTSIDE_NORMAL_HOURS',
      message: 'This time is outside the instructor\'s normal or one-off availability.',
    });
  }

  return warnings;
}

async function loadInstructorScheduleWarnings(sql, {
  instructorId,
  schoolId,
  scheduledDate,
  startTime,
  endTime,
}) {
  const date = new Date(`${scheduledDate}T00:00:00Z`);
  const dayOfWeek = date.getUTCDay(); // instructor_availability uses Sun=0 .. Sat=6

  const [weeklyWindows, oneOffWindows, busyBlocks, blackoutDates] = await Promise.all([
    sql`
      SELECT start_time::text AS start_time, end_time::text AS end_time
      FROM instructor_availability
      WHERE instructor_id = ${instructorId}
        AND school_id = ${schoolId}
        AND day_of_week = ${dayOfWeek}
        AND active = true
    `,
    sql`
      SELECT start_time::text AS start_time, end_time::text AS end_time
      FROM instructor_availability_overrides
      WHERE instructor_id = ${instructorId}
        AND school_id = ${schoolId}
        AND override_date = ${scheduledDate}::date
        AND active = true
    `,
    sql`
      SELECT start_time::text AS start_time, end_time::text AS end_time
      FROM instructor_busy_blocks
      WHERE instructor_id = ${instructorId}
        AND school_id = ${schoolId}
        AND block_date = ${scheduledDate}::date
        AND start_time < ${endTime}::time
        AND end_time > ${startTime}::time
    `,
    sql`
      SELECT id
      FROM instructor_blackout_dates
      WHERE instructor_id = ${instructorId}
        AND school_id = ${schoolId}
        AND blackout_date <= ${scheduledDate}::date
        AND COALESCE(end_date, blackout_date) >= ${scheduledDate}::date
    `,
  ]);

  let externalEvents = [];
  try {
    externalEvents = await sql`
      SELECT start_time::text AS start_time, end_time::text AS end_time, is_all_day
      FROM instructor_external_events
      WHERE instructor_id = ${instructorId}
        AND school_id = ${schoolId}
        AND event_date = ${scheduledDate}::date
        AND (is_all_day = true OR (start_time < ${endTime}::time AND end_time > ${startTime}::time))
    `;
  } catch (_) {
    // iCal integration is optional on older schemas; core availability checks
    // must still run when its table has not been deployed yet.
  }

  return buildInstructorScheduleWarnings({
    startTime,
    endTime,
    weeklyWindows,
    oneOffWindows,
    busyBlocks,
    blackoutDates,
    externalEvents,
  });
}

function sendScheduleOverrideRequired(res, warnings) {
  return res.status(409).json({
    error: 'Please review this time before continuing.',
    code: SCHEDULE_OVERRIDE_REQUIRED,
    warnings,
  });
}

module.exports = {
  SCHEDULE_OVERRIDE_REQUIRED,
  buildInstructorScheduleWarnings,
  loadInstructorScheduleWarnings,
  sendScheduleOverrideRequired,
};
