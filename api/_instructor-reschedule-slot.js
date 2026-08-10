const { BLOCKING_STATUSES } = require('./_booking-status');
const { isLessonTypeOffered } = require('./_lesson-type-helpers');
const {
  extractPostcode,
  bulkGeocodeUK,
  estimateDriveMinutes,
  TRAVEL_BUFFER_MINUTES,
} = require('./_travel-time');

const PLATFORM_MAX_BOOKING_DAYS = 84;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_HHMM_RE = /^\d{2}:\d{2}$/;

class InstructorRescheduleSlotError extends Error {
  constructor(code, message, status = 409, conflict = null) {
    super(message);
    this.name = 'InstructorRescheduleSlotError';
    this.code = code;
    this.status = status;
    this.conflict = conflict;
  }
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || '').slice(0, 5).split(':').map(Number);
  return (hours * 60) + minutes;
}

function minutesToTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function isValidDate(value) {
  if (!ISO_DATE_RE.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidTime(value) {
  if (!TIME_HHMM_RE.test(String(value || ''))) return false;
  const minutes = timeToMinutes(value);
  return Number.isFinite(minutes) && minutes >= 0 && minutes < 1440;
}

function normaliseTransmission(value) {
  const transmission = String(value || '').trim().toLowerCase();
  return ['manual', 'automatic', 'both'].includes(transmission) ? transmission : null;
}

function supportsTransmission(supported, requested) {
  const supportedType = normaliseTransmission(supported) || 'manual';
  const requestedType = normaliseTransmission(requested) || 'manual';
  return supportedType === 'both' || supportedType === requestedType;
}

function normaliseMaxBookingDays(value) {
  const days = parseInt(value, 10);
  if (!Number.isInteger(days) || days <= 0) return PLATFORM_MAX_BOOKING_DAYS;
  return Math.min(days, PLATFORM_MAX_BOOKING_DAYS);
}

function dateAtUtcMidnight(value) {
  return new Date(`${value}T00:00:00Z`);
}

function utcToday(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addUtcDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function slotDateTime(date, time) {
  return new Date(`${date}T${String(time).slice(0, 5)}:00Z`);
}

function targetInstructorIsEligible(instructor, booking) {
  if (!instructor || instructor.active !== true) return false;
  if (!supportsTransmission(instructor.transmission_type, booking.transmission_type)) return false;
  return !booking.lesson_type_slug || isLessonTypeOffered(instructor.offered_lesson_types, booking.lesson_type_slug);
}

async function listEligibleRescheduleInstructors(sql, { schoolId, booking }) {
  const instructors = await sql`
    SELECT id, name, email, phone, active, offered_lesson_types,
           COALESCE(transmission_type, 'manual') AS transmission_type,
           COALESCE(min_booking_notice_hours, 24)::int AS min_booking_notice_hours,
           COALESCE(max_booking_days_ahead, ${PLATFORM_MAX_BOOKING_DAYS})::int AS max_booking_days_ahead
      FROM instructors
     WHERE school_id = ${schoolId}
       AND active = TRUE
       AND email <> 'demo@coachcarter.uk'
     ORDER BY name, id
  `;

  return instructors.filter(candidate => targetInstructorIsEligible(candidate, booking));
}

function normalisePostcode(value) {
  return value ? String(value).toUpperCase().replace(/\s+/g, ' ') : null;
}

async function findPickupTravelConflict(sql, {
  schoolId,
  instructorId,
  date,
  startTime,
  endTime,
  pickupAddress,
  excludeBookingId,
  geocode = bulkGeocodeUK,
}) {
  const pickupPostcode = normalisePostcode(extractPostcode(pickupAddress));
  if (!pickupPostcode) return null;

  const bookings = await sql`
    SELECT id, start_time::text AS start_time, end_time::text AS end_time, pickup_address
      FROM lesson_bookings
     WHERE instructor_id = ${instructorId}
       AND school_id = ${schoolId}
       AND scheduled_date = ${date}::date
       AND status = ANY(${BLOCKING_STATUSES}::text[])
       AND pickup_address IS NOT NULL
       AND id <> ${excludeBookingId}
     ORDER BY start_time
  `;

  const slotStart = timeToMinutes(startTime);
  const slotEnd = timeToMinutes(endTime);
  let closestBefore = null;
  let closestAfter = null;

  for (const row of bookings) {
    const postcode = normalisePostcode(extractPostcode(row.pickup_address));
    if (!postcode) continue;
    const candidate = {
      id: Number(row.id),
      start: timeToMinutes(row.start_time),
      end: timeToMinutes(row.end_time),
      postcode,
    };
    if (candidate.end <= slotStart && (!closestBefore || candidate.end > closestBefore.end)) {
      closestBefore = candidate;
    }
    if (candidate.start >= slotEnd && (!closestAfter || candidate.start < closestAfter.start)) {
      closestAfter = candidate;
    }
  }

  if (!closestBefore && !closestAfter) return null;
  const postcodes = [pickupPostcode];
  if (closestBefore) postcodes.push(closestBefore.postcode);
  if (closestAfter) postcodes.push(closestAfter.postcode);
  const coordinates = await geocode(postcodes);

  const driveMinutes = (from, to) => {
    if (from.replace(/\s/g, '') === to.replace(/\s/g, '')) return 0;
    const fromCoordinates = coordinates[from];
    const toCoordinates = coordinates[to];
    if (!fromCoordinates || !toCoordinates) return null;
    return estimateDriveMinutes(
      fromCoordinates.lat,
      fromCoordinates.lon,
      toCoordinates.lat,
      toCoordinates.lon
    );
  };

  if (closestBefore) {
    const travelMinutes = driveMinutes(closestBefore.postcode, pickupPostcode);
    const gapMinutes = slotStart - closestBefore.end;
    if (travelMinutes != null && gapMinutes < travelMinutes + TRAVEL_BUFFER_MINUTES) {
      return { direction: 'before', booking_id: closestBefore.id, gap_minutes: gapMinutes, travel_minutes: travelMinutes };
    }
  }
  if (closestAfter) {
    const travelMinutes = driveMinutes(pickupPostcode, closestAfter.postcode);
    const gapMinutes = closestAfter.start - slotEnd;
    if (travelMinutes != null && gapMinutes < travelMinutes + TRAVEL_BUFFER_MINUTES) {
      return { direction: 'after', booking_id: closestAfter.id, gap_minutes: gapMinutes, travel_minutes: travelMinutes };
    }
  }
  return null;
}

function conflict(code, message, status = 409, detail = null) {
  throw new InstructorRescheduleSlotError(code, message, status, detail);
}

async function validateInstructorRescheduleSlot(sql, {
  schoolId,
  booking,
  targetInstructorId,
  newDate,
  newStartTime,
  now = new Date(),
  geocode = bulkGeocodeUK,
}) {
  if (!isValidDate(newDate)) conflict('INVALID_NEW_DATE', 'new_date must be YYYY-MM-DD', 400);
  if (!isValidTime(newStartTime)) conflict('INVALID_NEW_START_TIME', 'new_start_time must be HH:MM', 400);

  const bookingDuration = parseInt(booking.duration_minutes, 10) || 90;
  const newStartMinutes = timeToMinutes(newStartTime);
  const newEndMinutes = newStartMinutes + bookingDuration;
  if (newEndMinutes > 1440) conflict('LESSON_ENDS_NEXT_DAY', 'The lesson must end on the same day', 400);
  const newEndTime = minutesToTime(newEndMinutes);

  const [targetInstructor] = await sql`
    SELECT id, name, email, phone, active, offered_lesson_types,
           COALESCE(transmission_type, 'manual') AS transmission_type,
           COALESCE(min_booking_notice_hours, 24)::int AS min_booking_notice_hours,
           COALESCE(max_booking_days_ahead, ${PLATFORM_MAX_BOOKING_DAYS})::int AS max_booking_days_ahead
      FROM instructors
     WHERE id = ${targetInstructorId}
       AND school_id = ${schoolId}
       AND active = TRUE
       AND email <> 'demo@coachcarter.uk'
  `;
  if (!targetInstructor) conflict('INSTRUCTOR_UNAVAILABLE', 'The selected instructor is not available for booking.', 404);
  if (!targetInstructorIsEligible(targetInstructor, booking)) {
    if (!supportsTransmission(targetInstructor.transmission_type, booking.transmission_type)) {
      conflict('TRANSMISSION_UNSUPPORTED', 'The selected instructor does not support this lesson transmission.');
    }
    conflict('LESSON_TYPE_UNSUPPORTED', 'The selected instructor does not offer this lesson type.');
  }

  const newDateValue = dateAtUtcMidnight(newDate);
  const today = utcToday(now);
  if (newDateValue < today) conflict('SLOT_IN_PAST', 'Cannot reschedule to a date in the past', 400);
  const maxBookingDays = normaliseMaxBookingDays(targetInstructor.max_booking_days_ahead);
  if (newDateValue > addUtcDays(today, maxBookingDays)) {
    conflict(
      'OUTSIDE_BOOKING_WINDOW',
      `This instructor only accepts bookings up to ${maxBookingDays} day${maxBookingDays === 1 ? '' : 's'} in advance.`,
      400
    );
  }

  const startDateTime = slotDateTime(newDate, newStartTime);
  if (startDateTime <= now) conflict('SLOT_ALREADY_STARTED', 'That slot has already started.', 400);
  const noticeHours = (startDateTime.getTime() - now.getTime()) / 3600000;
  if (noticeHours < Math.max(0, Number(targetInstructor.min_booking_notice_hours || 0))) {
    conflict('MINIMUM_NOTICE', 'That slot is inside the selected instructor\'s minimum booking notice.', 409);
  }

  const oldDate = String(booking.scheduled_date || '').slice(0, 10);
  const oldStart = String(booking.start_time || '').slice(0, 5);
  if (Number(targetInstructorId) === Number(booking.instructor_id) && newDate === oldDate && newStartTime === oldStart) {
    conflict('SAME_SLOT', 'New time is the same as the current booking', 400);
  }
  if (booking.is_reserved_weekly_slot && Number(targetInstructorId) !== Number(booking.instructor_id)) {
    conflict('RESERVED_TRANSFER_NOT_SUPPORTED', 'Reserved Weekly Slot lessons cannot be transferred to another instructor.');
  }

  const [lessonConflict] = await sql`
    SELECT id
      FROM lesson_bookings
     WHERE instructor_id = ${targetInstructorId}
       AND school_id = ${schoolId}
       AND scheduled_date = ${newDate}::date
       AND status = ANY(${BLOCKING_STATUSES}::text[])
       AND start_time < ${newEndTime}::time
       AND end_time > ${newStartTime}::time
       AND id <> ${booking.id}
     LIMIT 1
  `;
  if (lessonConflict) conflict('LESSON_CONFLICT', 'That slot overlaps another lesson. Please choose another.');

  const [reservationConflict] = await sql`
    SELECT id
      FROM slot_reservations
     WHERE instructor_id = ${targetInstructorId}
       AND school_id = ${schoolId}
       AND scheduled_date = ${newDate}::date
       AND expires_at > NOW()
       AND start_time < ${newEndTime}::time
       AND end_time > ${newStartTime}::time
     LIMIT 1
  `;
  if (reservationConflict) conflict('SLOT_RESERVED', 'Someone is currently booking that slot. Please choose another.');

  const [requestConflict] = await sql`
    SELECT id
      FROM lesson_requests
     WHERE instructor_id = ${targetInstructorId}
       AND school_id = ${schoolId}
       AND scheduled_date = ${newDate}::date
       AND status = 'pending'
       AND expires_at > NOW()
       AND start_time < ${newEndTime}::time
       AND end_time > ${newStartTime}::time
     LIMIT 1
  `;
  if (requestConflict) conflict('PENDING_REQUEST_CONFLICT', 'That slot has a pending lesson request. Please choose another.');

  const [offerConflict] = await sql`
    SELECT id
      FROM lesson_offers
     WHERE instructor_id = ${targetInstructorId}
       AND school_id = ${schoolId}
       AND scheduled_date = ${newDate}::date
       AND status = 'pending'
       AND expires_at > NOW()
       AND start_time < ${newEndTime}::time
       AND end_time > ${newStartTime}::time
     LIMIT 1
  `;
  if (offerConflict) conflict('PENDING_OFFER_CONFLICT', 'That slot has a pending lesson offer. Please choose another.');

  const [recurringConflict] = await sql`
    SELECT id
      FROM recurring_slot_block_items
     WHERE instructor_id = ${targetInstructorId}
       AND school_id = ${schoolId}
       AND scheduled_date = ${newDate}::date
       AND status IN ('held', 'booked')
       AND start_time < ${newEndTime}::time
       AND end_time > ${newStartTime}::time
     LIMIT 1
  `;
  if (recurringConflict) conflict('RECURRING_HOLD_CONFLICT', 'That slot is held for a recurring lesson. Please choose another.');

  const overrides = await sql`
    SELECT start_time::text AS start_time, end_time::text AS end_time,
           COALESCE(transmission_type, 'both') AS transmission_type
      FROM instructor_availability_overrides
     WHERE instructor_id = ${targetInstructorId}
       AND school_id = ${schoolId}
       AND override_date = ${newDate}::date
       AND active = TRUE
  `;
  const blackout = await sql`
    SELECT 1
      FROM instructor_blackout_dates
     WHERE instructor_id = ${targetInstructorId}
       AND school_id = ${schoolId}
       AND blackout_date <= ${newDate}::date
       AND end_date >= ${newDate}::date
     LIMIT 1
  `;
  const dayOfWeek = newDateValue.getUTCDay();
  const weeklyWindows = blackout.length > 0 ? [] : await sql`
    SELECT start_time::text AS start_time, end_time::text AS end_time,
           COALESCE(to_jsonb(instructor_availability)->>'transmission_type', 'both') AS transmission_type
      FROM instructor_availability
     WHERE instructor_id = ${targetInstructorId}
       AND school_id = ${schoolId}
       AND day_of_week = ${dayOfWeek}
       AND active = TRUE
  `;
  const fitsAvailability = [...weeklyWindows, ...overrides].some(window => (
    newStartMinutes >= timeToMinutes(window.start_time)
    && newEndMinutes <= timeToMinutes(window.end_time)
    && supportsTransmission(window.transmission_type, booking.transmission_type)
    && supportsTransmission(targetInstructor.transmission_type, booking.transmission_type)
  ));
  if (!fitsAvailability) conflict('OUTSIDE_AVAILABILITY', 'That time is outside the selected instructor\'s availability.');

  const externalEvents = await sql`
    SELECT id, start_time::text AS start_time, end_time::text AS end_time, is_all_day
      FROM instructor_external_events
     WHERE instructor_id = ${targetInstructorId}
       AND school_id = ${schoolId}
       AND event_date = ${newDate}::date
  `;
  if (externalEvents.some(event => event.is_all_day || (
    newStartMinutes < timeToMinutes(event.end_time)
    && newEndMinutes > timeToMinutes(event.start_time)
  ))) {
    conflict('EXTERNAL_CALENDAR_CONFLICT', 'That slot conflicts with an external calendar event.');
  }

  const [busyConflict] = await sql`
    SELECT id
      FROM instructor_busy_blocks
     WHERE instructor_id = ${targetInstructorId}
       AND school_id = ${schoolId}
       AND block_date = ${newDate}::date
       AND start_time < ${newEndTime}::time
       AND end_time > ${newStartTime}::time
     LIMIT 1
  `;
  if (busyConflict) conflict('BUSY_BLOCK_CONFLICT', 'That slot conflicts with an instructor blackout or busy block.');

  const travelConflict = await findPickupTravelConflict(sql, {
    schoolId,
    instructorId: targetInstructorId,
    date: newDate,
    startTime: newStartTime,
    endTime: newEndTime,
    pickupAddress: booking.pickup_address,
    excludeBookingId: booking.id,
    geocode,
  });
  if (travelConflict) {
    conflict(
      'PICKUP_TRAVEL_CONFLICT',
      'That pickup location does not leave enough travel time from another lesson. Please choose another slot.',
      409,
      travelConflict
    );
  }

  return { targetInstructor, newEndTime, bookingDuration };
}

module.exports = {
  PLATFORM_MAX_BOOKING_DAYS,
  InstructorRescheduleSlotError,
  isValidDate,
  isValidTime,
  listEligibleRescheduleInstructors,
  targetInstructorIsEligible,
  validateInstructorRescheduleSlot,
  findPickupTravelConflict,
};
