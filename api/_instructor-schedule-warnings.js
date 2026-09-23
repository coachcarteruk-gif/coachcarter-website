const { createHash } = require('crypto');
const { BLOCKING_STATUSES } = require('./_booking-status');
const SCHEDULE_UNAVAILABLE = 'SCHEDULE_UNAVAILABLE';

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
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
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return [{ code: 'INVALID_TIME_RANGE', message: 'Choose a valid lesson time that finishes on the same day.' }];
  }

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
  } catch (err) {
    // iCal integration is optional on older schemas; core availability checks
    // must still run when its table has not been deployed yet.
    if (err.code !== '42P01') throw err;
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

function sendScheduleUnavailable(res, warnings) {
  return res.status(409).json({
    error: warnings.map(warning => warning.message).join(' ') +
      ' Update your availability or remove the conflicting block before booking this time.',
    code: SCHEDULE_UNAVAILABLE,
    warnings,
  });
}

// Acknowledgement is specific to this instructor, school and proposed lesson.
// It only relaxes normal hours; all other schedule conflicts remain hard stops.
function requireFlexibleBookingHoursReview(req, res, warnings, booking) {
  if (!warnings.length) return false;
  if (warnings.some(warning => warning.code !== 'OUTSIDE_NORMAL_HOURS')) {
    sendScheduleUnavailable(res, warnings);
    return true;
  }
  const token = createHash('sha256').update(JSON.stringify({ booking, warnings })).digest('hex');
  if (req.body?.normal_hours_override_token === token) return false;
  res.status(409).json({
    code: 'NORMAL_HOURS_OVERRIDE_REQUIRED',
    error: 'This lesson is outside your normal or one-off availability. You can override your normal hours for this flexible-package lesson.',
    warnings,
    normal_hours_override_token: token,
  });
  return true;
}

// Only newly uncovered bookings need acknowledgement. Existing exceptions must
// not prevent an instructor adding hours or making an unrelated schedule change.
function availabilityChangeConflicts({ bookings, weeklyWindows, oneOffWindows, blackoutRanges,
  nextWeeklyWindows = weeklyWindows, nextOneOffWindows = oneOffWindows,
  nextBlackoutRanges = blackoutRanges }) {
  function covered(booking, weekly, oneOff, blackouts) {
    const day = new Date(`${booking.scheduled_date}T00:00:00Z`).getUTCDay();
    const start = timeToMinutes(booking.start_time);
    const end = timeToMinutes(booking.end_time);
    const matches = window => windowCoversSlot(window, start, end) &&
      (!booking.transmission_type || !window.transmission_type || window.transmission_type === 'both' ||
       window.transmission_type === booking.transmission_type);
    if (oneOff.some(window => window.override_date === booking.scheduled_date && matches(window))) return true;
    if (blackouts.some(range => booking.scheduled_date >= range.start_date && booking.scheduled_date <= range.end_date)) return false;
    return weekly.some(window => Number(window.day_of_week) === day && matches(window));
  }
  return bookings.filter(booking => covered(booking, weeklyWindows, oneOffWindows, blackoutRanges) &&
    !covered(booking, nextWeeklyWindows, nextOneOffWindows, nextBlackoutRanges));
}

async function loadAvailabilityChangeReview(sql, { instructorId, schoolId, windows, ranges, deleteOverrideId }) {
  const [bookings, weeklyWindows, oneOffWindows, blackoutRanges] = await Promise.all([
    sql`SELECT b.id, b.scheduled_date::text, b.start_time::text, b.end_time::text,
               CASE WHEN i.transmission_type IN ('manual', 'automatic') THEN i.transmission_type
                    ELSE b.transmission_type END AS transmission_type,
               l.name AS learner_name
          FROM lesson_bookings b
          JOIN instructors i ON i.id = b.instructor_id AND i.school_id = b.school_id
          LEFT JOIN learner_users l ON l.id = b.learner_id AND l.school_id = b.school_id
         WHERE b.school_id = ${schoolId} AND b.instructor_id = ${instructorId}
           AND b.status = ANY(${BLOCKING_STATUSES}::text[]) AND b.slot_released_at IS NULL
           AND (b.scheduled_date + b.end_time) > (NOW() AT TIME ZONE 'Europe/London')
         ORDER BY b.scheduled_date, b.start_time, b.id`,
    sql`SELECT day_of_week, start_time::text, end_time::text,
               COALESCE(to_jsonb(instructor_availability)->>'transmission_type', 'both') AS transmission_type
          FROM instructor_availability
         WHERE school_id = ${schoolId} AND instructor_id = ${instructorId} AND active = true`,
    sql`SELECT id, override_date::text, start_time::text, end_time::text, transmission_type
          FROM instructor_availability_overrides
         WHERE school_id = ${schoolId} AND instructor_id = ${instructorId} AND active = true`,
    sql`SELECT blackout_date::text AS start_date, COALESCE(end_date, blackout_date)::text AS end_date
          FROM instructor_blackout_dates
         WHERE school_id = ${schoolId} AND instructor_id = ${instructorId}`,
  ]);
  const conflicts = availabilityChangeConflicts({
    bookings, weeklyWindows, oneOffWindows, blackoutRanges,
    nextWeeklyWindows: windows,
    nextBlackoutRanges: ranges,
    nextOneOffWindows: deleteOverrideId === undefined ? undefined :
      oneOffWindows.filter(window => Number(window.id) !== Number(deleteOverrideId)),
  });
  const token = createHash('sha256').update(JSON.stringify({
    schoolId, instructorId, windows, ranges, deleteOverrideId, conflicts,
  })).digest('hex');
  return { conflicts, token, weeklyWindows, blackoutRanges, oneOffWindows };
}

function requireAvailabilityChangeReview(req, res, review) {
  if (!review.conflicts.length || req.body?.availability_conflict_token === review.token) return false;
  res.status(409).json({
    code: 'AVAILABILITY_BOOKING_CONFLICTS',
    error: 'These changes leave existing lessons outside your availability. Review them before saving.',
    conflicts: review.conflicts,
    availability_conflict_token: review.token,
  });
  return true;
}

module.exports = {
  SCHEDULE_UNAVAILABLE,
  buildInstructorScheduleWarnings,
  loadInstructorScheduleWarnings,
  sendScheduleUnavailable,
  requireFlexibleBookingHoursReview,
  availabilityChangeConflicts,
  loadAvailabilityChangeReview,
  requireAvailabilityChangeReview,
};
