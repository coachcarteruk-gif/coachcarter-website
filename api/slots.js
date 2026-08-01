// Slot generation engine + booking actions
//
// Routes:
//   GET  /api/slots?action=available&from=YYYY-MM-DD&to=YYYY-MM-DD[&instructor_id=X][&lesson_type_id=X]
//     → returns available slots for the given lesson type duration, grouped by date
//
//   POST /api/slots?action=book          (JWT auth required)
//     → deduct hours from balance and create a confirmed booking
//     → optional repeat_weeks (2-8): creates N weekly bookings sharing a series_id
//
//   POST /api/slots?action=cancel        (JWT auth required)
//     → cancel a booking; returns hours if 48+ hours notice
//     → optional cancel_series: cancels all future bookings in the series
//
//   POST /api/slots?action=reserved-policy-move (JWT auth required)
//     → learner self-serve move for a Reserved Weekly Slot occurrence with 48+ hours notice
//
//   GET  /api/slots?action=my-bookings   (JWT auth required)
//     → upcoming + recent past bookings for the authenticated learner
//
//   GET  /api/slots?action=series-info&booking_id=X (JWT auth required)
//     → returns all bookings in a series
//
// Constraints enforced:
//   - "from" may not be in the past
//   - "to" may not exceed 84 days from today (platform ceiling; each
//     instructor's max_booking_days_ahead sets the learner-facing window)
//   - Max 31 days per request (for performance)
//   - 48-hour cancellation policy for hours return

const { neon }    = require('@neondatabase/serverless');
const jwt         = require('jsonwebtoken');
const crypto      = require('crypto');
const { createPlatformStripeClient, STRIPE_CLIENT_PURPOSES } = require('./_stripe-clients');
const stripe      = createPlatformStripeClient({ purpose: STRIPE_CLIENT_PURPOSES.PAYMENTS });
const { sendWhatsApp } = require('./_whatsapp');
const { reportError } = require('./_error-alert');
const { createTransporter } = require('./_auth-helpers');
const { notifyAvailableLearners, supersedeBroadcastSiblings } = require('./_notify-availability');
const { checkAdjacentTravelTime, extractPostcode, bulkGeocodeUK, estimateDriveMinutes, TRAVEL_BUFFER_MINUTES, DEFAULT_MAX_TRAVEL_MINUTES } = require('./_travel-time');
const { SCHEDULED, CHARGEABLE, REFUNDED, BLOCKING_STATUSES } = require('./_booking-status');
const { lockBalanceAdjustLCB, lockBalanceAndMutate } = require('./_credit-grant');
const {
  computeRequestExpiresAt,
  pendingRequestConflicts,
  pendingRequestConflictsPg,
  pendingRequestWindows,
  releaseRequestHold,
  lazyExpireSlotRequests,
  withLearnerContact,
  notifyLearnerRequestClosed,
  notifyInstructorNewRequest,
  formatSlotDisplay,
} = require('./_lesson-requests');
const { withNeonTransaction } = require('./_db-transaction');
const { planFifoCreditDraw } = require('./_bcs-fifo');
const { splitFifoPlanAcrossBookings } = require('./_bcs-booking-plan');
const {
  calcDirectLessonPrice,
  applySocialVideoDiscount,
  normaliseSocialVideoConsent,
  SOCIAL_VIDEO_DISCOUNT_PCT,
} = require('./_pricing-helpers');
const { isOptInOnlyLessonTypeSlug, isLessonTypeOffered } = require('./_lesson-type-helpers');
const { normaliseSlotStartInterval, firstSlotStartForWindow } = require('./_slot-starts');
const {
  CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES,
  getReservedBlockBankCheckoutPaymentOptions,
} = require('./_stripe-payment-methods');
const { resolveSchoolFromRequest } = require('./_tenant');
const {
  markBookingCreditSourcesRefunded,
  restoreBookingCreditSourcesActive,
  copyRefundedBookingCreditSources,
} = require('./_bcs-refund-marker');


const DEFAULT_SLOT_MINUTES = 90;  // fallback if no lesson type specified
const MAX_DAYS_AHEAD      = 84;   // platform ceiling — instructors.max_booking_days_ahead (1–84) is the learner-facing window (offer-driven series may exceed this — see api/webhook.js handleOfferBooking)
const MAX_RANGE_DAYS      = 31;   // max days per API request
const CANCEL_HOURS_CUTOFF = 48;   // hours notice needed to get hours back
const RESERVATION_MINUTES = 10;   // hold slot for 10 mins during checkout
const RECURRING_BLOCK_MIN_LESSONS = 4;
const RECURRING_BLOCK_MAX_LESSONS = 12;
const RECURRING_BLOCK_LOOKAHEAD_WEEKS = 12;
const RESERVED_MOVE_NOTICE_HOURS = 48;
const TEST_DATE_DURATION_MINUTES = 90;
const TEST_DATE_WARMUP_OFFSET_MINUTES = 45;
const TEST_DATE_MAX_DAYS_AHEAD = 366;
const CREDIT_BOOKING_SOURCE_TYPES = ['purchase', 'slot_purchase', 'admin_add', 'referral_bonus', 'referral_reward', 'legacy_grandfather'];
const SLOT_TRANSMISSION_TYPES = new Set(['manual', 'automatic', 'both']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TEST_DATE_PURPOSE = 'test_date';

function resolveSocialVideoSelection({ requested, ageConfirmed, instructor }) {
  const wantsSocialVideo = normaliseSocialVideoConsent(requested);
  const confirmed18 = normaliseSocialVideoConsent(ageConfirmed);
  const instructorOptedIn = !!instructor?.social_video_opt_in;
  const selected = wantsSocialVideo && confirmed18 && instructorOptedIn;
  return {
    selected,
    rejected: wantsSocialVideo && !instructorOptedIn,
    ageRejected: wantsSocialVideo && !confirmed18,
    ageConfirmed: selected,
    discountPct: selected ? SOCIAL_VIDEO_DISCOUNT_PCT : 0,
  };
}
const TIME_HHMM_RE = /^\d{2}:\d{2}$/;

class BookingTransactionAbort extends Error {
  constructor(result) {
    super(result?.message || result?.code || 'BOOKING_TRANSACTION_ABORT');
    this.name = 'BookingTransactionAbort';
    this.result = { ok: false, ...(result || {}) };
  }
}

class ReservedPolicyMoveAbort extends Error {
  constructor(statusCode, payload) {
    super(payload?.message || payload?.error || payload?.code || 'Reserved policy move refused');
    this.name = 'ReservedPolicyMoveAbort';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

class RecurringBankHoldAbort extends Error {
  constructor(result) {
    super(result?.message || result?.code || 'RECURRING_BANK_HOLD_ABORT');
    this.name = 'RecurringBankHoldAbort';
    this.result = { ok: false, ...(result || {}) };
  }
}

function abortReservedPolicyMove(statusCode, payload) {
  throw new ReservedPolicyMoveAbort(statusCode, payload);
}

function isMissingBookingPurposeSchema(err) {
  const msg = String(err?.message || '');
  return err?.code === '42703'
    && /column .*?(booking_purpose|test_start_time|test_centre).*? does not exist/i.test(msg);
}

function abortBookingTransaction(result) {
  throw new BookingTransactionAbort(result);
}

function abortRecurringBankHold(result) {
  throw new RecurringBankHoldAbort(result);
}

// Look up a lesson type by ID/slug (or return the default 'standard' type)
async function getLessonType(sql, lessonTypeId, schoolId, lessonTypeSlug = null) {
  if (lessonTypeId) {
    const [lt] = await sql`SELECT * FROM lesson_types WHERE id = ${lessonTypeId} AND active = true AND school_id = ${schoolId}`;
    return lt || null;
  }
  if (lessonTypeSlug) {
    const slug = String(lessonTypeSlug).trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(slug)) return null;
    const [lt] = await sql`SELECT * FROM lesson_types WHERE slug = ${slug} AND active = true AND school_id = ${schoolId}`;
    return lt || null;
  }
  // Default to standard lesson
  const [lt] = await sql`SELECT * FROM lesson_types WHERE slug = 'standard' AND active = true AND school_id = ${schoolId}`;
  return lt || { id: null, name: 'Standard Lesson', slug: 'standard', duration_minutes: 90, price_pence: 8250, colour: '#3b82f6' };
}

function formatHours(minutes) {
  const hrs = minutes / 60;
  return hrs % 1 === 0 ? `${hrs} hour${hrs !== 1 ? 's' : ''}` : `${hrs.toFixed(1)} hours`;
}

function isFreeTrialLessonType(lessonType) {
  return lessonType && lessonType.slug === 'trial';
}

function rejectFreeTrialOnPaidPath(res) {
  return res.status(400).json({
    error: 'Use the free trial page to book a trial.'
  });
}

function rejectLessonTypeNotOffered(res) {
  return res.status(400).json({
    error: 'This instructor does not currently offer that lesson length.'
  });
}

function normaliseSlotTransmissionType(value) {
  const text = String(value || '').trim().toLowerCase();
  return SLOT_TRANSMISSION_TYPES.has(text) ? text : null;
}

function slotSupportsTransmission(slotTransmissionType, requestedTransmissionType) {
  const requested = normaliseSlotTransmissionType(requestedTransmissionType);
  if (!requested) return true;
  const slotType = normaliseSlotTransmissionType(slotTransmissionType) || 'both';
  return slotType === 'both' || slotType === requested;
}

function clampSlotTransmissionType(slotTransmissionType, instructorTransmissionType) {
  const instructorType = normaliseSlotTransmissionType(instructorTransmissionType) || 'manual';
  const slotType = normaliseSlotTransmissionType(slotTransmissionType) || 'both';
  if (instructorType === 'both') return slotType;
  if (slotType === 'both') return instructorType;
  return slotType === instructorType ? slotType : null;
}

function parseRequestTransmissionType(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return normaliseSlotTransmissionType(value);
}

function normaliseStartTime(value) {
  const text = String(value || '').trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(text)) return null;
  return text.slice(0, 5);
}

function isQuarterHourStart(value) {
  const time = normaliseStartTime(value);
  if (!time) return false;
  return [0, 15, 30, 45].includes(timeToMinutes(time) % 60);
}

function minutesSinceMidnightToTime(mins) {
  const bounded = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(bounded / 60);
  const m = bounded % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function generateTestDateStartOptions(testTime) {
  const cleanTestTime = normaliseStartTime(testTime);
  if (!cleanTestTime) return [];
  const ideal = timeToMinutes(cleanTestTime) - TEST_DATE_WARMUP_OFFSET_MINUTES;
  const nearest = Math.round(ideal / 15) * 15;
  return [-15, 0, 15]
    .map(offset => nearest + offset)
    .filter(mins => mins >= 0 && mins + TEST_DATE_DURATION_MINUTES <= 24 * 60)
    .map(mins => ({
      start_time: minutesSinceMidnightToTime(mins),
      end_time: minutesSinceMidnightToTime(mins + TEST_DATE_DURATION_MINUTES),
      recommended: mins === nearest,
    }));
}

function testStartCoveredByLesson(startTime, endTime, testTime) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const test = timeToMinutes(testTime);
  return start <= test && test <= end;
}

function isWithinTestDateUpperBound(dateValue) {
  const dateObj = dateValue instanceof Date ? dateValue : parseDate(String(dateValue).slice(0, 10));
  if (!dateObj) return false;
  const today = startOfDay(new Date());
  return dateObj >= today && dateObj <= addDays(today, TEST_DATE_MAX_DAYS_AHEAD);
}

function concreteLessonTransmissionType(requestedTransmissionType, instructorTransmissionType) {
  const requested = normaliseSlotTransmissionType(requestedTransmissionType);
  if (requested === 'manual' || requested === 'automatic') return requested;
  const instructorType = normaliseSlotTransmissionType(instructorTransmissionType) || 'manual';
  return instructorType === 'automatic' ? 'automatic' : 'manual';
}

function hasBufferedSlotConflict(slotStart, slotEnd, blockStart, blockEnd, bufferMinutes = 0) {
  const buffer = Math.max(0, parseInt(bufferMinutes, 10) || 0);
  return slotStart < (blockEnd + buffer) && (slotEnd + buffer) > blockStart;
}

function normalisePostcode(postcode) {
  return postcode ? String(postcode).toUpperCase().replace(/\s+/g, ' ') : null;
}

function findAdjacentTravelSpacingConflict({ slotStart, slotEnd, pickupPostcode, bookedSlots, coordMap = {} }) {
  const learnerPostcode = normalisePostcode(pickupPostcode);
  if (!learnerPostcode) return null;

  let closestBefore = null;
  let closestAfter = null;
  for (const b of bookedSlots || []) {
    if (b.end <= slotStart && b.postcode) {
      if (!closestBefore || b.end > closestBefore.end) closestBefore = b;
    }
    if (b.start >= slotEnd && b.postcode) {
      if (!closestAfter || b.start < closestAfter.start) closestAfter = b;
    }
  }

  function driveMinutesBetween(fromPostcode, toPostcode) {
    const from = normalisePostcode(fromPostcode);
    const to = normalisePostcode(toPostcode);
    if (!from || !to) return null;
    if (from.replace(/\s/g, '') === to.replace(/\s/g, '')) return 0;
    const fromCoord = coordMap[from];
    const toCoord = coordMap[to];
    if (!fromCoord || !toCoord) return null;
    return estimateDriveMinutes(fromCoord.lat, fromCoord.lon, toCoord.lat, toCoord.lon);
  }

  if (closestBefore) {
    const driveMinutes = driveMinutesBetween(closestBefore.postcode, learnerPostcode);
    if (driveMinutes != null && (slotStart - closestBefore.end) < driveMinutes + TRAVEL_BUFFER_MINUTES) {
      return { direction: 'before', gap_minutes: slotStart - closestBefore.end, travel_minutes: driveMinutes };
    }
  }

  if (closestAfter) {
    const driveMinutes = driveMinutesBetween(learnerPostcode, closestAfter.postcode);
    if (driveMinutes != null && (closestAfter.start - slotEnd) < driveMinutes + TRAVEL_BUFFER_MINUTES) {
      return { direction: 'after', gap_minutes: closestAfter.start - slotEnd, travel_minutes: driveMinutes };
    }
  }

  return null;
}

async function checkPickupTravelSpacingConflict(sql, {
  instructorId,
  schoolId,
  date,
  startTime,
  endTime,
  pickupAddress,
  excludeBookingId = null,
}) {
  const pickupPostcode = extractPostcode(pickupAddress);
  if (!pickupPostcode) return null;

  const bookings = await sql`
    SELECT id, start_time::text AS start_time, end_time::text AS end_time, pickup_address
    FROM lesson_bookings
    WHERE instructor_id = ${instructorId}
      AND school_id = ${schoolId}
      AND scheduled_date = ${date}
      AND status = ANY(${BLOCKING_STATUSES}::text[])
      AND pickup_address IS NOT NULL
      AND (${excludeBookingId}::int IS NULL OR id <> ${excludeBookingId}::int)
    ORDER BY start_time
  `;

  const bookedSlots = bookings
    .map(b => ({
      id: b.id,
      start: timeToMinutes(b.start_time),
      end: timeToMinutes(b.end_time),
      postcode: b.pickup_address ? extractPostcode(b.pickup_address) : null,
    }))
    .filter(b => b.postcode);

  if (bookedSlots.length === 0) return null;

  const postcodes = new Set([normalisePostcode(pickupPostcode)]);
  for (const b of bookedSlots) postcodes.add(normalisePostcode(b.postcode));
  const coordMap = await bulkGeocodeUK([...postcodes].filter(Boolean));

  return findAdjacentTravelSpacingConflict({
    slotStart: timeToMinutes(startTime),
    slotEnd: timeToMinutes(endTime),
    pickupPostcode,
    bookedSlots,
    coordMap,
  });
}

async function rejectIfPickupTravelConflict(res, sql, options) {
  try {
    const conflict = await checkPickupTravelSpacingConflict(sql, options);
    if (!conflict) return false;
    return res.status(409).json({
      error: 'That pickup location does not leave enough travel time from another lesson. Please choose your saved address or another slot.',
      code: 'PICKUP_TRAVEL_CONFLICT',
      conflict,
    });
  } catch (_) {
    return false;
  }
}

function normaliseMaxBookingDaysAhead(value) {
  const days = parseInt(value, 10);
  if (!Number.isFinite(days) || days <= 0) return MAX_DAYS_AHEAD;
  return Math.min(days, MAX_DAYS_AHEAD);
}

function bookingWindowLimitDate(maxBookingDaysAhead) {
  return addDays(startOfDay(new Date()), normaliseMaxBookingDaysAhead(maxBookingDaysAhead));
}

function isDateWithinBookingWindow(dateValue, maxBookingDaysAhead) {
  const dateObj = dateValue instanceof Date ? dateValue : parseDate(String(dateValue).slice(0, 10));
  return !!dateObj && dateObj <= bookingWindowLimitDate(maxBookingDaysAhead);
}

function advanceWindowError(maxBookingDaysAhead, verb = 'book') {
  const days = normaliseMaxBookingDaysAhead(maxBookingDaysAhead);
  return `This instructor only accepts learner bookings up to ${days} day${days !== 1 ? 's' : ''} in advance. Please choose an earlier date to ${verb}.`;
}

async function slotFitsActiveAvailability(sql, {
  instructorId,
  schoolId,
  date,
  startTime,
  endTime,
  transmissionType = null,
  enforceBookingWindow = true
}) {
  const slotStart = timeToMinutes(startTime);
  const slotEnd = timeToMinutes(endTime);
  const dayOfWeek = new Date(date + 'T00:00:00Z').getUTCDay();

  const [instructor] = await sql`
    SELECT COALESCE(min_booking_notice_hours, 24) AS min_booking_notice_hours,
           COALESCE(max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
           COALESCE(transmission_type, 'manual') AS transmission_type
    FROM instructors
    WHERE id = ${instructorId}
      AND school_id = ${schoolId}
      AND active = true
  `;
  if (!instructor) return false;
  const instructorTransmissionType = normaliseSlotTransmissionType(instructor.transmission_type) || 'manual';
  if (enforceBookingWindow && !isDateWithinBookingWindow(date, instructor.max_booking_days_ahead)) return false;

  const minNoticeHours = Math.max(0, parseInt(instructor.min_booking_notice_hours, 10) || 0);
  if (minNoticeHours > 0) {
    const slotDateTime = new Date(date + 'T00:00:00Z');
    slotDateTime.setUTCHours(Math.floor(slotStart / 60), slotStart % 60, 0, 0);
    if (((slotDateTime - new Date()) / 3600000) < minNoticeHours) return false;
  }

  let overrideWindows = [];
  try {
    overrideWindows = await sql`
      SELECT start_time::text AS start_time, end_time::text AS end_time,
             COALESCE(transmission_type, 'both') AS transmission_type
      FROM instructor_availability_overrides
      WHERE instructor_id = ${instructorId}
        AND school_id = ${schoolId}
        AND override_date = ${date}::date
        AND active = true
    `;
  } catch (_) {}
  overrideWindows = overrideWindows
    .map(w => ({
      ...w,
      transmission_type: clampSlotTransmissionType(w.transmission_type, instructorTransmissionType)
    }))
    .filter(w => w.transmission_type);

  const blackoutRows = await sql`
    SELECT 1
    FROM instructor_blackout_dates
    WHERE instructor_id = ${instructorId}
      AND school_id = ${schoolId}
      AND blackout_date <= ${date}::date
      AND end_date >= ${date}::date
    LIMIT 1
  `;

  let externalEvents = [];
  try {
    externalEvents = await sql`
      SELECT start_time::text AS start_time, end_time::text AS end_time, is_all_day
      FROM instructor_external_events
      WHERE instructor_id = ${instructorId}
        AND school_id = ${schoolId}
        AND event_date = ${date}::date
    `;
  } catch (_) {}
  if (externalEvents.some(e => e.is_all_day)) return false;
  if (externalEvents.some(e => slotStart < timeToMinutes(e.end_time) && slotEnd > timeToMinutes(e.start_time))) {
    return false;
  }

  let busyBlocks = [];
  try {
    busyBlocks = await sql`
      SELECT start_time::text AS start_time, end_time::text AS end_time
      FROM instructor_busy_blocks
      WHERE instructor_id = ${instructorId}
        AND school_id = ${schoolId}
        AND block_date = ${date}::date
    `;
  } catch (_) {}
  if (busyBlocks.some(b => slotStart < timeToMinutes(b.end_time) && slotEnd > timeToMinutes(b.start_time))) {
    return false;
  }

  const weeklyWindows = blackoutRows.length > 0
    ? []
    : await sql`
        SELECT start_time::text AS start_time, end_time::text AS end_time,
               COALESCE(to_jsonb(instructor_availability)->>'transmission_type', 'both') AS transmission_type
        FROM instructor_availability
        WHERE instructor_id = ${instructorId}
          AND school_id = ${schoolId}
          AND day_of_week = ${dayOfWeek}
          AND active = true
      `;
  for (const w of weeklyWindows) {
    w.transmission_type = clampSlotTransmissionType(w.transmission_type, instructorTransmissionType);
  }

  return [...weeklyWindows, ...overrideWindows].some(w => {
    if (!w.transmission_type) return false;
    const windowStart = timeToMinutes(w.start_time);
    const windowEnd = timeToMinutes(w.end_time);
    return slotStart >= windowStart &&
           slotEnd <= windowEnd &&
           slotSupportsTransmission(w.transmission_type, transmissionType);
  });
}

async function slotHasBlockingOverlap(sql, { instructorId, schoolId, date, startTime, endTime }) {
  const [bookingConflict] = await sql`
    SELECT id
      FROM lesson_bookings
     WHERE instructor_id = ${instructorId}
       AND school_id = ${schoolId}
       AND scheduled_date = ${date}::date
       AND status = ANY(${BLOCKING_STATUSES}::text[])
       AND start_time < ${endTime}::time
       AND end_time > ${startTime}::time
     LIMIT 1
  `;
  if (bookingConflict) return true;

  const [reservationConflict] = await sql`
    SELECT id
      FROM slot_reservations
     WHERE instructor_id = ${instructorId}
       AND school_id = ${schoolId}
       AND scheduled_date = ${date}::date
       AND expires_at > NOW()
       AND start_time < ${endTime}::time
       AND end_time > ${startTime}::time
     LIMIT 1
  `;
  if (reservationConflict) return true;

  try {
    const [offerConflict] = await sql`
      SELECT id
        FROM lesson_offers
       WHERE instructor_id = ${instructorId}
         AND school_id = ${schoolId}
         AND scheduled_date = ${date}::date
         AND status = 'pending'
         AND expires_at > NOW()
         AND start_time < ${endTime}::time
         AND end_time > ${startTime}::time
       LIMIT 1
    `;
    if (offerConflict) return true;
  } catch (_) {}

  try {
    const [requestConflict] = await sql`
      SELECT id
        FROM lesson_requests
       WHERE instructor_id = ${instructorId}
         AND school_id = ${schoolId}
         AND scheduled_date = ${date}::date
         AND status = 'pending'
         AND expires_at > NOW()
         AND start_time < ${endTime}::time
         AND end_time > ${startTime}::time
       LIMIT 1
    `;
    if (requestConflict) return true;
  } catch (_) {}

  try {
    const [recurringHoldConflict] = await sql`
      SELECT rsbi.id
        FROM recurring_slot_block_items rsbi
        JOIN recurring_slot_blocks rsb ON rsb.id = rsbi.block_id
       WHERE rsbi.instructor_id = ${instructorId}
         AND rsbi.school_id = ${schoolId}
         AND rsbi.scheduled_date = ${date}::date
         AND rsbi.status = 'held'
         AND rsb.status = 'pending_payment'
         AND rsb.expires_at > NOW()
         AND rsbi.start_time < ${endTime}::time
         AND rsbi.end_time > ${startTime}::time
       LIMIT 1
    `;
    if (recurringHoldConflict) return true;
  } catch (_) {}

  try {
    const [busyBlockConflict] = await sql`
      SELECT id
        FROM instructor_busy_blocks
       WHERE instructor_id = ${instructorId}
         AND school_id = ${schoolId}
         AND block_date = ${date}::date
         AND start_time < ${endTime}::time
         AND end_time > ${startTime}::time
       LIMIT 1
    `;
    if (busyBlockConflict) return true;
  } catch (_) {}

  return false;
}

async function lockTestDateSlotMutation(client, { schoolId, instructorId, date }) {
  await client.query(
    `SELECT pg_advisory_xact_lock($1::integer, hashtext($2)::integer)`,
    [schoolId, `test-date-slot:${instructorId}:${date}`]
  );
}

async function testDateSlotOverlapConflictsPg(client, { instructorId, schoolId, dates, startTime, endTime, blockingStatuses = BLOCKING_STATUSES }) {
  const conflicts = [];
  const addRows = (rows, reason) => {
    for (const row of rows) {
      conflicts.push({
        date: String(row.date).slice(0, 10),
        start_time: String(row.start_time || startTime).slice(0, 5),
        reason,
      });
    }
  };

  const bookingConflicts = await client.query(
    `SELECT scheduled_date::text AS date, start_time::text
       FROM lesson_bookings
      WHERE instructor_id = $1
        AND school_id = $2
        AND scheduled_date = ANY($3::date[])
        AND status = ANY($6::text[])
        AND start_time < $5::time
        AND end_time > $4::time`,
    [instructorId, schoolId, dates, startTime, endTime, blockingStatuses]
  );
  addRows(bookingConflicts.rows, 'already_booked');

  const reservations = await client.query(
    `SELECT scheduled_date::text AS date, start_time::text
       FROM slot_reservations
      WHERE instructor_id = $1
        AND school_id = $2
        AND scheduled_date = ANY($3::date[])
        AND expires_at > NOW()
        AND start_time < $5::time
        AND end_time > $4::time`,
    [instructorId, schoolId, dates, startTime, endTime]
  );
  addRows(reservations.rows, 'reserved');

  try {
    const offerConflicts = await client.query(
      `SELECT scheduled_date::text AS date, start_time::text
         FROM lesson_offers
        WHERE instructor_id = $1
          AND school_id = $2
          AND scheduled_date = ANY($3::date[])
          AND status = 'pending'
          AND expires_at > NOW()
          AND start_time < $5::time
          AND end_time > $4::time`,
      [instructorId, schoolId, dates, startTime, endTime]
    );
    addRows(offerConflicts.rows, 'pending_offer');
  } catch (_) {}

  try {
    const requestConflicts = await client.query(
      `SELECT scheduled_date::text AS date, start_time::text
         FROM lesson_requests
        WHERE instructor_id = $1
          AND school_id = $2
          AND scheduled_date = ANY($3::date[])
          AND status = 'pending'
          AND expires_at > NOW()
          AND start_time < $5::time
          AND end_time > $4::time`,
      [instructorId, schoolId, dates, startTime, endTime]
    );
    addRows(requestConflicts.rows, 'pending_request');
  } catch (_) {}

  try {
    const recurringHoldConflicts = await client.query(
      `SELECT rsbi.scheduled_date::text AS date, rsbi.start_time::text
         FROM recurring_slot_block_items rsbi
         JOIN recurring_slot_blocks rsb ON rsb.id = rsbi.block_id
        WHERE rsbi.instructor_id = $1
          AND rsbi.school_id = $2
          AND rsbi.scheduled_date = ANY($3::date[])
          AND rsbi.status = 'held'
          AND rsb.status = 'pending_payment'
          AND rsb.expires_at > NOW()
          AND rsbi.start_time < $5::time
          AND rsbi.end_time > $4::time`,
      [instructorId, schoolId, dates, startTime, endTime]
    );
    addRows(recurringHoldConflicts.rows, 'pending_weekly_block');
  } catch (_) {}

  try {
    const busyBlockConflicts = await client.query(
      `SELECT block_date::text AS date, start_time::text
         FROM instructor_busy_blocks
        WHERE instructor_id = $1
          AND school_id = $2
          AND block_date = ANY($3::date[])
          AND start_time < $5::time
          AND end_time > $4::time`,
      [instructorId, schoolId, dates, startTime, endTime]
    );
    addRows(busyBlockConflicts.rows, 'busy_block');
  } catch (_) {}

  return conflicts;
}

async function resolveTestDateContext(req, res, { requireStartTime = false } = {}) {
  const user = verifyAuth(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorised' });
    return null;
  }
  const schoolId = user.school_id || 1;
  const sql = neon(process.env.POSTGRES_URL);
  const instructorId = parseInt(req.method === 'GET' ? req.query.instructor_id : req.body?.instructor_id, 10);
  const selectedStartTime = req.method === 'GET'
    ? normaliseStartTime(req.query.start_time)
    : normaliseStartTime(req.body?.start_time);
  const requestedTransmissionType = parseRequestTransmissionType(req.method === 'GET' ? req.query.transmission_type : req.body?.transmission_type);
  const submittedDuration = req.method === 'GET' ? req.query.duration_minutes : req.body?.duration_minutes;
  const submittedLessonTypeId = req.method === 'GET' ? req.query.lesson_type_id : req.body?.lesson_type_id;

  if (!instructorId) {
    res.status(400).json({ error: 'instructor_id is required' });
    return null;
  }
  if (requireStartTime && !selectedStartTime) {
    res.status(400).json({ error: 'start_time is required' });
    return null;
  }
  if (requireStartTime && !isQuarterHourStart(selectedStartTime)) {
    res.status(400).json({ error: 'Test date lesson start time must be on a quarter-hour boundary.' });
    return null;
  }
  if (submittedDuration !== undefined && submittedDuration !== null && String(submittedDuration).trim() !== '' && parseInt(submittedDuration, 10) !== TEST_DATE_DURATION_MINUTES) {
    res.status(400).json({ error: 'Test date lessons are always 90 minutes.' });
    return null;
  }

  const [learner] = await sql`
    SELECT id, name, email, phone, pickup_address,
           test_date::text AS test_date, test_time, test_centre,
           COALESCE(test_instructor_booked, FALSE) AS test_instructor_booked
      FROM learner_users
     WHERE id = ${user.id}
       AND school_id = ${schoolId}
  `;
  if (!learner) {
    res.status(404).json({ error: 'Learner account not found' });
    return null;
  }
  if (!learner.test_date || !learner.test_time) {
    res.status(400).json({ error: 'Save your practical test date and time in your profile before booking a test date lesson.' });
    return null;
  }
  if (learner.test_instructor_booked) {
    res.status(409).json({ error: 'Your practical test date lesson is already booked.' });
    return null;
  }
  const testDate = parseDate(String(learner.test_date).slice(0, 10));
  const testTime = normaliseStartTime(learner.test_time);
  if (!testDate || !testTime) {
    res.status(400).json({ error: 'Saved practical test details are invalid. Please update your profile.' });
    return null;
  }
  if (!isWithinTestDateUpperBound(testDate)) {
    res.status(400).json({ error: `Test date lessons can only be booked up to ${Math.floor(TEST_DATE_MAX_DAYS_AHEAD / 30)} months ahead.` });
    return null;
  }

  const [instructor] = await sql`
    SELECT id, name, email, phone, max_travel_minutes, offered_lesson_types,
           COALESCE(transmission_type, 'manual') AS transmission_type
      FROM instructors
     WHERE id = ${instructorId}
       AND school_id = ${schoolId}
       AND active = true
  `;
  if (!instructor) {
    res.status(404).json({ error: 'Instructor not found or unavailable' });
    return null;
  }

  const [lessonType] = await sql`
    SELECT id, slug, name, duration_minutes, price_pence, colour
      FROM lesson_types
     WHERE school_id = ${schoolId}
       AND active = true
       AND duration_minutes = ${TEST_DATE_DURATION_MINUTES}
       AND slug != 'trial'
     ORDER BY id ASC
     LIMIT 1
  `;
  if (!lessonType) {
    res.status(404).json({ error: 'No active 90-minute lesson type is configured for this school.' });
    return null;
  }
  if (submittedLessonTypeId !== undefined && submittedLessonTypeId !== null && String(submittedLessonTypeId).trim() !== '' && parseInt(submittedLessonTypeId, 10) !== Number(lessonType.id)) {
    res.status(400).json({ error: 'Test date lessons must use the server-selected 90-minute lesson type.' });
    return null;
  }
  if (!isLessonTypeOffered(instructor.offered_lesson_types, lessonType.slug)) {
    res.status(400).json({ error: 'This instructor does not currently offer the 90-minute test date lesson length.' });
    return null;
  }

  const options = generateTestDateStartOptions(testTime);
  const selectedOption = selectedStartTime ? options.find(o => o.start_time === selectedStartTime) : null;
  if (requireStartTime && !selectedOption) {
    res.status(400).json({ error: 'Choose one of the recommended quarter-hour start times for your saved test time.' });
    return null;
  }
  if (requireStartTime && !testStartCoveredByLesson(selectedOption.start_time, selectedOption.end_time, testTime)) {
    res.status(400).json({ error: 'The 90-minute test date lesson must cover your practical test start time.' });
    return null;
  }

  return {
    sql,
    user,
    schoolId,
    learner,
    instructor,
    lessonType,
    options,
    selectedOption,
    testDate: formatDate(testDate),
    testTime,
    testCentre: learner.test_centre || null,
    requestedTransmissionType,
  };
}

async function buildTestDateAvailability(ctx, { pickupAddress = null } = {}) {
  const results = [];
  const pickup = pickupAddress || ctx.learner.pickup_address || null;
  for (const option of ctx.options) {
    let fits = true;
    let reason = null;
    if (!testStartCoveredByLesson(option.start_time, option.end_time, ctx.testTime)) {
      fits = false; reason = 'coverage';
    } else if (!await slotFitsActiveAvailability(ctx.sql, {
      instructorId: ctx.instructor.id,
      schoolId: ctx.schoolId,
      date: ctx.testDate,
      startTime: option.start_time,
      endTime: option.end_time,
      transmissionType: ctx.requestedTransmissionType,
      enforceBookingWindow: false,
    })) {
      fits = false; reason = 'availability';
    } else if (await slotHasBlockingOverlap(ctx.sql, {
      instructorId: ctx.instructor.id,
      schoolId: ctx.schoolId,
      date: ctx.testDate,
      startTime: option.start_time,
      endTime: option.end_time,
    })) {
      fits = false; reason = 'clash';
    } else if (pickup && await checkPickupTravelSpacingConflict(ctx.sql, {
      instructorId: ctx.instructor.id,
      schoolId: ctx.schoolId,
      date: ctx.testDate,
      startTime: option.start_time,
      endTime: option.end_time,
      pickupAddress: pickup,
      maxTravelMinutes: ctx.instructor.max_travel_minutes || undefined,
    })) {
      fits = false; reason = 'travel';
    }
    results.push({ ...option, fits, reason });
  }
  return results;
}


// verifyAuth delegates to centralised _auth.js.
// All handlers in slots.js (handleBook, handleCheckoutSlot, handleCancel,
// handleReschedule, handleMyBookings, handleSeriesInfo) treat `user.id` as
// a learner ID and filter by `learner_id = ${user.id}`. Accepting
// instructor/admin tokens here would either silently return no rows or
// INSERT a booking with a bogus learner FK — restrict to learners.
// Guest checkout uses its own separate handler (handleCheckoutSlotGuest).
function verifyAuth(req) {
  const { requireAuth } = require('./_auth');
  return requireAuth(req, { roles: ['learner'] });
}

module.exports = async (req, res) => {
  const action = req.query.action;
  const method = req.method || 'GET';
  const shouldLog = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const startedAt = shouldLog ? Date.now() : 0;

  if (shouldLog) {
    const origStatus = res.status.bind(res);
    let statusCode = 200;
    res.status = (code) => { statusCode = code; return origStatus(code); };
    res.on('finish', () => {
      const ms = Date.now() - startedAt;
      console.log(`[slots-api] ${method} action=${action} status=${statusCode} ${ms}ms`);
    });
  }

  if (action === 'available')    return handleAvailable(req, res);
  if (action === 'durations-for-slot') return handleDurationsForSlot(req, res);
  if (action === 'recurring-block-preview') return handleRecurringBlockPreview(req, res);
  if (action === 'recurring-block-commit') return handleRecurringBlockCommit(req, res);
  if (action === 'recurring-block-bank-checkout') return handleRecurringBlockBankCheckout(req, res);
  if (action === 'recurring-block-status') return handleRecurringBlockStatus(req, res);
  if (action === 'test-date-availability') return handleTestDateAvailability(req, res);
  if (action === 'book-test-date') return handleBookTestDate(req, res);
  if (action === 'checkout-test-date') return handleCheckoutTestDate(req, res);
  if (action === 'book')         return handleBook(req, res);
  if (action === 'request-slot') return handleRequestSlot(req, res);
  if (action === 'my-requests')  return handleMyRequests(req, res);
  if (action === 'withdraw-request') return handleWithdrawRequest(req, res);
  if (action === 'checkout-request') return handleCheckoutRequest(req, res);
  if (action === 'checkout-slot') return handleCheckoutSlot(req, res);
  if (action === 'checkout-slot-guest') return handleCheckoutSlotGuest(req, res);
  if (action === 'book-free-trial') return handleBookFreeTrial(req, res);
  if (action === 'cancel')       return handleCancel(req, res);
  if (action === 'reserved-policy-move') return handleReservedPolicyMove(req, res);
  if (action === 'reschedule')   return handleReschedule(req, res);
  if (action === 'my-bookings')  return handleMyBookings(req, res);
  if (action === 'series-info')  return handleSeriesInfo(req, res);

  return res.status(400).json({ error: 'Unknown action' });
};

// ── GET /api/slots?action=available ──────────────────────────────────────────
async function handleAvailable(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { from, to, instructor_id, lesson_type_id, lesson_type_slug, pickup_postcode, transmission_type } = req.query;
  const requestedTransmissionType = parseRequestTransmissionType(transmission_type);
  if (transmission_type && !requestedTransmissionType) {
    return res.status(400).json({ error: 'transmission_type must be manual, automatic, or both' });
  }
  // Slot-first: when true, the caller is using lesson_type_id only to set the
  // provisional slot duration. Skip the offered_lesson_types
  // filter so instructors offering OTHER durations are not excluded — the
  // per-duration check happens later in handleDurationsForSlot when the user
  // clicks a slot.
  const minDurationOnly = req.query.min_duration_only === '1' || req.query.min_duration_only === 'true';

  // Validate dates
  if (!from || !to)
    return res.status(400).json({ error: '"from" and "to" query params are required (YYYY-MM-DD)' });

  const fromDate = parseDate(from);
  const toDate   = parseDate(to);

  if (!fromDate || !toDate)
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });

  const today    = startOfDay(new Date());
  const maxAhead = addDays(today, MAX_DAYS_AHEAD);

  if (fromDate < today)
    return res.status(400).json({ error: '"from" date cannot be in the past' });

  if (toDate > maxAhead)
    return res.status(400).json({
      error: `"to" date cannot be more than ${MAX_DAYS_AHEAD} days from today`
    });

  if (daysBetween(fromDate, toDate) > MAX_RANGE_DAYS)
    return res.status(400).json({
      error: `Date range cannot exceed ${MAX_RANGE_DAYS} days per request`
    });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const tenant = await resolveSchoolFromRequest(req, { sql, allowLegacySchoolIdQuery: true });
    if (!tenant) return res.status(404).json({ error: 'School not found' });
    const schoolId = tenant.schoolId;

    // 0. Look up lesson type to get duration
    const lessonType = await getLessonType(sql, lesson_type_id, schoolId, lesson_type_slug);
    if (!lessonType) return res.status(404).json({ error: 'Lesson type not found or inactive' });
    const slotMinutes = lessonType.duration_minutes;

    // 1. Load availability windows (optionally filtered to one instructor).
    // When minDurationOnly is set, we don't filter by offered_lesson_types —
    // the slot feed shows everyone, and per-duration filtering happens in
    // handleDurationsForSlot when the user clicks a slot.
    //
    // All of the data queries below (windows, overrides, bookings, holds,
    // blackouts, external events, busy blocks) are independent of each other,
    // so they are built as promises and awaited together in one Promise.all —
    // the Neon HTTP driver pays a full round-trip per query, and running them
    // sequentially dominated this endpoint's response time.
    const offeredFilterJson = JSON.stringify([lessonType.slug]);
    const implicitOfferAllowed = !isOptInOnlyLessonTypeSlug(lessonType.slug);
    const slotStartIntervalsPromise = instructor_id
      ? sql`
          SELECT i.id AS instructor_id,
                 COALESCE((to_jsonb(i)->>'slot_start_interval_minutes')::integer, 30) AS slot_start_interval_minutes
          FROM instructors i
          WHERE i.id = ${instructor_id}
            AND i.active = true
            AND i.school_id = ${schoolId}
        `
      : sql`
          SELECT i.id AS instructor_id,
                 COALESCE((to_jsonb(i)->>'slot_start_interval_minutes')::integer, 30) AS slot_start_interval_minutes
          FROM instructors i
          WHERE i.active = true
            AND i.email != 'demo@coachcarter.uk'
            AND i.school_id = ${schoolId}
        `;
    const windowsPromise = (async () => instructor_id
      ? (minDurationOnly
        ? await sql`
            SELECT ia.instructor_id, ia.day_of_week,
                   ia.start_time::text AS start_time,
                   ia.end_time::text   AS end_time,
                   i.name AS instructor_name,
                   i.photo_url, i.bio,
                   COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
                   COALESCE(i.min_booking_notice_hours, 24) AS min_booking_notice_hours,
                   COALESCE(i.max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
                   COALESCE(to_jsonb(ia)->>'transmission_type', 'both') AS transmission_type,
                   COALESCE(i.transmission_type, 'manual') AS instructor_transmission_type,
                   i.max_travel_minutes,
                   COALESCE(i.request_to_book, false) AS request_to_book
            FROM instructor_availability ia
            JOIN instructors i ON i.id = ia.instructor_id
            WHERE ia.instructor_id = ${instructor_id}
              AND ia.active = true
              AND ia.school_id = ${schoolId}
              AND i.active  = true
              AND i.school_id = ${schoolId}
            ORDER BY ia.day_of_week, ia.start_time
          `
        : await sql`
            SELECT ia.instructor_id, ia.day_of_week,
                   ia.start_time::text AS start_time,
                   ia.end_time::text   AS end_time,
                   i.name AS instructor_name,
                   i.photo_url, i.bio,
                   COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
                   COALESCE(i.min_booking_notice_hours, 24) AS min_booking_notice_hours,
                   COALESCE(i.max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
                   COALESCE(to_jsonb(ia)->>'transmission_type', 'both') AS transmission_type,
                   COALESCE(i.transmission_type, 'manual') AS instructor_transmission_type,
                   i.max_travel_minutes,
                   COALESCE(i.request_to_book, false) AS request_to_book
            FROM instructor_availability ia
            JOIN instructors i ON i.id = ia.instructor_id
            WHERE ia.instructor_id = ${instructor_id}
              AND ia.active = true
              AND ia.school_id = ${schoolId}
              AND i.active  = true
              AND i.school_id = ${schoolId}
              AND ((${implicitOfferAllowed} AND i.offered_lesson_types IS NULL) OR i.offered_lesson_types @> ${offeredFilterJson}::jsonb)
            ORDER BY ia.day_of_week, ia.start_time
          `)
      : (minDurationOnly
        ? await sql`
            SELECT ia.instructor_id, ia.day_of_week,
                   ia.start_time::text AS start_time,
                   ia.end_time::text   AS end_time,
                   i.name AS instructor_name,
                   i.photo_url, i.bio,
                   COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
                   COALESCE(i.min_booking_notice_hours, 24) AS min_booking_notice_hours,
                   COALESCE(i.max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
                   COALESCE(to_jsonb(ia)->>'transmission_type', 'both') AS transmission_type,
                   COALESCE(i.transmission_type, 'manual') AS instructor_transmission_type,
                   i.max_travel_minutes,
                   COALESCE(i.request_to_book, false) AS request_to_book
            FROM instructor_availability ia
            JOIN instructors i ON i.id = ia.instructor_id
            WHERE ia.active = true
              AND ia.school_id = ${schoolId}
              AND i.active  = true
              AND i.email  != 'demo@coachcarter.uk'
              AND i.school_id = ${schoolId}
            ORDER BY ia.instructor_id, ia.day_of_week, ia.start_time
          `
        : await sql`
            SELECT ia.instructor_id, ia.day_of_week,
                   ia.start_time::text AS start_time,
                   ia.end_time::text   AS end_time,
                   i.name AS instructor_name,
                   i.photo_url, i.bio,
                   COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
                   COALESCE(i.min_booking_notice_hours, 24) AS min_booking_notice_hours,
                   COALESCE(i.max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
                   COALESCE(to_jsonb(ia)->>'transmission_type', 'both') AS transmission_type,
                   COALESCE(i.transmission_type, 'manual') AS instructor_transmission_type,
                   i.max_travel_minutes,
                   COALESCE(i.request_to_book, false) AS request_to_book
            FROM instructor_availability ia
            JOIN instructors i ON i.id = ia.instructor_id
            WHERE ia.active = true
              AND ia.school_id = ${schoolId}
              AND i.active  = true
              AND i.email  != 'demo@coachcarter.uk'
              AND i.school_id = ${schoolId}
              AND ((${implicitOfferAllowed} AND i.offered_lesson_types IS NULL) OR i.offered_lesson_types @> ${offeredFilterJson}::jsonb)
            ORDER BY ia.instructor_id, ia.day_of_week, ia.start_time
          `))();

    const overrideWindowsPromise = (async () => {
      try {
      return instructor_id
        ? (minDurationOnly
          ? await sql`
              SELECT iao.instructor_id,
                     iao.override_date::text AS override_date,
                     iao.start_time::text AS start_time,
                     iao.end_time::text AS end_time,
                     i.name AS instructor_name,
                     i.photo_url, i.bio,
                     COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
                     COALESCE(i.min_booking_notice_hours, 24) AS min_booking_notice_hours,
                     COALESCE(i.max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
                     COALESCE(iao.transmission_type, 'both') AS transmission_type,
                     COALESCE(i.transmission_type, 'manual') AS instructor_transmission_type,
                     i.max_travel_minutes,
                   COALESCE(i.request_to_book, false) AS request_to_book
              FROM instructor_availability_overrides iao
              JOIN instructors i ON i.id = iao.instructor_id
              WHERE iao.instructor_id = ${instructor_id}
                AND iao.active = true
                AND iao.school_id = ${schoolId}
                AND iao.override_date BETWEEN ${from} AND ${to}
                AND i.active = true
                AND i.school_id = ${schoolId}
              ORDER BY iao.override_date, iao.start_time
            `
          : await sql`
              SELECT iao.instructor_id,
                     iao.override_date::text AS override_date,
                     iao.start_time::text AS start_time,
                     iao.end_time::text AS end_time,
                     i.name AS instructor_name,
                     i.photo_url, i.bio,
                     COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
                     COALESCE(i.min_booking_notice_hours, 24) AS min_booking_notice_hours,
                     COALESCE(i.max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
                     COALESCE(iao.transmission_type, 'both') AS transmission_type,
                     COALESCE(i.transmission_type, 'manual') AS instructor_transmission_type,
                     i.max_travel_minutes,
                   COALESCE(i.request_to_book, false) AS request_to_book
              FROM instructor_availability_overrides iao
              JOIN instructors i ON i.id = iao.instructor_id
              WHERE iao.instructor_id = ${instructor_id}
                AND iao.active = true
                AND iao.school_id = ${schoolId}
                AND iao.override_date BETWEEN ${from} AND ${to}
                AND i.active = true
                AND i.school_id = ${schoolId}
                AND ((${implicitOfferAllowed} AND i.offered_lesson_types IS NULL) OR i.offered_lesson_types @> ${offeredFilterJson}::jsonb)
              ORDER BY iao.override_date, iao.start_time
            `)
        : (minDurationOnly
          ? await sql`
              SELECT iao.instructor_id,
                     iao.override_date::text AS override_date,
                     iao.start_time::text AS start_time,
                     iao.end_time::text AS end_time,
                     i.name AS instructor_name,
                     i.photo_url, i.bio,
                     COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
                     COALESCE(i.min_booking_notice_hours, 24) AS min_booking_notice_hours,
                     COALESCE(i.max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
                     COALESCE(iao.transmission_type, 'both') AS transmission_type,
                     COALESCE(i.transmission_type, 'manual') AS instructor_transmission_type,
                     i.max_travel_minutes,
                   COALESCE(i.request_to_book, false) AS request_to_book
              FROM instructor_availability_overrides iao
              JOIN instructors i ON i.id = iao.instructor_id
              WHERE iao.active = true
                AND iao.school_id = ${schoolId}
                AND iao.override_date BETWEEN ${from} AND ${to}
                AND i.active = true
                AND i.email != 'demo@coachcarter.uk'
                AND i.school_id = ${schoolId}
              ORDER BY iao.instructor_id, iao.override_date, iao.start_time
            `
          : await sql`
              SELECT iao.instructor_id,
                     iao.override_date::text AS override_date,
                     iao.start_time::text AS start_time,
                     iao.end_time::text AS end_time,
                     i.name AS instructor_name,
                     i.photo_url, i.bio,
                     COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
                     COALESCE(i.min_booking_notice_hours, 24) AS min_booking_notice_hours,
                     COALESCE(i.max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
                     COALESCE(iao.transmission_type, 'both') AS transmission_type,
                     COALESCE(i.transmission_type, 'manual') AS instructor_transmission_type,
                     i.max_travel_minutes,
                   COALESCE(i.request_to_book, false) AS request_to_book
              FROM instructor_availability_overrides iao
              JOIN instructors i ON i.id = iao.instructor_id
              WHERE iao.active = true
                AND iao.school_id = ${schoolId}
                AND iao.override_date BETWEEN ${from} AND ${to}
                AND i.active = true
                AND i.email != 'demo@coachcarter.uk'
                AND i.school_id = ${schoolId}
                AND ((${implicitOfferAllowed} AND i.offered_lesson_types IS NULL) OR i.offered_lesson_types @> ${offeredFilterJson}::jsonb)
              ORDER BY iao.instructor_id, iao.override_date, iao.start_time
            `);
      } catch (e) {
        // Table may not exist before the availability override migration has run.
        return [];
      }
    })();

    // 2. Load all confirmed/completed bookings in the date range
    const bookingsPromise = instructor_id
      ? sql`
          SELECT instructor_id,
                 scheduled_date::text AS scheduled_date,
                 start_time::text     AS start_time,
                 end_time::text       AS end_time,
                 pickup_address
          FROM lesson_bookings
          WHERE scheduled_date BETWEEN ${from} AND ${to}
            AND status = ANY(${BLOCKING_STATUSES}::text[])
            AND instructor_id = ${instructor_id}
            AND school_id = ${schoolId}
        `
      : sql`
          SELECT instructor_id,
                 scheduled_date::text AS scheduled_date,
                 start_time::text     AS start_time,
                 end_time::text       AS end_time,
                 pickup_address
          FROM lesson_bookings
          WHERE scheduled_date BETWEEN ${from} AND ${to}
            AND status = ANY(${BLOCKING_STATUSES}::text[])
            AND school_id = ${schoolId}
        `;

    // 2b. Also load active slot reservations (held during Stripe checkout)
    const reservationsPromise = (async () => {
      try {
      return instructor_id
        ? await sql`
            SELECT instructor_id,
                   scheduled_date::text AS scheduled_date,
                   start_time::text     AS start_time,
                   end_time::text       AS end_time
            FROM slot_reservations
            WHERE scheduled_date BETWEEN ${from} AND ${to}
              AND expires_at > NOW()
              AND instructor_id = ${instructor_id}
              AND school_id = ${schoolId}
          `
        : await sql`
            SELECT instructor_id,
                   scheduled_date::text AS scheduled_date,
                   start_time::text     AS start_time,
                   end_time::text       AS end_time
            FROM slot_reservations
            WHERE scheduled_date BETWEEN ${from} AND ${to}
              AND expires_at > NOW()
              AND school_id = ${schoolId}
          `;
      } catch (e) {
        // Table may not exist yet — that's fine, no reservations
        return [];
      }
    })();

    // 2b-ii. Also load pending lesson offers (instructor-initiated, awaiting acceptance)
    const pendingOffersPromise = (async () => {
      try {
      return instructor_id
        ? await sql`
            SELECT instructor_id,
                   scheduled_date::text AS scheduled_date,
                   start_time::text     AS start_time,
                   end_time::text       AS end_time
            FROM lesson_offers
            WHERE scheduled_date BETWEEN ${from} AND ${to}
              AND status = 'pending'
              AND expires_at > NOW()
              AND instructor_id = ${instructor_id}
              AND school_id = ${schoolId}
          `
        : await sql`
            SELECT instructor_id,
                   scheduled_date::text AS scheduled_date,
                   start_time::text     AS start_time,
                   end_time::text       AS end_time
            FROM lesson_offers
            WHERE scheduled_date BETWEEN ${from} AND ${to}
              AND status = 'pending'
              AND expires_at > NOW()
              AND school_id = ${schoolId}
          `;
      } catch (e) {
        // Table may not exist yet
        return [];
      }
    })();

    // 2b-iii. Pending lesson requests block their slot exactly like offers
    // (LESSON-REQUEST-PLAN.md).
    const pendingRequestsPromise = (async () => {
      try {
      return instructor_id
        ? await sql`
            SELECT instructor_id,
                   scheduled_date::text AS scheduled_date,
                   start_time::text     AS start_time,
                   end_time::text       AS end_time
            FROM lesson_requests
            WHERE scheduled_date BETWEEN ${from} AND ${to}
              AND status = 'pending'
              AND expires_at > NOW()
              AND instructor_id = ${instructor_id}
              AND school_id = ${schoolId}
          `
        : await sql`
            SELECT instructor_id,
                   scheduled_date::text AS scheduled_date,
                   start_time::text     AS start_time,
                   end_time::text       AS end_time
            FROM lesson_requests
            WHERE scheduled_date BETWEEN ${from} AND ${to}
              AND status = 'pending'
              AND expires_at > NOW()
              AND school_id = ${schoolId}
          `;
      } catch (e) {
        // Table may not exist yet
        return [];
      }
    })();

    const recurringHoldsPromise = (async () => {
      try {
      return instructor_id
        ? await sql`
            SELECT rsbi.instructor_id,
                   rsbi.scheduled_date::text AS scheduled_date,
                   rsbi.start_time::text     AS start_time,
                   rsbi.end_time::text       AS end_time
            FROM recurring_slot_block_items rsbi
            JOIN recurring_slot_blocks rsb ON rsb.id = rsbi.block_id
            WHERE rsbi.scheduled_date BETWEEN ${from} AND ${to}
              AND rsbi.status = 'held'
              AND rsb.status = 'pending_payment'
              AND rsb.expires_at > NOW()
              AND rsbi.instructor_id = ${instructor_id}
              AND rsbi.school_id = ${schoolId}
          `
        : await sql`
            SELECT rsbi.instructor_id,
                   rsbi.scheduled_date::text AS scheduled_date,
                   rsbi.start_time::text     AS start_time,
                   rsbi.end_time::text       AS end_time
            FROM recurring_slot_block_items rsbi
            JOIN recurring_slot_blocks rsb ON rsb.id = rsbi.block_id
            WHERE rsbi.scheduled_date BETWEEN ${from} AND ${to}
              AND rsbi.status = 'held'
              AND rsb.status = 'pending_payment'
              AND rsb.expires_at > NOW()
              AND rsbi.school_id = ${schoolId}
          `;
      } catch (e) {
        // Table may not exist before the recurring block migration has run.
        return [];
      }
    })();

    // 2c. Load blackout date ranges overlapping the requested window
    const blackoutsPromise = (async () => {
      try {
      return instructor_id
        ? await sql`
            SELECT ibd.instructor_id, ibd.blackout_date::text AS start_date, ibd.end_date::text
            FROM instructor_blackout_dates ibd
            JOIN instructors i ON i.id = ibd.instructor_id
            WHERE ibd.blackout_date <= ${to} AND ibd.end_date >= ${from}
              AND ibd.instructor_id = ${instructor_id}
              AND ibd.school_id = ${schoolId}
              AND i.school_id = ${schoolId}
          `
        : await sql`
            SELECT ibd.instructor_id, ibd.blackout_date::text AS start_date, ibd.end_date::text
            FROM instructor_blackout_dates ibd
            JOIN instructors i ON i.id = ibd.instructor_id
            WHERE ibd.blackout_date <= ${to} AND ibd.end_date >= ${from}
              AND ibd.school_id = ${schoolId}
              AND i.school_id = ${schoolId}
          `;
      } catch (e) {
      console.warn('Blackout query failed (end_date column may be missing — run migration):', e.message);
      // Fallback: try single-date query without end_date
      try {
        return instructor_id
          ? await sql`
              SELECT ibd.instructor_id, ibd.blackout_date::text AS start_date, ibd.blackout_date::text AS end_date
              FROM instructor_blackout_dates ibd
              JOIN instructors i ON i.id = ibd.instructor_id
              WHERE ibd.blackout_date BETWEEN ${from} AND ${to}
                AND ibd.instructor_id = ${instructor_id}
                AND ibd.school_id = ${schoolId}
                AND i.school_id = ${schoolId}
            `
          : await sql`
              SELECT ibd.instructor_id, ibd.blackout_date::text AS start_date, ibd.blackout_date::text AS end_date
              FROM instructor_blackout_dates ibd
              JOIN instructors i ON i.id = ibd.instructor_id
              WHERE ibd.blackout_date BETWEEN ${from} AND ${to}
                AND ibd.school_id = ${schoolId}
                AND i.school_id = ${schoolId}
            `;
      } catch (e2) {
        // Table genuinely doesn't exist
        return [];
      }
      }
    })();

    // 2d. Load external calendar events (iCal sync) in the date range
    const externalEventsPromise = (async () => {
      try {
      return instructor_id
        ? await sql`
            SELECT iee.instructor_id, iee.event_date::text AS event_date,
                   iee.start_time::text AS start_time, iee.end_time::text AS end_time, iee.is_all_day
            FROM instructor_external_events iee
            JOIN instructors i ON i.id = iee.instructor_id
            WHERE iee.event_date BETWEEN ${from} AND ${to}
              AND iee.instructor_id = ${instructor_id}
              AND iee.school_id = ${schoolId}
              AND i.school_id = ${schoolId}
          `
        : await sql`
            SELECT iee.instructor_id, iee.event_date::text AS event_date,
                   iee.start_time::text AS start_time, iee.end_time::text AS end_time, iee.is_all_day
            FROM instructor_external_events iee
            JOIN instructors i ON i.id = iee.instructor_id
            WHERE iee.event_date BETWEEN ${from} AND ${to}
              AND iee.school_id = ${schoolId}
              AND i.school_id = ${schoolId}
          `;
      } catch (e) {
        // Table may not exist yet
        return [];
      }
    })();

    // 2e. Load instructor-entered busy blocks in the date range. Timed busy
    // blocks behave like bookings for availability generation.
    const busyBlocksPromise = (async () => {
      try {
      return instructor_id
        ? await sql`
            SELECT ibb.instructor_id, ibb.block_date::text AS block_date,
                   ibb.start_time::text AS start_time, ibb.end_time::text AS end_time
            FROM instructor_busy_blocks ibb
            JOIN instructors i ON i.id = ibb.instructor_id
            WHERE ibb.block_date BETWEEN ${from} AND ${to}
              AND ibb.instructor_id = ${instructor_id}
              AND ibb.school_id = ${schoolId}
              AND i.school_id = ${schoolId}
          `
        : await sql`
            SELECT ibb.instructor_id, ibb.block_date::text AS block_date,
                   ibb.start_time::text AS start_time, ibb.end_time::text AS end_time
            FROM instructor_busy_blocks ibb
            JOIN instructors i ON i.id = ibb.instructor_id
            WHERE ibb.block_date BETWEEN ${from} AND ${to}
              AND ibb.school_id = ${schoolId}
              AND i.school_id = ${schoolId}
          `;
      } catch (e) {
        // Table may not exist yet.
        return [];
      }
    })();

    // Await everything in one round-trip wave.
    const [windows, overrideWindows, slotStartIntervalRows, bookings, reservationRows, pendingOffers,
           pendingRequests, recurringHolds, blackouts, externalEvents, busyBlocks] =
      await Promise.all([windowsPromise, overrideWindowsPromise, slotStartIntervalsPromise, bookingsPromise,
                         reservationsPromise, pendingOffersPromise, pendingRequestsPromise,
                         recurringHoldsPromise, blackoutsPromise, externalEventsPromise,
                         busyBlocksPromise]);

    // Merge pending offers, pending requests and recurring holds into
    // reservations so they all block slots identically.
    const reservations = reservationRows.concat(pendingOffers, pendingRequests, recurringHolds);
    const slotStartIntervalByInstructor = new Map(
      slotStartIntervalRows.map(row => [
        Number(row.instructor_id),
        normaliseSlotStartInterval(row.slot_start_interval_minutes)
      ])
    );

    // Expand blackout ranges into individual "instructorId|date" entries for fast lookup
    const blackoutIndex = new Set();
    for (const b of blackouts) {
      const startIso = b.start_date instanceof Date ? b.start_date.toISOString().slice(0, 10) : String(b.start_date).slice(0, 10);
      const endIso = b.end_date instanceof Date ? b.end_date.toISOString().slice(0, 10) : String(b.end_date).slice(0, 10);
      const start = new Date(startIso + 'T00:00:00');
      const end = new Date(endIso + 'T00:00:00');
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().slice(0, 10);
        blackoutIndex.add(`${b.instructor_id}|${ds}`);
      }
    }

    const externalAllDayIndex = new Set();

    // Index bookings + reservations by "instructorId|date" for fast lookup
    const bookedIndex = {};
    for (const b of [...bookings, ...reservations]) {
      const key = `${b.instructor_id}|${b.scheduled_date}`;
      if (!bookedIndex[key]) bookedIndex[key] = [];
      bookedIndex[key].push({
        start: timeToMinutes(b.start_time),
        end: timeToMinutes(b.end_time),
        postcode: b.pickup_address ? extractPostcode(b.pickup_address) : null
      });
    }

    // Index external calendar events: all-day events are hard blockers,
    // timed events behave like existing bookings.
    for (const e of externalEvents) {
      if (e.is_all_day) {
        externalAllDayIndex.add(`${e.instructor_id}|${e.event_date}`);
      } else {
        const key = `${e.instructor_id}|${e.event_date}`;
        if (!bookedIndex[key]) bookedIndex[key] = [];
        bookedIndex[key].push({ start: timeToMinutes(e.start_time), end: timeToMinutes(e.end_time) });
      }
    }
    for (const b of busyBlocks) {
      const key = `${b.instructor_id}|${b.block_date}`;
      if (!bookedIndex[key]) bookedIndex[key] = [];
      bookedIndex[key].push({ start: timeToMinutes(b.start_time), end: timeToMinutes(b.end_time), postcode: null });
    }

    // 3. Group windows by instructor
    const byInstructor = {};
    for (const w of [...windows, ...overrideWindows]) {
      const windowTransmissionType = clampSlotTransmissionType(w.transmission_type, w.instructor_transmission_type);
      if (!windowTransmissionType) continue;
      if (!byInstructor[w.instructor_id]) {
        byInstructor[w.instructor_id] = {
          id:             w.instructor_id,
          name:           w.instructor_name,
          photo_url:      w.photo_url,
          bio:            w.bio,
          buffer_minutes: w.buffer_minutes != null ? Math.max(0, parseInt(w.buffer_minutes, 10) || 0) : 30,
          min_booking_notice_hours: parseInt(w.min_booking_notice_hours) || 24,
          max_booking_days_ahead: normaliseMaxBookingDaysAhead(w.max_booking_days_ahead),
          slot_start_interval_minutes: normaliseSlotStartInterval(
            slotStartIntervalByInstructor.get(Number(w.instructor_id))
          ),
          max_travel_minutes: w.max_travel_minutes != null ? parseInt(w.max_travel_minutes) : DEFAULT_MAX_TRAVEL_MINUTES,
          request_to_book: !!w.request_to_book,
          windows:        []
        };
      }
      byInstructor[w.instructor_id].windows.push({
        day_of_week: w.day_of_week,
        override_date: w.override_date || null,
        transmission_type: windowTransmissionType,
        start: timeToMinutes(w.start_time),
        end:   timeToMinutes(w.end_time)
      });
    }

    // 3b. Travel time filtering — geocode all postcodes if learner provided theirs
    const learnerPostcode = pickup_postcode ? pickup_postcode.toUpperCase().replace(/\s+/g, ' ') : null;
    let coordMap = {}; // postcode → { lat, lon }
    if (learnerPostcode) {
      try {
        // Collect all unique postcodes from bookings + learner's postcode
        const allPostcodes = new Set([learnerPostcode]);
        for (const slots of Object.values(bookedIndex)) {
          for (const s of slots) {
            if (s.postcode) allPostcodes.add(s.postcode);
          }
        }
        coordMap = await bulkGeocodeUK([...allPostcodes]);
      } catch { /* graceful — skip travel filtering if geocoding fails */ }
    }

    // 4. Walk every date in range and generate slots
    const result = {}; // { "YYYY-MM-DD": [ slot, ... ] }
    let travelHiddenCount = 0; // slots removed by travel time filter

    // For same-day booking: calculate current time in minutes to filter past slots
    const now          = new Date();
    const todayStr     = formatDate(today);
    const nowMinutes   = now.getUTCHours() * 60 + now.getUTCMinutes();

    let cursor = new Date(fromDate);
    while (cursor <= toDate) {
      const dateStr    = formatDate(cursor);
      const dayOfWeek  = cursor.getDay(); // 0=Sun … 6=Sat
      const isToday    = dateStr === todayStr;
      const daySlots   = [];
      const daySlotKeys = new Set();

      for (const instructor of Object.values(byInstructor)) {
        if (!isDateWithinBookingWindow(cursor, instructor.max_booking_days_ahead)) continue;
        if (externalAllDayIndex.has(`${instructor.id}|${dateStr}`)) continue;
        const dateWindows = instructor.windows.filter(w => w.override_date === dateStr);
        const isBlackout = blackoutIndex.has(`${instructor.id}|${dateStr}`);
        if (isBlackout && dateWindows.length === 0) continue;

        const weeklyWindows = isBlackout
          ? []
          : instructor.windows.filter(w => !w.override_date && w.day_of_week === dayOfWeek);
        const matchingWindows = dateWindows.concat(weeklyWindows);
        const bookedSlots     = bookedIndex[`${instructor.id}|${dateStr}`] || [];
        const buffer          = instructor.buffer_minutes || 0;

        for (const window of matchingWindows) {
          if (!slotSupportsTransmission(window.transmission_type, requestedTransmissionType)) continue;
          const slotStartIncrementMinutes = instructor.slot_start_interval_minutes;
          let slotStart = firstSlotStartForWindow(window.start, slotStartIncrementMinutes);

          while (slotStart + slotMinutes <= window.end) {
            const slotEnd = slotStart + slotMinutes;

            // Skip slots that have already started today
            if (isToday && slotStart <= nowMinutes) {
              slotStart += slotStartIncrementMinutes;
              continue;
            }

            // Skip slots within the instructor's minimum booking notice period
            if (instructor.min_booking_notice_hours > 0) {
              const slotDateTime = new Date(cursor);
              slotDateTime.setUTCHours(Math.floor(slotStart / 60), slotStart % 60, 0, 0);
              const hoursUntilSlot = (slotDateTime - now) / 3600000;
              if (hoursUntilSlot < instructor.min_booking_notice_hours) {
                slotStart += slotStartIncrementMinutes;
                continue;
              }
            }

            // Check if this slot overlaps any booked slot, including the required
            // gap between the earlier booking and whichever blocked item follows.
            const isBooked = bookedSlots.some(
              b => hasBufferedSlotConflict(slotStart, slotEnd, b.start, b.end, buffer)
            );

            if (isBooked) {
              slotStart += slotStartIncrementMinutes;
              continue;
            }

            // Travel time filter — hide slots where instructor can't travel in time
            if (learnerPostcode) {
              const travelBlocked = !!findAdjacentTravelSpacingConflict({
                slotStart,
                slotEnd,
                pickupPostcode: learnerPostcode,
                bookedSlots,
                coordMap
              });

              if (travelBlocked) {
                travelHiddenCount++;
                slotStart += slotStartIncrementMinutes;
                continue;
              }
            }

            const slotKey = `${instructor.id}|${slotStart}|${slotEnd}`;
            if (daySlotKeys.has(slotKey)) {
              slotStart += slotStartIncrementMinutes;
              continue;
            }
            daySlotKeys.add(slotKey);

            daySlots.push({
              instructor_id:   instructor.id,
              instructor_name: instructor.name,
              instructor_photo: instructor.photo_url,
              request_to_book: !!instructor.request_to_book,
              date:            dateStr,
              start_time:      minutesToTime(slotStart),
              end_time:        minutesToTime(slotEnd),
              transmission_type: window.transmission_type
            });

            slotStart += slotStartIncrementMinutes;
          }
        }
      }

      // Only include dates that have at least one slot
      if (daySlots.length > 0) {
        // Sort by start time, then instructor name
        daySlots.sort((a, b) =>
          a.start_time.localeCompare(b.start_time) ||
          a.instructor_name.localeCompare(b.instructor_name)
        );
        result[dateStr] = daySlots;
      }

      cursor = addDays(cursor, 1);
    }

    const response = {
      from,
      to,
      instructor_id: instructor_id || null,
      lesson_type: { id: lessonType.id, name: lessonType.name, duration_minutes: slotMinutes, price_pence: lessonType.price_pence, colour: lessonType.colour },
      days_with_slots: Object.keys(result).length,
      slots: result
    };
    if (travelHiddenCount > 0) response.travel_hidden = travelHiddenCount;
    return res.json(response);

  } catch (err) {
    console.error('slots available error:', err);
    reportError('/api/slots', err);
    return res.status(500).json({ error: 'Failed to generate slots', details: 'Internal server error' });
  }
}

// ── GET /api/slots?action=durations-for-slot ─────────────────────────────────
// For a given (instructor, date, start_time), returns every active lesson
// type for the school with a `fits` boolean + reason. Powers the slot-first
// booking modal: the user clicks a slot, we tell them which durations fit.
//
// Query params:
//   instructor_id     (required, integer)
//   date              (required, YYYY-MM-DD)
//   start_time        (required, HH:MM or HH:MM:SS)
//   school / school_id (optional legacy tenant hints; host mapping preferred)
//   pickup_postcode   (optional) — when present, runs travel-time check
//
// Returns: { instructor_id, date, start_time, durations: [{lesson_type_id,
//   slug, name, duration_minutes, price_pence, colour, fits, reason}] }
async function handleDurationsForSlot(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { instructor_id, date, start_time, pickup_postcode, transmission_type } = req.query;
  const instructorId = parseInt(instructor_id);
  const requestedTransmissionType = parseRequestTransmissionType(transmission_type);

  if (!instructorId || !date || !start_time) {
    return res.status(400).json({ error: 'instructor_id, date and start_time are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  }
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(start_time)) {
    return res.status(400).json({ error: 'Invalid start_time format. Use HH:MM' });
  }
  if (transmission_type && !requestedTransmissionType) {
    return res.status(400).json({ error: 'transmission_type must be manual, automatic, or both' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const tenant = await resolveSchoolFromRequest(req, { sql, allowLegacySchoolIdQuery: true });
    if (!tenant) return res.status(404).json({ error: 'School not found' });
    const schoolId = tenant.schoolId;

    // Load all active lesson types for this school, excluding the free-trial
    // type (free trials have their own dedicated flow at /free-trial.html).
    const lessonTypes = await sql`
      SELECT id, slug, name, duration_minutes, price_pence, colour
      FROM lesson_types
      WHERE school_id = ${schoolId}
        AND active = true
        AND slug != 'trial'
      ORDER BY duration_minutes ASC
    `;
    if (lessonTypes.length === 0) {
      return res.json({ instructor_id: instructorId, date, start_time, durations: [] });
    }

    // Load instructor + their availability windows for that day-of-week.
    const dayOfWeek = new Date(date + 'T00:00:00Z').getUTCDay();
    const [instructor] = await sql`
      SELECT i.id, i.offered_lesson_types,
             COALESCE((to_jsonb(i)->>'social_video_opt_in')::boolean, false) AS social_video_opt_in,
             COALESCE(i.buffer_minutes, 30) AS buffer_minutes,
             COALESCE(i.min_booking_notice_hours, 24) AS min_booking_notice_hours,
             COALESCE(i.max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
             COALESCE(i.transmission_type, 'manual') AS transmission_type,
             i.max_travel_minutes,
             COALESCE(i.request_to_book, false) AS request_to_book
      FROM instructors i
      WHERE i.id = ${instructorId}
        AND i.school_id = ${schoolId}
        AND i.active = true
    `;
    if (!instructor) return res.status(404).json({ error: 'Instructor not found' });

    let windows = await sql`
      SELECT start_time::text AS start_time, end_time::text AS end_time,
             COALESCE(to_jsonb(instructor_availability)->>'transmission_type', 'both') AS transmission_type
      FROM instructor_availability
      WHERE instructor_id = ${instructorId}
        AND school_id = ${schoolId}
        AND day_of_week = ${dayOfWeek}
        AND active = true
    `;
    const instructorTransmissionType = normaliseSlotTransmissionType(instructor.transmission_type) || 'manual';
    windows = windows
      .map(w => ({ ...w, transmission_type: clampSlotTransmissionType(w.transmission_type, instructorTransmissionType) }))
      .filter(w => w.transmission_type);
    const slotStart = timeToMinutes(start_time);
    let overrideWindows = [];
    try {
      overrideWindows = await sql`
        SELECT start_time::text AS start_time, end_time::text AS end_time,
               COALESCE(transmission_type, 'both') AS transmission_type
        FROM instructor_availability_overrides
        WHERE instructor_id = ${instructorId}
          AND school_id = ${schoolId}
          AND override_date = ${date}::date
          AND active = true
      `;
    } catch (_) {}
    overrideWindows = overrideWindows
      .map(w => ({
        ...w,
        transmission_type: clampSlotTransmissionType(w.transmission_type, instructorTransmissionType)
      }))
      .filter(w => w.transmission_type);

    const matchingOverrideWindows = overrideWindows.filter(w => {
      const ws = timeToMinutes(w.start_time);
      const we = timeToMinutes(w.end_time);
      return slotStart >= ws && slotStart < we && slotSupportsTransmission(w.transmission_type, requestedTransmissionType);
    });
    windows = matchingOverrideWindows.length > 0 ? matchingOverrideWindows : windows;

    let blackoutBlocked = false;
    try {
      const blackouts = await sql`
        SELECT 1
        FROM instructor_blackout_dates
        WHERE instructor_id = ${instructorId}
          AND school_id = ${schoolId}
          AND blackout_date <= ${date}::date
          AND end_date >= ${date}::date
        LIMIT 1
      `;
      blackoutBlocked = blackouts.length > 0 && overrideWindows.length === 0;
      if (blackouts.length > 0 && overrideWindows.length > 0) {
        windows = overrideWindows;
      }
    } catch (_) {}

    const buffer = parseInt(instructor.buffer_minutes) || 0;
    const offered = instructor.offered_lesson_types; // null = default set, otherwise JSONB array of slugs

    // Find the availability window covering this start time (so we know how
    // long the door is open for).
    let windowEnd = null;
    let slotTransmissionType = instructorTransmissionType;
    for (const w of windows) {
      const ws = timeToMinutes(w.start_time);
      const we = timeToMinutes(w.end_time);
      if (slotStart >= ws && slotStart < we && slotSupportsTransmission(w.transmission_type, requestedTransmissionType)) {
        if (windowEnd == null || we > windowEnd) {
          windowEnd = we;
          slotTransmissionType = normaliseSlotTransmissionType(w.transmission_type) || instructorTransmissionType;
        }
      }
    }

    // Notice cutoff: how soon-from-now the slot starts.
    const slotDateTime = new Date(date + 'T00:00:00Z');
    slotDateTime.setUTCHours(Math.floor(slotStart / 60), slotStart % 60, 0, 0);
    const hoursUntilSlot = (slotDateTime - new Date()) / 3600000;
    const violatesNotice = hoursUntilSlot < (parseInt(instructor.min_booking_notice_hours) || 0);
    const violatesAdvanceWindow = !isDateWithinBookingWindow(date, instructor.max_booking_days_ahead);

    // Same-day blocks (bookings + reservations + pending offers + external).
    const sameDayBookings = await sql`
      SELECT start_time::text AS start_time, end_time::text AS end_time, pickup_address
      FROM lesson_bookings
      WHERE scheduled_date = ${date}
        AND status = ANY(${BLOCKING_STATUSES}::text[])
        AND instructor_id = ${instructorId}
        AND school_id = ${schoolId}
    `;
    let reservations = [];
    try {
      reservations = await sql`
        SELECT start_time::text AS start_time, end_time::text AS end_time
        FROM slot_reservations
        WHERE scheduled_date = ${date}
          AND expires_at > NOW()
          AND instructor_id = ${instructorId}
          AND school_id = ${schoolId}
      `;
    } catch (_) {}
    let pendingOffers = [];
    try {
      pendingOffers = await sql`
        SELECT start_time::text AS start_time, end_time::text AS end_time
        FROM lesson_offers
        WHERE scheduled_date = ${date}
          AND status = 'pending'
          AND expires_at > NOW()
          AND instructor_id = ${instructorId}
          AND school_id = ${schoolId}
      `;
    } catch (_) {}
    let pendingRequests = [];
    try {
      pendingRequests = await sql`
        SELECT start_time::text AS start_time, end_time::text AS end_time
        FROM lesson_requests
        WHERE scheduled_date = ${date}
          AND status = 'pending'
          AND expires_at > NOW()
          AND instructor_id = ${instructorId}
          AND school_id = ${schoolId}
      `;
    } catch (_) {}
    let recurringHolds = [];
    try {
      recurringHolds = await sql`
        SELECT rsbi.start_time::text AS start_time, rsbi.end_time::text AS end_time
        FROM recurring_slot_block_items rsbi
        JOIN recurring_slot_blocks rsb ON rsb.id = rsbi.block_id
        WHERE rsbi.scheduled_date = ${date}
          AND rsbi.status = 'held'
          AND rsb.status = 'pending_payment'
          AND rsb.expires_at > NOW()
          AND rsbi.instructor_id = ${instructorId}
          AND rsbi.school_id = ${schoolId}
      `;
    } catch (_) {}
    let externalEvents = [];
    try {
      externalEvents = await sql`
        SELECT start_time::text AS start_time, end_time::text AS end_time, is_all_day
        FROM instructor_external_events
        WHERE event_date = ${date}
          AND instructor_id = ${instructorId}
          AND school_id = ${schoolId}
      `;
    } catch (_) {}

    let busyBlocks = [];
    try {
      busyBlocks = await sql`
        SELECT start_time::text AS start_time, end_time::text AS end_time
        FROM instructor_busy_blocks
        WHERE block_date = ${date}::date
          AND instructor_id = ${instructorId}
          AND school_id = ${schoolId}
      `;
    } catch (_) {}

    // If an all-day external event blocks this date, every duration is a clash.
    const allDayBlocked = blackoutBlocked || externalEvents.some(e => e.is_all_day);

    // Convert all blocks to {start, end, postcode} in minutes.
    const blocks = [];
    for (const b of sameDayBookings) {
      blocks.push({ start: timeToMinutes(b.start_time), end: timeToMinutes(b.end_time), postcode: b.pickup_address ? extractPostcode(b.pickup_address) : null });
    }
    for (const r of reservations) {
      blocks.push({ start: timeToMinutes(r.start_time), end: timeToMinutes(r.end_time), postcode: null });
    }
    for (const o of pendingOffers) {
      blocks.push({ start: timeToMinutes(o.start_time), end: timeToMinutes(o.end_time), postcode: null });
    }
    for (const pr of pendingRequests) {
      blocks.push({ start: timeToMinutes(pr.start_time), end: timeToMinutes(pr.end_time), postcode: null });
    }
    for (const h of recurringHolds) {
      blocks.push({ start: timeToMinutes(h.start_time), end: timeToMinutes(h.end_time), postcode: null });
    }
    for (const e of externalEvents) {
      if (!e.is_all_day && e.start_time && e.end_time) {
        blocks.push({ start: timeToMinutes(e.start_time), end: timeToMinutes(e.end_time), postcode: null });
      }
    }
    for (const b of busyBlocks) {
      blocks.push({ start: timeToMinutes(b.start_time), end: timeToMinutes(b.end_time), postcode: null });
    }

    // Travel-time geocoding (only when a learner postcode is provided).
    const learnerPostcode = pickup_postcode ? pickup_postcode.toUpperCase().replace(/\s+/g, ' ') : null;
    let coordMap = {};
    if (learnerPostcode) {
      try {
        const allPostcodes = new Set([learnerPostcode]);
        for (const b of blocks) if (b.postcode) allPostcodes.add(b.postcode);
        coordMap = await bulkGeocodeUK([...allPostcodes]);
      } catch (_) { /* skip travel filter if geocoding fails */ }
    }

    // For each lesson type, decide fits + reason.
    const directPrices = new Map();
    for (const lt of lessonTypes) {
      const direct = await calcDirectLessonPrice(sql, {
        schoolId,
        instructorId,
        learnerId: parseInt(req.query.learner_id) || null,
        durationMinutes: lt.duration_minutes
      });
      directPrices.set(lt.id, direct.pricePence);
    }

    const durations = lessonTypes.map(lt => {
      const slotEnd = slotStart + lt.duration_minutes;
      let fits = true;
      let reason = null;

      if (allDayBlocked) {
        fits = false; reason = 'clash';
      } else if (violatesAdvanceWindow) {
        fits = false; reason = 'advance';
      } else if (windowEnd === null || slotEnd > windowEnd) {
        fits = false; reason = 'window';
      } else if (violatesNotice) {
        fits = false; reason = 'notice';
      } else if (!isLessonTypeOffered(offered, lt.slug)) {
        fits = false; reason = 'not_offered';
      } else if (blocks.some(b => hasBufferedSlotConflict(slotStart, slotEnd, b.start, b.end, buffer))) {
        fits = false; reason = 'clash';
      } else if (learnerPostcode && coordMap[learnerPostcode]) {
        const learnerCoord = coordMap[learnerPostcode];
        let closestBefore = null, closestAfter = null;
        for (const b of blocks) {
          if (b.end <= slotStart && b.postcode && coordMap[b.postcode]) {
            if (!closestBefore || b.end > closestBefore.end) closestBefore = b;
          }
          if (b.start >= slotEnd && b.postcode && coordMap[b.postcode]) {
            if (!closestAfter || b.start < closestAfter.start) closestAfter = b;
          }
        }
        if (closestBefore) {
          const prev = coordMap[closestBefore.postcode];
          const drive = estimateDriveMinutes(prev.lat, prev.lon, learnerCoord.lat, learnerCoord.lon);
          if ((slotStart - closestBefore.end) < drive + TRAVEL_BUFFER_MINUTES) { fits = false; reason = 'travel'; }
        }
        if (fits && closestAfter) {
          const next = coordMap[closestAfter.postcode];
          const drive = estimateDriveMinutes(learnerCoord.lat, learnerCoord.lon, next.lat, next.lon);
          if ((closestAfter.start - slotEnd) < drive + TRAVEL_BUFFER_MINUTES) { fits = false; reason = 'travel'; }
        }
      }

      return {
        lesson_type_id: lt.id,
        slug: lt.slug,
        name: lt.name,
        duration_minutes: lt.duration_minutes,
        price_pence: directPrices.get(lt.id) || lt.price_pence,
        social_video_price_pence: instructor.social_video_opt_in
          ? applySocialVideoDiscount(directPrices.get(lt.id) || lt.price_pence, true).pricePence
          : null,
        colour: lt.colour,
        fits,
        reason
      };
    });

    return res.json({
      instructor_id: instructorId,
      date,
      start_time,
      transmission_type: slotTransmissionType,
      social_video_opt_in: !!instructor.social_video_opt_in,
      social_video_discount_pct: instructor.social_video_opt_in ? SOCIAL_VIDEO_DISCOUNT_PCT : 0,
      request_to_book: !!instructor.request_to_book,
      durations
    });
  } catch (err) {
    reportError('/api/slots?action=durations-for-slot', err);
    return res.status(500).json({ error: 'Failed to compute durations', details: 'Internal server error' });
  }
}

// ── POST /api/slots?action=book ───────────────────────────────────────────────
// Body: { instructor_id, date, start_time, end_time, lesson_type_id?, pickup_address?, dropoff_address? }
// Deducts hours from balance atomically and creates a confirmed booking.
async function bookCreditFundedSlotsTransaction({
  connectionString,
  learnerId,
  instructorId,
  schoolId,
  bookingDates,
  startTime,
  endTime,
  lessonTypeId,
  durationMins,
  chargeMins,
  pickupAddress,
  dropoffAddress,
  bookingTransmissionType,
  socialVideoConsent = false,
  socialVideoAgeConfirmed = false,
  socialVideoDiscountPct = 0,
  bookingPurpose = 'lesson',
  testStartTime = null,
  testCentre = null,
  seriesId,
  sourceTypes = CREDIT_BOOKING_SOURCE_TYPES,
  blockingStatuses = BLOCKING_STATUSES,
  recurringBlock = null,
  useTestDateOverlapGuards = false,
}) {
  const chargeMinutesPerBooking = Math.max(0, parseInt(chargeMins, 10) || durationMins);
  const totalMins = chargeMinutesPerBooking * bookingDates.length;
  const dateStrings = bookingDates.map(bd => bd.date);

  try {
    return await withNeonTransaction(connectionString, async client => {
    await client.query(
      `INSERT INTO learner_credit_balances
         (learner_id, instructor_id, school_id, balance_minutes)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (learner_id, instructor_id) DO NOTHING`,
      [learnerId, instructorId, schoolId]
    );

    const locked = await client.query(
      `SELECT balance_minutes
         FROM learner_credit_balances
        WHERE learner_id = $1
          AND instructor_id = $2
          AND school_id = $3
        FOR UPDATE`,
      [learnerId, instructorId, schoolId]
    );

    if (locked.rowCount === 0) {
      abortBookingTransaction({
        ok: false,
        code: 'LCB_SCOPE_INVARIANT',
        message: 'Learner credit balance row exists outside the expected school scope',
      });
    }

    const balanceMinutes = Number(locked.rows[0].balance_minutes || 0);
    if (balanceMinutes < totalMins) {
      abortBookingTransaction({ ok: false, code: 'INSUFFICIENT_BALANCE', balanceMinutes });
    }

    let conflictRows = [];
    if (useTestDateOverlapGuards) {
      for (const date of dateStrings) {
        await lockTestDateSlotMutation(client, { schoolId, instructorId, date });
      }
      conflictRows = await testDateSlotOverlapConflictsPg(client, {
        instructorId,
        schoolId,
        dates: dateStrings,
        startTime,
        endTime,
        blockingStatuses,
      });
    } else {
      const bookingConflicts = await client.query(
        `SELECT scheduled_date::text AS date, start_time::text
           FROM lesson_bookings
          WHERE instructor_id = $1
            AND school_id = $2
            AND scheduled_date = ANY($3::date[])
            AND start_time = $4
            AND status = ANY($5::text[])`,
        [instructorId, schoolId, dateStrings, startTime, blockingStatuses]
      );

      const reservations = await client.query(
        `SELECT scheduled_date::text AS date, start_time::text
           FROM slot_reservations
          WHERE instructor_id = $1
            AND school_id = $2
            AND scheduled_date = ANY($3::date[])
            AND start_time = $4
            AND expires_at > NOW()`,
        [instructorId, schoolId, dateStrings, startTime]
      );

      const offerConflicts = await client.query(
        `SELECT scheduled_date::text AS date, start_time::text
           FROM lesson_offers
          WHERE instructor_id = $1
            AND school_id = $2
            AND scheduled_date = ANY($3::date[])
            AND start_time = $4
            AND status = 'pending'
            AND expires_at > NOW()`,
        [instructorId, schoolId, dateStrings, startTime]
      );

      const requestConflictRows = await pendingRequestConflictsPg(client, {
        instructorId, schoolId, dates: dateStrings, startTime,
      });

      let recurringHoldConflictRows = [];
      const recurringItemsTable = await client.query(`SELECT to_regclass('public.recurring_slot_block_items') AS relation_name`);
      if (recurringItemsTable.rows[0]?.relation_name) {
        const recurringHoldConflicts = await client.query(
          `SELECT rsbi.scheduled_date::text AS date, rsbi.start_time::text
             FROM recurring_slot_block_items rsbi
             JOIN recurring_slot_blocks rsb ON rsb.id = rsbi.block_id
            WHERE rsbi.instructor_id = $1
              AND rsbi.school_id = $2
              AND rsbi.scheduled_date = ANY($3::date[])
              AND rsbi.start_time = $4
              AND rsbi.status = 'held'
              AND rsb.status = 'pending_payment'
              AND rsb.expires_at > NOW()`,
          [instructorId, schoolId, dateStrings, startTime]
        );
        recurringHoldConflictRows = recurringHoldConflicts.rows;
      }

      let busyBlockConflictRows = [];
      try {
        const busyBlockConflicts = await client.query(
          `SELECT block_date::text AS date, start_time::text
             FROM instructor_busy_blocks
            WHERE instructor_id = $1
              AND school_id = $2
              AND block_date = ANY($3::date[])
              AND start_time < $5::time
              AND end_time > $4::time`,
          [instructorId, schoolId, dateStrings, startTime, endTime]
        );
        busyBlockConflictRows = busyBlockConflicts.rows;
      } catch (_) {}

      conflictRows = [
        ...bookingConflicts.rows.map(row => ({ ...row, reason: 'already_booked' })),
        ...reservations.rows.map(row => ({ ...row, reason: 'reserved' })),
        ...offerConflicts.rows.map(row => ({ ...row, reason: 'pending_offer' })),
        ...requestConflictRows.map(row => ({ ...row, reason: 'pending_request' })),
        ...recurringHoldConflictRows.map(row => ({ ...row, reason: 'pending_weekly_block' })),
        ...busyBlockConflictRows.map(row => ({ ...row, reason: 'busy_block' })),
      ];
    }

    const takenDates = new Set(conflictRows.map(c => String(c.date).slice(0, 10)));
    if (takenDates.size > 0) {
      abortBookingTransaction({
        ok: false,
        code: 'SLOTS_UNAVAILABLE',
        conflicts: conflictRows.map(c => ({
          date: String(c.date).slice(0, 10),
          start_time: String(c.start_time || startTime).slice(0, 5),
          reason: c.reason || 'already_booked',
        })),
        available: dateStrings.filter(d => !takenDates.has(d)).map(d => ({ date: d, start_time: startTime })),
      });
    }

    const sourcesResult = await client.query(
      `SELECT
         ct.id,
         ct.created_at,
         ct.school_id,
         ct.minutes,
         COALESCE(ct.amount_pence, 0)::int AS amount_pence,
         COALESCE(ct.effective_rate_pence_per_minute, 0)::int AS effective_rate_pence_per_minute,
         COALESCE(ct.stripe_fee_pence, 0)::int AS stripe_fee_pence,
         ct.absorbed_by,
         COALESCE(bcs.active_minutes_drawn, 0)::int AS active_minutes_drawn,
         COALESCE(bcs.active_contribution_pence, 0)::int AS active_contribution_pence,
         COALESCE(bcs.active_stripe_fee_pence, 0)::int AS active_stripe_fee_pence,
         COALESCE(csa.adjusted_minutes, 0)::int AS adjusted_minutes,
         COALESCE(csa.adjusted_pence, 0)::int AS adjusted_pence
       FROM credit_transactions ct
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(SUM(minutes_drawn), 0)::int AS active_minutes_drawn,
           COALESCE(SUM(contribution_pence), 0)::int AS active_contribution_pence,
           COALESCE(SUM(stripe_fee_pence), 0)::int AS active_stripe_fee_pence
         FROM booking_credit_sources
         WHERE credit_transaction_id = ct.id
           AND school_id = $3
           AND refunded_at IS NULL
       ) bcs ON TRUE
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(SUM(minutes_adjusted), 0)::int AS adjusted_minutes,
           COALESCE(SUM(pence_adjusted), 0)::int AS adjusted_pence
         FROM credit_source_adjustments
         WHERE credit_transaction_id = ct.id
       ) csa ON TRUE
       WHERE ct.learner_id = $1
         AND ct.instructor_id = $2
         AND ct.school_id = $3
         AND ct.type = ANY($4::text[])
         AND ct.minutes > 0
       ORDER BY ct.created_at ASC, ct.id ASC`,
      [learnerId, instructorId, schoolId, sourceTypes]
    );

    const fifoPlan = planFifoCreditDraw({ sources: sourcesResult.rows, minutes: totalMins, schoolId });
    if (!fifoPlan.ok) {
      abortBookingTransaction({
        ok: false,
        code: 'INSUFFICIENT_FIFO_SOURCES',
        balanceMinutes,
        shortageMinutes: fifoPlan.shortage_minutes,
      });
    }

    let recurringBlockRow = null;
    if (recurringBlock) {
      const insertedBlock = await client.query(
        `INSERT INTO recurring_slot_blocks
           (school_id, learner_id, instructor_id, anchor_booking_id, lesson_type_id,
            status, funding_method, selected_lessons, duration_minutes, start_time, end_time,
            price_per_lesson_pence, total_price_pence, price_source, confirmed_at, metadata)
         VALUES
           ($1, $2, $3, $4, $5,
            'confirmed', 'lesson_credit', $6, $7, $8, $9,
            $10, $11, $12, NOW(), $13::jsonb)
         RETURNING id, status, funding_method, selected_lessons, total_price_pence`,
        [
          schoolId,
          learnerId,
          instructorId,
          recurringBlock.anchorBookingId || null,
          lessonTypeId,
          bookingDates.length,
          durationMins,
          startTime,
          endTime,
          recurringBlock.pricePerLessonPence || 0,
          recurringBlock.totalPricePence || 0,
          recurringBlock.priceSource || null,
          JSON.stringify(recurringBlock.metadata || {}),
        ]
      );
      recurringBlockRow = insertedBlock.rows[0];
    }

    const bookingTargets = [];
    const createdBookings = [];
    for (const bd of bookingDates) {
      try {
        let inserted;
        try {
          inserted = await client.query(
            `INSERT INTO lesson_bookings
               (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
                pickup_address, dropoff_address, lesson_type_id, transmission_type, minutes_deducted, series_id, school_id,
                list_price_pence, list_price_source, social_video_consent, social_video_age_confirmed, social_video_discount_pct,
                booking_purpose, test_start_time, test_centre)
             VALUES
               ($1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $12, $13,
                0, 'live_compute_insert', $14, $15, $16,
                $17, $18, $19)
             RETURNING id, scheduled_date::text, start_time::text, end_time::text, status, created_at`,
            [
              learnerId, instructorId, bd.date, startTime, endTime, SCHEDULED,
              pickupAddress, dropoffAddress, lessonTypeId, bookingTransmissionType || 'manual', chargeMinutesPerBooking, seriesId, schoolId,
              !!socialVideoConsent, !!socialVideoAgeConfirmed, socialVideoDiscountPct || 0,
              bookingPurpose || 'lesson', testStartTime || null, testCentre || null,
            ]
          );
        } catch (insertErr) {
          if (!isMissingBookingPurposeSchema(insertErr) || bookingPurpose === TEST_DATE_PURPOSE) throw insertErr;
          console.warn('credit booking: lesson_bookings test-date metadata columns missing; using legacy lesson insert for normal booking');
          inserted = await client.query(
            `INSERT INTO lesson_bookings
               (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
                pickup_address, dropoff_address, lesson_type_id, transmission_type, minutes_deducted, series_id, school_id,
                list_price_pence, list_price_source, social_video_consent, social_video_age_confirmed, social_video_discount_pct)
             VALUES
               ($1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $12, $13,
                0, 'live_compute_insert', $14, $15, $16)
             RETURNING id, scheduled_date::text, start_time::text, end_time::text, status, created_at`,
            [
              learnerId, instructorId, bd.date, startTime, endTime, SCHEDULED,
              pickupAddress, dropoffAddress, lessonTypeId, bookingTransmissionType || 'manual', chargeMinutesPerBooking, seriesId, schoolId,
              !!socialVideoConsent, !!socialVideoAgeConfirmed, socialVideoDiscountPct || 0,
            ]
          );
        }
        const booking = inserted.rows[0];
        createdBookings.push(booking);
        bookingTargets.push({ booking_id: booking.id, minutes: chargeMinutesPerBooking });
      } catch (err) {
        if (err.code === '23505' || err.message?.includes('uq_booking_slot') || err.message?.includes('uq_instructor_slot')) {
          abortBookingTransaction({
            ok: false,
            code: 'SLOTS_UNAVAILABLE',
            conflicts: [{ date: bd.date, start_time: startTime, reason: 'already booked' }],
            available: dateStrings.filter(d => d !== bd.date).map(d => ({ date: d, start_time: startTime })),
          });
        }
        throw err;
      }
    }

    if (recurringBlockRow) {
      for (let i = 0; i < createdBookings.length; i++) {
        const booking = createdBookings[i];
        const bd = bookingDates[i];
        await client.query(
          `INSERT INTO recurring_slot_block_items
             (block_id, school_id, instructor_id, lesson_booking_id,
              scheduled_date, start_time, end_time, status, price_pence)
           VALUES
             ($1, $2, $3, $4,
              $5, $6, $7, 'booked', $8)`,
          [
            recurringBlockRow.id,
            schoolId,
            instructorId,
            booking.id,
            bd.date,
            startTime,
            endTime,
            recurringBlock.pricePerLessonPence || 0,
          ]
        );
      }
    }

    const bcsRows = splitFifoPlanAcrossBookings({ plannedRows: fifoPlan.rows, bookingTargets });
    const listPriceByBookingId = new Map();
    for (const row of bcsRows) {
      if (row.absorbed_by === 'instructor') continue;
      listPriceByBookingId.set(row.booking_id, (listPriceByBookingId.get(row.booking_id) || 0) + row.contribution_pence);
    }

    let insertedBcsCount = 0;
    for (const row of bcsRows) {
      const inserted = await client.query(
        `INSERT INTO booking_credit_sources
           (school_id, booking_id, credit_transaction_id, minutes_drawn,
            rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (booking_id, credit_transaction_id) DO NOTHING
         RETURNING id`,
        [
          row.school_id, row.booking_id, row.credit_transaction_id, row.minutes_drawn,
          row.rate_pence_per_minute, row.contribution_pence, row.stripe_fee_pence, row.absorbed_by,
        ]
      );
      insertedBcsCount += inserted.rowCount;
    }

    if (insertedBcsCount !== bcsRows.length) {
      throw new Error(`BCS_IDEMPOTENCY_INVARIANT: expected ${bcsRows.length} inserts, got ${insertedBcsCount}`);
    }

    for (const booking of createdBookings) {
      await client.query(
        `UPDATE lesson_bookings
            SET list_price_pence = $1
          WHERE id = $2
            AND school_id = $3`,
        [listPriceByBookingId.get(booking.id) || 0, booking.id, schoolId]
      );
    }

    const decremented = await client.query(
      `UPDATE learner_credit_balances
          SET balance_minutes = balance_minutes - $4,
              updated_at = NOW()
        WHERE learner_id = $1
          AND instructor_id = $2
          AND school_id = $3
          AND balance_minutes >= $4
      RETURNING balance_minutes`,
      [learnerId, instructorId, schoolId, totalMins]
    );

    if (decremented.rowCount !== 1) {
      throw new Error('LCB_DECREMENT_INVARIANT: locked balance failed guarded decrement');
    }

    return {
      ok: true,
      createdBookings,
      balanceMinutes: Number(decremented.rows[0].balance_minutes || 0),
      bcsRows,
      recurringBlock: recurringBlockRow,
    };
    });
  } catch (err) {
    if (err instanceof BookingTransactionAbort) {
      return err.result;
    }
    throw err;
  }
}

function parseRecurringBlockLessons(value) {
  const lessons = parseInt(value, 10);
  if (!Number.isInteger(lessons) || lessons < RECURRING_BLOCK_MIN_LESSONS || lessons > RECURRING_BLOCK_MAX_LESSONS) {
    return null;
  }
  return lessons;
}

function recurringBlockLessonCountError() {
  return `lessons must be between ${RECURRING_BLOCK_MIN_LESSONS} and ${RECURRING_BLOCK_MAX_LESSONS}`;
}

async function getRecurringAnchorBooking(sql, { bookingId, learnerId, schoolId }) {
  const id = parseInt(bookingId, 10);
  if (!Number.isInteger(id) || id <= 0) return null;

  const [anchor] = await sql`
    SELECT lb.id,
           lb.learner_id,
           lb.instructor_id,
           lb.school_id,
           lb.scheduled_date::text AS scheduled_date,
           lb.start_time::text AS start_time,
           lb.end_time::text AS end_time,
           lb.lesson_type_id,
           lb.pickup_address,
           lb.dropoff_address,
           lb.transmission_type,
           lt.name AS lesson_type_name,
           lt.slug AS lesson_type_slug,
           lt.duration_minutes,
           i.name AS instructor_name,
           i.offered_lesson_types,
           COALESCE(i.transmission_type, 'manual') AS instructor_transmission_type
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
                        AND i.school_id = lb.school_id
                        AND i.active = true
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
                               AND lt.school_id = lb.school_id
     WHERE lb.id = ${id}
       AND lb.learner_id = ${learnerId}
       AND lb.school_id = ${schoolId}
       AND lb.status = ${SCHEDULED}
  `;
  return anchor || null;
}

async function buildRecurringSlotConflictIndex(sql, {
  schoolId,
  instructorId,
  dates,
  startTime,
  endTime,
}) {
  const conflicts = new Map();
  const add = (date, reason) => {
    const key = String(date).slice(0, 10);
    if (!conflicts.has(key)) conflicts.set(key, reason);
  };

  const bookings = await sql`
    SELECT scheduled_date::text AS date
      FROM lesson_bookings
     WHERE instructor_id = ${instructorId}
       AND school_id = ${schoolId}
       AND scheduled_date = ANY(${dates})
       AND status = ANY(${BLOCKING_STATUSES}::text[])
       AND start_time < ${endTime}::time
       AND end_time > ${startTime}::time
  `;
  bookings.forEach(row => add(row.date, 'already_booked'));

  const reservations = await sql`
    SELECT scheduled_date::text AS date
      FROM slot_reservations
     WHERE instructor_id = ${instructorId}
       AND school_id = ${schoolId}
       AND scheduled_date = ANY(${dates})
       AND expires_at > NOW()
       AND start_time < ${endTime}::time
       AND end_time > ${startTime}::time
  `;
  reservations.forEach(row => add(row.date, 'reserved'));

  try {
    const offers = await sql`
      SELECT scheduled_date::text AS date
        FROM lesson_offers
       WHERE instructor_id = ${instructorId}
         AND school_id = ${schoolId}
         AND scheduled_date = ANY(${dates})
         AND status = 'pending'
         AND expires_at > NOW()
         AND start_time < ${endTime}::time
         AND end_time > ${startTime}::time
    `;
    offers.forEach(row => add(row.date, 'pending_offer'));
  } catch (_) {}

  try {
    const requests = await sql`
      SELECT scheduled_date::text AS date
        FROM lesson_requests
       WHERE instructor_id = ${instructorId}
         AND school_id = ${schoolId}
         AND scheduled_date = ANY(${dates})
         AND status = 'pending'
         AND expires_at > NOW()
         AND start_time < ${endTime}::time
         AND end_time > ${startTime}::time
    `;
    requests.forEach(row => add(row.date, 'pending_request'));
  } catch (_) {}

  try {
    const holds = await sql`
      SELECT rsbi.scheduled_date::text AS date
        FROM recurring_slot_block_items rsbi
        JOIN recurring_slot_blocks rsb ON rsb.id = rsbi.block_id
       WHERE rsbi.instructor_id = ${instructorId}
         AND rsbi.school_id = ${schoolId}
         AND rsbi.scheduled_date = ANY(${dates})
         AND rsbi.status = 'held'
         AND rsb.status = 'pending_payment'
         AND rsb.expires_at > NOW()
         AND rsbi.start_time < ${endTime}::time
         AND rsbi.end_time > ${startTime}::time
    `;
    holds.forEach(row => add(row.date, 'pending_weekly_block'));
  } catch (_) {}

  try {
    const busyBlocks = await sql`
      SELECT block_date::text AS date
        FROM instructor_busy_blocks
       WHERE instructor_id = ${instructorId}
         AND school_id = ${schoolId}
         AND block_date = ANY(${dates})
         AND start_time < ${endTime}::time
         AND end_time > ${startTime}::time
    `;
    busyBlocks.forEach(row => add(row.date, 'busy_block'));
  } catch (_) {}

  return conflicts;
}

async function buildRecurringBlockPreview(sql, {
  anchorBookingId,
  learnerId,
  schoolId,
  lessons,
}) {
  const selectedLessons = parseRecurringBlockLessons(lessons);
  if (!selectedLessons) {
    return { ok: false, code: 'INVALID_LESSONS', message: recurringBlockLessonCountError() };
  }

  const anchor = await getRecurringAnchorBooking(sql, { bookingId: anchorBookingId, learnerId, schoolId });
  if (!anchor) {
    return { ok: false, code: 'ANCHOR_NOT_FOUND', message: 'Anchor booking not found' };
  }

  const durationMins = parseInt(anchor.duration_minutes, 10) || (timeToMinutes(anchor.end_time) - timeToMinutes(anchor.start_time));
  const startTime = String(anchor.start_time).slice(0, 5);
  const endTime = String(anchor.end_time).slice(0, 5);
  const requestedTransmissionType = parseRequestTransmissionType(anchor.transmission_type);
  const anchorDate = parseDate(String(anchor.scheduled_date).slice(0, 10));
  const candidateDates = [];
  for (let week = 1; week <= RECURRING_BLOCK_LOOKAHEAD_WEEKS; week++) {
    candidateDates.push(formatDate(addDays(anchorDate, week * 7)));
  }

  const conflictIndex = await buildRecurringSlotConflictIndex(sql, {
    schoolId,
    instructorId: anchor.instructor_id,
    dates: candidateDates,
    startTime,
    endTime,
  });

  const weeks = [];
  const selectedSlots = [];
  for (let i = 0; i < candidateDates.length; i++) {
    const date = candidateDates[i];
    let status = 'available';
    let reason = null;

    if (conflictIndex.has(date)) {
      status = 'unavailable';
      reason = conflictIndex.get(date);
    } else {
      const fitsAvailability = await slotFitsActiveAvailability(sql, {
        instructorId: anchor.instructor_id,
        schoolId,
        date,
        startTime,
        endTime,
        transmissionType: requestedTransmissionType,
        enforceBookingWindow: false,
      });
      if (!fitsAvailability) {
        status = 'unavailable';
        reason = 'outside_availability';
      }
    }

    const canSelect = status === 'available' && selectedSlots.length < selectedLessons;
    const weekRow = {
      week: i + 1,
      date,
      start_time: startTime,
      end_time: endTime,
      status,
      selected: canSelect,
    };
    if (reason) weekRow.reason = reason;
    weeks.push(weekRow);
    if (canSelect) selectedSlots.push({ date, start_time: startTime, end_time: endTime });
  }

  const pricing = await calcDirectLessonPrice(sql, {
    schoolId,
    instructorId: anchor.instructor_id,
    learnerId,
    durationMinutes: durationMins,
  });

  const [balance] = await sql`
    SELECT COALESCE(balance_minutes, 0)::int AS balance_minutes
      FROM learner_credit_balances
     WHERE learner_id = ${learnerId}
       AND instructor_id = ${anchor.instructor_id}
       AND school_id = ${schoolId}
  `;
  const balanceMinutes = Number(balance?.balance_minutes || 0);
  const requiredMinutes = durationMins * selectedLessons;
  const availableCount = weeks.filter(w => w.status === 'available').length;

  return {
    ok: true,
    anchor: {
      booking_id: anchor.id,
      date: String(anchor.scheduled_date).slice(0, 10),
      start_time: startTime,
      end_time: endTime,
      instructor_id: anchor.instructor_id,
      instructor_name: anchor.instructor_name,
      lesson_type_id: anchor.lesson_type_id,
      lesson_type_name: anchor.lesson_type_name,
      transmission_type: concreteLessonTransmissionType(requestedTransmissionType, anchor.instructor_transmission_type),
      duration_minutes: durationMins,
      pickup_address: anchor.pickup_address || null,
      dropoff_address: anchor.dropoff_address || null,
    },
    requested_lessons: selectedLessons,
    selected_lessons: selectedSlots.length,
    available_lessons: availableCount,
    max_selectable_lessons: Math.min(RECURRING_BLOCK_MAX_LESSONS, availableCount),
    can_commit: selectedSlots.length === selectedLessons && selectedLessons >= RECURRING_BLOCK_MIN_LESSONS,
    selected_slots: selectedSlots,
    weeks,
    pricing: {
      price_per_lesson_pence: pricing.pricePence,
      total_price_pence: pricing.pricePence * selectedSlots.length,
      requested_total_price_pence: pricing.pricePence * selectedLessons,
      price_source: pricing.source,
    },
    credit: {
      balance_minutes: balanceMinutes,
      required_minutes: requiredMinutes,
      has_sufficient_credit: balanceMinutes >= requiredMinutes,
    },
  };
}

async function handleRecurringBlockPreview(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const preview = await buildRecurringBlockPreview(sql, {
      anchorBookingId: req.query.booking_id,
      learnerId: user.id,
      schoolId,
      lessons: req.query.lessons || RECURRING_BLOCK_MIN_LESSONS,
    });

    if (!preview.ok && preview.code === 'INVALID_LESSONS') {
      return res.status(400).json({ error: true, code: preview.code, message: preview.message });
    }
    if (!preview.ok && preview.code === 'ANCHOR_NOT_FOUND') {
      return res.status(404).json({ error: true, code: preview.code, message: preview.message });
    }
    if (!preview.ok) {
      return res.status(400).json({ error: true, code: preview.code || 'PREVIEW_FAILED', message: preview.message || 'Preview failed' });
    }

    return res.json({ ok: true, ...preview });
  } catch (err) {
    console.error('recurring-block-preview error:', err);
    reportError('/api/slots?action=recurring-block-preview', err);
    return res.status(500).json({ error: true, code: 'PREVIEW_FAILED', message: 'Failed to preview recurring block' });
  }
}

async function handleRecurringBlockCommit(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;
  const { anchor_booking_id, lessons } = req.body || {};

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const preview = await buildRecurringBlockPreview(sql, {
      anchorBookingId: anchor_booking_id,
      learnerId: user.id,
      schoolId,
      lessons,
    });

    if (!preview.ok && preview.code === 'INVALID_LESSONS') {
      return res.status(400).json({ error: true, code: preview.code, message: preview.message });
    }
    if (!preview.ok && preview.code === 'ANCHOR_NOT_FOUND') {
      return res.status(404).json({ error: true, code: preview.code, message: preview.message });
    }
    if (!preview.ok) {
      return res.status(400).json({ error: true, code: preview.code || 'PREVIEW_FAILED', message: preview.message || 'Preview failed' });
    }
    if (!preview.can_commit) {
      return res.status(409).json({
        error: true,
        code: 'SLOTS_UNAVAILABLE',
        message: 'Not enough matching future weekly slots are available. Please review the refreshed preview.',
        preview,
      });
    }
    if (!preview.credit.has_sufficient_credit) {
      return res.status(402).json({
        error: true,
        code: 'INSUFFICIENT_CREDIT',
        message: 'Not enough same-instructor Lesson Credit for this weekly block.',
        preview,
      });
    }

    const seriesId = crypto.randomUUID();
    const booked = await bookCreditFundedSlotsTransaction({
      connectionString: process.env.POSTGRES_URL,
      learnerId: user.id,
      instructorId: Number(preview.anchor.instructor_id),
      schoolId,
      bookingDates: preview.selected_slots.map(slot => ({ date: slot.date })),
      startTime: preview.anchor.start_time,
      endTime: preview.anchor.end_time,
      lessonTypeId: preview.anchor.lesson_type_id,
      durationMins: preview.anchor.duration_minutes,
      pickupAddress: preview.anchor.pickup_address,
      dropoffAddress: preview.anchor.dropoff_address,
      bookingTransmissionType: preview.anchor.transmission_type,
      seriesId,
      recurringBlock: {
        anchorBookingId: preview.anchor.booking_id,
        pricePerLessonPence: preview.pricing.price_per_lesson_pence,
        totalPricePence: preview.pricing.requested_total_price_pence,
        priceSource: preview.pricing.price_source,
        metadata: {
          source: 'recurring_block_credit_commit',
          lookahead_weeks: RECURRING_BLOCK_LOOKAHEAD_WEEKS,
        },
      },
    });

    if (!booked.ok && (booked.code === 'INSUFFICIENT_BALANCE' || booked.code === 'INSUFFICIENT_FIFO_SOURCES')) {
      return res.status(402).json({
        error: true,
        code: 'INSUFFICIENT_CREDIT',
        message: 'Not enough same-instructor Lesson Credit for this weekly block.',
      });
    }
    if (!booked.ok && booked.code === 'SLOTS_UNAVAILABLE') {
      return res.status(409).json({
        error: true,
        code: 'SLOTS_UNAVAILABLE',
        message: 'One or more selected slots are no longer available. Please refresh the preview.',
        conflicts: booked.conflicts || [],
        available: booked.available || [],
      });
    }
    if (!booked.ok && booked.code === 'LCB_SCOPE_INVARIANT') {
      throw new Error(booked.message || 'LCB_SCOPE_INVARIANT');
    }
    if (!booked.ok) {
      throw new Error(`Recurring block credit commit failed: ${booked.code || 'UNKNOWN'}`);
    }

    try { await sql`UPDATE learner_users SET last_activity_at = NOW() WHERE id = ${user.id} AND school_id = ${schoolId}`; } catch (_) {}

    for (const b of booked.createdBookings) {
      supersedeBroadcastSiblings({
        instructor_id: preview.anchor.instructor_id,
        scheduled_date: String(b.scheduled_date).slice(0, 10),
        start_time: String(b.start_time).slice(0, 5),
        school_id: schoolId
      }).catch(err => console.warn('supersede on recurring block commit failed:', err.message));
    }

    return res.status(201).json({
      ok: true,
      block_id: booked.recurringBlock?.id,
      status: booked.recurringBlock?.status || 'confirmed',
      funding_method: booked.recurringBlock?.funding_method || 'lesson_credit',
      series_id: seriesId,
      booking_ids: booked.createdBookings.map(b => b.id),
      dates: preview.selected_slots.map(slot => slot.date),
      selected_lessons: preview.requested_lessons,
      balance_minutes: booked.balanceMinutes,
      pricing: {
        price_per_lesson_pence: preview.pricing.price_per_lesson_pence,
        total_price_pence: preview.pricing.requested_total_price_pence,
        price_source: preview.pricing.price_source,
      },
    });
  } catch (err) {
    console.error('recurring-block-commit error:', err);
    reportError('/api/slots?action=recurring-block-commit', err);
    return res.status(500).json({ error: true, code: 'COMMIT_FAILED', message: 'Failed to confirm recurring block' });
  }
}

async function createRecurringBlockBankHoldTransaction({
  connectionString,
  learnerId,
  schoolId,
  preview,
  holdMinutes = RESERVATION_MINUTES,
}) {
  const selectedSlots = preview.selected_slots || [];
  const dateStrings = selectedSlots.map(slot => slot.date);
  const anchor = preview.anchor || {};
  const instructorId = Number(anchor.instructor_id);
  const startTime = anchor.start_time;
  const endTime = anchor.end_time;

  try {
    return await withNeonTransaction(connectionString, async client => {
    // Targeted lazy cleanup keeps expired checkout holds from blocking this
    // exact future block before the later expiry job/webhook slice exists.
    const expiredBlocks = await client.query(
      `SELECT DISTINCT rsb.id
         FROM recurring_slot_blocks rsb
         JOIN recurring_slot_block_items rsbi ON rsbi.block_id = rsb.id
        WHERE rsb.school_id = $1
          AND rsb.status = 'pending_payment'
          AND rsb.expires_at <= NOW()
          AND rsbi.instructor_id = $2
          AND rsbi.school_id = $1
          AND rsbi.scheduled_date = ANY($3::date[])
          AND rsbi.status = 'held'
          AND rsbi.start_time < $5::time
          AND rsbi.end_time > $4::time`,
      [schoolId, instructorId, dateStrings, startTime, endTime]
    );
    const expiredBlockIds = expiredBlocks.rows.map(row => row.id);
    if (expiredBlockIds.length > 0) {
      await client.query(
        `UPDATE recurring_slot_block_items
            SET status = 'released',
                updated_at = NOW()
          WHERE block_id = ANY($1::int[])
            AND status = 'held'`,
        [expiredBlockIds]
      );
      await client.query(
        `UPDATE recurring_slot_blocks
            SET status = 'expired',
                released_at = NOW(),
                updated_at = NOW()
          WHERE id = ANY($1::int[])
            AND status = 'pending_payment'`,
        [expiredBlockIds]
      );
    }

    const bookingConflicts = await client.query(
      `SELECT scheduled_date::text AS date
         FROM lesson_bookings
        WHERE instructor_id = $1
          AND school_id = $2
          AND scheduled_date = ANY($3::date[])
          AND status = ANY($4::text[])
          AND start_time < $6::time
          AND end_time > $5::time`,
      [instructorId, schoolId, dateStrings, BLOCKING_STATUSES, startTime, endTime]
    );

    const reservationConflicts = await client.query(
      `SELECT scheduled_date::text AS date
         FROM slot_reservations
        WHERE instructor_id = $1
          AND school_id = $2
          AND scheduled_date = ANY($3::date[])
          AND expires_at > NOW()
          AND start_time < $5::time
          AND end_time > $4::time`,
      [instructorId, schoolId, dateStrings, startTime, endTime]
    );

    const offerConflicts = await client.query(
      `SELECT scheduled_date::text AS date
         FROM lesson_offers
        WHERE instructor_id = $1
          AND school_id = $2
          AND scheduled_date = ANY($3::date[])
          AND status = 'pending'
          AND expires_at > NOW()
          AND start_time < $5::time
          AND end_time > $4::time`,
      [instructorId, schoolId, dateStrings, startTime, endTime]
    );

    const heldConflicts = await client.query(
      `SELECT rsbi.scheduled_date::text AS date
         FROM recurring_slot_block_items rsbi
         JOIN recurring_slot_blocks rsb ON rsb.id = rsbi.block_id
        WHERE rsbi.instructor_id = $1
          AND rsbi.school_id = $2
          AND rsbi.scheduled_date = ANY($3::date[])
          AND rsbi.status = 'held'
          AND rsb.status = 'pending_payment'
          AND rsb.expires_at > NOW()
          AND rsbi.start_time < $5::time
          AND rsbi.end_time > $4::time`,
      [instructorId, schoolId, dateStrings, startTime, endTime]
    );

    let busyBlockConflictRows = [];
    try {
      const busyBlockConflicts = await client.query(
        `SELECT block_date::text AS date
           FROM instructor_busy_blocks
          WHERE instructor_id = $1
            AND school_id = $2
            AND block_date = ANY($3::date[])
            AND start_time < $5::time
            AND end_time > $4::time`,
        [instructorId, schoolId, dateStrings, startTime, endTime]
      );
      busyBlockConflictRows = busyBlockConflicts.rows;
    } catch (_) {}

    let requestConflictRows = [];
    try {
      const requestConflicts = await client.query(
        `SELECT scheduled_date::text AS date
           FROM lesson_requests
          WHERE instructor_id = $1
            AND school_id = $2
            AND scheduled_date = ANY($3::date[])
            AND status = 'pending'
            AND expires_at > NOW()
            AND start_time < $5::time
            AND end_time > $4::time`,
        [instructorId, schoolId, dateStrings, startTime, endTime]
      );
      requestConflictRows = requestConflicts.rows;
    } catch (_) {}

    const takenDates = new Set([
      ...bookingConflicts.rows.map(row => String(row.date).slice(0, 10)),
      ...reservationConflicts.rows.map(row => String(row.date).slice(0, 10)),
      ...offerConflicts.rows.map(row => String(row.date).slice(0, 10)),
      ...heldConflicts.rows.map(row => String(row.date).slice(0, 10)),
      ...busyBlockConflictRows.map(row => String(row.date).slice(0, 10)),
      ...requestConflictRows.map(row => String(row.date).slice(0, 10)),
    ]);
    if (takenDates.size > 0) {
      return {
        ok: false,
        code: 'SLOTS_UNAVAILABLE',
        conflicts: [...takenDates].map(date => ({ date, start_time: startTime, reason: 'already held or booked' })),
      };
    }

    const block = await client.query(
      `INSERT INTO recurring_slot_blocks
         (school_id, learner_id, instructor_id, anchor_booking_id, lesson_type_id,
          status, funding_method, selected_lessons, duration_minutes, start_time, end_time,
          price_per_lesson_pence, total_price_pence, price_source, expires_at, metadata)
       VALUES
         ($1, $2, $3, $4, $5,
          'pending_payment', 'bank_payment', $6, $7, $8, $9,
          $10, $11, $12, NOW() + ($13::int * INTERVAL '1 minute'), $14::jsonb)
       RETURNING id, status, funding_method, expires_at, total_price_pence`,
      [
        schoolId,
        learnerId,
        instructorId,
        anchor.booking_id || null,
        anchor.lesson_type_id || null,
        preview.requested_lessons,
        anchor.duration_minutes,
        startTime,
        endTime,
        preview.pricing.price_per_lesson_pence,
        preview.pricing.requested_total_price_pence,
        preview.pricing.price_source || null,
        holdMinutes,
        JSON.stringify({
          source: 'recurring_block_bank_checkout_hold',
          lookahead_weeks: RECURRING_BLOCK_LOOKAHEAD_WEEKS,
          hold_minutes: holdMinutes,
          selected_slots: selectedSlots,
        }),
      ]
    );

    const blockRow = block.rows[0];
    for (const slot of selectedSlots) {
      try {
        await client.query(
          `INSERT INTO recurring_slot_block_items
             (block_id, school_id, instructor_id, scheduled_date, start_time, end_time, status, price_pence)
           VALUES
             ($1, $2, $3, $4, $5, $6, 'held', $7)`,
          [
            blockRow.id,
            schoolId,
            instructorId,
            slot.date,
            slot.start_time,
            slot.end_time,
            preview.pricing.price_per_lesson_pence,
          ]
        );
      } catch (err) {
        if (err.code === '23505') {
          abortRecurringBankHold({
            ok: false,
            code: 'SLOTS_UNAVAILABLE',
            conflicts: [{ date: slot.date, start_time: slot.start_time, reason: 'already held' }],
          });
        }
        throw err;
      }
    }

    return { ok: true, block: blockRow };
    });
  } catch (err) {
    if (err instanceof RecurringBankHoldAbort) {
      return err.result;
    }
    throw err;
  }
}

async function releaseRecurringBlockBankHold(sql, { blockId, schoolId, status = 'released' }) {
  if (!blockId) return;
  await sql`
    UPDATE recurring_slot_block_items
       SET status = 'released',
           updated_at = NOW()
     WHERE block_id = ${blockId}
       AND school_id = ${schoolId}
       AND status = 'held'
  `;
  await sql`
    UPDATE recurring_slot_blocks
       SET status = ${status},
           released_at = NOW(),
           updated_at = NOW()
     WHERE id = ${blockId}
       AND school_id = ${schoolId}
       AND status = 'pending_payment'
  `;
}

async function expireStaleRecurringBlockBankHoldForLearner({
  connectionString,
  blockId,
  learnerId,
  schoolId,
}) {
  return withNeonTransaction(connectionString, async client => {
    const blockResult = await client.query(
      `SELECT id, status, funding_method, expires_at, expires_at <= NOW() AS is_stale
         FROM recurring_slot_blocks
        WHERE id = $1
          AND learner_id = $2
          AND school_id = $3
        FOR UPDATE`,
      [blockId, learnerId, schoolId]
    );
    const block = blockResult.rows[0];
    if (!block) return { ok: false, code: 'BLOCK_NOT_FOUND' };
    if (block.funding_method !== 'bank_payment') return { ok: true, code: 'NOT_BANK_PAYMENT' };
    if (block.status !== 'pending_payment') return { ok: true, code: 'BLOCK_NOT_PENDING', status: block.status };
    if (!block.expires_at || !block.is_stale) return { ok: true, code: 'BLOCK_NOT_STALE' };

    await client.query(
      `UPDATE recurring_slot_block_items
          SET status = 'released',
              updated_at = NOW()
        WHERE block_id = $1
          AND school_id = $2
          AND status = 'held'`,
      [blockId, schoolId]
    );
    await client.query(
      `UPDATE recurring_slot_blocks
          SET status = 'expired',
              released_at = NOW(),
              metadata = metadata || $4::jsonb,
              updated_at = NOW()
        WHERE id = $1
          AND learner_id = $2
          AND school_id = $3
          AND status = 'pending_payment'`,
      [
        blockId,
        learnerId,
        schoolId,
        JSON.stringify({
          release_reason: 'status_read_stale_pending_hold',
          release_seen_at: new Date().toISOString(),
        }),
      ]
    );
    return { ok: true, code: 'EXPIRED' };
  });
}

async function handleRecurringBlockStatus(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: true, code: 'UNAUTHORISED', message: 'Unauthorised' });
  const schoolId = user.school_id || 1;
  const blockId = parseInt(req.query.block_id, 10);
  if (!Number.isInteger(blockId) || blockId <= 0) {
    return res.status(400).json({ error: true, code: 'INVALID_BLOCK_ID', message: 'block_id is required' });
  }

  const sql = neon(process.env.POSTGRES_URL);
  try {
    await expireStaleRecurringBlockBankHoldForLearner({
      connectionString: process.env.POSTGRES_URL,
      blockId,
      learnerId: user.id,
      schoolId,
    });

    const [block] = await sql`
      SELECT rsb.id,
             rsb.school_id,
             rsb.learner_id,
             rsb.instructor_id,
             i.name AS instructor_name,
             rsb.anchor_booking_id,
             rsb.lesson_type_id,
             lt.name AS lesson_type_name,
             rsb.status,
             rsb.funding_method,
             rsb.selected_lessons,
             rsb.duration_minutes,
             rsb.start_time::text AS start_time,
             rsb.end_time::text AS end_time,
             rsb.price_per_lesson_pence,
             rsb.total_price_pence,
             rsb.price_source,
             rsb.expires_at,
             rsb.confirmed_at,
             rsb.released_at,
             rsb.stripe_payment_intent_id,
             rsb.stripe_checkout_session_id,
             rsb.created_at,
             rsb.updated_at
        FROM recurring_slot_blocks rsb
        JOIN instructors i ON i.id = rsb.instructor_id
                          AND i.school_id = rsb.school_id
        LEFT JOIN lesson_types lt ON lt.id = rsb.lesson_type_id
                                 AND lt.school_id = rsb.school_id
       WHERE rsb.id = ${blockId}
         AND rsb.learner_id = ${user.id}
         AND rsb.school_id = ${schoolId}
    `;
    if (!block) {
      return res.status(404).json({ error: true, code: 'BLOCK_NOT_FOUND', message: 'Reserved weekly slot block not found' });
    }

    const items = await sql`
      SELECT rsbi.id,
             rsbi.scheduled_date::text AS scheduled_date,
             rsbi.start_time::text AS start_time,
             rsbi.end_time::text AS end_time,
             rsbi.status,
             rsbi.price_pence,
             rsbi.lesson_booking_id,
             lb.status AS booking_status,
             lb.scheduled_date::text AS booking_date,
             lb.start_time::text AS booking_start_time,
             lb.end_time::text AS booking_end_time
        FROM recurring_slot_block_items rsbi
        LEFT JOIN lesson_bookings lb
          ON lb.id = rsbi.lesson_booking_id
         AND lb.school_id = rsbi.school_id
         AND lb.learner_id = ${user.id}
       WHERE rsbi.block_id = ${blockId}
         AND rsbi.school_id = ${schoolId}
       ORDER BY rsbi.scheduled_date, rsbi.start_time
    `;

    const normalisedItems = items.map(item => ({
      id: item.id,
      date: String(item.scheduled_date).slice(0, 10),
      start_time: String(item.start_time).slice(0, 5),
      end_time: String(item.end_time).slice(0, 5),
      status: item.status,
      price_pence: item.price_pence,
      lesson_booking_id: item.lesson_booking_id || null,
      booking: item.lesson_booking_id ? {
        id: item.lesson_booking_id,
        status: item.booking_status,
        date: String(item.booking_date || item.scheduled_date).slice(0, 10),
        start_time: String(item.booking_start_time || item.start_time).slice(0, 5),
        end_time: String(item.booking_end_time || item.end_time).slice(0, 5),
      } : null,
    }));

    return res.json({
      ok: true,
      block: {
        id: block.id,
        status: block.status,
        funding_method: block.funding_method,
        selected_lessons: block.selected_lessons,
        expires_at: block.expires_at,
        confirmed_at: block.confirmed_at,
        released_at: block.released_at,
        instructor_id: block.instructor_id,
        instructor_name: block.instructor_name,
        anchor_booking_id: block.anchor_booking_id || null,
        lesson_type_id: block.lesson_type_id || null,
        lesson_type_name: block.lesson_type_name || null,
        duration_minutes: block.duration_minutes,
        start_time: String(block.start_time).slice(0, 5),
        end_time: String(block.end_time).slice(0, 5),
        price_per_lesson_pence: block.price_per_lesson_pence,
        total_price_pence: block.total_price_pence,
        price_source: block.price_source || null,
        stripe: {
          checkout_session_id: block.stripe_checkout_session_id || null,
          payment_intent_id: block.stripe_payment_intent_id || null,
        },
      },
      items: normalisedItems,
      bookings: normalisedItems
        .filter(item => item.booking)
        .map(item => item.booking),
    });
  } catch (err) {
    console.error('recurring-block-status error:', err);
    reportError('/api/slots?action=recurring-block-status', err);
    return res.status(500).json({ error: true, code: 'STATUS_FAILED', message: 'Failed to load reserved block status' });
  }
}

async function handleRecurringBlockBankCheckout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: true, code: 'UNAUTHORISED', message: 'Unauthorised' });
  const schoolId = user.school_id || 1;
  const { anchor_booking_id, lessons } = req.body || {};

  let bankPaymentOptions;
  try {
    bankPaymentOptions = getReservedBlockBankCheckoutPaymentOptions();
  } catch (err) {
    if (err.code === 'PAY_BY_BANK_CONFIGURATION_MISSING') {
      return res.status(503).json({
        error: true,
        code: err.code,
        message: 'Reserved Weekly Slot bank checkout is not configured yet.',
      });
    }
    throw err;
  }

  const sql = neon(process.env.POSTGRES_URL);
  let hold = null;
  let createdSession = null;

  try {
    const preview = await buildRecurringBlockPreview(sql, {
      anchorBookingId: anchor_booking_id,
      learnerId: user.id,
      schoolId,
      lessons,
    });

    if (!preview.ok && preview.code === 'INVALID_LESSONS') {
      return res.status(400).json({ error: true, code: preview.code, message: preview.message });
    }
    if (!preview.ok && preview.code === 'ANCHOR_NOT_FOUND') {
      return res.status(404).json({ error: true, code: preview.code, message: preview.message });
    }
    if (!preview.ok) {
      return res.status(400).json({ error: true, code: preview.code || 'PREVIEW_FAILED', message: preview.message || 'Preview failed' });
    }
    if (!preview.can_commit) {
      return res.status(409).json({
        error: true,
        code: 'SLOTS_UNAVAILABLE',
        message: 'Not enough matching future weekly slots are available. Please review the refreshed preview.',
        preview,
      });
    }
    if (preview.credit.has_sufficient_credit) {
      return res.status(409).json({
        error: true,
        code: 'LESSON_CREDIT_AVAILABLE',
        message: 'Use Lesson Credit to confirm this weekly block.',
        preview,
      });
    }
    if (preview.pricing.requested_total_price_pence <= 0) {
      return res.status(409).json({
        error: true,
        code: 'ZERO_PRICE_UNSUPPORTED',
        message: 'Bank checkout requires a positive whole-block price.',
      });
    }

    hold = await createRecurringBlockBankHoldTransaction({
      connectionString: process.env.POSTGRES_URL,
      learnerId: user.id,
      schoolId,
      preview,
      holdMinutes: RESERVATION_MINUTES,
    });

    if (!hold.ok && hold.code === 'SLOTS_UNAVAILABLE') {
      return res.status(409).json({
        error: true,
        code: 'SLOTS_UNAVAILABLE',
        message: 'One or more selected slots are no longer available. Please refresh the preview.',
        conflicts: hold.conflicts || [],
      });
    }
    if (!hold.ok) {
      throw new Error(`Recurring block bank hold failed: ${hold.code || 'UNKNOWN'}`);
    }

    const [learner] = await sql`
      SELECT email
        FROM learner_users
       WHERE id = ${user.id}
         AND school_id = ${schoolId}
    `;
    if (!learner) {
      await releaseRecurringBlockBankHold(sql, { blockId: hold.block.id, schoolId });
      return res.status(404).json({ error: true, code: 'LEARNER_NOT_FOUND', message: 'Learner not found' });
    }
    const emailValid = learner.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(learner.email).trim());
    const origin = req.headers.origin || 'https://coachcarter.uk';
    const firstDate = preview.selected_slots[0]?.date;
    const lastDate = preview.selected_slots[preview.selected_slots.length - 1]?.date;

    const recurringBlockBankMetadata = {
      payment_type: 'recurring_block_bank_checkout',
      recurring_slot_block_id: String(hold.block.id),
      learner_id: String(user.id),
      instructor_id: String(preview.anchor.instructor_id),
      anchor_booking_id: String(preview.anchor.booking_id),
      lesson_type_id: String(preview.anchor.lesson_type_id || ''),
      selected_lessons: String(preview.requested_lessons),
      duration_minutes: String(preview.anchor.duration_minutes),
      amount_pence: String(preview.pricing.requested_total_price_pence),
      price_per_lesson_pence: String(preview.pricing.price_per_lesson_pence),
      price_source: preview.pricing.price_source || '',
      first_date: firstDate || '',
      last_date: lastDate || '',
      school_id: String(schoolId),
    };

    createdSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'gbp',
          unit_amount: preview.pricing.requested_total_price_pence,
          product_data: {
            name: `Reserved Weekly Slot - ${preview.requested_lessons} lessons`,
            description: `${preview.anchor.lesson_type_name || 'Driving lesson'} with ${preview.anchor.instructor_name}. Held for ${RESERVATION_MINUTES} minutes while bank checkout starts.`
          }
        },
        quantity: 1
      }],
      metadata: recurringBlockBankMetadata,
      payment_intent_data: {
        metadata: recurringBlockBankMetadata,
      },
      ...(emailValid ? { customer_email: learner.email } : {}),
      ...bankPaymentOptions,
      excluded_payment_method_types: CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES,
      billing_address_collection: 'required',
      success_url: `${origin}/learner/book.html?reserved_bank_checkout=1&block_id=${hold.block.id}`,
      cancel_url: `${origin}/learner/book.html?reserved_bank_cancelled=1&block_id=${hold.block.id}`
    });

    await sql`
      UPDATE recurring_slot_blocks
         SET stripe_checkout_session_id = ${createdSession.id},
             stripe_payment_intent_id = ${createdSession.payment_intent || null},
             metadata = metadata || ${JSON.stringify({ stripe_checkout_session_url_created: true })}::jsonb,
             updated_at = NOW()
       WHERE id = ${hold.block.id}
         AND school_id = ${schoolId}
         AND status = 'pending_payment'
    `;

    return res.status(201).json({
      ok: true,
      url: createdSession.url,
      block_id: hold.block.id,
      status: hold.block.status,
      funding_method: hold.block.funding_method,
      expires_at: hold.block.expires_at,
      selected_lessons: preview.requested_lessons,
      pricing: {
        price_per_lesson_pence: preview.pricing.price_per_lesson_pence,
        total_price_pence: preview.pricing.requested_total_price_pence,
        price_source: preview.pricing.price_source,
      },
    });
  } catch (err) {
    if (createdSession?.id) {
      try { await stripe.checkout.sessions.expire(createdSession.id); } catch (_) {}
    }
    if (hold?.ok && hold.block?.id) {
      try { await releaseRecurringBlockBankHold(sql, { blockId: hold.block.id, schoolId }); } catch (_) {}
    }
    console.error('recurring-block-bank-checkout error:', err);
    reportError('/api/slots?action=recurring-block-bank-checkout', err);
    return res.status(500).json({ error: true, code: 'BANK_CHECKOUT_FAILED', message: 'Failed to start reserved block bank checkout' });
  }
}

async function handleTestDateAvailability(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const ctx = await resolveTestDateContext(req, res);
    if (!ctx) return;
    const directPrice = await calcDirectLessonPrice(ctx.sql, {
      schoolId: ctx.schoolId,
      instructorId: ctx.instructor.id,
      learnerId: ctx.user.id,
      durationMinutes: TEST_DATE_DURATION_MINUTES,
    });
    const balanceRows = await ctx.sql`
      SELECT balance_minutes
        FROM learner_credit_balances
       WHERE learner_id = ${ctx.user.id}
         AND instructor_id = ${ctx.instructor.id}
         AND school_id = ${ctx.schoolId}
    `;
    const options = await buildTestDateAvailability(ctx);
    return res.json({
      ok: true,
      test_date: ctx.testDate,
      test_time: ctx.testTime,
      test_centre: ctx.testCentre,
      instructor_id: ctx.instructor.id,
      instructor_name: ctx.instructor.name,
      lesson_type_id: ctx.lessonType.id,
      lesson_type_name: ctx.lessonType.name,
      duration_minutes: TEST_DATE_DURATION_MINUTES,
      price_pence: directPrice.pricePence,
      balance_minutes: Number(balanceRows[0]?.balance_minutes || 0),
      can_use_credit: Number(balanceRows[0]?.balance_minutes || 0) >= TEST_DATE_DURATION_MINUTES,
      options,
    });
  } catch (err) {
    console.error('test-date-availability error:', err);
    reportError('/api/slots?action=test-date-availability', err);
    return res.status(500).json({ error: 'Failed to load test date lesson options', details: 'Internal server error' });
  }
}

async function handleBookTestDate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const ctx = await resolveTestDateContext(req, res, { requireStartTime: true });
    if (!ctx) return;
    const pickupAddress = String(req.body?.pickup_address || ctx.learner.pickup_address || '').trim();
    const dropoffAddress = req.body?.dropoff_address ? String(req.body.dropoff_address).trim() : null;
    if (!pickupAddress) return res.status(400).json({ error: 'Pickup address is required' });

    const options = await buildTestDateAvailability(ctx, { pickupAddress });
    const selected = options.find(o => o.start_time === ctx.selectedOption.start_time);
    if (!selected || !selected.fits) {
      return res.status(409).json({
        error: true,
        code: 'SLOT_UNAVAILABLE',
        message: 'That test date lesson time is no longer available.',
        reason: selected?.reason || 'unavailable',
        options,
      });
    }

    const bookingTransmissionType = concreteLessonTransmissionType(ctx.requestedTransmissionType, ctx.instructor.transmission_type);
    const booked = await bookCreditFundedSlotsTransaction({
      connectionString: process.env.POSTGRES_URL,
      learnerId: ctx.user.id,
      instructorId: ctx.instructor.id,
      schoolId: ctx.schoolId,
      bookingDates: [{ date: ctx.testDate }],
      startTime: ctx.selectedOption.start_time,
      endTime: ctx.selectedOption.end_time,
      lessonTypeId: ctx.lessonType.id,
      durationMins: TEST_DATE_DURATION_MINUTES,
      chargeMins: TEST_DATE_DURATION_MINUTES,
      pickupAddress,
      dropoffAddress,
      bookingTransmissionType,
      bookingPurpose: TEST_DATE_PURPOSE,
      testStartTime: ctx.testTime,
      testCentre: ctx.testCentre,
      useTestDateOverlapGuards: true,
    });
    if (!booked.ok && (booked.code === 'INSUFFICIENT_BALANCE' || booked.code === 'INSUFFICIENT_FIFO_SOURCES')) {
      return res.status(402).json({ error: 'Not enough Lesson Credit. You need 1.5 hours with this instructor.' });
    }
    if (!booked.ok && booked.code === 'SLOTS_UNAVAILABLE') {
      return res.status(409).json({ error: true, code: 'SLOTS_UNAVAILABLE', message: 'That test date lesson time is no longer available.', conflicts: booked.conflicts || [] });
    }
    if (!booked.ok) throw new Error(`Test date credit booking failed: ${booked.code || 'UNKNOWN'}`);

    await ctx.sql`
      UPDATE learner_users
         SET test_instructor_booked = TRUE,
             last_activity_at = NOW()
       WHERE id = ${ctx.user.id}
         AND school_id = ${ctx.schoolId}
    `;

    return res.status(201).json({
      success: true,
      booking_id: booked.createdBookings[0].id,
      balance_minutes: booked.balanceMinutes,
      balance_hours: (booked.balanceMinutes / 60).toFixed(1),
      booking_purpose: TEST_DATE_PURPOSE,
      test_date: ctx.testDate,
      test_time: ctx.testTime,
    });
  } catch (err) {
    console.error('book-test-date error:', err);
    reportError('/api/slots?action=book-test-date', err);
    return res.status(500).json({ error: 'Test date lesson booking failed', details: 'Internal server error' });
  }
}

async function handleCheckoutTestDate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let session = null;
  try {
    const ctx = await resolveTestDateContext(req, res, { requireStartTime: true });
    if (!ctx) return;
    const pickupAddress = String(req.body?.pickup_address || ctx.learner.pickup_address || '').trim();
    const dropoffAddress = req.body?.dropoff_address ? String(req.body.dropoff_address).trim() : '';
    if (!pickupAddress) return res.status(400).json({ error: 'Pickup address is required' });

    const options = await buildTestDateAvailability(ctx, { pickupAddress });
    const selected = options.find(o => o.start_time === ctx.selectedOption.start_time);
    if (!selected || !selected.fits) {
      return res.status(409).json({ error: 'That test date lesson time is no longer available.', reason: selected?.reason || 'unavailable' });
    }

    await ctx.sql`DELETE FROM slot_reservations WHERE expires_at < NOW()`;
    const directPrice = await calcDirectLessonPrice(ctx.sql, {
      schoolId: ctx.schoolId,
      instructorId: ctx.instructor.id,
      learnerId: ctx.user.id,
      durationMinutes: TEST_DATE_DURATION_MINUTES,
    });
    const bookingTransmissionType = concreteLessonTransmissionType(ctx.requestedTransmissionType, ctx.instructor.transmission_type);
    const emailValid = ctx.learner.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(ctx.learner.email).trim());
    const origin = req.headers.origin || 'https://coachcarter.uk';
    const lessonDate = new Date(ctx.testDate + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const pricePence = directPrice.pricePence;

    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'gbp',
          unit_amount: pricePence,
          product_data: {
            name: `Test date lesson - ${lessonDate} ${ctx.selectedOption.start_time}-${ctx.selectedOption.end_time}`,
            description: `1.5 hour warm-up and practical test booking with ${ctx.instructor.name}.`,
          },
        },
        quantity: 1,
      }],
      metadata: {
        payment_type: 'slot_booking',
        booking_purpose: TEST_DATE_PURPOSE,
        learner_id: String(ctx.user.id),
        learner_email: emailValid ? ctx.learner.email : '',
        instructor_id: String(ctx.instructor.id),
        instructor_name: ctx.instructor.name,
        scheduled_date: ctx.testDate,
        start_time: ctx.selectedOption.start_time,
        end_time: ctx.selectedOption.end_time,
        transmission_type: bookingTransmissionType,
        pickup_address: pickupAddress,
        dropoff_address: dropoffAddress,
        lesson_type_id: String(ctx.lessonType.id),
        duration_minutes: String(TEST_DATE_DURATION_MINUTES),
        charge_minutes: String(TEST_DATE_DURATION_MINUTES),
        amount_pence: String(pricePence),
        school_id: String(ctx.schoolId),
        test_date: ctx.testDate,
        test_time: ctx.testTime,
        test_centre: ctx.testCentre || '',
        effective_rate_pence_per_minute: String(Math.round(pricePence / TEST_DATE_DURATION_MINUTES)),
      },
      ...(emailValid ? { customer_email: ctx.learner.email } : {}),
      excluded_payment_method_types: CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES,
      billing_address_collection: 'required',
      allow_promotion_codes: false,
      success_url: `${origin}/learner/book.html?paid=1&test_date_lesson=1`,
      cancel_url: `${origin}/learner/book.html?cancelled=1`,
    });

    const insertedRows = await withNeonTransaction(process.env.POSTGRES_URL, async client => {
      await lockTestDateSlotMutation(client, {
        schoolId: ctx.schoolId,
        instructorId: ctx.instructor.id,
        date: ctx.testDate,
      });
      const conflicts = await testDateSlotOverlapConflictsPg(client, {
        instructorId: ctx.instructor.id,
        schoolId: ctx.schoolId,
        dates: [ctx.testDate],
        startTime: ctx.selectedOption.start_time,
        endTime: ctx.selectedOption.end_time,
      });
      if (conflicts.length > 0) {
        return [];
      }
      const inserted = await client.query(
        `INSERT INTO slot_reservations
           (learner_id, instructor_id, scheduled_date, start_time, end_time, stripe_session_id, expires_at, school_id)
         VALUES
           ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '10 minutes', $7)
         ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING
         RETURNING id`,
        [
          ctx.user.id,
          ctx.instructor.id,
          ctx.testDate,
          ctx.selectedOption.start_time,
          ctx.selectedOption.end_time,
          session.id,
          ctx.schoolId,
        ]
      );
      return inserted.rows;
    });
    if (insertedRows.length === 0) {
      stripe.checkout.sessions.expire(session.id).catch((expireErr) => {
        console.warn('Failed to expire orphan test-date Stripe session', session.id, expireErr.message);
      });
      return res.status(409).json({ error: 'Someone else just took that test date lesson time.' });
    }

    return res.json({ url: session.url });
  } catch (err) {
    if (session?.id) {
      try { await stripe.checkout.sessions.expire(session.id); } catch (_) {}
    }
    console.error('checkout-test-date error:', err);
    reportError('/api/slots?action=checkout-test-date', err);
    return res.status(500).json({ error: 'Failed to create test date checkout', details: 'Internal server error' });
  }
}

async function handleBook(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  const {
    instructor_id,
    date,
    start_time,
    end_time,
    lesson_type_id,
    pickup_address,
    dropoff_address,
    repeat_weeks,
    transmission_type,
    social_video_consent,
    social_video_age_confirmed,
  } = req.body;
  if (!instructor_id || !date || !start_time || !end_time)
    return res.status(400).json({ error: 'instructor_id, date, start_time and end_time are required' });
  const requestedTransmissionType = parseRequestTransmissionType(transmission_type);
  if (transmission_type && !requestedTransmissionType) {
    return res.status(400).json({ error: 'transmission_type must be manual, automatic, or both' });
  }

  // Validate repeat_weeks if provided
  const weeks = repeat_weeks ? parseInt(repeat_weeks, 10) : 1;
  if (weeks < 1 || weeks > 8 || isNaN(weeks))
    return res.status(400).json({ error: 'repeat_weeks must be between 1 and 8' });
  const isRecurring = weeks > 1;

  // Validate date is not in the past and within booking window
  const bookingDate = parseDate(date);
  if (!bookingDate)
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });

  const today    = startOfDay(new Date());
  const maxAhead = addDays(today, MAX_DAYS_AHEAD);
  if (bookingDate < today)
    return res.status(400).json({ error: 'Cannot book a slot in the past' });

  // Build list of dates for all weeks
  const bookingDates = [];
  for (let w = 0; w < weeks; w++) {
    const d = addDays(bookingDate, w * 7);
    bookingDates.push({ date: formatDate(d), dateObj: d });
  }

  // Validate all dates are within the booking window
  const lastDate = bookingDates[bookingDates.length - 1];
  if (lastDate.dateObj > maxAhead)
    return res.status(400).json({ error: `Cannot book more than ${MAX_DAYS_AHEAD} days in advance. The last date in this series (${lastDate.date}) exceeds the limit.` });

  // Reject same-day bookings where the slot has already started
  const startMins = timeToMinutes(start_time);
  const endMins   = timeToMinutes(end_time);
  if (bookingDate.getTime() === today.getTime()) {
    const now = new Date();
    const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (startMins <= nowMins)
      return res.status(400).json({ error: 'This slot has already started. Please choose a later time.' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // 0. Look up lesson type
    const lessonType = await getLessonType(sql, lesson_type_id, schoolId);
    if (!lessonType) return res.status(404).json({ error: 'Lesson type not found or inactive' });
    if (isFreeTrialLessonType(lessonType)) return rejectFreeTrialOnPaidPath(res);
    const durationMins = lessonType.duration_minutes;

    // Validate slot duration matches lesson type
    if (endMins - startMins !== durationMins)
      return res.status(400).json({ error: `Slot must be exactly ${formatHours(durationMins)} for ${lessonType.name}` });

    // 1. Check learner has enough hours
    const [learner] = await sql`
      SELECT id, name, email, phone, credit_balance, balance_minutes, pickup_address
      FROM learner_users WHERE id = ${user.id} AND school_id = ${schoolId}
    `;
    if (!learner)
      return res.status(404).json({ error: 'Learner account not found' });

    // 2. Check instructor exists and is active
    const [instructor] = await sql`
      SELECT id, name, email, phone, max_travel_minutes, offered_lesson_types,
             COALESCE(social_video_opt_in, false) AS social_video_opt_in,
             COALESCE(max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
             COALESCE(transmission_type, 'manual') AS transmission_type
      FROM instructors
      WHERE id = ${instructor_id} AND active = true AND school_id = ${schoolId}
    `;
    if (!instructor)
      return res.status(404).json({ error: 'Instructor not found or unavailable' });
    const socialVideo = resolveSocialVideoSelection({
      requested: social_video_consent,
      ageConfirmed: social_video_age_confirmed,
      instructor,
    });
    if (socialVideo.rejected) {
      return res.status(400).json({ error: 'This instructor is not offering social media filming discounts.' });
    }
    if (socialVideo.ageRejected) {
      return res.status(400).json({ error: 'Social media filming consent is only available when the learner confirms they are 18 or over.' });
    }
    if (!isLessonTypeOffered(instructor.offered_lesson_types, lessonType.slug)) {
      return rejectLessonTypeNotOffered(res);
    }
    const outOfWindowDates = bookingDates.filter(bd => !isDateWithinBookingWindow(bd.dateObj, instructor.max_booking_days_ahead));
    if (outOfWindowDates.length > 0) {
      return res.status(400).json({ error: advanceWindowError(instructor.max_booking_days_ahead) });
    }
    const bookingTransmissionType = concreteLessonTransmissionType(requestedTransmissionType, instructor.transmission_type);

    const unavailableDates = [];
    for (const bd of bookingDates) {
      const fitsAvailability = await slotFitsActiveAvailability(sql, {
        instructorId: instructor_id,
        schoolId,
        date: bd.date,
        startTime: start_time,
        endTime: end_time,
        transmissionType: requestedTransmissionType
      });
      if (!fitsAvailability) unavailableDates.push(bd.date);
    }
    if (unavailableDates.length > 0) {
      const availableDates = bookingDates
        .map(d => d.date)
        .filter(d => !unavailableDates.includes(d));
      return res.status(409).json({
        error: true,
        code: 'SLOTS_UNAVAILABLE',
        message: `${unavailableDates.length} of ${weeks} slots are no longer available`,
        conflicts: unavailableDates.map(d => ({ date: d, start_time, reason: 'outside availability' })),
        available: availableDates.map(d => ({ date: d, start_time }))
      });
    }

    // Demo instructor bookings are free (no deduction)
    const isDemoInstructor = instructor.email === 'demo@coachcarter.uk';

    // Check if payments are enabled for this school
    const [schoolRow] = await sql`SELECT config FROM schools WHERE id = ${schoolId}`;
    const schoolConfig = schoolRow?.config || {};
    const skipPayments = isDemoInstructor || !schoolConfig.payments_enabled;

    // 2b. Travel time check between pickup postcodes (warning only, not blocking)
    let travelWarnings = null;
    const bookingPickupAddr = pickup_address || learner.pickup_address || null;
    const skipTravel = req.query.skip_travel_check === 'true';
    if (bookingPickupAddr && !skipTravel && !isDemoInstructor) {
      try {
        const result = await checkAdjacentTravelTime(
          sql, instructor_id, date, start_time, end_time,
          bookingPickupAddr, instructor.max_travel_minutes || undefined
        );
        if (result) travelWarnings = result.warnings;
      } catch { /* never block bookings due to travel check errors */ }
    }

    if (bookingPickupAddr && !isDemoInstructor) {
      for (const bd of bookingDates) {
        if (await rejectIfPickupTravelConflict(res, sql, {
          instructorId: instructor_id,
          schoolId,
          date: bd.date,
          startTime: start_time,
          endTime: end_time,
          pickupAddress: bookingPickupAddr,
        })) return;
      }
    }

    // Filming consent discounts the cash price, not the lesson-credit
    // entitlement. A one-hour lesson always consumes and, when eligible,
    // returns 60 minutes.
    const chargeMins = durationMins;
    const totalMins = chargeMins * weeks;

    // 3. For recurring bookings, check all slots are available before booking any
    if (isRecurring) {
      const dateStrings = bookingDates.map(d => d.date);
      const conflicts = await sql`
        SELECT scheduled_date::text AS date, start_time::text
        FROM lesson_bookings
        WHERE instructor_id = ${instructor_id}
          AND school_id = ${schoolId}
          AND scheduled_date = ANY(${dateStrings})
          AND start_time = ${start_time}
          AND status = ANY(${BLOCKING_STATUSES}::text[])
      `;
      // Also check slot reservations (Stripe checkout holds)
      const reservations = await sql`
        SELECT scheduled_date::text AS date, start_time::text
        FROM slot_reservations
        WHERE instructor_id = ${instructor_id}
          AND school_id = ${schoolId}
          AND scheduled_date = ANY(${dateStrings})
          AND start_time = ${start_time}
          AND expires_at > NOW()
      `;
      // Also check pending lesson offers
      let offerConflicts = [];
      try {
        offerConflicts = await sql`
          SELECT scheduled_date::text AS date, start_time::text
          FROM lesson_offers
          WHERE instructor_id = ${instructor_id}
            AND school_id = ${schoolId}
            AND scheduled_date = ANY(${dateStrings})
            AND start_time = ${start_time}
            AND status = 'pending'
            AND expires_at > NOW()
        `;
      } catch (e) { /* table may not exist yet */ }
      // Also check pending lesson requests
      const requestConflicts = await pendingRequestConflicts(sql, {
        instructorId: instructor_id, schoolId, dates: dateStrings, startTime: start_time,
      });
      const takenDates = new Set([
        ...conflicts.map(c => c.date),
        ...reservations.map(r => r.date),
        ...offerConflicts.map(o => o.date),
        ...requestConflicts.map(r => r.date)
      ]);
      if (takenDates.size > 0) {
        return res.status(409).json({
          error: true,
          code: 'SLOTS_UNAVAILABLE',
          message: `${takenDates.size} of ${weeks} slots are not available`,
          conflicts: [...takenDates].map(d => ({ date: d, start_time, reason: 'already booked' })),
          available: dateStrings.filter(d => !takenDates.has(d)).map(d => ({ date: d, start_time }))
        });
      }
    }

    // Credit-funded bookings are written by bookCreditFundedSlotsTransaction()
    // below. Do not use the standalone balance-only LCB helper here: the LCB
    // lock must stay held through FIFO planning, booking inserts, BCS inserts,
    // and the final scoped balance decrement.

    // 5. Create booking(s) — unique index on (instructor_id, scheduled_date, start_time)
    const seriesId = isRecurring ? crypto.randomUUID() : null;
    const bookingPickup  = pickup_address || learner.pickup_address || null;
    const bookingDropoff = dropoff_address || null;
    const minsPerBooking = skipPayments ? 0 : chargeMins;
    let createdBookings = [];
    let transactionBalanceMinutes = null;

    // Credit-funded list_price_pence is computed inside the transaction from
    // planned payable BCS contribution. skipPayments paths snapshot 0 because
    // no credit source was consumed and no list price is owed.
    const listPricePence = 0;

    if (!skipPayments) {
      const booked = await bookCreditFundedSlotsTransaction({
        connectionString: process.env.POSTGRES_URL,
        learnerId: user.id,
        instructorId: Number(instructor_id),
        schoolId,
        bookingDates,
        startTime: start_time,
        endTime: end_time,
        lessonTypeId: lessonType.id,
        durationMins,
        pickupAddress: bookingPickup,
        dropoffAddress: bookingDropoff,
        bookingTransmissionType,
        chargeMins,
        socialVideoConsent: socialVideo.selected,
        socialVideoAgeConfirmed: socialVideo.ageConfirmed,
        socialVideoDiscountPct: socialVideo.discountPct,
        seriesId,
      });

      if (!booked.ok && (booked.code === 'INSUFFICIENT_BALANCE' || booked.code === 'INSUFFICIENT_FIFO_SOURCES')) {
        return res.status(402).json({ error: `Not enough Lesson Credit. You need ${formatHours(totalMins)}. Please use pay-and-book for this slot.` });
      }
      if (!booked.ok && booked.code === 'SLOTS_UNAVAILABLE') {
        return res.status(409).json({
          error: true,
          code: 'SLOTS_UNAVAILABLE',
          message: `${booked.conflicts?.length || 1} of ${weeks} slots are not available`,
          conflicts: booked.conflicts || [],
          available: booked.available || []
        });
      }
      if (!booked.ok && booked.code === 'LCB_SCOPE_INVARIANT') {
        throw new Error(booked.message || 'LCB_SCOPE_INVARIANT');
      }
      if (!booked.ok) {
        throw new Error(`Credit-funded booking transaction failed: ${booked.code || 'UNKNOWN'}`);
      }

      createdBookings = booked.createdBookings;
      transactionBalanceMinutes = booked.balanceMinutes;
    } else try {
      for (const bd of bookingDates) {
        const [b] = await sql`
          INSERT INTO lesson_bookings
            (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
             pickup_address, dropoff_address, lesson_type_id, transmission_type, minutes_deducted, series_id, school_id,
             list_price_pence, list_price_source, social_video_consent, social_video_age_confirmed, social_video_discount_pct)
          VALUES
            (${user.id}, ${instructor_id}, ${bd.date}, ${start_time}, ${end_time}, ${SCHEDULED},
             ${bookingPickup}, ${bookingDropoff}, ${lessonType.id}, ${bookingTransmissionType}, ${minsPerBooking}, ${seriesId}, ${schoolId},
             ${listPricePence}, 'live_compute_insert', ${socialVideo.selected}, ${socialVideo.ageConfirmed}, ${socialVideo.discountPct})
          RETURNING id, scheduled_date::text, start_time::text, end_time::text, status, created_at
        `;
        createdBookings.push(b);
      }
    } catch (insertErr) {
      // Refund the hours since booking failed (not needed for demo/free schools).
      // lockBalanceAdjustLCB encapsulates the LCB-lock prologue — this is a
      // credit-affecting writer and must serialise against concurrent
      // grantCredits() for this learner. See api/_credit-grant.js for the
      // invariant.
      if (!skipPayments) {
        const creditsToRefund = Math.ceil(totalMins / 60);
        await lockBalanceAdjustLCB(sql, {
          learnerId: user.id, instructorId: instructor_id, schoolId,
          delta: totalMins, creditsDelta: creditsToRefund,
        });
      }
      // If some bookings in a series were created before the failure, cancel them
      if (createdBookings.length > 0) {
        const createdIds = createdBookings.map(b => b.id);
        await sql`
          UPDATE lesson_bookings SET status = ${REFUNDED}, cancelled_at = NOW()
          WHERE id = ANY(${createdIds})
        `;
      }
      if (insertErr.message?.includes('uq_booking_slot') || insertErr.message?.includes('uq_instructor_slot')) {
        return res.status(409).json({ error: 'Sorry, one of the slots was just booked by someone else. Please try again.' });
      }
      throw insertErr;
    }

    // GDPR: update last activity timestamp
    try { await sql`UPDATE learner_users SET last_activity_at = NOW() WHERE id = ${user.id}`; } catch (e) {}

    // Supersede any pending broadcast offers on these slots — a learner just
    // booked one of them through the regular flow, so the broadcast is moot.
    // Fire-and-forget; sends a "no longer available" message to other recipients.
    for (const b of createdBookings) {
      supersedeBroadcastSiblings({
        instructor_id: instructor_id,
        scheduled_date: String(b.scheduled_date).slice(0, 10),
        start_time: String(b.start_time).slice(0, 5),
        school_id: schoolId
      }).catch(err => console.warn('supersede on book failed:', err.message));
    }

    // 6. Get updated balance for response
    const [updated] = await sql`SELECT balance_minutes, credit_balance FROM learner_users WHERE id = ${user.id}`;
    const responseBalanceMinutes = transactionBalanceMinutes ?? (updated.balance_minutes || 0);
    const durationStr = formatHours(durationMins);
    const balanceStr  = formatHours(responseBalanceMinutes);

    // 7. Send notifications
    const mailer = createTransporter();

    if (isRecurring) {
      // Send summary email + ICS for each booking in the series
      const dateList = bookingDates.map(bd => {
        const display = formatDateDisplay(bd.date);
        return `<li>${display} at ${start_time} – ${end_time}</li>`;
      }).join('');

      await mailer.sendMail({
        from:    'CoachCarter <bookings@coachcarter.uk>',
        to:      learner.email,
        subject: `${weeks} weekly lessons confirmed — starting ${formatDateDisplay(date)}`,
        html: `
          <h1>${weeks} weekly lessons confirmed.</h1>
          <table>
            <tr><td><strong>Instructor:</strong></td><td>${instructor.name}</td></tr>
            <tr><td><strong>Type:</strong></td><td>${lessonType.name} (${durationStr})</td></tr>
            <tr><td><strong>Total hours:</strong></td><td>${formatHours(totalMins)}</td></tr>
            <tr><td><strong>Hours remaining:</strong></td><td>${balanceStr}</td></tr>
          </table>
          <h3>Dates:</h3>
          <ol>${dateList}</ol>
          <p style="margin-top:16px;font-size:0.875rem;color:#797879">
            Need to cancel? You can cancel individual lessons or the whole series.
            Cancel at least 48 hours before and the lesson credit returns to your balance.
          </p>
          <p>
            <a href="https://coachcarter.uk/learner/"
               style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold">
              View my bookings →
            </a>
          </p>
        `,
        attachments: bookingDates.map((bd, i) => ({
          filename: `coachcarter-lesson-${bd.date}.ics`,
          content: generateICS({
            id: createdBookings[i].id,
            scheduled_date: bd.date,
            start_time,
            end_time,
            instructor_name: instructor.name,
            lesson_type_name: lessonType.name,
            duration_str: durationStr
          }),
          contentType: 'text/calendar; method=PUBLISH'
        }))
      });

      if (!isDemoInstructor) {
        await mailer.sendMail({
          from:    'CoachCarter <system@coachcarter.uk>',
          to:      instructor.email,
          subject: `${weeks} weekly bookings — ${learner.name} starting ${formatDateDisplay(date)}`,
          html: `
            <h2>${weeks} weekly lessons booked</h2>
            <table>
              <tr><td><strong>Learner:</strong></td><td>${learner.name}</td></tr>
              <tr><td><strong>Email:</strong></td><td>${learner.email}</td></tr>
              <tr><td><strong>Type:</strong></td><td>${lessonType.name} (${durationStr})</td></tr>
            </table>
            <h3>Dates:</h3>
            <ol>${dateList}</ol>
            <p style="margin-top:16px">
              <a href="https://coachcarter.uk/instructor/"
                 style="background:#f58321;color:white;padding:10px 20px;text-decoration:none;
                        border-radius:8px;display:inline-block;font-weight:bold;font-size:0.9rem">
                View my schedule →
              </a>
            </p>
          `
        });
      }

      // WhatsApp — single summary message
      const dateListText = bookingDates.map(bd => `  📅 ${formatDateDisplay(bd.date)}`).join('\n');
      await sendWhatsApp(learner.phone,
        `✅ ${weeks} weekly lessons confirmed!\n\n🚗 Instructor: ${instructor.name}\n📋 ${lessonType.name} (${durationStr} each)\n⏰ ${start_time} – ${end_time}\n\n${dateListText}\n\nTotal: ${formatHours(totalMins)} | Remaining: ${balanceStr}\n\nView bookings: https://coachcarter.uk/learner/`
      );
      if (!isDemoInstructor) {
        await sendWhatsApp(instructor.phone,
          `📋 ${weeks} weekly bookings!\n\n👤 ${learner.name}\n📋 ${lessonType.name} (${durationStr})\n⏰ ${start_time} – ${end_time}\n\n${dateListText}\n\nView schedule: https://coachcarter.uk/instructor/`
        );
      }
    } else {
      // Single booking — existing notification flow
      const lessonDateStr = formatDateDisplay(date);
      const lessonTime    = `${start_time} – ${end_time}`;

      const icsContent = generateICS({
        id: createdBookings[0].id,
        scheduled_date: date,
        start_time,
        end_time,
        instructor_name: instructor.name,
        lesson_type_name: lessonType.name,
        duration_str: durationStr
      });

      await mailer.sendMail({
        from:    'CoachCarter <bookings@coachcarter.uk>',
        to:      learner.email,
        subject: `Lesson confirmed — ${lessonDateStr} at ${start_time}`,
        html: `
          <h1>Lesson confirmed.</h1>
          <table>
            <tr><td><strong>Date:</strong></td><td>${lessonDateStr}</td></tr>
            <tr><td><strong>Time:</strong></td><td>${lessonTime}</td></tr>
            <tr><td><strong>Instructor:</strong></td><td>${instructor.name}</td></tr>
            <tr><td><strong>Type:</strong></td><td>${lessonType.name}</td></tr>
            <tr><td><strong>Duration:</strong></td><td>${durationStr}</td></tr>
            <tr><td><strong>Hours remaining:</strong></td><td>${balanceStr}</td></tr>
          </table>
          <p style="margin-top:16px;font-size:0.875rem;color:#797879">
            Need to cancel? Do so at least 48 hours before and the lesson credit returns to your balance.
          </p>
          <p>
            <a href="https://coachcarter.uk/learner/"
               style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold">
              View my bookings →
            </a>
          </p>
        `,
        attachments: [{
          filename: `coachcarter-lesson-${date}.ics`,
          content:  icsContent,
          contentType: 'text/calendar; method=PUBLISH'
        }]
      });

      if (!isDemoInstructor) {
        await mailer.sendMail({
          from:    'CoachCarter <system@coachcarter.uk>',
          to:      instructor.email,
          subject: `New booking — ${lessonDateStr} at ${start_time}`,
          html: `
            <h2>New lesson booked</h2>
            <table>
              <tr><td><strong>Learner:</strong></td><td>${learner.name}</td></tr>
              <tr><td><strong>Email:</strong></td><td>${learner.email}</td></tr>
              <tr><td><strong>Date:</strong></td><td>${lessonDateStr}</td></tr>
              <tr><td><strong>Time:</strong></td><td>${lessonTime}</td></tr>
              <tr><td><strong>Type:</strong></td><td>${lessonType.name} (${durationStr})</td></tr>
            </table>
            <p style="margin-top:16px">
              <a href="https://coachcarter.uk/instructor/"
                 style="background:#f58321;color:white;padding:10px 20px;text-decoration:none;
                        border-radius:8px;display:inline-block;font-weight:bold;font-size:0.9rem">
                View my schedule →
              </a>
            </p>
          `
        });
      }

      await sendWhatsApp(learner.phone,
        `✅ Lesson confirmed!\n\n📅 ${lessonDateStr}\n⏰ ${lessonTime}\n🚗 Instructor: ${instructor.name}\n📋 ${lessonType.name} (${durationStr})\n\nNeed to cancel? Do so at least 48 hours before and the lesson credit returns to your balance.\n\nView bookings: https://coachcarter.uk/learner/`
      );
      if (!isDemoInstructor) {
        await sendWhatsApp(instructor.phone,
          `📋 New booking!\n\n👤 ${learner.name}\n📅 ${lessonDateStr}\n⏰ ${lessonTime}\n📋 ${lessonType.name} (${durationStr})\n\nView schedule: https://coachcarter.uk/instructor/`
        );
      }
    }

    // 8. Response
    const response = {
      success:         true,
      booking_id:      createdBookings[0].id,
      balance_minutes: responseBalanceMinutes,
      balance_hours:   (responseBalanceMinutes / 60).toFixed(1),
      credit_balance:  updated.credit_balance,
      payments_enabled: !!schoolConfig.payments_enabled
    };
    if (isRecurring) {
      response.series_id   = seriesId;
      response.booking_ids = createdBookings.map(b => b.id);
      response.dates       = bookingDates.map(bd => bd.date);
      response.weeks       = weeks;
    }
    if (travelWarnings && travelWarnings.length > 0) {
      response.travel_warnings = travelWarnings;
    }

    return res.status(201).json(response);

  } catch (err) {
    console.error('slots book error:', err);
    reportError('/api/slots', err);
    return res.status(500).json({ error: 'Booking failed', details: 'Internal server error' });
  }
}

// All the ways a slot can be taken, in one place: blocking bookings, live
// checkout reservations, pending offers, pending lesson requests, pending
// weekly-block holds, and busy blocks. Tagged-template twin of the checks
// inside bookCreditFundedSlotsTransaction — use this from handlers that
// aren't already inside that transaction. Returns conflict rows
// [{ date, start_time, reason }].
async function slotClashConflicts(sql, { instructorId, schoolId, dates, startTime, endTime }) {
  const conflicts = [];

  const bookings = await sql`
    SELECT scheduled_date::text AS date, start_time::text
    FROM lesson_bookings
    WHERE instructor_id = ${instructorId}
      AND school_id = ${schoolId}
      AND scheduled_date = ANY(${dates})
      AND start_time = ${startTime}
      AND status = ANY(${BLOCKING_STATUSES}::text[])
  `;
  conflicts.push(...bookings.map(r => ({ ...r, reason: 'already_booked' })));

  try {
    const reservations = await sql`
      SELECT scheduled_date::text AS date, start_time::text
      FROM slot_reservations
      WHERE instructor_id = ${instructorId}
        AND school_id = ${schoolId}
        AND scheduled_date = ANY(${dates})
        AND start_time = ${startTime}
        AND expires_at > NOW()
    `;
    conflicts.push(...reservations.map(r => ({ ...r, reason: 'reserved' })));
  } catch (e) { /* table may not exist yet */ }

  try {
    const offers = await sql`
      SELECT scheduled_date::text AS date, start_time::text
      FROM lesson_offers
      WHERE instructor_id = ${instructorId}
        AND school_id = ${schoolId}
        AND scheduled_date = ANY(${dates})
        AND start_time = ${startTime}
        AND status = 'pending'
        AND expires_at > NOW()
    `;
    conflicts.push(...offers.map(r => ({ ...r, reason: 'pending_offer' })));
  } catch (e) { /* table may not exist yet */ }

  const requests = await pendingRequestConflicts(sql, { instructorId, schoolId, dates, startTime });
  conflicts.push(...requests.map(r => ({ ...r, reason: 'pending_request' })));

  try {
    const recurringHolds = await sql`
      SELECT rsbi.scheduled_date::text AS date, rsbi.start_time::text
      FROM recurring_slot_block_items rsbi
      JOIN recurring_slot_blocks rsb ON rsb.id = rsbi.block_id
      WHERE rsbi.instructor_id = ${instructorId}
        AND rsbi.school_id = ${schoolId}
        AND rsbi.scheduled_date = ANY(${dates})
        AND rsbi.start_time = ${startTime}
        AND rsbi.status = 'held'
        AND rsb.status = 'pending_payment'
        AND rsb.expires_at > NOW()
    `;
    conflicts.push(...recurringHolds.map(r => ({ ...r, reason: 'pending_weekly_block' })));
  } catch (e) { /* table may not exist yet */ }

  if (endTime) {
    try {
      const busyBlocks = await sql`
        SELECT block_date::text AS date, start_time::text
        FROM instructor_busy_blocks
        WHERE instructor_id = ${instructorId}
          AND school_id = ${schoolId}
          AND block_date = ANY(${dates})
          AND start_time < ${endTime}::time
          AND end_time > ${startTime}::time
      `;
      conflicts.push(...busyBlocks.map(r => ({ ...r, reason: 'busy_block' })));
    } catch (e) { /* table may not exist yet */ }
  }

  return conflicts;
}

// ── POST /api/slots?action=request-slot ───────────────────────────────────────
// Credit-funded lesson request for a request-to-book instructor
// (LESSON-REQUEST-PLAN.md). Deducts the lesson's minutes as a hold
// ('request_hold' ledger row) and creates a pending lesson_requests row that
// blocks the slot until the instructor accepts, declines, or it expires.
// Single slot only — no repeat weeks on requests.
async function handleRequestSlot(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  const { instructor_id, date, start_time, end_time, lesson_type_id, pickup_address, transmission_type } = req.body;
  if (!instructor_id || !date || !start_time || !end_time)
    return res.status(400).json({ error: 'instructor_id, date, start_time and end_time are required' });
  const requestedTransmissionType = parseRequestTransmissionType(transmission_type);
  if (transmission_type && !requestedTransmissionType) {
    return res.status(400).json({ error: 'transmission_type must be manual, automatic, or both' });
  }

  const bookingDate = parseDate(date);
  if (!bookingDate)
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  const today = startOfDay(new Date());
  if (bookingDate < today)
    return res.status(400).json({ error: 'Cannot request a slot in the past' });
  const maxAhead = addDays(today, MAX_DAYS_AHEAD);
  if (bookingDate > maxAhead)
    return res.status(400).json({ error: `Cannot request a lesson more than ${MAX_DAYS_AHEAD} days in advance` });

  const startMins = timeToMinutes(start_time);
  const endMins   = timeToMinutes(end_time);

  // Requests need decision headroom: reject anything inside the minimum lead
  // window (also covers already-started same-day slots).
  const requestExpiresAt = computeRequestExpiresAt(date, start_time);
  if (!requestExpiresAt) {
    return res.status(400).json({
      error: true,
      code: 'REQUEST_TOO_LATE',
      message: 'This slot starts too soon to request — the instructor needs time to confirm. Please pick a later slot.'
    });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const lessonType = await getLessonType(sql, lesson_type_id, schoolId);
    if (!lessonType) return res.status(404).json({ error: 'Lesson type not found or inactive' });
    if (isFreeTrialLessonType(lessonType)) return rejectFreeTrialOnPaidPath(res);
    const durationMins = lessonType.duration_minutes;
    if (endMins - startMins !== durationMins)
      return res.status(400).json({ error: `Slot must be exactly ${formatHours(durationMins)} for ${lessonType.name}` });

    const [learner] = await sql`
      SELECT id, name, email, phone, pickup_address
      FROM learner_users WHERE id = ${user.id} AND school_id = ${schoolId}
    `;
    if (!learner) return res.status(404).json({ error: 'Learner account not found' });

    const [instructor] = await sql`
      SELECT id, name, email, phone, max_travel_minutes, offered_lesson_types,
             COALESCE(request_to_book, false) AS request_to_book,
             COALESCE(max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
             COALESCE(transmission_type, 'manual') AS transmission_type
      FROM instructors
      WHERE id = ${instructor_id} AND active = true AND school_id = ${schoolId}
    `;
    if (!instructor)
      return res.status(404).json({ error: 'Instructor not found or unavailable' });
    if (!instructor.request_to_book) {
      return res.status(400).json({
        error: true,
        code: 'REQUEST_NOT_ENABLED',
        message: 'This instructor takes instant bookings — book the slot instead.'
      });
    }
    if (!isLessonTypeOffered(instructor.offered_lesson_types, lessonType.slug)) {
      return rejectLessonTypeNotOffered(res);
    }
    if (!isDateWithinBookingWindow(bookingDate, instructor.max_booking_days_ahead)) {
      return res.status(400).json({ error: advanceWindowError(instructor.max_booking_days_ahead, 'request') });
    }

    // Demo instructors / payments-disabled schools book instantly for free —
    // request mode is meaningless there.
    const isDemoInstructor = instructor.email === 'demo@coachcarter.uk';
    const [schoolRow] = await sql`SELECT config FROM schools WHERE id = ${schoolId}`;
    if (isDemoInstructor || !schoolRow?.config?.payments_enabled) {
      return res.status(400).json({
        error: true,
        code: 'REQUEST_NOT_ENABLED',
        message: 'Requests are not available here — book the slot instead.'
      });
    }

    const fitsAvailability = await slotFitsActiveAvailability(sql, {
      instructorId: instructor_id,
      schoolId,
      date,
      startTime: start_time,
      endTime: end_time,
      transmissionType: requestedTransmissionType
    });
    if (!fitsAvailability) {
      return res.status(409).json({ error: true, code: 'SLOTS_UNAVAILABLE', message: 'That slot is no longer available' });
    }

    const requestPickupAddr = pickup_address || learner.pickup_address || null;
    let travelWarnings = null;
    if (requestPickupAddr) {
      if (await rejectIfPickupTravelConflict(res, sql, {
        instructorId: instructor_id,
        schoolId,
        date,
        startTime: start_time,
        endTime: end_time,
        pickupAddress: requestPickupAddr,
      })) return;
      try {
        const result = await checkAdjacentTravelTime(
          sql, instructor_id, date, start_time, end_time,
          requestPickupAddr, instructor.max_travel_minutes || undefined
        );
        if (result) travelWarnings = result.warnings;
      } catch { /* never block requests on travel-check errors */ }
    }

    // Clear any pending-but-expired request still holding this slot's unique
    // index, then run the same clash checks a booking would.
    await lazyExpireSlotRequests(sql, { instructorId: instructor_id, schoolId, date, startTime: start_time });

    const clashChecks = await slotClashConflicts(sql, {
      instructorId: instructor_id,
      schoolId,
      dates: [date],
      startTime: start_time,
      endTime: end_time,
    });
    if (clashChecks.length > 0) {
      return res.status(409).json({ error: true, code: 'SLOTS_UNAVAILABLE', message: 'That slot is no longer available' });
    }

    const bookingTransmissionType = concreteLessonTransmissionType(requestedTransmissionType, instructor.transmission_type);

    // 1. Claim the slot with the pending-request row (uq_request_slot makes
    //    concurrent duplicates impossible). Insert BEFORE taking the hold so
    //    a crash can never strand deducted credits without a visible row.
    let request;
    try {
      const [inserted] = await sql`
        INSERT INTO lesson_requests
          (school_id, instructor_id, learner_id, scheduled_date, start_time, end_time,
           lesson_type_id, pickup_address, transmission_type, payment_method,
           credits_minutes, status, expires_at)
        VALUES
          (${schoolId}, ${instructor_id}, ${user.id}, ${date}, ${start_time}, ${end_time},
           ${lessonType.id}, ${requestPickupAddr}, ${bookingTransmissionType}, 'credit',
           ${durationMins}, 'pending', ${requestExpiresAt.toISOString()})
        RETURNING id, expires_at
      `;
      request = inserted;
    } catch (insertErr) {
      if (insertErr.code === '23505' || insertErr.message?.includes('uq_request_slot')) {
        return res.status(409).json({ error: true, code: 'SLOTS_UNAVAILABLE', message: 'Someone has already requested that slot.' });
      }
      throw insertErr;
    }

    // 2. Take the credit hold. On failure, remove the claim.
    const hold = await lockBalanceAndMutate(sql, {
      learnerId: user.id,
      instructorId: Number(instructor_id),
      schoolId,
      delta: -durationMins,
      creditsDelta: -Math.ceil(durationMins / 60),
      ledgerType: 'request_hold',
      reason: 'lesson request hold',
    });
    if (!hold.ok) {
      await sql`DELETE FROM lesson_requests WHERE id = ${request.id} AND school_id = ${schoolId} AND status = 'pending'`;
      if (hold.code === 'INSUFFICIENT_BALANCE') {
        return res.status(402).json({
          error: true,
          code: 'INSUFFICIENT_BALANCE',
          message: `Not enough Lesson Credit. You need ${formatHours(durationMins)}. Please use pay-and-request for this slot.`
        });
      }
      throw new Error(`request_hold failed: ${hold.code}`);
    }
    await sql`
      UPDATE lesson_requests SET hold_transaction_id = ${hold.transactionId}
      WHERE id = ${request.id} AND school_id = ${schoolId}
    `;

    // 3. Nudge the instructor (awaited — Vercel kills the instance after res).
    await notifyInstructorNewRequest(
      {
        id: request.id,
        instructor_id: Number(instructor_id),
        learner_id: user.id,
        school_id: schoolId,
        scheduled_date: date,
        start_time,
        end_time,
        expires_at: request.expires_at,
      },
      instructor,
      { learnerDisplayName: learner.name || 'A learner' }
    );

    const response = {
      ok: true,
      request_id: request.id,
      expires_at: request.expires_at,
      balance_minutes: hold.balanceMinutes,
      balance_hours: ((hold.balanceMinutes || 0) / 60).toFixed(1),
    };
    if (travelWarnings && travelWarnings.length > 0) response.travel_warnings = travelWarnings;
    return res.status(201).json(response);
  } catch (err) {
    console.error('request-slot error:', err);
    reportError('/api/slots?action=request-slot', err);
    return res.status(500).json({ error: 'Request failed', details: 'Internal server error' });
  }
}

// ── GET /api/slots?action=my-requests ─────────────────────────────────────────
// The authenticated learner's lesson requests (pending first, then recent).
async function handleMyRequests(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`
      SELECT lr.id, lr.scheduled_date::text, lr.start_time::text, lr.end_time::text,
             lr.status, lr.payment_method, lr.credits_minutes, lr.amount_pence,
             lr.decline_reason, lr.expires_at, lr.decided_at, lr.created_at,
             lr.booking_id,
             i.name AS instructor_name,
             lt.name AS lesson_type_name, lt.duration_minutes
      FROM lesson_requests lr
      JOIN instructors i ON i.id = lr.instructor_id AND i.school_id = lr.school_id
      LEFT JOIN lesson_types lt ON lt.id = lr.lesson_type_id
      WHERE lr.learner_id = ${user.id}
        AND lr.school_id = ${schoolId}
        AND lr.created_at > NOW() - INTERVAL '90 days'
      ORDER BY (lr.status = 'pending') DESC, lr.scheduled_date DESC, lr.start_time DESC
      LIMIT 100
    `;
    return res.json({ ok: true, requests: rows });
  } catch (err) {
    console.error('my-requests error:', err);
    reportError('/api/slots?action=my-requests', err);
    return res.status(500).json({ error: 'Failed to load requests', details: 'Internal server error' });
  }
}

// ── POST /api/slots?action=withdraw-request ───────────────────────────────────
// Learner cancels their own pending request. Releases the hold in full.
async function handleWithdrawRequest(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  const requestId = parseInt(req.body?.request_id, 10);
  if (!Number.isInteger(requestId) || requestId <= 0)
    return res.status(400).json({ error: 'request_id is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Atomic claim — races with accept/decline/expiry lose cleanly.
    const [claimed] = await sql`
      UPDATE lesson_requests
         SET status = 'withdrawn', decided_at = NOW()
       WHERE id = ${requestId}
         AND school_id = ${schoolId}
         AND learner_id = ${user.id}
         AND status = 'pending'
       RETURNING *
    `;
    if (!claimed) {
      return res.status(409).json({
        error: true,
        code: 'REQUEST_NOT_PENDING',
        message: 'This request has already been answered or has expired.'
      });
    }

    const release = await releaseRequestHold(sql, claimed);

    // Let the instructor know the slot is free again (best effort).
    try {
      const [instr] = await sql`
        SELECT name, phone FROM instructors WHERE id = ${claimed.instructor_id} AND school_id = ${schoolId}
      `;
      if (instr?.phone) {
        await sendWhatsApp(
          instr.phone,
          `Lesson request withdrawn: ${formatSlotDisplay(claimed)} is available again.`,
          { purpose: 'lesson_request.withdrawn_instructor', learnerId: user.id, instructorId: claimed.instructor_id, schoolId }
        );
      }
    } catch (notifyErr) {
      console.error('withdraw-request instructor notify failed:', notifyErr.message);
    }

    const withContact = await withLearnerContact(sql, claimed);
    await notifyLearnerRequestClosed(withContact, 'withdrawn');

    return res.json({ ok: true, released: release.ok });
  } catch (err) {
    console.error('withdraw-request error:', err);
    reportError('/api/slots?action=withdraw-request', err);
    return res.status(500).json({ error: 'Withdraw failed', details: 'Internal server error' });
  }
}

// ── POST /api/slots?action=checkout-request ───────────────────────────────────
// Card-funded lesson request for a request-to-book instructor
// (LESSON-REQUEST-PLAN.md). Creates a Stripe Checkout session with
// capture_method='manual' — the card is AUTHORIZED at checkout but only
// charged if the instructor accepts. The webhook (payment_type
// 'lesson_request_hold') creates the pending lesson_requests row.
//
// Works for both logged-in learners and guests. Guests supply
// { guest_name, guest_email, guest_phone } and get a learner_users row
// created up-front, mirroring checkout-slot-guest.
async function handleCheckoutRequest(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  const { instructor_id, date, start_time, end_time, lesson_type_id, pickup_address, transmission_type,
          guest_name, guest_email, guest_phone } = req.body;

  if (!instructor_id || !date || !start_time || !end_time)
    return res.status(400).json({ error: 'instructor_id, date, start_time and end_time are required' });
  const requestedTransmissionType = parseRequestTransmissionType(transmission_type);
  if (transmission_type && !requestedTransmissionType)
    return res.status(400).json({ error: 'transmission_type must be manual, automatic, or both' });

  const isGuest = !user;
  let cleanGuestName = null, cleanGuestEmail = null, cleanGuestPhone = null;
  if (isGuest) {
    // A signed-in learner whose cookie has expired sends no guest fields at
    // all (the page hides them when it believes a session exists). Return
    // 401 so fetchAuthed shows its session-expired prompt instead of a
    // baffling "enter your name" error with no name field on screen.
    if (guest_name === undefined && guest_email === undefined && guest_phone === undefined)
      return res.status(401).json({ error: true, code: 'SESSION_EXPIRED', message: 'Your session has expired — please sign in again to request this slot.' });
    cleanGuestName = String(guest_name || '').trim();
    cleanGuestEmail = String(guest_email || '').trim().toLowerCase();
    cleanGuestPhone = String(guest_phone || '').replace(/\s+/g, '').trim();
    if (!cleanGuestName || cleanGuestName.length < 2)
      return res.status(400).json({ error: 'Please enter your name' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanGuestEmail))
      return res.status(400).json({ error: 'Please enter a valid email address' });
    if (!/^(?:07\d{9}|\+447\d{9})$/.test(cleanGuestPhone))
      return res.status(400).json({ error: 'Please enter a valid UK mobile number' });
  }

  const bookingDate = parseDate(date);
  if (!bookingDate)
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  const today = startOfDay(new Date());
  if (bookingDate < today)
    return res.status(400).json({ error: 'Cannot request a slot in the past' });
  if (bookingDate > addDays(today, MAX_DAYS_AHEAD))
    return res.status(400).json({ error: `Cannot request a lesson more than ${MAX_DAYS_AHEAD} days in advance` });

  const requestExpiresAt = computeRequestExpiresAt(date, start_time);
  if (!requestExpiresAt) {
    return res.status(400).json({
      error: true,
      code: 'REQUEST_TOO_LATE',
      message: 'This slot starts too soon to request — the instructor needs time to confirm. Please pick a later slot.'
    });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const schoolId = user?.school_id
      || (isGuest ? (await resolveSchoolFromRequest(req, { sql })).schoolId : 1)
      || 1;

    // ── Guest rate limiting (security rule 3): same limits as guest checkout ──
    if (isGuest) {
      const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
      const ipKey = `guest_checkout_ip:${ip}`;
      const phoneKey = `guest_checkout_phone:${cleanGuestPhone}`;
      try {
        await sql`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour'`;
        const [ipLimit] = await sql`SELECT request_count FROM rate_limits WHERE key = ${ipKey} AND window_start > NOW() - INTERVAL '1 hour'`;
        if (ipLimit && ipLimit.request_count >= 10)
          return res.status(429).json({ error: 'Too many booking attempts. Please try again later.' });
        const [phoneLimit] = await sql`SELECT request_count FROM rate_limits WHERE key = ${phoneKey} AND window_start > NOW() - INTERVAL '1 hour'`;
        if (phoneLimit && phoneLimit.request_count >= 5)
          return res.status(429).json({ error: 'Too many booking attempts for this phone number. Please try again later.' });
        for (const key of [ipKey, phoneKey]) {
          const [ex] = await sql`SELECT request_count FROM rate_limits WHERE key = ${key} AND window_start > NOW() - INTERVAL '1 hour'`;
          if (ex) {
            await sql`UPDATE rate_limits SET request_count = request_count + 1 WHERE key = ${key} AND window_start > NOW() - INTERVAL '1 hour'`;
          } else {
            await sql`INSERT INTO rate_limits (key, request_count, window_start) VALUES (${key}, 1, NOW())`;
          }
        }
      } catch (e) { /* rate limit check failed — allow request through */ }
    }

    const lessonType = await getLessonType(sql, lesson_type_id, schoolId);
    if (!lessonType) return res.status(404).json({ error: 'Lesson type not found or inactive' });
    if (isFreeTrialLessonType(lessonType)) return rejectFreeTrialOnPaidPath(res);
    const durationMins = lessonType.duration_minutes;
    const startMins = timeToMinutes(start_time);
    const endMins = timeToMinutes(end_time);
    if (endMins - startMins !== durationMins)
      return res.status(400).json({ error: `Slot must be exactly ${formatHours(durationMins)} for ${lessonType.name}` });

    const [instructor] = await sql`
      SELECT id, name, email, phone, max_travel_minutes, offered_lesson_types,
             COALESCE(request_to_book, false) AS request_to_book,
             COALESCE(max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
             COALESCE(transmission_type, 'manual') AS transmission_type
      FROM instructors
      WHERE id = ${instructor_id} AND active = true AND school_id = ${schoolId}
    `;
    if (!instructor)
      return res.status(404).json({ error: 'Instructor not found or unavailable' });
    if (!instructor.request_to_book) {
      return res.status(400).json({
        error: true,
        code: 'REQUEST_NOT_ENABLED',
        message: 'This instructor takes instant bookings — book the slot instead.'
      });
    }
    if (!isLessonTypeOffered(instructor.offered_lesson_types, lessonType.slug)) {
      return rejectLessonTypeNotOffered(res);
    }
    if (!isDateWithinBookingWindow(bookingDate, instructor.max_booking_days_ahead)) {
      return res.status(400).json({ error: advanceWindowError(instructor.max_booking_days_ahead, 'request') });
    }

    const fitsAvailability = await slotFitsActiveAvailability(sql, {
      instructorId: instructor_id,
      schoolId,
      date,
      startTime: start_time,
      endTime: end_time,
      transmissionType: requestedTransmissionType
    });
    if (!fitsAvailability)
      return res.status(409).json({ error: true, code: 'SLOTS_UNAVAILABLE', message: 'That slot is no longer available' });

    // Resolve the learner: logged-in id, existing account by guest email, or
    // a fresh account (mirrors checkout-slot-guest).
    let learnerId, learnerRecord = null;
    if (!isGuest) {
      const [learner] = await sql`
        SELECT id, name, email, phone, pickup_address FROM learner_users
        WHERE id = ${user.id} AND school_id = ${schoolId}
      `;
      if (!learner) return res.status(404).json({ error: 'Learner account not found' });
      learnerId = learner.id;
      learnerRecord = learner;
    } else {
      const [existing] = await sql`
        SELECT id, name, email, phone, pickup_address FROM learner_users
        WHERE LOWER(email) = ${cleanGuestEmail} AND school_id = ${schoolId}
      `;
      if (existing) {
        learnerId = existing.id;
        learnerRecord = existing;
      } else {
        try {
          const [newLearner] = await sql`
            INSERT INTO learner_users (name, email, phone, pickup_address, balance_minutes, credit_balance, school_id)
            VALUES (${cleanGuestName}, ${cleanGuestEmail}, ${cleanGuestPhone}, ${pickup_address || null}, 0, 0, ${schoolId})
            RETURNING id, name, email, phone, pickup_address
          `;
          learnerId = newLearner.id;
          learnerRecord = newLearner;
        } catch (insertErr) {
          if (insertErr.message?.includes('learner_users_phone_key') || insertErr.message?.includes('unique')) {
            const [newLearner] = await sql`
              INSERT INTO learner_users (name, email, pickup_address, balance_minutes, credit_balance, school_id)
              VALUES (${cleanGuestName}, ${cleanGuestEmail}, ${pickup_address || null}, 0, 0, ${schoolId})
              RETURNING id, name, email, phone, pickup_address
            `;
            learnerId = newLearner.id;
            learnerRecord = newLearner;
          } else {
            throw insertErr;
          }
        }
      }
    }

    const requestPickupAddr = (pickup_address && String(pickup_address).trim()) || learnerRecord.pickup_address || null;
    if (requestPickupAddr) {
      if (await rejectIfPickupTravelConflict(res, sql, {
        instructorId: instructor_id,
        schoolId,
        date,
        startTime: start_time,
        endTime: end_time,
        pickupAddress: requestPickupAddr,
      })) return;
    }

    // Clear stale holds, then clash-check everything.
    await lazyExpireSlotRequests(sql, { instructorId: instructor_id, schoolId, date, startTime: start_time });
    await sql`
      DELETE FROM slot_reservations
      WHERE instructor_id = ${instructor_id}
        AND scheduled_date = ${date}
        AND start_time = ${start_time}::time
        AND expires_at <= NOW()
    `;
    const clashChecks = await slotClashConflicts(sql, {
      instructorId: instructor_id,
      schoolId,
      dates: [date],
      startTime: start_time,
      endTime: end_time,
    });
    if (clashChecks.length > 0)
      return res.status(409).json({ error: true, code: 'SLOTS_UNAVAILABLE', message: 'That slot is no longer available' });

    const bookingTransmissionType = concreteLessonTransmissionType(requestedTransmissionType, instructor.transmission_type);
    const directPrice = await calcDirectLessonPrice(sql, {
      schoolId,
      instructorId: instructor_id,
      learnerId,
      durationMinutes: durationMins
    });
    const pricePence = directPrice.pricePence;

    const origin = req.headers.origin || 'https://coachcarter.uk';
    const lessonDate = new Date(date + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const emailForStripe = learnerRecord.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(learnerRecord.email).trim())
      ? learnerRecord.email : (cleanGuestEmail || null);

    const requestPaymentMetadata = {
      payment_type: 'lesson_request_hold',
      learner_id: String(learnerId),
      learner_email: emailForStripe || '',
      instructor_id: String(instructor_id),
      instructor_name: instructor.name,
      scheduled_date: date,
      start_time,
      end_time,
      transmission_type: bookingTransmissionType,
      pickup_address: requestPickupAddr || '',
      lesson_type_id: String(lessonType.id),
      duration_minutes: String(durationMins),
      amount_pence: String(pricePence),
      school_id: String(schoolId),
      guest_name: cleanGuestName || '',
      guest_email: cleanGuestEmail || '',
      guest_phone: cleanGuestPhone || '',
    };
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Manual capture: authorize now, charge only if the instructor accepts.
      // Cards only — most redirect payment methods don't support auth holds.
      payment_method_types: ['card'],
      payment_intent_data: {
        capture_method: 'manual',
        metadata: requestPaymentMetadata,
      },
      line_items: [{
        price_data: {
          currency: 'gbp',
          unit_amount: pricePence,
          product_data: {
            name: `Lesson request — ${lessonType.name}, ${lessonDate} ${start_time}–${end_time}`,
            description: `Request with ${instructor.name}. Your card is only charged if they accept.`
          }
        },
        quantity: 1
      }],
      metadata: requestPaymentMetadata,
      ...(emailForStripe ? { customer_email: emailForStripe } : {}),
      billing_address_collection: 'required',
      success_url: `${origin}/learner/book.html?requested=1`,
      cancel_url:  `${origin}/learner/book.html?cancelled=1`
    });

    // Hold the slot while they authorize the card (same reservation flow as
    // checkout-slot; the webhook converts it to a pending request).
    const insertedRows = await sql`
      INSERT INTO slot_reservations
        (learner_id, instructor_id, scheduled_date, start_time, end_time, stripe_session_id, expires_at, school_id)
      VALUES
        (${learnerId}, ${instructor_id}, ${date}, ${start_time}, ${end_time}, ${session.id},
         NOW() + INTERVAL '10 minutes', ${schoolId})
      ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING
      RETURNING id
    `;
    if (insertedRows.length === 0) {
      stripe.checkout.sessions.expire(session.id).catch((expireErr) => {
        console.warn('Failed to expire orphan request Stripe session', session.id, expireErr.message);
      });
      return res.status(409).json({ error: 'Someone else just took that slot.' });
    }

    return res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('checkout-request error:', err);
    reportError('/api/slots?action=checkout-request', err);
    return res.status(500).json({ error: 'Failed to start the request', details: 'Internal server error' });
  }
}

// ── POST /api/slots?action=checkout-slot ──────────────────────────────────────
// Body: { instructor_id, date, start_time, end_time, lesson_type_id? }
// Creates a Stripe Checkout session for a single lesson at the lesson type's price.
// Reserves the slot for 10 minutes while the learner pays.
// The webhook will book the slot and add+deduct hours on payment completion.
async function handleCheckoutSlot(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  const {
    instructor_id,
    date,
    start_time,
    end_time,
    lesson_type_id,
    pickup_address,
    dropoff_address,
    transmission_type,
    social_video_consent,
    social_video_age_confirmed,
  } = req.body;
  if (!instructor_id || !date || !start_time || !end_time)
    return res.status(400).json({ error: 'instructor_id, date, start_time, end_time required' });
  const requestedTransmissionType = parseRequestTransmissionType(transmission_type);
  if (transmission_type && !requestedTransmissionType) {
    return res.status(400).json({ error: 'transmission_type must be manual, automatic, or both' });
  }

  // Reject same-day bookings where the slot has already started
  const startMins    = timeToMinutes(start_time);
  const endMins      = timeToMinutes(end_time);
  const checkoutDate = parseDate(date);
  const todayStart   = startOfDay(new Date());
  if (!checkoutDate)
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  if (checkoutDate && checkoutDate.getTime() === todayStart.getTime()) {
    const now = new Date();
    const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (startMins <= nowMins)
      return res.status(400).json({ error: 'This slot has already started. Please choose a later time.' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // 0. Look up lesson type for pricing
    const lessonType = await getLessonType(sql, lesson_type_id, schoolId);
    if (!lessonType) return res.status(404).json({ error: 'Lesson type not found or inactive' });
    if (isFreeTrialLessonType(lessonType)) return rejectFreeTrialOnPaidPath(res);
    const durationMins = lessonType.duration_minutes;
    const directPrice  = await calcDirectLessonPrice(sql, {
      schoolId,
      instructorId: instructor_id,
      learnerId: user.id,
      durationMinutes: durationMins
    });
    const durationStr  = formatHours(durationMins);

    // Validate slot duration matches lesson type
    if (endMins - startMins !== durationMins)
      return res.status(400).json({ error: `Slot must be exactly ${durationStr} for ${lessonType.name}` });

    // Clean up any expired reservations
    await sql`DELETE FROM slot_reservations WHERE expires_at < NOW()`;

    // Check slot isn't already booked
    const [existingBooking] = await sql`
      SELECT id FROM lesson_bookings
      WHERE instructor_id = ${instructor_id}
        AND scheduled_date = ${date}
        AND start_time = ${start_time}::time
        AND status = ${SCHEDULED}
        AND COALESCE(school_id, 1) = ${schoolId}
    `;
    if (existingBooking)
      return res.status(409).json({ error: 'Sorry, that slot is already booked.' });

    // Check slot isn't already reserved by someone else
    const [existingReservation] = await sql`
      SELECT id FROM slot_reservations
      WHERE instructor_id = ${instructor_id}
        AND scheduled_date = ${date}
        AND start_time = ${start_time}::time
        AND expires_at > NOW()
        AND learner_id != ${user.id}
        AND COALESCE(school_id, 1) = ${schoolId}
    `;
    if (existingReservation)
      return res.status(409).json({ error: 'Someone else is currently booking this slot. Try another or wait a few minutes.' });

    // Check slot isn't held by a pending lesson offer
    try {
      const [existingOffer] = await sql`
        SELECT id FROM lesson_offers
        WHERE instructor_id = ${instructor_id}
          AND scheduled_date = ${date}
          AND start_time = ${start_time}::time
          AND status = 'pending'
          AND expires_at > NOW()
          AND COALESCE(school_id, 1) = ${schoolId}
      `;
      if (existingOffer)
        return res.status(409).json({ error: 'This slot is currently held for a pending lesson offer.' });
    } catch (e) { /* table may not exist yet */ }

    // Check slot isn't held by a pending lesson request
    try {
      const [existingRequest] = await sql`
        SELECT id FROM lesson_requests
        WHERE instructor_id = ${instructor_id}
          AND scheduled_date = ${date}
          AND start_time = ${start_time}::time
          AND status = 'pending'
          AND expires_at > NOW()
          AND school_id = ${schoolId}
      `;
      if (existingRequest)
        return res.status(409).json({ error: 'Someone has already requested this slot and the instructor is deciding. Try another slot.' });
    } catch (e) { /* table may not exist yet */ }

    // Check instructor is valid (and belongs to this school)
    const [instructor] = await sql`
      SELECT id, name, offered_lesson_types,
             COALESCE(social_video_opt_in, false) AS social_video_opt_in,
             COALESCE(max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
             COALESCE(transmission_type, 'manual') AS transmission_type
      FROM instructors
      WHERE id = ${instructor_id}
        AND active = true
        AND COALESCE(school_id, 1) = ${schoolId}
    `;
    if (!instructor)
      return res.status(404).json({ error: 'Instructor not found' });
    const socialVideo = resolveSocialVideoSelection({
      requested: social_video_consent,
      ageConfirmed: social_video_age_confirmed,
      instructor,
    });
    if (socialVideo.rejected) {
      return res.status(400).json({ error: 'This instructor is not offering social media filming discounts.' });
    }
    if (socialVideo.ageRejected) {
      return res.status(400).json({ error: 'Social media filming consent is only available when the learner confirms they are 18 or over.' });
    }
    const priced = applySocialVideoDiscount(directPrice.pricePence, socialVideo.selected);
    const pricePence = priced.pricePence;
    // The 5% filming discount applies to the Stripe amount only. Preserve the
    // full lesson duration in charge_minutes so a later cancellation returns
    // the complete lesson entitlement.
    const chargeMins = durationMins;
    if (!isLessonTypeOffered(instructor.offered_lesson_types, lessonType.slug)) {
      return rejectLessonTypeNotOffered(res);
    }
    if (!isDateWithinBookingWindow(checkoutDate, instructor.max_booking_days_ahead)) {
      return res.status(400).json({ error: advanceWindowError(instructor.max_booking_days_ahead) });
    }
    const stillAvailable = await slotFitsActiveAvailability(sql, {
      instructorId: instructor_id,
      schoolId,
      date,
      startTime: start_time,
      endTime: end_time,
      transmissionType: requestedTransmissionType
    });
    if (!stillAvailable) {
      return res.status(409).json({ error: 'This slot is no longer available. Please choose another time.' });
    }
    const bookingTransmissionType = concreteLessonTransmissionType(requestedTransmissionType, instructor.transmission_type);

    // Get learner email
    const [learner] = await sql`SELECT email, pickup_address FROM learner_users WHERE id = ${user.id} AND school_id = ${schoolId}`;
    if (!learner)
      return res.status(404).json({ error: 'Learner not found' });
    const checkoutPickupAddress = (pickup_address && String(pickup_address).trim()) || learner.pickup_address || '';
    const checkoutDropoffAddress = dropoff_address && String(dropoff_address).trim() ? String(dropoff_address).trim() : '';

    if (checkoutPickupAddress) {
      if (await rejectIfPickupTravelConflict(res, sql, {
        instructorId: instructor_id,
        schoolId,
        date,
        startTime: start_time,
        endTime: end_time,
        pickupAddress: checkoutPickupAddress,
      })) return;
    }

    // SMS-only learners can have no email. Only pre-fill Stripe's
    // customer_email when we have a valid value — otherwise Stripe collects
    // it at checkout. The webhook already falls back to session.customer_email.
    const emailValid = learner.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(learner.email).trim());

    // Create Stripe Checkout session
    const origin = req.headers.origin || 'https://coachcarter.uk';
    const lessonDate = new Date(date + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'gbp',
          unit_amount: pricePence,
          product_data: {
            name: `${lessonType.name} — ${lessonDate} ${start_time}–${end_time}`,
            description: `${durationStr} lesson with ${instructor.name}. Slot held for ${RESERVATION_MINUTES} minutes.`
          }
        },
        quantity: 1
      }],
      metadata: {
        payment_type:    'slot_booking',
        learner_id:      String(user.id),
        learner_email:   emailValid ? learner.email : '',
        instructor_id:   String(instructor_id),
        instructor_name: instructor.name,
        scheduled_date:  date,
        start_time,
        end_time,
        transmission_type: bookingTransmissionType,
        pickup_address:  checkoutPickupAddress,
        dropoff_address: checkoutDropoffAddress,
        lesson_type_id:  String(lessonType.id),
        duration_minutes: String(durationMins),
        charge_minutes:   String(chargeMins),
        amount_pence:    String(pricePence),
        school_id:       String(schoolId),
        social_video_consent: socialVideo.selected ? 'true' : 'false',
        social_video_age_confirmed: socialVideo.ageConfirmed ? 'true' : 'false',
        social_video_discount_pct: String(socialVideo.discountPct),
        social_video_discount_pence: String(priced.discountPence),
        // Step 4 / Phase 2A: derivable from pricePence/durationMins per the
        // source-of-truth rule, snapshotted for audit clarity.
        effective_rate_pence_per_minute: String(chargeMins > 0 ? Math.round(pricePence / chargeMins) : 0)
      },
      ...(emailValid ? { customer_email: learner.email } : {}),
      excluded_payment_method_types: CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES,
      billing_address_collection: 'required',
      allow_promotion_codes: true,
      success_url: `${origin}/learner/book.html?paid=1`,
      cancel_url:  `${origin}/learner/book.html?cancelled=1`
    });

    // Reserve the slot. uq_slot_reservation_slot enforces one active
    // reservation per (instructor, date, start_time) — the DELETE-expired
    // pass at the top of this handler clears stale rows so a fresh INSERT
    // only ever races a still-live one. ON CONFLICT returns NULL inserted
    // rows; we then inspect who currently holds the slot.
    const insertedRows = await sql`
      INSERT INTO slot_reservations
        (learner_id, instructor_id, scheduled_date, start_time, end_time, stripe_session_id, expires_at, school_id)
      VALUES
        (${user.id}, ${instructor_id}, ${date}, ${start_time}, ${end_time}, ${session.id},
         NOW() + INTERVAL '10 minutes', ${schoolId})
      ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING
      RETURNING id
    `;

    if (insertedRows.length === 0) {
      // Lost the race against a parallel checkout. Expire the orphan Stripe
      // session so the learner isn't sitting on a payment page for a slot
      // they can never book. Fire-and-forget — if Stripe is down the
      // session expires on its own 24h later.
      stripe.checkout.sessions.expire(session.id).catch((expireErr) => {
        console.warn('Failed to expire orphan Stripe session', session.id, expireErr.message);
      });

      // Distinguish "same learner retried" from "different learner won
      // the race" so the user-facing error makes sense. A retry is
      // unusual — the DELETE-expired pass + the existingReservation
      // check should normally catch it — but it can happen on a fast
      // double-click after the previous session was abandoned.
      const [holder] = await sql`
        SELECT learner_id FROM slot_reservations
        WHERE instructor_id = ${instructor_id}
          AND scheduled_date = ${date}
          AND start_time = ${start_time}::time
      `;
      if (holder?.learner_id === user.id) {
        return res.status(409).json({ error: 'You already have a checkout in progress for this slot. Wait a moment and try again.' });
      }
      return res.status(409).json({ error: 'Someone else just took that slot.' });
    }

    return res.json({ url: session.url });
  } catch (err) {
    console.error('checkout-slot error:', err);
    reportError('/api/slots', err);
    return res.status(500).json({ error: 'Failed to create checkout', details: 'Internal server error' });
  }
}

// ── POST /api/slots?action=checkout-slot-guest ────────────────────────────────
// Guest checkout: no auth required. Creates learner account, reserves slot, returns Stripe URL.
// Body: { instructor_id, date, start_time, end_time, lesson_type_id?, guest_name, guest_email, guest_phone, guest_pickup_address, dropoff_address? }
async function handleCheckoutSlotGuest(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { instructor_id, date, start_time, end_time, lesson_type_id,
          guest_name, guest_email, guest_phone, guest_pickup_address, dropoff_address, transmission_type,
          social_video_consent, social_video_age_confirmed } = req.body;

  // Validate required guest fields
  if (!guest_name || !guest_name.trim())
    return res.status(400).json({ error: 'Name is required' });
  if (!guest_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest_email.trim()))
    return res.status(400).json({ error: 'A valid email address is required' });
  if (!guest_phone || !/^(?:07\d{9}|\+447\d{9})$/.test(guest_phone.replace(/\s+/g, '')))
    return res.status(400).json({ error: 'A valid UK phone number is required (07xxx xxx xxx)' });
  if (!guest_pickup_address || !guest_pickup_address.trim())
    return res.status(400).json({ error: 'Pickup address is required' });
  if (!instructor_id || !date || !start_time || !end_time)
    return res.status(400).json({ error: 'instructor_id, date, start_time, end_time required' });

  const cleanEmail = guest_email.toLowerCase().trim();
  const cleanPhone = guest_phone.replace(/\s+/g, '').trim();
  const cleanName  = guest_name.trim();
  const cleanAddr  = guest_pickup_address.trim();
  const cleanDropoff = dropoff_address && String(dropoff_address).trim() ? String(dropoff_address).trim() : '';
  const schoolId   = parseInt(req.body.school_id, 10) || 1;
  const requestedTransmissionType = parseRequestTransmissionType(transmission_type);
  if (transmission_type && !requestedTransmissionType) {
    return res.status(400).json({ error: 'transmission_type must be manual, automatic, or both' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // ── Rate limiting: 10 per IP per hour, 5 per phone per hour ──
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const ipKey = `guest_checkout_ip:${ip}`;
    const phoneKey = `guest_checkout_phone:${cleanPhone}`;
    try {
      await sql`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour'`;
      const [ipLimit] = await sql`SELECT request_count FROM rate_limits WHERE key = ${ipKey} AND window_start > NOW() - INTERVAL '1 hour'`;
      if (ipLimit && ipLimit.request_count >= 10)
        return res.status(429).json({ error: 'Too many booking attempts. Please try again later.' });
      const [phoneLimit] = await sql`SELECT request_count FROM rate_limits WHERE key = ${phoneKey} AND window_start > NOW() - INTERVAL '1 hour'`;
      if (phoneLimit && phoneLimit.request_count >= 5)
        return res.status(429).json({ error: 'Too many booking attempts for this phone number. Please try again later.' });
      // Increment counters
      for (const key of [ipKey, phoneKey]) {
        const [ex] = await sql`SELECT request_count FROM rate_limits WHERE key = ${key} AND window_start > NOW() - INTERVAL '1 hour'`;
        if (ex) {
          await sql`UPDATE rate_limits SET request_count = request_count + 1 WHERE key = ${key} AND window_start > NOW() - INTERVAL '1 hour'`;
        } else {
          await sql`INSERT INTO rate_limits (key, request_count, window_start) VALUES (${key}, 1, NOW())`;
        }
      }
    } catch (e) { /* rate limit check failed — allow request through */ }

    // ── Slot validation (same as authenticated flow) ──
    const startMins = timeToMinutes(start_time);
    const endMins   = timeToMinutes(end_time);
    const checkoutDate = parseDate(date);
    const todayStart   = startOfDay(new Date());
    if (!checkoutDate)
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    if (checkoutDate && checkoutDate.getTime() === todayStart.getTime()) {
      const now = new Date();
      const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
      if (startMins <= nowMins)
        return res.status(400).json({ error: 'This slot has already started. Please choose a later time.' });
    }

    const lessonType = await getLessonType(sql, lesson_type_id, schoolId);
    if (!lessonType) return res.status(404).json({ error: 'Lesson type not found or inactive' });
    if (isFreeTrialLessonType(lessonType)) return rejectFreeTrialOnPaidPath(res);
    const durationMins = lessonType.duration_minutes;
    const durationStr  = formatHours(durationMins);

    if (endMins - startMins !== durationMins)
      return res.status(400).json({ error: `Slot must be exactly ${durationStr} for ${lessonType.name}` });

    await sql`DELETE FROM slot_reservations WHERE expires_at < NOW()`;

    const [existingBooking] = await sql`
      SELECT id FROM lesson_bookings
      WHERE instructor_id = ${instructor_id}
        AND scheduled_date = ${date}
        AND start_time = ${start_time}::time
        AND status = ${SCHEDULED}
        AND COALESCE(school_id, 1) = ${schoolId}
    `;
    if (existingBooking)
      return res.status(409).json({ error: 'Sorry, that slot is already booked.' });

    const [existingReservation] = await sql`
      SELECT id FROM slot_reservations
      WHERE instructor_id = ${instructor_id}
        AND scheduled_date = ${date}
        AND start_time = ${start_time}::time
        AND expires_at > NOW()
        AND COALESCE(school_id, 1) = ${schoolId}
    `;
    if (existingReservation)
      return res.status(409).json({ error: 'Someone else is currently booking this slot. Try another or wait a few minutes.' });

    try {
      const [existingOffer] = await sql`
        SELECT id FROM lesson_offers
        WHERE instructor_id = ${instructor_id}
          AND scheduled_date = ${date}
          AND start_time = ${start_time}::time
          AND status = 'pending'
          AND expires_at > NOW()
          AND COALESCE(school_id, 1) = ${schoolId}
      `;
      if (existingOffer)
        return res.status(409).json({ error: 'This slot is currently held for a pending lesson offer.' });
    } catch (e) { /* table may not exist yet */ }

    // Check slot isn't held by a pending lesson request
    try {
      const [existingRequest] = await sql`
        SELECT id FROM lesson_requests
        WHERE instructor_id = ${instructor_id}
          AND scheduled_date = ${date}
          AND start_time = ${start_time}::time
          AND status = 'pending'
          AND expires_at > NOW()
          AND school_id = ${schoolId}
      `;
      if (existingRequest)
        return res.status(409).json({ error: 'Someone has already requested this slot and the instructor is deciding. Try another slot.' });
    } catch (e) { /* table may not exist yet */ }

    const [instructor] = await sql`
      SELECT id, name, offered_lesson_types,
             COALESCE(social_video_opt_in, false) AS social_video_opt_in,
             COALESCE(max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
             COALESCE(transmission_type, 'manual') AS transmission_type
      FROM instructors
      WHERE id = ${instructor_id}
        AND active = true
        AND COALESCE(school_id, 1) = ${schoolId}
    `;
    if (!instructor)
      return res.status(404).json({ error: 'Instructor not found' });
    const socialVideo = resolveSocialVideoSelection({
      requested: social_video_consent,
      ageConfirmed: social_video_age_confirmed,
      instructor,
    });
    if (socialVideo.rejected) {
      return res.status(400).json({ error: 'This instructor is not offering social media filming discounts.' });
    }
    if (socialVideo.ageRejected) {
      return res.status(400).json({ error: 'Social media filming consent is only available when the learner confirms they are 18 or over.' });
    }
    if (!isLessonTypeOffered(instructor.offered_lesson_types, lessonType.slug)) {
      return rejectLessonTypeNotOffered(res);
    }
    if (!isDateWithinBookingWindow(checkoutDate, instructor.max_booking_days_ahead)) {
      return res.status(400).json({ error: advanceWindowError(instructor.max_booking_days_ahead) });
    }

    // ── Find or create learner ──
    const stillAvailable = await slotFitsActiveAvailability(sql, {
      instructorId: instructor_id,
      schoolId,
      date,
      startTime: start_time,
      endTime: end_time,
      transmissionType: requestedTransmissionType
    });
    if (!stillAvailable) {
      return res.status(409).json({ error: 'This slot is no longer available. Please choose another time.' });
    }
    const bookingTransmissionType = concreteLessonTransmissionType(requestedTransmissionType, instructor.transmission_type);
    if (await rejectIfPickupTravelConflict(res, sql, {
      instructorId: instructor_id,
      schoolId,
      date,
      startTime: start_time,
      endTime: end_time,
      pickupAddress: cleanAddr,
    })) return;

    let learnerId;
    const [existingLearner] = await sql`
      SELECT id, name, phone, pickup_address FROM learner_users
      WHERE LOWER(email) = ${cleanEmail} AND school_id = ${schoolId}
    `;

    if (existingLearner) {
      learnerId = existingLearner.id;
      // Backfill empty fields only — never overwrite existing data
      const needsUpdate = (!existingLearner.name && cleanName) ||
                          (!existingLearner.phone && cleanPhone) ||
                          (!existingLearner.pickup_address && cleanAddr);
      if (needsUpdate) {
        await sql`
          UPDATE learner_users SET
            name = COALESCE(NULLIF(name, ''), ${cleanName}),
            phone = COALESCE(phone, ${cleanPhone}),
            pickup_address = COALESCE(NULLIF(pickup_address, ''), ${cleanAddr}),
            last_activity_at = NOW()
          WHERE id = ${learnerId}
        `;
      }
    } else {
      try {
        const [newLearner] = await sql`
          INSERT INTO learner_users (name, email, phone, pickup_address, balance_minutes, credit_balance, school_id)
          VALUES (${cleanName}, ${cleanEmail}, ${cleanPhone}, ${cleanAddr}, 0, 0, ${schoolId})
          RETURNING id
        `;
        learnerId = newLearner.id;
      } catch (insertErr) {
        if (insertErr.message?.includes('learner_users_phone_key') || insertErr.message?.includes('unique')) {
          // Phone already in use by another account — retry without phone
          console.warn('⚠️ Guest checkout: phone conflict, retrying without phone');
          const [newLearner] = await sql`
            INSERT INTO learner_users (name, email, pickup_address, balance_minutes, credit_balance, school_id)
            VALUES (${cleanName}, ${cleanEmail}, ${cleanAddr}, 0, 0, ${schoolId})
            RETURNING id
          `;
          learnerId = newLearner.id;
        } else {
          throw insertErr;
        }
      }
    }

    const directPrice = await calcDirectLessonPrice(sql, {
      schoolId,
      instructorId: instructor_id,
      learnerId,
      durationMinutes: durationMins
    });
    const priced = applySocialVideoDiscount(directPrice.pricePence, socialVideo.selected);
    const pricePence = priced.pricePence;
    // The 5% filming discount applies to the Stripe amount only. Preserve the
    // full lesson duration in charge_minutes so a later cancellation returns
    // the complete lesson entitlement.
    const chargeMins = durationMins;

    // ── Create Stripe Checkout session ──
    const origin = req.headers.origin || 'https://coachcarter.uk';
    const lessonDate = new Date(date + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'gbp',
          unit_amount: pricePence,
          product_data: {
            name: `${lessonType.name} — ${lessonDate} ${start_time}–${end_time}`,
            description: `${durationStr} lesson with ${instructor.name}. Slot held for ${RESERVATION_MINUTES} minutes.`
          }
        },
        quantity: 1
      }],
      metadata: {
        payment_type:    'slot_booking',
        learner_id:      String(learnerId),
        learner_email:   cleanEmail,
        instructor_id:   String(instructor_id),
        instructor_name: instructor.name,
        scheduled_date:  date,
        start_time,
        end_time,
        transmission_type: bookingTransmissionType,
        pickup_address:  cleanAddr,
        dropoff_address: cleanDropoff,
        lesson_type_id:  String(lessonType.id),
        duration_minutes: String(durationMins),
        charge_minutes:   String(chargeMins),
        amount_pence:    String(pricePence),
        school_id:       String(schoolId),
        social_video_consent: socialVideo.selected ? 'true' : 'false',
        social_video_age_confirmed: socialVideo.ageConfirmed ? 'true' : 'false',
        social_video_discount_pct: String(socialVideo.discountPct),
        social_video_discount_pence: String(priced.discountPence),
        // Step 4 / Phase 2A: snapshot for audit clarity.
        effective_rate_pence_per_minute: String(chargeMins > 0 ? Math.round(pricePence / chargeMins) : 0)
      },
      customer_email: cleanEmail,
      excluded_payment_method_types: CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES,
      billing_address_collection: 'required',
      allow_promotion_codes: true,
      success_url: `${origin}/learner/book.html?paid=1`,
      cancel_url:  `${origin}/learner/book.html?cancelled=1`
    });

    // Reserve the slot — see uq_slot_reservation_slot rationale in the
    // authenticated checkout-slot handler above.
    const insertedRows = await sql`
      INSERT INTO slot_reservations
        (learner_id, instructor_id, scheduled_date, start_time, end_time, stripe_session_id, expires_at, school_id)
      VALUES
        (${learnerId}, ${instructor_id}, ${date}, ${start_time}, ${end_time}, ${session.id},
         NOW() + INTERVAL '10 minutes', ${schoolId})
      ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING
      RETURNING id
    `;

    if (insertedRows.length === 0) {
      stripe.checkout.sessions.expire(session.id).catch((expireErr) => {
        console.warn('Failed to expire orphan Stripe session', session.id, expireErr.message);
      });

      const [holder] = await sql`
        SELECT learner_id FROM slot_reservations
        WHERE instructor_id = ${instructor_id}
          AND scheduled_date = ${date}
          AND start_time = ${start_time}::time
      `;
      if (holder?.learner_id === learnerId) {
        return res.status(409).json({ error: 'You already have a checkout in progress for this slot. Wait a moment and try again.' });
      }
      return res.status(409).json({ error: 'Someone else just took that slot.' });
    }

    return res.json({ url: session.url });
  } catch (err) {
    console.error('checkout-slot-guest error:', err);
    reportError('/api/slots?action=checkout-slot-guest', err);
    return res.status(500).json({ error: 'Failed to create checkout', details: 'Internal server error' });
  }
}

// ── POST /api/slots?action=book-free-trial ────────────────────────────────────
// Self-serve free trial booking. No auth, no payment, no Stripe.
// Body: { instructor_id, date, start_time, end_time, guest_name, guest_email,
//         guest_phone, guest_pickup_address, school_id?, referral_code? }
//
// Flow:
//   1. Validate inputs (same shape as checkout-slot-guest).
//   2. Rate-limit by IP and phone.
//   3. Resolve Free Trial lesson type from DB (slug = 'trial').
//   4. One-trial guard: reject if email or phone has any prior free trial booking
//      (any status — cancelled bookings count, to prevent cancel/rebook abuse).
//   5. Slot conflict check.
//   6. Find or create learner via shared findOrCreateLearner pattern.
//   7. INSERT booking with payment_method='free', minutes_deducted=0.
//   8. Generate magic-link token + send confirmation emails (no session cookie).
//   9. Return redirect_url to /free-trial-success.html.
//
// Future-proofing: REQUIRE_REFERRAL constant lets us flip to referrer-only
// (see DEVELOPMENT-ROADMAP.md). v1 ships open-access.
const REQUIRE_REFERRAL = false;

function isSelfServeFreeTrialBooking(booking) {
  return booking?.created_by === 'free_trial_self_serve'
    && booking?.payment_method === 'free'
    && Number(booking?.minutes_deducted || 0) === 0;
}

async function handleBookFreeTrial(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { instructor_id, date, start_time, end_time,
           guest_name, guest_email, guest_phone, guest_pickup_address,
          referral_code, transmission_type } = req.body;

  if (!guest_name || !guest_name.trim())
    return res.status(400).json({ error: 'Name is required' });
  if (!guest_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest_email.trim()))
    return res.status(400).json({ error: 'A valid email address is required' });
  if (!guest_phone || !/^(?:07\d{9}|\+447\d{9})$/.test(guest_phone.replace(/\s+/g, '')))
    return res.status(400).json({ error: 'A valid UK phone number is required (07xxx xxx xxx)' });
  if (!guest_pickup_address || !guest_pickup_address.trim())
    return res.status(400).json({ error: 'Pickup address is required' });
  if (!instructor_id || !date || !start_time || !end_time)
    return res.status(400).json({ error: 'instructor_id, date, start_time, end_time required' });

  const cleanEmail = guest_email.toLowerCase().trim();
  const cleanPhone = guest_phone.replace(/\s+/g, '').trim();
  const cleanName  = guest_name.trim();
  const cleanAddr  = guest_pickup_address.trim();
  const schoolId   = parseInt(req.body.school_id, 10) || 1;
  const requestedTransmissionType = parseRequestTransmissionType(transmission_type);
  if (transmission_type && !requestedTransmissionType) {
    return res.status(400).json({ error: 'transmission_type must be manual, automatic, or both' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // ── Rate limiting: 10 per IP per hour, 3 per phone per hour ──
    // Tighter than paid checkout (which is 5/phone) — free is more abusable.
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const ipKey = `free_trial_ip:${ip}`;
    const phoneKey = `free_trial_phone:${cleanPhone}`;
    try {
      await sql`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour'`;
      const [ipLimit] = await sql`SELECT request_count FROM rate_limits WHERE key = ${ipKey} AND window_start > NOW() - INTERVAL '1 hour'`;
      if (ipLimit && ipLimit.request_count >= 10)
        return res.status(429).json({ error: 'Too many booking attempts. Please try again later.' });
      const [phoneLimit] = await sql`SELECT request_count FROM rate_limits WHERE key = ${phoneKey} AND window_start > NOW() - INTERVAL '1 hour'`;
      if (phoneLimit && phoneLimit.request_count >= 3)
        return res.status(429).json({ error: 'Too many booking attempts for this phone number. Please try again later.' });
      for (const key of [ipKey, phoneKey]) {
        const [ex] = await sql`SELECT request_count FROM rate_limits WHERE key = ${key} AND window_start > NOW() - INTERVAL '1 hour'`;
        if (ex) {
          await sql`UPDATE rate_limits SET request_count = request_count + 1 WHERE key = ${key} AND window_start > NOW() - INTERVAL '1 hour'`;
        } else {
          await sql`INSERT INTO rate_limits (key, request_count, window_start) VALUES (${key}, 1, NOW())`;
        }
      }
    } catch (e) { /* rate limit check failed — allow request through */ }

    // ── Resolve Free Trial lesson type ──
    const [trialType] = await sql`
      SELECT id, slug, name, duration_minutes
      FROM lesson_types
      WHERE slug = 'trial' AND active = true AND school_id = ${schoolId}
    `;
    if (!trialType)
      return res.status(404).json({ error: 'Free trial is not currently available.' });

    const durationMins = trialType.duration_minutes;

    // ── Slot timing validation ──
    const startMins = timeToMinutes(start_time);
    const endMins   = timeToMinutes(end_time);
    const checkoutDate = parseDate(date);
    const todayStart   = startOfDay(new Date());
    if (!checkoutDate)
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    if (checkoutDate && checkoutDate.getTime() === todayStart.getTime()) {
      const now = new Date();
      const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
      if (startMins <= nowMins)
        return res.status(400).json({ error: 'This slot has already started. Please choose a later time.' });
    }
    if (endMins - startMins !== durationMins)
      return res.status(400).json({ error: `Slot must be exactly ${durationMins} minutes for a free trial.` });

    // ── One-trial guard (C1): block if email or phone has any prior trial ──
    // No status filter — cancelled bookings count too, preventing cancel/rebook loops.
    //
    // Phone match uses both 07xxx and +447xxx variants since learner_users
    // stores either form. guest_phone catches the phone-collision case where
    // the learner row ends up with phone=NULL — the raw submitted phone is
    // always written to lesson_bookings.guest_phone for free-trial bookings.
    let normPhone = cleanPhone;
    if (normPhone.startsWith('07')) normPhone = '+44' + normPhone.slice(1);
    const phoneVariants = [cleanPhone, normPhone];

    const [existingLearner] = await sql`
      SELECT id, name, phone, pickup_address, email, COALESCE(free_trial_allowed, TRUE) AS free_trial_allowed
      FROM learner_users
      WHERE LOWER(email) = ${cleanEmail} AND school_id = ${schoolId}
    `;
    if (existingLearner && !existingLearner.free_trial_allowed) {
      return res.status(403).json({
        error: 'trial_not_allowed',
        message: 'This account is not currently allowed to book a free trial.'
      });
    }

    const [priorTrial] = await sql`
      SELECT lb.id, lb.learner_id FROM lesson_bookings lb
      JOIN learner_users lu ON lu.id = lb.learner_id
      WHERE lb.lesson_type_id = ${trialType.id}
        AND lb.school_id = ${schoolId}
        AND lu.school_id = ${schoolId}
        AND (
          LOWER(lu.email) = ${cleanEmail}
          OR lu.phone = ANY(${phoneVariants})
          OR lb.guest_phone = ANY(${phoneVariants})
        )
      LIMIT 1
    `;
    const learnerTrialOverrideOn = existingLearner
      && existingLearner.free_trial_allowed
      && String(priorTrial?.learner_id || '') === String(existingLearner.id);
    if (priorTrial && !learnerTrialOverrideOn) {
      return res.status(409).json({
        error: 'already_used',
        message: "Looks like you've already booked a free trial. Check your email or log in to manage it."
      });
    }

    // ── Referral lookup (optional in v1; may become required later) ──
    let referrerId = null;
    if (referral_code) {
      const [ref] = await sql`
        SELECT learner_id FROM referrals WHERE code = ${referral_code} AND school_id = ${schoolId}
      `;
      if (ref) referrerId = ref.learner_id;
    }
    if (REQUIRE_REFERRAL && !referrerId) {
      return res.status(403).json({ error: 'Free trial available by referral only.' });
    }

    // ── Slot conflict checks ──
    await sql`DELETE FROM slot_reservations WHERE expires_at < NOW()`;

    const [instructor] = await sql`
      SELECT id, name, email, phone, COALESCE(buffer_minutes, 30) AS buffer_minutes,
             max_travel_minutes, offered_lesson_types,
             COALESCE(max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
             COALESCE(transmission_type, 'manual') AS transmission_type
      FROM instructors
      WHERE id = ${instructor_id} AND active = true AND school_id = ${schoolId}
    `;
    if (!instructor)
      return res.status(404).json({ error: 'Instructor not found' });
    if (!isLessonTypeOffered(instructor.offered_lesson_types, trialType.slug)) {
      return res.status(400).json({ error: 'This instructor does not offer free trials.' });
    }
    if (!isDateWithinBookingWindow(checkoutDate, instructor.max_booking_days_ahead)) {
      return res.status(400).json({ error: advanceWindowError(instructor.max_booking_days_ahead) });
    }

    const stillAvailable = await slotFitsActiveAvailability(sql, {
      instructorId: instructor_id,
      schoolId,
      date,
      startTime: start_time,
      endTime: end_time,
      transmissionType: requestedTransmissionType
    });
    if (!stillAvailable) {
      return res.status(409).json({ error: 'This slot is no longer available. Please choose another time.' });
    }
    const bookingTransmissionType = concreteLessonTransmissionType(requestedTransmissionType, instructor.transmission_type);

    const bufferMinutes = parseInt(instructor.buffer_minutes, 10) || 0;

    const existingBookings = await sql`
      SELECT id, start_time::text AS start_time, end_time::text AS end_time, pickup_address
      FROM lesson_bookings
      WHERE instructor_id = ${instructor_id}
        AND scheduled_date = ${date}
        AND status = ANY(${BLOCKING_STATUSES}::text[])
        AND school_id = ${schoolId}
    `;
    const bookingBlocks = existingBookings.map(b => ({
      id: b.id,
      start: timeToMinutes(b.start_time),
      end: timeToMinutes(b.end_time),
      postcode: b.pickup_address ? extractPostcode(b.pickup_address) : null
    }));
    if (bookingBlocks.some(b => hasBufferedSlotConflict(startMins, endMins, b.start, b.end, bufferMinutes)))
      return res.status(409).json({ error: 'Sorry, that slot is already booked.' });

    const existingReservations = await sql`
      SELECT id, start_time::text AS start_time, end_time::text AS end_time
      FROM slot_reservations
      WHERE instructor_id = ${instructor_id}
        AND scheduled_date = ${date}
        AND expires_at > NOW()
        AND school_id = ${schoolId}
    `;
    if (existingReservations.some(r => hasBufferedSlotConflict(
      startMins,
      endMins,
      timeToMinutes(r.start_time),
      timeToMinutes(r.end_time),
      bufferMinutes
    )))
      return res.status(409).json({ error: 'Someone else is currently booking this slot. Try another or wait a few minutes.' });

    try {
      const existingOffers = await sql`
        SELECT id, start_time::text AS start_time, end_time::text AS end_time
        FROM lesson_offers
        WHERE instructor_id = ${instructor_id}
          AND scheduled_date = ${date}
          AND status = 'pending'
          AND expires_at > NOW()
          AND school_id = ${schoolId}
      `;
      if (existingOffers.some(o => hasBufferedSlotConflict(
        startMins,
        endMins,
        timeToMinutes(o.start_time),
        timeToMinutes(o.end_time),
        bufferMinutes
      )))
        return res.status(409).json({ error: 'This slot is currently held for a pending lesson offer.' });
    } catch (e) { /* table may not exist yet */ }

    try {
      const existingRequests = await sql`
        SELECT id, start_time::text AS start_time, end_time::text AS end_time
        FROM lesson_requests
        WHERE instructor_id = ${instructor_id}
          AND scheduled_date = ${date}
          AND status = 'pending'
          AND expires_at > NOW()
          AND school_id = ${schoolId}
      `;
      if (existingRequests.some(r => hasBufferedSlotConflict(
        startMins,
        endMins,
        timeToMinutes(r.start_time),
        timeToMinutes(r.end_time),
        bufferMinutes
      )))
        return res.status(409).json({ error: 'Someone has already requested this slot and the instructor is deciding. Try another slot.' });
    } catch (e) { /* table may not exist yet */ }

    const pickupPostcode = extractPostcode(cleanAddr);
    if (pickupPostcode) {
      let coordMap = {};
      try {
        const postcodes = new Set([normalisePostcode(pickupPostcode)]);
        for (const b of bookingBlocks) {
          if (b.postcode) postcodes.add(normalisePostcode(b.postcode));
        }
        coordMap = await bulkGeocodeUK([...postcodes]);
      } catch { /* graceful — same-postcode checks still work without geocoding */ }

      const travelConflict = findAdjacentTravelSpacingConflict({
        slotStart: startMins,
        slotEnd: endMins,
        pickupPostcode,
        bookedSlots: bookingBlocks,
        coordMap
      });
      if (travelConflict) {
        return res.status(409).json({ error: 'Sorry, that slot does not leave enough travel time from another booking.' });
      }
    }

    // ── Find or create learner (mirrors offers.js findOrCreateLearner) ──
    let learnerId;
    if (existingLearner) {
      learnerId = existingLearner.id;
      const needsUpdate = (!existingLearner.name && cleanName) ||
                          (!existingLearner.phone && cleanPhone) ||
                          (!existingLearner.pickup_address && cleanAddr);
      if (needsUpdate) {
        await sql`
          UPDATE learner_users SET
            name = COALESCE(NULLIF(name, ''), ${cleanName}),
            phone = COALESCE(phone, ${cleanPhone}),
            pickup_address = COALESCE(NULLIF(pickup_address, ''), ${cleanAddr}),
            last_activity_at = NOW()
          WHERE id = ${learnerId}
        `;
      }
    } else {
      try {
        const [newLearner] = await sql`
          INSERT INTO learner_users
            (name, email, phone, pickup_address, balance_minutes, credit_balance, school_id, referred_by)
          VALUES
            (${cleanName}, ${cleanEmail}, ${cleanPhone}, ${cleanAddr}, 0, 0, ${schoolId}, ${referrerId})
          RETURNING id
        `;
        learnerId = newLearner.id;
      } catch (insertErr) {
        if (insertErr.message?.includes('learner_users_phone_key') || insertErr.message?.includes('unique')) {
          // Phone collision with a different account — insert without phone
          const [newLearner] = await sql`
            INSERT INTO learner_users
              (name, email, pickup_address, balance_minutes, credit_balance, school_id, referred_by)
            VALUES
              (${cleanName}, ${cleanEmail}, ${cleanAddr}, 0, 0, ${schoolId}, ${referrerId})
            RETURNING id
          `;
          learnerId = newLearner.id;
        } else {
          throw insertErr;
        }
      }
    }

    // ── Create the booking ──
    // list_price_pence = 0 + 'live_compute_insert' (Step 1b): a free trial has
    // no list price.
    let booking;
    try {
      const [b] = await sql`
        INSERT INTO lesson_bookings
          (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
           created_by, payment_method, lesson_type_id, minutes_deducted,
           pickup_address, school_id, guest_phone, transmission_type,
           list_price_pence, list_price_source)
        VALUES
          (${learnerId}, ${instructor_id}, ${date}, ${start_time}, ${end_time}, ${SCHEDULED},
           'free_trial_self_serve', 'free', ${trialType.id}, 0,
           ${cleanAddr}, ${schoolId}, ${cleanPhone}, ${bookingTransmissionType},
           0, 'live_compute_insert')
        RETURNING id, scheduled_date::text, start_time::text, end_time::text
      `;
      booking = b;
    } catch (insertErr) {
      if (insertErr.message?.includes('uq_booking_slot') || insertErr.message?.includes('uq_instructor_slot')) {
        return res.status(409).json({ error: 'Sorry, that slot was just taken.' });
      }
      throw insertErr;
    }

    // ── Step 2.5: zero-value credit_transactions row + BCS attribution ──
    // PER-INSTRUCTOR-CREDITS-PLAN.md §Step 2 table at L538-543: free-trial
    // bookings get a credit_transactions row with source='free_trial',
    // amount_pence=0, credits=0, absorbed_by='platform'. The BCS row pins
    // FIFO attribution to that credit_transactions row so the booking has
    // a ledger ancestor like every paid booking.
    //
    // minutes_drawn = durationMins because the BCS CHECK requires > 0; the
    // economic effect is still zero (contribution_pence = 0, fee = 0).
    //
    // If either INSERT fails the booking has already succeeded and the trial
    // is committed. We log + alert rather than rolling back: zero financial
    // impact, and a missing BCS row for a free trial doesn't break payouts
    // (free trials are excluded by absorbed_by='platform' at payout time).
    try {
      const [creditTx] = await sql`
        INSERT INTO credit_transactions
          (learner_id, type, credits, amount_pence, payment_method,
           minutes, school_id, stripe_fee_pence,
           instructor_id, effective_rate_pence_per_minute, source, absorbed_by)
        VALUES
          (${learnerId}, 'free_trial', 0, 0, 'free',
           ${durationMins}, ${schoolId}, 0,
           ${instructor_id}, 0, 'free_trial', 'platform')
        RETURNING id
      `;

      await sql`
        INSERT INTO booking_credit_sources
          (booking_id, credit_transaction_id, minutes_drawn,
           rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by,
           school_id)
        VALUES
          (${booking.id}, ${creditTx.id}, ${durationMins},
           0, 0, 0, 'platform',
           ${schoolId})
      `;
    } catch (ledgerErr) {
      console.error('[handleBookFreeTrial] ledger insert failed (booking succeeded)',
        { bookingId: booking.id, learnerId, instructorId: instructor_id, err: ledgerErr.message });
      reportError('/api/slots?action=book-free-trial:ledger', ledgerErr);
    }

    // ── Send confirmation emails ──
    const lessonDate = new Date(date + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const lessonTime = `${start_time} – ${end_time}`;

    try {
      const transporter = createTransporter();
      const firstName = cleanName.split(' ')[0] || 'there';

      const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';
      const learnerLoginUrl = `${baseUrl}/learner/login.html?email=${encodeURIComponent(cleanEmail)}`;
      const learnerCta = `<p style="margin-top:16px"><a href="${learnerLoginUrl}" style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold">Sign in &amp; manage booking →</a></p>
           <p style="font-size:0.85rem;color:#797879">Enter your email and we'll send a 6-digit sign-in code.</p>`;

      await transporter.sendMail({
        from:    'CoachCarter <bookings@coachcarter.uk>',
        to:      cleanEmail,
        subject: `Free trial booked — ${lessonDate} at ${start_time}`,
        html: `
          <h1>Your free trial is booked.</h1>
          <p>Hi ${firstName}, here are the details:</p>
          <table>
            <tr><td><strong>Date:</strong></td><td>${lessonDate}</td></tr>
            <tr><td><strong>Time:</strong></td><td>${lessonTime}</td></tr>
            <tr><td><strong>Instructor:</strong></td><td>${instructor.name}</td></tr>
            <tr><td><strong>Duration:</strong></td><td>${durationMins} minutes</td></tr>
            <tr><td><strong>Pickup:</strong></td><td>${cleanAddr}</td></tr>
            <tr><td><strong>Price:</strong></td><td>FREE</td></tr>
          </table>
          <p style="margin-top:16px;font-size:0.875rem;color:#797879">
            Need to cancel or reschedule? Sign in below — please give at least 48 hours notice.
          </p>
          ${learnerCta}
        `
      });

      if (instructor.email) {
        await transporter.sendMail({
          from:    'CoachCarter <system@coachcarter.uk>',
          to:      instructor.email,
          subject: `New free trial booked — ${lessonDate} at ${start_time}`,
          html: `
            <h2>New free trial booking</h2>
            <table>
              <tr><td><strong>Learner:</strong></td><td>${cleanName}</td></tr>
              <tr><td><strong>Email:</strong></td><td>${cleanEmail}</td></tr>
              <tr><td><strong>Phone:</strong></td><td>${cleanPhone}</td></tr>
              <tr><td><strong>Pickup:</strong></td><td>${cleanAddr}</td></tr>
              <tr><td><strong>Date:</strong></td><td>${lessonDate}</td></tr>
              <tr><td><strong>Time:</strong></td><td>${lessonTime}</td></tr>
              <tr><td><strong>Duration:</strong></td><td>${durationMins} minutes</td></tr>
            </table>
            <p style="margin-top:16px">
              <a href="https://coachcarter.uk/instructor/"
                 style="background:#f58321;color:white;padding:10px 20px;text-decoration:none;
                        border-radius:8px;display:inline-block;font-weight:bold;font-size:0.9rem">
                View my schedule →
              </a>
            </p>
          `
        });
      }
    } catch (emailErr) {
      console.error('Free trial email send failed:', emailErr);
      // Booking already exists — don't fail the request on email failure.
    }

    // ── WhatsApp notifications (non-blocking) ──
    sendWhatsApp(cleanPhone,
      `✅ Free trial booked!\n\n📅 ${lessonDate}\n⏰ ${lessonTime}\n🚗 Instructor: ${instructor.name}\n\nCheck your email for confirmation. To manage your booking, use learner sign-in and request a 6-digit code.`
    );
    sendWhatsApp(instructor.phone,
      `📋 New free trial!\n\n👤 ${cleanName}\n📅 ${lessonDate}\n⏰ ${lessonTime}\n📍 ${cleanAddr}\n\nView schedule: https://coachcarter.uk/instructor/`
    );

    return res.json({
      ok: true,
      redirect_url: '/free-trial-success.html',
      booking_id: booking.id
    });

  } catch (err) {
    console.error('book-free-trial error:', err);
    reportError('/api/slots?action=book-free-trial', err);
    return res.status(500).json({ error: 'Failed to book free trial', details: 'Internal server error' });
  }
}

// ── POST /api/slots?action=cancel ─────────────────────────────────────────────
// Body: { booking_id }
// Cancels a confirmed booking. Returns credit if 48+ hours before lesson.
async function handleCancel(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  const { booking_id, cancel_series } = req.body;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Load booking — must belong to this learner
    // NOTE: cast scheduled_date and start_time to text — Neon returns a Date object
    // for `date` columns, which breaks `${date}T${time}Z` template-string parsing.
    const [booking] = await sql`
      SELECT lb.*,
             lb.scheduled_date::text AS scheduled_date,
             lb.start_time::text     AS start_time,
             lb.end_time::text       AS end_time,
             i.name AS instructor_name, i.email AS instructor_email, i.phone AS instructor_phone,
             lu.name AS learner_name, lu.email AS learner_email, lu.phone AS learner_phone
      FROM lesson_bookings lb
      JOIN instructors i    ON i.id  = lb.instructor_id
      JOIN learner_users lu ON lu.id = lb.learner_id
      WHERE lb.id = ${booking_id} AND lb.learner_id = ${user.id}
        AND COALESCE(lb.school_id, 1) = ${schoolId}
    `;

    if (!booking)
      return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== SCHEDULED)
      return res.status(400).json({ error: `Cannot cancel a booking with status "${booking.status}"` });

    const isDemoBooking = booking.instructor_email === 'demo@coachcarter.uk';

    // ── Series cancellation ─────────────────────────────────────────────────
    if (cancel_series && booking.series_id) {
      // Find all future confirmed bookings in this series (including the target)
      const seriesBookings = await sql`
        SELECT id, scheduled_date::text, start_time::text, end_time::text, minutes_deducted
        FROM lesson_bookings
        WHERE series_id = ${booking.series_id}
          AND learner_id = ${user.id}
          AND COALESCE(school_id, 1) = ${schoolId}
          AND status = ${SCHEDULED}
          AND scheduled_date >= CURRENT_DATE
        ORDER BY scheduled_date
      `;

      if (seriesBookings.length === 0)
        return res.status(400).json({ error: 'No future bookings in this series to cancel' });

      const cancelled = [];
      const refunded = [];
      const noRefund = [];
      let totalMinsRefunded = 0;

      for (const sb of seriesBookings) {
        const lessonDT = new Date(`${sb.scheduled_date}T${sb.start_time}Z`);
        const hoursUntil = (lessonDT - Date.now()) / 3600000;
        const mins = sb.minutes_deducted != null ? sb.minutes_deducted : DEFAULT_SLOT_MINUTES;
        const eligible = !isDemoBooking && hoursUntil >= CANCEL_HOURS_CUTOFF && mins > 0;

        if (eligible) {
          await sql`
            UPDATE lesson_bookings
            SET status = ${REFUNDED}, cancelled_at = NOW(), credit_returned = TRUE
            WHERE id = ${sb.id}
          `;
          await markBookingCreditSourcesRefunded(sql, { bookingId: sb.id, schoolId });
        } else {
          await sql`
            UPDATE lesson_bookings
            SET cancelled_at = NOW(), credit_returned = FALSE, credit_forfeited = TRUE
            WHERE id = ${sb.id}
          `;
        }

        cancelled.push(sb.id);
        if (eligible) {
          refunded.push(sb.id);
          totalMinsRefunded += mins;
        } else {
          noRefund.push(sb.id);
        }
      }

      // Refund total eligible minutes in one update. Series-cancel covers
      // multiple bookings but they all share booking.instructor_id (series
      // by construction = one instructor), so the refund lands on the same
      // LCB row that was originally debited.
      if (totalMinsRefunded > 0) {
        const creditsBack = Math.ceil(totalMinsRefunded / 60);
        await lockBalanceAdjustLCB(sql, {
          learnerId: user.id, instructorId: booking.instructor_id, schoolId,
          delta: totalMinsRefunded, creditsDelta: creditsBack,
        });
      }

      const [updated] = await sql`SELECT credit_balance, balance_minutes FROM learner_users WHERE id = ${user.id}`;
      const balanceStr = formatHours(updated.balance_minutes || 0);
      const refundedStr = formatHours(totalMinsRefunded);

      // Send summary notifications
      const mailer = createTransporter();
      const dateList = seriesBookings.map(sb => {
        const display = formatDateDisplay(sb.scheduled_date);
        return `<li>${display} at ${String(sb.start_time).slice(0, 5)}</li>`;
      }).join('');

      await mailer.sendMail({
        from:    'CoachCarter <bookings@coachcarter.uk>',
        to:      booking.learner_email,
        subject: `${cancelled.length} lessons cancelled`,
        html: `
          <h1>${cancelled.length} lessons cancelled.</h1>
          <p>The following lessons with ${booking.instructor_name} have been cancelled:</p>
          <ol>${dateList}</ol>
          ${totalMinsRefunded > 0 ? `<p><strong>${refundedStr} returned to your balance.</strong> You now have ${balanceStr} remaining.</p>` : ''}
          ${noRefund.length > 0 ? `<p>${noRefund.length} lesson(s) were within 48 hours and hours were forfeited.</p>` : ''}
          <p><a href="https://coachcarter.uk/learner/"
                style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;
                       border-radius:8px;display:inline-block;font-weight:bold">
            Book again →
          </a></p>
        `
      });

      if (!isDemoBooking) {
        await mailer.sendMail({
          from:    'CoachCarter <system@coachcarter.uk>',
          to:      booking.instructor_email,
          subject: `${cancelled.length} lessons cancelled — ${booking.learner_name}`,
          html: `
            <h2>${cancelled.length} lessons cancelled</h2>
            <p><strong>${booking.learner_name}</strong> has cancelled their weekly series:</p>
            <ol>${dateList}</ol>
            <p>These slots are now free.</p>
          `
        });
      }

      const dateListText = seriesBookings.map(sb => `  📅 ${formatDateDisplay(sb.scheduled_date)}`).join('\n');
      await sendWhatsApp(booking.learner_phone,
        `❌ ${cancelled.length} lessons cancelled\n\n${dateListText}\n\n${totalMinsRefunded > 0 ? `${refundedStr} returned. Balance: ${balanceStr}` : 'Hours forfeited (less than 48hrs notice).'}\n\nRebook: https://coachcarter.uk/learner/book.html`
      );
      if (!isDemoBooking) {
        await sendWhatsApp(booking.instructor_phone,
          `❌ ${cancelled.length} lessons cancelled\n\n👤 ${booking.learner_name}\n${dateListText}\n\nThese slots are now free.`
        );
      }

      // Notify learners with matching weekly availability (fire-and-forget).
      // <48h cancellations with the instructor opted in mint a discounted
      // broadcast offer; otherwise this fans out a plain "slot opened" message.
      for (const sb of seriesBookings) {
        notifyAvailableLearners({
          instructor_id:   booking.instructor_id,
          instructor_name: booking.instructor_name,
          scheduled_date:  sb.scheduled_date,
          start_time:      sb.start_time,
          end_time:        sb.end_time,
          lesson_type_id:  booking.lesson_type_id,
          school_id:       booking.school_id
        }).catch(err => {
          console.warn('availability notify (series) failed:', err.message);
          reportError('/api/slots:availability-series', err);
        });
      }

      return res.json({
        success:          true,
        cancelled,
        refunded,
        no_refund:        noRefund,
        minutes_returned: totalMinsRefunded,
        credit_balance:   updated.credit_balance,
        balance_minutes:  updated.balance_minutes || 0,
        balance_hours:    ((updated.balance_minutes || 0) / 60).toFixed(1),
        message: `${cancelled.length} lessons cancelled. ${totalMinsRefunded > 0 ? formatHours(totalMinsRefunded) + ' returned.' : ''}`
      });
    }

    // ── Single booking cancellation (existing logic) ────────────────────────

    // Calculate hours until lesson
    const lessonDateTime = new Date(`${booking.scheduled_date}T${booking.start_time}Z`);
    const hoursUntil     = (lessonDateTime - Date.now()) / 3600000;
    // Demo bookings are free, so no hours to return
    const minsToReturn   = booking.minutes_deducted != null ? booking.minutes_deducted : DEFAULT_SLOT_MINUTES;
    const isSelfServeFreeTrial = isSelfServeFreeTrialBooking(booking);
    const creditReturned = !isDemoBooking
      && !isSelfServeFreeTrial
      && hoursUntil >= CANCEL_HOURS_CUTOFF
      && minsToReturn > 0;
    const bookingReleased = creditReturned || isSelfServeFreeTrial;

    // Cancel the booking. Late-cancel (<48h) keeps status=scheduled and
    // forfeits the credit; the hourly cron flips it to chargeable so the
    // instructor is still paid. Self-serve free trials have no credit/payout
    // value, so learner cancellation always releases the calendar slot.
    // 48h+ paid cancellations flip straight to refunded.
    if (creditReturned) {
      await sql`
        UPDATE lesson_bookings
        SET status = ${REFUNDED}, cancelled_at = NOW(), credit_returned = TRUE
        WHERE id = ${booking_id}
      `;
      await markBookingCreditSourcesRefunded(sql, { bookingId: booking_id, schoolId });
    } else if (isSelfServeFreeTrial) {
      await sql`
        UPDATE lesson_bookings
        SET status = ${REFUNDED}, cancelled_at = NOW(), credit_returned = FALSE, credit_forfeited = FALSE
        WHERE id = ${booking_id}
      `;
    } else {
      await sql`
        UPDATE lesson_bookings
        SET cancelled_at = NOW(), credit_returned = FALSE, credit_forfeited = TRUE
        WHERE id = ${booking_id}
      `;
    }

    // Return hours if eligible (not for demo bookings). Refund lands on the
    // same LCB row that was originally debited (booking.instructor_id).
    if (creditReturned) {
      await lockBalanceAdjustLCB(sql, {
        learnerId: user.id, instructorId: booking.instructor_id, schoolId,
        delta: minsToReturn, creditsDelta: Math.ceil(minsToReturn / 60),
      });
    }

    const [updated] = await sql`SELECT credit_balance, balance_minutes FROM learner_users WHERE id = ${user.id}`;
    const balanceStr = formatHours(updated.balance_minutes || 0);
    const returnedStr = formatHours(minsToReturn);

    // Notify learner
    const lessonDateStr = formatDateDisplay(String(booking.scheduled_date).slice(0, 10));
    const cancelTime    = String(booking.start_time).slice(0, 5);
    try {
      const mailer = createTransporter();
      await mailer.sendMail({
        from:    'CoachCarter <bookings@coachcarter.uk>',
        to:      booking.learner_email,
        subject: `Lesson cancelled — ${lessonDateStr}`,
        html: creditReturned ? `
          <h1>Lesson cancelled.</h1>
          <p>Your lesson on <strong>${lessonDateStr} at ${cancelTime}</strong>
             with ${booking.instructor_name} has been cancelled.</p>
          <p><strong>${returnedStr} returned to your balance.</strong>
             You now have ${balanceStr} remaining.</p>
          <p><a href="https://coachcarter.uk/learner/"
                style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;
                       border-radius:8px;display:inline-block;font-weight:bold">
            Book another lesson →
          </a></p>
        ` : isSelfServeFreeTrial ? `
          <h1>Free trial cancelled.</h1>
          <p>Your free trial on <strong>${lessonDateStr} at ${cancelTime}</strong>
             with ${booking.instructor_name} has been cancelled.</p>
          <p>No lesson credit was used.</p>
        ` : `
          <h1>Lesson cancelled.</h1>
          <p>Your lesson on <strong>${lessonDateStr} at ${cancelTime}</strong>
             with ${booking.instructor_name} has been cancelled.</p>
          <p><strong>As this was cancelled with less than 48 hours' notice, your hours have been forfeited
             in line with our cancellation policy.</strong></p>
          <p>If you believe this is an error, please reply to this email.</p>
        `
      });

      // Notify instructor (skip for demo instructor)
      if (!isDemoBooking) {
        await mailer.sendMail({
          from:    'CoachCarter <system@coachcarter.uk>',
          to:      booking.instructor_email,
          subject: `Lesson cancelled — ${lessonDateStr} at ${cancelTime}`,
          html: `
            <h2>Lesson cancelled</h2>
            <p>The lesson with <strong>${booking.learner_name}</strong> on
               <strong>${lessonDateStr} at ${cancelTime}</strong>
               has been cancelled by the learner.</p>
            <p>${bookingReleased ? 'This slot is now free.' : 'This booking remains on your calendar under the late-cancellation policy.'}</p>
          `
        });
      }
    } catch (emailErr) {
      console.error('cancel email error (non-fatal):', emailErr.message);
      reportError('/api/slots:cancel-email', emailErr);
    }

    // WhatsApp cancellation notifications
    await sendWhatsApp(booking.learner_phone,
      creditReturned
        ? `❌ Lesson cancelled\n\n📅 ${lessonDateStr} at ${cancelTime}\n\n${returnedStr} returned to your balance. You now have ${balanceStr} remaining.\n\nRebook: https://coachcarter.uk/learner/book.html`
        : isSelfServeFreeTrial
          ? `❌ Free trial cancelled\n\n📅 ${lessonDateStr} at ${cancelTime}\n\nNo lesson credit was used.`
        : `❌ Lesson cancelled\n\n📅 ${lessonDateStr} at ${cancelTime}\n\nAs this was less than 48 hours' notice, your hours have been forfeited.`
    );
    if (!isDemoBooking) {
      await sendWhatsApp(booking.instructor_phone,
        `❌ Lesson cancelled\n\n👤 ${booking.learner_name}\n📅 ${lessonDateStr} at ${cancelTime}\n\n${bookingReleased ? 'This slot is now free.' : 'This booking remains on your calendar under the late-cancellation policy.'}`
      );
    }

    // Notify learners with matching weekly availability (fire-and-forget).
    // <48h cancellations with the instructor opted in mint a discounted
    // broadcast offer; otherwise this fans out a plain "slot opened" message.
    if (bookingReleased) {
      notifyAvailableLearners({
        instructor_id:   booking.instructor_id,
        instructor_name: booking.instructor_name,
        scheduled_date:  String(booking.scheduled_date).slice(0, 10),
        start_time:      booking.start_time,
        end_time:        booking.end_time,
        lesson_type_id:  booking.lesson_type_id,
        school_id:       booking.school_id
      }).catch(err => {
        console.warn('availability notify failed:', err.message);
        reportError('/api/slots:availability', err);
      });
    }

    return res.json({
      success:          true,
      credit_returned:  creditReturned,
      credit_balance:   updated.credit_balance,
      balance_minutes:  updated.balance_minutes || 0,
      balance_hours:    ((updated.balance_minutes || 0) / 60).toFixed(1),
      minutes_returned: creditReturned ? minsToReturn : 0,
      message: isDemoBooking
        ? 'Demo booking cancelled.'
        : isSelfServeFreeTrial
          ? 'Free trial cancelled.'
        : creditReturned
          ? `Booking cancelled and ${returnedStr} returned to your balance.`
          : `Booking cancelled. Hours forfeited (less than ${CANCEL_HOURS_CUTOFF} hours' notice).`
    });

  } catch (err) {
    console.error('slots cancel error:', err);
    reportError('/api/slots', err);
    return res.status(500).json({ error: 'Cancellation failed', details: 'Internal server error' });
  }
}

// ── POST /api/slots?action=reschedule ────────────────────────────────────────
// Body: { booking_id, new_date, new_start_time }
// Atomically moves a confirmed booking to a new time slot (no credit change).
function normaliseMoveTimeHHMM(value) {
  const text = String(value || '').trim();
  if (!TIME_HHMM_RE.test(text)) return null;
  const [hh, mm] = text.split(':').map(Number);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return text;
}

async function ensureReservedReplacementFitsAvailability(client, booking, {
  schoolId,
  newDate,
  newStartTime,
  newEndTime,
}) {
  const slotStart = timeToMinutes(newStartTime);
  const slotEnd = timeToMinutes(newEndTime);
  const dayOfWeek = new Date(`${newDate}T00:00:00Z`).getUTCDay();

  const instructorResult = await client.query(
    `SELECT COALESCE(min_booking_notice_hours, 24)::int AS min_booking_notice_hours,
            COALESCE(transmission_type, 'manual') AS transmission_type,
            active
       FROM instructors
      WHERE id = $1
        AND school_id = $2`,
    [booking.instructor_id, schoolId]
  );
  const instructor = instructorResult.rows[0];
  if (!instructor || instructor.active !== true) {
    abortReservedPolicyMove(409, {
      error: true,
      code: 'INSTRUCTOR_UNAVAILABLE',
      message: 'That replacement slot is not available',
    });
  }

  const minNoticeHours = Math.max(0, parseInt(instructor.min_booking_notice_hours, 10) || 0);
  const newSlotStart = new Date(`${newDate}T${newStartTime}:00Z`);
  if (minNoticeHours > 0 && ((newSlotStart.getTime() - Date.now()) / 3600000) < minNoticeHours) {
    abortReservedPolicyMove(409, {
      error: true,
      code: 'SLOT_BEFORE_MIN_NOTICE',
      message: 'That replacement slot is not available',
    });
  }

  const blackout = await client.query(
    `SELECT 1
       FROM instructor_blackout_dates
      WHERE instructor_id = $1
        AND school_id = $2
        AND blackout_date <= $3::date
        AND end_date >= $3::date
      LIMIT 1`,
    [booking.instructor_id, schoolId, newDate]
  );
  if (blackout.rowCount > 0) {
    abortReservedPolicyMove(409, {
      error: true,
      code: 'SLOT_BLACKED_OUT',
      message: 'That replacement slot is not available',
    });
  }

  let externalEvents = { rows: [] };
  try {
    externalEvents = await client.query(
      `SELECT start_time::text AS start_time, end_time::text AS end_time, is_all_day
         FROM instructor_external_events
        WHERE instructor_id = $1
          AND school_id = $2
          AND event_date = $3::date`,
      [booking.instructor_id, schoolId, newDate]
    );
  } catch (_) {}
  if (externalEvents.rows.some(e => e.is_all_day)) {
    abortReservedPolicyMove(409, {
      error: true,
      code: 'SLOT_BLOCKED_BY_EXTERNAL_EVENT',
      message: 'That replacement slot is not available',
    });
  }
  if (externalEvents.rows.some(e => slotStart < timeToMinutes(e.end_time) && slotEnd > timeToMinutes(e.start_time))) {
    abortReservedPolicyMove(409, {
      error: true,
      code: 'SLOT_BLOCKED_BY_EXTERNAL_EVENT',
      message: 'That replacement slot is not available',
    });
  }

  let busyBlocks = { rows: [] };
  try {
    busyBlocks = await client.query(
      `SELECT start_time::text AS start_time, end_time::text AS end_time
         FROM instructor_busy_blocks
        WHERE instructor_id = $1
          AND school_id = $2
          AND block_date = $3::date`,
      [booking.instructor_id, schoolId, newDate]
    );
  } catch (_) {}
  if (busyBlocks.rows.some(b => slotStart < timeToMinutes(b.end_time) && slotEnd > timeToMinutes(b.start_time))) {
    abortReservedPolicyMove(409, {
      error: true,
      code: 'SLOT_BLOCKED_BY_BUSY_BLOCK',
      message: 'That replacement slot is not available',
    });
  }

  const weeklyWindows = await client.query(
    `SELECT start_time::text AS start_time, end_time::text AS end_time,
            COALESCE(to_jsonb(instructor_availability)->>'transmission_type', 'both') AS transmission_type
       FROM instructor_availability
      WHERE instructor_id = $1
        AND school_id = $2
        AND day_of_week = $3
        AND active = true`,
    [booking.instructor_id, schoolId, dayOfWeek]
  );

  let overrideWindows = { rows: [] };
  try {
    overrideWindows = await client.query(
      `SELECT start_time::text AS start_time, end_time::text AS end_time,
              COALESCE(transmission_type, 'both') AS transmission_type
         FROM instructor_availability_overrides
        WHERE instructor_id = $1
          AND school_id = $2
          AND override_date = $3::date
          AND active = true`,
      [booking.instructor_id, schoolId, newDate]
    );
  } catch (_) {}

  const instructorTransmission = normaliseSlotTransmissionType(instructor.transmission_type) || 'manual';
  const requestedTransmission = normaliseSlotTransmissionType(booking.transmission_type) || 'manual';
  const windows = [
    ...weeklyWindows.rows
      .map(w => ({
        ...w,
        transmission_type: clampSlotTransmissionType(w.transmission_type, instructorTransmission),
      }))
      .filter(w => w.transmission_type),
    ...overrideWindows.rows
      .map(w => ({
        ...w,
        transmission_type: clampSlotTransmissionType(w.transmission_type, instructorTransmission),
      }))
      .filter(w => w.transmission_type),
  ];

  const fits = windows.some(w => {
    const windowStart = timeToMinutes(w.start_time);
    const windowEnd = timeToMinutes(w.end_time);
    return slotStart >= windowStart &&
           slotEnd <= windowEnd &&
           slotSupportsTransmission(w.transmission_type, requestedTransmission);
  });

  if (!fits) {
    abortReservedPolicyMove(409, {
      error: true,
      code: 'SLOT_OUTSIDE_AVAILABILITY',
      message: 'That replacement slot is not available',
    });
  }
}

// Body: { booking_id, new_date, new_start_time }
// Learner self-serve move for one confirmed Reserved Weekly Slot occurrence.
async function handleReservedPolicyMove(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: true, code: 'UNAUTHORISED', message: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  const bookingId = parseInt(req.body?.booking_id, 10);
  const newDate = String(req.body?.new_date || '').trim();
  const newStartTime = normaliseMoveTimeHHMM(req.body?.new_start_time);

  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return res.status(400).json({ error: true, code: 'INVALID_BOOKING_ID', message: 'booking_id is required' });
  }
  if (!ISO_DATE_RE.test(newDate) || !parseDate(newDate)) {
    return res.status(400).json({ error: true, code: 'INVALID_NEW_DATE', message: 'new_date must be YYYY-MM-DD' });
  }
  if (!newStartTime) {
    return res.status(400).json({ error: true, code: 'INVALID_NEW_START_TIME', message: 'new_start_time must be HH:MM' });
  }

  try {
    const result = await withNeonTransaction(process.env.POSTGRES_URL, async client => {
      const bookingResult = await client.query(
        `SELECT
           lb.id,
           lb.learner_id,
           lb.instructor_id,
           lb.school_id,
           lb.status,
           lb.scheduled_date::text AS scheduled_date,
           lb.start_time::text AS start_time,
           lb.end_time::text AS end_time,
           lb.lesson_type_id,
           lb.minutes_deducted,
           COALESCE(lb.reschedule_count, 0)::int AS reschedule_count,
           lb.pickup_address,
           lb.dropoff_address,
           lb.payment_method,
           lb.stripe_fee_pence,
           lb.stripe_fee_source,
           lb.list_price_pence,
           lb.list_price_source,
           COALESCE(lb.social_video_consent, false) AS social_video_consent,
           COALESCE(lb.social_video_age_confirmed, false) AS social_video_age_confirmed,
           COALESCE(lb.social_video_discount_pct, 0) AS social_video_discount_pct,
           COALESCE(lb.transmission_type, 'manual') AS transmission_type,
           rsb.id AS recurring_slot_block_id,
           rsbi.id AS recurring_slot_block_item_id,
           rsbi.price_pence AS recurring_item_price_pence
         FROM lesson_bookings lb
         JOIN recurring_slot_block_items rsbi
           ON rsbi.lesson_booking_id = lb.id
          AND rsbi.school_id = lb.school_id
          AND rsbi.instructor_id = lb.instructor_id
          AND rsbi.status = 'booked'
         JOIN recurring_slot_blocks rsb
           ON rsb.id = rsbi.block_id
          AND rsb.school_id = lb.school_id
          AND rsb.learner_id = lb.learner_id
          AND rsb.instructor_id = lb.instructor_id
          AND rsb.status = 'confirmed'
         WHERE lb.id = $1
           AND lb.learner_id = $2
           AND lb.school_id = $3
           AND lb.status = $4
         FOR UPDATE OF lb, rsbi, rsb`,
        [bookingId, user.id, schoolId, SCHEDULED]
      );
      const booking = bookingResult.rows[0];
      if (!booking) {
        abortReservedPolicyMove(404, {
          error: true,
          code: 'RESERVED_BOOKING_NOT_FOUND',
          message: 'Confirmed reserved weekly booking not found',
        });
      }

      const oldDate = String(booking.scheduled_date).slice(0, 10);
      const oldStart = String(booking.start_time).slice(0, 5);
      if (newDate === oldDate && newStartTime === oldStart) {
        abortReservedPolicyMove(400, {
          error: true,
          code: 'SAME_RESERVED_SLOT',
          message: 'New time is the same as the current reserved lesson',
        });
      }

      const oldLessonStart = new Date(`${oldDate}T${oldStart}:00Z`);
      if (oldLessonStart.getTime() <= Date.now()) {
        abortReservedPolicyMove(400, {
          error: true,
          code: 'RESERVED_LESSON_ALREADY_STARTED',
          message: 'Cannot move a reserved lesson that has already started',
        });
      }

      const noticeHours = (oldLessonStart.getTime() - Date.now()) / 3600000;
      if (noticeHours < RESERVED_MOVE_NOTICE_HOURS) {
        abortReservedPolicyMove(409, {
          error: true,
          code: 'RESERVED_MOVE_NOTICE_TOO_SHORT',
          message: 'Reserved lessons can only be moved by learners with at least 48 hours notice',
        });
      }

      const newStart = timeToMinutes(newStartTime);
      const originalDuration = timeToMinutes(booking.end_time) - timeToMinutes(booking.start_time);
      const durationMinutes = originalDuration > 0 ? originalDuration : Number(booking.minutes_deducted || 0);
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        abortReservedPolicyMove(400, {
          error: true,
          code: 'UNKNOWN_BOOKING_DURATION',
          message: 'Could not determine the reserved lesson duration',
        });
      }

      const newEndMins = newStart + durationMinutes;
      if (newEndMins > 24 * 60) {
        abortReservedPolicyMove(400, {
          error: true,
          code: 'NEW_SLOT_ENDS_AFTER_DAY',
          message: 'The replacement slot would finish after the end of the day',
        });
      }
      const newEndTime = minutesToTime(newEndMins);
      const newSlotStart = new Date(`${newDate}T${newStartTime}:00Z`);
      if (newSlotStart.getTime() <= Date.now()) {
        abortReservedPolicyMove(400, {
          error: true,
          code: 'NEW_SLOT_IN_PAST',
          message: 'The replacement slot must be in the future',
        });
      }

      await ensureReservedReplacementFitsAvailability(client, booking, {
        schoolId,
        newDate,
        newStartTime,
        newEndTime,
      });

      const bookingConflict = await client.query(
        `SELECT id
           FROM lesson_bookings
          WHERE instructor_id = $1
            AND school_id = $2
            AND scheduled_date = $3::date
            AND start_time < $5::time
            AND end_time > $4::time
            AND status = ANY($6::text[])
            AND id <> $7
          LIMIT 1`,
        [booking.instructor_id, schoolId, newDate, newStartTime, newEndTime, BLOCKING_STATUSES, booking.id]
      );
      if (bookingConflict.rowCount > 0) {
        abortReservedPolicyMove(409, {
          error: true,
          code: 'SLOT_UNAVAILABLE',
          message: 'That replacement slot is already booked',
        });
      }

      const activeReservation = await client.query(
        `SELECT id
           FROM slot_reservations
          WHERE instructor_id = $1
            AND school_id = $2
            AND scheduled_date = $3::date
            AND start_time < $5::time
            AND end_time > $4::time
            AND expires_at > NOW()
          LIMIT 1`,
        [booking.instructor_id, schoolId, newDate, newStartTime, newEndTime]
      );
      if (activeReservation.rowCount > 0) {
        abortReservedPolicyMove(409, {
          error: true,
          code: 'SLOT_RESERVED',
          message: 'Someone is currently booking that replacement slot',
        });
      }

      const pendingOffer = await client.query(
        `SELECT id
           FROM lesson_offers
          WHERE instructor_id = $1
            AND school_id = $2
            AND scheduled_date = $3::date
            AND start_time < $5::time
            AND end_time > $4::time
            AND status = 'pending'
            AND expires_at > NOW()
          LIMIT 1`,
        [booking.instructor_id, schoolId, newDate, newStartTime, newEndTime]
      );
      if (pendingOffer.rowCount > 0) {
        abortReservedPolicyMove(409, {
          error: true,
          code: 'SLOT_HAS_PENDING_OFFER',
          message: 'That replacement slot has a pending offer',
        });
      }

      const pendingRequest = await client.query(
        `SELECT id
           FROM lesson_requests
          WHERE instructor_id = $1
            AND school_id = $2
            AND scheduled_date = $3::date
            AND start_time < $5::time
            AND end_time > $4::time
            AND status = 'pending'
            AND expires_at > NOW()
          LIMIT 1`,
        [booking.instructor_id, schoolId, newDate, newStartTime, newEndTime]
      );
      if (pendingRequest.rowCount > 0) {
        abortReservedPolicyMove(409, {
          error: true,
          code: 'SLOT_HAS_PENDING_REQUEST',
          message: 'That replacement slot has a pending lesson request',
        });
      }

      const recurringConflict = await client.query(
        `SELECT id, status
           FROM recurring_slot_block_items
          WHERE instructor_id = $1
            AND school_id = $2
            AND scheduled_date = $3::date
            AND start_time < $5::time
            AND end_time > $4::time
            AND status IN ('held', 'booked')
            AND id <> $6
          LIMIT 1`,
        [booking.instructor_id, schoolId, newDate, newStartTime, newEndTime, booking.recurring_slot_block_item_id]
      );
      if (recurringConflict.rowCount > 0) {
        abortReservedPolicyMove(409, {
          error: true,
          code: 'SLOT_HELD_FOR_RECURRING_BLOCK',
          message: 'That replacement slot is held for a recurring block',
        });
      }

      const sameBlockItem = await client.query(
        `SELECT id, status
           FROM recurring_slot_block_items
          WHERE block_id = $1
            AND school_id = $2
            AND scheduled_date = $3::date
            AND start_time = $4::time
          LIMIT 1`,
        [booking.recurring_slot_block_id, schoolId, newDate, newStartTime]
      );
      if (sameBlockItem.rowCount > 0) {
        abortReservedPolicyMove(409, {
          error: true,
          code: 'REPLACEMENT_ALREADY_IN_BLOCK',
          message: 'That replacement slot is already represented in this reserved weekly block',
        });
      }

      const refundedBcs = await client.query(
        `UPDATE booking_credit_sources
            SET refunded_at = NOW()
          WHERE booking_id = $1
            AND school_id = $2
            AND refunded_at IS NULL
          RETURNING id`,
        [booking.id, schoolId]
      );
      const refundedBcsIds = refundedBcs.rows.map(row => row.id);

      await client.query(
        `UPDATE lesson_bookings
            SET status = $1,
                credit_returned = TRUE,
                cancelled_at = NOW()
          WHERE id = $2
            AND learner_id = $3
            AND school_id = $4
            AND status = $5`,
        [REFUNDED, booking.id, user.id, schoolId, SCHEDULED]
      );

      const insertedBooking = await client.query(
        `INSERT INTO lesson_bookings
           (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
            rescheduled_from, reschedule_count, pickup_address, dropoff_address,
            lesson_type_id, minutes_deducted, school_id, created_by, payment_method,
            stripe_fee_pence, stripe_fee_source, list_price_pence, list_price_source,
            transmission_type, social_video_consent, social_video_age_confirmed, social_video_discount_pct)
         VALUES
           ($1, $2, $3::date, $4::time, $5::time, $6,
            $7, $8, $9, $10,
            $11, $12, $13, 'learner', $14,
            $15, $16, $17, $18,
            $19, $20, $21, $22)
         RETURNING id, scheduled_date::text, start_time::text, end_time::text, status`,
        [
          booking.learner_id,
          booking.instructor_id,
          newDate,
          newStartTime,
          newEndTime,
          SCHEDULED,
          booking.id,
          booking.reschedule_count,
          booking.pickup_address || null,
          booking.dropoff_address || null,
          booking.lesson_type_id || null,
          booking.minutes_deducted != null ? booking.minutes_deducted : null,
          schoolId,
          booking.payment_method || null,
          booking.stripe_fee_pence != null ? booking.stripe_fee_pence : null,
          booking.stripe_fee_source || null,
          booking.list_price_pence != null ? booking.list_price_pence : null,
          booking.list_price_source || null,
          booking.transmission_type || 'manual',
          !!booking.social_video_consent,
          !!booking.social_video_age_confirmed,
          booking.social_video_discount_pct || 0,
        ]
      );
      const newBooking = insertedBooking.rows[0];

      if (refundedBcsIds.length > 0) {
        await client.query(
          `INSERT INTO booking_credit_sources
             (school_id, booking_id, credit_transaction_id, minutes_drawn,
              rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by,
              refunded_at)
           SELECT
             school_id, $1, credit_transaction_id, minutes_drawn,
             rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by,
             NULL
             FROM booking_credit_sources
            WHERE id = ANY($2::int[])
              AND school_id = $3
              AND refunded_at IS NOT NULL
           ON CONFLICT (booking_id, credit_transaction_id) DO NOTHING`,
          [newBooking.id, refundedBcsIds, schoolId]
        );
      }

      await client.query(
        `UPDATE recurring_slot_block_items
            SET status = 'released',
                updated_at = NOW()
          WHERE id = $1
            AND school_id = $2
            AND status = 'booked'`,
        [booking.recurring_slot_block_item_id, schoolId]
      );

      const insertedItem = await client.query(
        `INSERT INTO recurring_slot_block_items
           (block_id, school_id, instructor_id, lesson_booking_id,
            scheduled_date, start_time, end_time, status, price_pence)
         VALUES
           ($1, $2, $3, $4,
            $5::date, $6::time, $7::time, 'booked', $8)
         RETURNING id`,
        [
          booking.recurring_slot_block_id,
          schoolId,
          booking.instructor_id,
          newBooking.id,
          newDate,
          newStartTime,
          newEndTime,
          booking.recurring_item_price_pence || 0,
        ]
      );

      return {
        old_booking_id: booking.id,
        new_booking_id: newBooking.id,
        recurring_slot_block_id: booking.recurring_slot_block_id,
        released_recurring_slot_block_item_id: booking.recurring_slot_block_item_id,
        replacement_recurring_slot_block_item_id: insertedItem.rows[0].id,
        movement_type: 'reserved_policy_move',
        old_slot: { date: oldDate, start_time: oldStart, end_time: String(booking.end_time).slice(0, 5) },
        new_slot: { date: newDate, start_time: newStartTime, end_time: newEndTime },
        copied_booking_credit_source_count: refundedBcsIds.length,
      };
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ReservedPolicyMoveAbort) {
      return res.status(err.statusCode).json(err.payload);
    }
    if (err?.code === '23505' || err?.message?.includes('uq_booking_slot')) {
      return res.status(409).json({ error: true, code: 'SLOT_UNAVAILABLE', message: 'That replacement slot is no longer available' });
    }
    console.error('slots reserved-policy-move error:', err);
    reportError('/api/slots?action=reserved-policy-move', err);
    return res.status(500).json({ error: true, code: 'RESERVED_POLICY_MOVE_FAILED', message: 'Failed to move reserved lesson' });
  }
}

async function handleReschedule(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  const { booking_id, new_date, new_start_time, pickup_address, dropoff_address } = req.body;
  if (!booking_id || !new_date || !new_start_time)
    return res.status(400).json({ error: 'booking_id, new_date and new_start_time are required' });

  // Validate new date format
  const newBookingDate = parseDate(new_date);
  if (!newBookingDate)
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });

  const today    = startOfDay(new Date());
  const maxAhead = addDays(today, MAX_DAYS_AHEAD);
  if (newBookingDate < today)
    return res.status(400).json({ error: 'Cannot reschedule to a date in the past' });
  if (newBookingDate > maxAhead)
    return res.status(400).json({ error: `Cannot reschedule more than ${MAX_DAYS_AHEAD} days in advance` });

  const newStartMins = timeToMinutes(new_start_time);

  // Reject if new slot has already started
  if (newBookingDate.getTime() === today.getTime()) {
    const now = new Date();
    const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (newStartMins <= nowMins)
      return res.status(400).json({ error: 'This slot has already started.' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Load booking — must belong to this learner
    // Cast date/time to text — Neon returns Date objects which break `${date}T${time}Z` parsing.
    const [booking] = await sql`
      SELECT lb.*,
             lb.scheduled_date::text AS scheduled_date,
             lb.start_time::text     AS start_time,
             lb.end_time::text       AS end_time,
             i.name AS instructor_name, i.email AS instructor_email,
             i.phone AS instructor_phone,
             COALESCE(i.max_booking_days_ahead, ${MAX_DAYS_AHEAD}) AS max_booking_days_ahead,
             lu.name AS learner_name, lu.email AS learner_email, lu.phone AS learner_phone,
             lu.pickup_address AS learner_pickup_address,
             COALESCE(lb.reschedule_count, 0) AS reschedule_count,
             COALESCE(
               lt.duration_minutes,
               CASE
                 WHEN lb.end_time > lb.start_time
                 THEN ROUND(EXTRACT(EPOCH FROM (lb.end_time - lb.start_time)) / 60)::int
                 ELSE NULL
               END,
               ${DEFAULT_SLOT_MINUTES}
             ) AS type_duration_minutes,
             lt.name AS lesson_type_name,
             EXISTS (
               SELECT 1
                 FROM recurring_slot_block_items rsbi
                 JOIN recurring_slot_blocks rsb
                   ON rsb.id = rsbi.block_id
                  AND rsb.school_id = COALESCE(lb.school_id, 1)
                  AND rsb.learner_id = lb.learner_id
                  AND rsb.instructor_id = lb.instructor_id
                  AND rsb.status = 'confirmed'
                WHERE rsbi.lesson_booking_id = lb.id
                  AND rsbi.school_id = COALESCE(lb.school_id, 1)
                  AND rsbi.instructor_id = lb.instructor_id
                  AND rsbi.status = 'booked'
             ) AS is_reserved_weekly_slot
      FROM lesson_bookings lb
      JOIN instructors i    ON i.id  = lb.instructor_id
      JOIN learner_users lu ON lu.id = lb.learner_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.id = ${booking_id} AND lb.learner_id = ${user.id}
        AND COALESCE(lb.school_id, 1) = ${schoolId}
    `;

    if (!booking)
      return res.status(404).json({ error: 'Booking not found' });
    if (!isDateWithinBookingWindow(newBookingDate, booking.max_booking_days_ahead)) {
      return res.status(400).json({ error: advanceWindowError(booking.max_booking_days_ahead, 'reschedule') });
    }

    // Calculate new end time using booking's lesson type duration
    const bookingDuration = parseInt(booking.type_duration_minutes) || DEFAULT_SLOT_MINUTES;
    const newEndMins   = newStartMins + bookingDuration;
    const new_end_time = minutesToTime(newEndMins);
    const newPickupAddress = (pickup_address && String(pickup_address).trim()) || booking.pickup_address || booking.learner_pickup_address || null;
    const newDropoffAddress = dropoff_address === null
      ? null
      : (dropoff_address && String(dropoff_address).trim() ? String(dropoff_address).trim() : (booking.dropoff_address || null));
    if (booking.status !== SCHEDULED)
      return res.status(400).json({ error: `Cannot reschedule a booking with status "${booking.status}"` });

    // Check 48-hour reschedule window (same as cancellation policy)
    const lessonDateTime = new Date(`${booking.scheduled_date}T${booking.start_time}Z`);
    const hoursUntil     = (lessonDateTime - Date.now()) / 3600000;
    if (booking.is_reserved_weekly_slot) {
      if (hoursUntil < RESERVED_MOVE_NOTICE_HOURS) {
        return res.status(409).json({
          error: true,
          code: 'RESERVED_MOVE_NOTICE_TOO_SHORT',
          message: 'Reserved lessons can only be moved by learners with at least 48 hours notice.'
        });
      }
      return res.status(409).json({
        error: true,
        code: 'RESERVED_MOVE_REQUIRES_POLICY_ENDPOINT',
        message: 'Use Move reserved lesson for Reserved Weekly Slot occurrences.'
      });
    }
    if (hoursUntil < CANCEL_HOURS_CUTOFF)
      return res.status(400).json({
        error: `Cannot reschedule with less than ${CANCEL_HOURS_CUTOFF} hours' notice. You can still cancel, but the lesson will be forfeited.`
      });

    // Reschedule count cap (max 2)
    const MAX_RESCHEDULES = 2;
    if (booking.reschedule_count >= MAX_RESCHEDULES)
      return res.status(400).json({
        error: `This lesson has already been rescheduled ${MAX_RESCHEDULES} times. Please cancel and rebook instead.`
      });

    // Check new slot isn't the same as current
    const oldDate  = String(booking.scheduled_date).slice(0, 10);
    const oldStart = String(booking.start_time).slice(0, 5);
    if (new_date === oldDate && new_start_time === oldStart)
      return res.status(400).json({ error: 'New time is the same as current booking' });

    // Check new slot is available (not booked or reserved)
    const [existingBooking] = await sql`
      SELECT id FROM lesson_bookings
      WHERE instructor_id = ${booking.instructor_id}
        AND scheduled_date = ${new_date}
        AND start_time = ${new_start_time}::time
        AND status = ANY(${BLOCKING_STATUSES}::text[])
        AND COALESCE(school_id, 1) = ${schoolId}
    `;
    if (existingBooking)
      return res.status(409).json({ error: 'That slot is already booked. Please choose another.' });

    const [existingReservation] = await sql`
      SELECT id FROM slot_reservations
      WHERE instructor_id = ${booking.instructor_id}
        AND scheduled_date = ${new_date}
        AND start_time = ${new_start_time}::time
        AND expires_at > NOW()
    `;
    if (existingReservation)
      return res.status(409).json({ error: 'Someone is currently booking that slot. Try another or wait a few minutes.' });

    const rescheduleRequestConflicts = await pendingRequestConflicts(sql, {
      instructorId: booking.instructor_id, schoolId, dates: [new_date], startTime: new_start_time,
    });
    if (rescheduleRequestConflicts.length > 0)
      return res.status(409).json({ error: 'Someone has already requested that slot and the instructor is deciding. Please choose another.' });

    const stillAvailable = await slotFitsActiveAvailability(sql, {
      instructorId: booking.instructor_id,
      schoolId,
      date: new_date,
      startTime: new_start_time,
      endTime: new_end_time,
      transmissionType: booking.transmission_type,
    });
    if (!stillAvailable) {
      return res.status(409).json({ error: 'That slot is no longer available. Please choose another.' });
    }

    if (newPickupAddress) {
      if (await rejectIfPickupTravelConflict(res, sql, {
        instructorId: booking.instructor_id,
        schoolId,
        date: new_date,
        startTime: new_start_time,
        endTime: new_end_time,
        pickupAddress: newPickupAddress,
        excludeBookingId: booking_id,
      })) return;
    }

    // Atomically: mark old booking as refunded, create new one
    // 1. Mark old booking as refunded. credit_returned = TRUE prevents the
    // divergence cron from double-counting the deduction: the credit was
    // debited once on the original booking, the new booking carries the
    // same minutes_deducted forward, and the old row is no longer an
    // active draw. Without this, the cron's booking_draws CTE counts both
    // rows and reports +minutes_deducted of drift per reschedule (see
    // memory/project_step_4_5_shipped.md chip #3 entry for the three
    // historical bookings affected: #117, #133, #214).
    await sql`
      UPDATE lesson_bookings
      SET status = ${REFUNDED}, credit_returned = TRUE, cancelled_at = NOW()
      WHERE id = ${booking_id}
    `;
    const refundedBcsIds = await markBookingCreditSourcesRefunded(sql, { bookingId: booking_id, schoolId });

    // 2. Create new booking. Carry the Stripe fee snapshot forward — it was
    // paid on the original charge and the lesson is still happening, just at
    // a different time. (Step 4f.c.)
    //
    // list_price_pence + list_price_source carry forward for the same reason
    // (Step 1b): reschedule is not a new sale, so the list-price snapshot
    // taken at the original booking still represents what the learner paid
    // for this lesson. Recomputing here would mis-snapshot if the school
    // changed list prices between original booking and reschedule.
    let newBooking;
    try {
      const [b] = await sql`
        INSERT INTO lesson_bookings
          (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
           rescheduled_from, reschedule_count, pickup_address, dropoff_address,
           lesson_type_id, minutes_deducted, school_id,
           stripe_fee_pence, stripe_fee_source,
           list_price_pence, list_price_source, social_video_consent, social_video_age_confirmed, social_video_discount_pct)
        VALUES
          (${user.id}, ${booking.instructor_id}, ${new_date}, ${new_start_time}, ${new_end_time},
           ${SCHEDULED}, ${booking_id}, ${booking.reschedule_count + 1},
           ${newPickupAddress}, ${newDropoffAddress},
           ${booking.lesson_type_id || null}, ${booking.minutes_deducted != null ? booking.minutes_deducted : null},
           ${schoolId},
           ${booking.stripe_fee_pence != null ? booking.stripe_fee_pence : null},
           ${booking.stripe_fee_source || null},
           ${booking.list_price_pence != null ? booking.list_price_pence : null},
           ${booking.list_price_source || null},
           ${!!booking.social_video_consent},
           ${!!booking.social_video_age_confirmed},
           ${booking.social_video_discount_pct || 0})
        RETURNING id, scheduled_date, start_time::text, end_time::text, status,
                  rescheduled_from, reschedule_count
      `;
      newBooking = b;
    } catch (insertErr) {
      // Rollback: restore old booking. credit_returned must flip back to
      // FALSE in lockstep — leaving it TRUE while status returns to
      // SCHEDULED would silently exclude the booking from the cron's
      // booking_draws CTE, manufacturing -minutes_deducted of drift.
      await sql`
        UPDATE lesson_bookings
        SET status = ${SCHEDULED}, credit_returned = FALSE, cancelled_at = NULL
        WHERE id = ${booking_id}
      `;
      await restoreBookingCreditSourcesActive(sql, { bcsIds: refundedBcsIds, schoolId });
      if (insertErr.message?.includes('uq_booking_slot') || insertErr.code === '23505') {
        return res.status(409).json({ error: 'That slot was just booked by someone else. Please choose another.' });
      }
      throw insertErr;
    }
    await copyRefundedBookingCreditSources(sql, {
      bcsIds: refundedBcsIds,
      newBookingId: newBooking.id,
      schoolId,
    });

    // Send notifications
    const oldDateStr = formatDateDisplay(oldDate);
    const newDateStr = formatDateDisplay(new_date);
    const oldTime    = oldStart;
    const newTime    = new_start_time;
    const mailer     = createTransporter();
    const isDemoBooking = booking.instructor_email === 'demo@coachcarter.uk';

    // Generate .ics for new booking
    const icsContent = generateICS({
      id: newBooking.id,
      scheduled_date: new_date,
      start_time: new_start_time,
      end_time: new_end_time,
      instructor_name: booking.instructor_name
    });

    // Notifications are best-effort: reschedule DB writes are already complete.
    try {
      await mailer.sendMail({
      from:    'CoachCarter <bookings@coachcarter.uk>',
      to:      booking.learner_email,
      subject: `Lesson rescheduled — now ${newDateStr} at ${newTime}`,
      html: `
        <h1>Lesson rescheduled</h1>
        <p>Your lesson has been moved:</p>
        <table>
          <tr><td><strong>Was:</strong></td><td><s>${oldDateStr} at ${oldTime}</s></td></tr>
          <tr><td><strong>Now:</strong></td><td>${newDateStr} at ${newTime}</td></tr>
          <tr><td><strong>Instructor:</strong></td><td>${booking.instructor_name}</td></tr>
          <tr><td><strong>Duration:</strong></td><td>${formatHours(bookingDuration)}</td></tr>
        </table>
        <p style="margin-top:16px;font-size:0.875rem;color:#797879">
          You can reschedule ${MAX_RESCHEDULES - newBooking.reschedule_count} more time${MAX_RESCHEDULES - newBooking.reschedule_count !== 1 ? 's' : ''}.
          Cancel at least 48 hours before and the lesson credit returns to your balance.
        </p>
        <p>
          <a href="https://coachcarter.uk/learner/"
             style="background:#f58321;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold">
            View my bookings →
          </a>
        </p>
      `,
      attachments: [{
        filename: `coachcarter-lesson-${new_date}.ics`,
        content:  icsContent,
        contentType: 'text/calendar; method=PUBLISH'
      }]
      });
    } catch (emailErr) {
      console.warn('Learner reschedule email failed:', emailErr.message);
    }

    // Email to instructor (skip demo)
    if (!isDemoBooking) {
      try {
        await mailer.sendMail({
        from:    'CoachCarter <system@coachcarter.uk>',
        to:      booking.instructor_email,
        subject: `Lesson rescheduled — ${booking.learner_name}`,
        html: `
          <h2>Lesson rescheduled</h2>
          <p><strong>${booking.learner_name}</strong> has rescheduled their lesson:</p>
          <table>
            <tr><td><strong>Was:</strong></td><td>${oldDateStr} at ${oldTime}</td></tr>
            <tr><td><strong>Now:</strong></td><td>${newDateStr} at ${newTime}</td></tr>
          </table>
          <p style="margin-top:16px">
            <a href="https://coachcarter.uk/instructor/"
               style="background:#f58321;color:white;padding:10px 20px;text-decoration:none;
                      border-radius:8px;display:inline-block;font-weight:bold;font-size:0.9rem">
              View my schedule →
            </a>
          </p>
        `
        });
      } catch (emailErr) {
        console.warn('Instructor reschedule email failed:', emailErr.message);
      }
    }

    // WhatsApp notifications
    try {
      await sendWhatsApp(booking.learner_phone,
      `🔄 Lesson rescheduled!\n\n❌ Was: ${oldDateStr} at ${oldTime}\n✅ Now: ${newDateStr} at ${newTime}\n🚗 Instructor: ${booking.instructor_name}\n\nView bookings: https://coachcarter.uk/learner/`
    );
    } catch (waErr) {
      console.warn('Learner reschedule WhatsApp failed:', waErr.message);
    }
    if (!isDemoBooking) {
      try {
        await sendWhatsApp(booking.instructor_phone,
        `🔄 Lesson rescheduled\n\n👤 ${booking.learner_name}\n❌ Was: ${oldDateStr} at ${oldTime}\n✅ Now: ${newDateStr} at ${newTime}\n\nView schedule: https://coachcarter.uk/instructor/`
        );
      } catch (waErr) {
        console.warn('Instructor reschedule WhatsApp failed:', waErr.message);
      }
    }

    return res.json({
      ok: true,
      old_booking_id: booking_id,
      new_booking_id: newBooking.id,
      new_date,
      new_start_time,
      new_end_time,
      reschedule_count: newBooking.reschedule_count,
      message: `Lesson rescheduled from ${oldDateStr} at ${oldTime} to ${newDateStr} at ${newTime}.`
    });

  } catch (err) {
    console.error('slots reschedule error:', err);
    reportError('/api/slots', err);
    return res.status(500).json({ error: 'Reschedule failed', details: 'Internal server error' });
  }
}

// ── GET /api/slots?action=my-bookings ────────────────────────────────────────
// Returns the authenticated learner's upcoming and recent bookings.
async function handleMyBookings(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;
  const pastLimit = Math.min(parseInt(new URL(req.url, 'http://x').searchParams.get('past_limit')) || 20, 100);
  const pastOffset = parseInt(new URL(req.url, 'http://x').searchParams.get('past_offset')) || 0;

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const nowISO = new Date().toISOString().slice(0, 10);
    const [recurringTables] = await sql`
      SELECT
        to_regclass('public.recurring_slot_blocks') AS blocks_table,
        to_regclass('public.recurring_slot_block_items') AS items_table
    `;
    const hasRecurringSlotReadModel = Boolean(recurringTables?.blocks_table && recurringTables?.items_table);

    // Upcoming: all confirmed future lessons (no limit)
    const upcoming = hasRecurringSlotReadModel ? await sql`
      SELECT
        lb.id, lb.scheduled_date::text, lb.start_time::text, lb.end_time::text,
        lb.status, lb.cancelled_at, lb.credit_returned,
        COALESCE(lb.reschedule_count, 0) AS reschedule_count,
        lb.rescheduled_from, lb.pickup_address, lb.dropoff_address,
        COALESCE(to_jsonb(lb)->>'booking_purpose', 'lesson') AS booking_purpose,
        to_jsonb(lb)->>'test_start_time' AS test_start_time,
        to_jsonb(lb)->>'test_centre' AS test_centre,
        lb.lesson_type_id, lb.minutes_deducted, lb.series_id,
        COALESCE(lb.social_video_consent, false) AS social_video_consent,
        COALESCE(lb.social_video_age_confirmed, false) AS social_video_age_confirmed,
        COALESCE(lb.social_video_discount_pct, 0) AS social_video_discount_pct,
        rsb.id AS recurring_slot_block_id,
        rsbi.id AS recurring_slot_block_item_id,
        COALESCE(rsb.status = 'confirmed' AND rsbi.status = 'booked', false) AS is_reserved_weekly_slot,
        CASE
          WHEN rsb.status = 'confirmed' AND rsbi.status = 'booked' THEN ${RESERVED_MOVE_NOTICE_HOURS}
          ELSE NULL
        END AS reserved_move_notice_hours,
        CASE
          WHEN rsb.status = 'confirmed' AND rsbi.status = 'booked'
          THEN to_char(lb.scheduled_date::date + lb.start_time::time - (${RESERVED_MOVE_NOTICE_HOURS}::integer * INTERVAL '1 hour'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          ELSE NULL
        END AS reserved_move_request_deadline,
        CASE
          WHEN rsb.status = 'confirmed' AND rsbi.status = 'booked'
          THEN (NOW() < (lb.scheduled_date::date + lb.start_time::time - (${RESERVED_MOVE_NOTICE_HOURS}::integer * INTERVAL '1 hour')))
          ELSE NULL
        END AS reserved_move_policy_open,
        CASE
          WHEN rsb.status = 'confirmed' AND rsbi.status = 'booked'
          THEN 'policy_visible_admin_override'
          ELSE NULL
        END AS reserved_move_policy_mode,
        i.id AS instructor_id, i.name AS instructor_name, i.photo_url AS instructor_photo,
        lt.name AS lesson_type_name, lt.colour AS lesson_type_colour,
        COALESCE(
          lt.duration_minutes,
          CASE
            WHEN lb.end_time > lb.start_time
            THEN ROUND(EXTRACT(EPOCH FROM (lb.end_time - lb.start_time)) / 60)::int
            ELSE NULL
          END,
          ${DEFAULT_SLOT_MINUTES}
        ) AS duration_minutes
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      LEFT JOIN recurring_slot_block_items rsbi
        ON rsbi.lesson_booking_id = lb.id
       AND rsbi.school_id = COALESCE(lb.school_id, 1)
       AND rsbi.instructor_id = lb.instructor_id
       AND rsbi.status = 'booked'
      LEFT JOIN recurring_slot_blocks rsb
        ON rsb.id = rsbi.block_id
       AND rsb.school_id = COALESCE(lb.school_id, 1)
       AND rsb.learner_id = lb.learner_id
       AND rsb.instructor_id = lb.instructor_id
       AND rsb.status = 'confirmed'
      WHERE lb.learner_id = ${user.id}
        AND COALESCE(lb.school_id, 1) = ${schoolId}
        AND lb.status = ${SCHEDULED}
        AND lb.scheduled_date >= ${nowISO}
      ORDER BY lb.scheduled_date ASC, lb.start_time ASC
    ` : await sql`
      SELECT
        lb.id, lb.scheduled_date::text, lb.start_time::text, lb.end_time::text,
        lb.status, lb.cancelled_at, lb.credit_returned,
        COALESCE(lb.reschedule_count, 0) AS reschedule_count,
        lb.rescheduled_from, lb.pickup_address, lb.dropoff_address,
        COALESCE(to_jsonb(lb)->>'booking_purpose', 'lesson') AS booking_purpose,
        to_jsonb(lb)->>'test_start_time' AS test_start_time,
        to_jsonb(lb)->>'test_centre' AS test_centre,
        lb.lesson_type_id, lb.minutes_deducted, lb.series_id,
        COALESCE(lb.social_video_consent, false) AS social_video_consent,
        COALESCE(lb.social_video_age_confirmed, false) AS social_video_age_confirmed,
        COALESCE(lb.social_video_discount_pct, 0) AS social_video_discount_pct,
        NULL::integer AS recurring_slot_block_id,
        NULL::integer AS recurring_slot_block_item_id,
        false AS is_reserved_weekly_slot,
        NULL::integer AS reserved_move_notice_hours,
        NULL::text AS reserved_move_request_deadline,
        NULL::boolean AS reserved_move_policy_open,
        NULL::text AS reserved_move_policy_mode,
        i.id AS instructor_id, i.name AS instructor_name, i.photo_url AS instructor_photo,
        lt.name AS lesson_type_name, lt.colour AS lesson_type_colour,
        COALESCE(
          lt.duration_minutes,
          CASE
            WHEN lb.end_time > lb.start_time
            THEN ROUND(EXTRACT(EPOCH FROM (lb.end_time - lb.start_time)) / 60)::int
            ELSE NULL
          END,
          ${DEFAULT_SLOT_MINUTES}
        ) AS duration_minutes
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.learner_id = ${user.id}
        AND COALESCE(lb.school_id, 1) = ${schoolId}
        AND lb.status = ${SCHEDULED}
        AND lb.scheduled_date >= ${nowISO}
      ORDER BY lb.scheduled_date ASC, lb.start_time ASC
    `;

    // Past: paginated (completed, cancelled, or past confirmed)
    const past = hasRecurringSlotReadModel ? await sql`
      SELECT
        lb.id, lb.scheduled_date::text, lb.start_time::text, lb.end_time::text,
        lb.status, lb.cancelled_at, lb.credit_returned,
        COALESCE(lb.reschedule_count, 0) AS reschedule_count,
        lb.rescheduled_from, lb.pickup_address, lb.dropoff_address,
        COALESCE(to_jsonb(lb)->>'booking_purpose', 'lesson') AS booking_purpose,
        to_jsonb(lb)->>'test_start_time' AS test_start_time,
        to_jsonb(lb)->>'test_centre' AS test_centre,
        lb.lesson_type_id, lb.minutes_deducted, lb.series_id,
        COALESCE(lb.social_video_consent, false) AS social_video_consent,
        COALESCE(lb.social_video_age_confirmed, false) AS social_video_age_confirmed,
        COALESCE(lb.social_video_discount_pct, 0) AS social_video_discount_pct,
        rsb.id AS recurring_slot_block_id,
        rsbi.id AS recurring_slot_block_item_id,
        COALESCE(rsb.status = 'confirmed' AND rsbi.status = 'booked', false) AS is_reserved_weekly_slot,
        CASE
          WHEN rsb.status = 'confirmed' AND rsbi.status = 'booked' THEN ${RESERVED_MOVE_NOTICE_HOURS}
          ELSE NULL
        END AS reserved_move_notice_hours,
        CASE
          WHEN rsb.status = 'confirmed' AND rsbi.status = 'booked'
          THEN to_char(lb.scheduled_date::date + lb.start_time::time - (${RESERVED_MOVE_NOTICE_HOURS}::integer * INTERVAL '1 hour'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          ELSE NULL
        END AS reserved_move_request_deadline,
        CASE
          WHEN rsb.status = 'confirmed' AND rsbi.status = 'booked'
          THEN (NOW() < (lb.scheduled_date::date + lb.start_time::time - (${RESERVED_MOVE_NOTICE_HOURS}::integer * INTERVAL '1 hour')))
          ELSE NULL
        END AS reserved_move_policy_open,
        CASE
          WHEN rsb.status = 'confirmed' AND rsbi.status = 'booked'
          THEN 'policy_visible_admin_override'
          ELSE NULL
        END AS reserved_move_policy_mode,
        i.id AS instructor_id, i.name AS instructor_name, i.photo_url AS instructor_photo,
        lt.name AS lesson_type_name, lt.colour AS lesson_type_colour,
        COALESCE(
          lt.duration_minutes,
          CASE
            WHEN lb.end_time > lb.start_time
            THEN ROUND(EXTRACT(EPOCH FROM (lb.end_time - lb.start_time)) / 60)::int
            ELSE NULL
          END,
          ${DEFAULT_SLOT_MINUTES}
        ) AS duration_minutes
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      LEFT JOIN recurring_slot_block_items rsbi
        ON rsbi.lesson_booking_id = lb.id
       AND rsbi.school_id = COALESCE(lb.school_id, 1)
       AND rsbi.instructor_id = lb.instructor_id
       AND rsbi.status = 'booked'
      LEFT JOIN recurring_slot_blocks rsb
        ON rsb.id = rsbi.block_id
       AND rsb.school_id = COALESCE(lb.school_id, 1)
       AND rsb.learner_id = lb.learner_id
       AND rsb.instructor_id = lb.instructor_id
       AND rsb.status = 'confirmed'
      WHERE lb.learner_id = ${user.id}
        AND COALESCE(lb.school_id, 1) = ${schoolId}
        AND NOT (lb.status = ${SCHEDULED} AND lb.scheduled_date >= ${nowISO})
      ORDER BY lb.scheduled_date DESC, lb.start_time DESC
      LIMIT ${pastLimit + 1}
      OFFSET ${pastOffset}
    ` : await sql`
      SELECT
        lb.id, lb.scheduled_date::text, lb.start_time::text, lb.end_time::text,
        lb.status, lb.cancelled_at, lb.credit_returned,
        COALESCE(lb.reschedule_count, 0) AS reschedule_count,
        lb.rescheduled_from, lb.pickup_address, lb.dropoff_address,
        COALESCE(to_jsonb(lb)->>'booking_purpose', 'lesson') AS booking_purpose,
        to_jsonb(lb)->>'test_start_time' AS test_start_time,
        to_jsonb(lb)->>'test_centre' AS test_centre,
        lb.lesson_type_id, lb.minutes_deducted, lb.series_id,
        COALESCE(lb.social_video_consent, false) AS social_video_consent,
        COALESCE(lb.social_video_age_confirmed, false) AS social_video_age_confirmed,
        COALESCE(lb.social_video_discount_pct, 0) AS social_video_discount_pct,
        NULL::integer AS recurring_slot_block_id,
        NULL::integer AS recurring_slot_block_item_id,
        false AS is_reserved_weekly_slot,
        NULL::integer AS reserved_move_notice_hours,
        NULL::text AS reserved_move_request_deadline,
        NULL::boolean AS reserved_move_policy_open,
        NULL::text AS reserved_move_policy_mode,
        i.id AS instructor_id, i.name AS instructor_name, i.photo_url AS instructor_photo,
        lt.name AS lesson_type_name, lt.colour AS lesson_type_colour,
        COALESCE(
          lt.duration_minutes,
          CASE
            WHEN lb.end_time > lb.start_time
            THEN ROUND(EXTRACT(EPOCH FROM (lb.end_time - lb.start_time)) / 60)::int
            ELSE NULL
          END,
          ${DEFAULT_SLOT_MINUTES}
        ) AS duration_minutes
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.learner_id = ${user.id}
        AND COALESCE(lb.school_id, 1) = ${schoolId}
        AND NOT (lb.status = ${SCHEDULED} AND lb.scheduled_date >= ${nowISO})
      ORDER BY lb.scheduled_date DESC, lb.start_time DESC
      LIMIT ${pastLimit + 1}
      OFFSET ${pastOffset}
    `;

    const hasMorePast = past.length > pastLimit;
    if (hasMorePast) past.pop();

    return res.json({ upcoming, past, hasMorePast });

  } catch (err) {
    console.error('slots my-bookings error:', err);
    reportError('/api/slots', err);
    return res.status(500).json({ error: 'Failed to load bookings', details: 'Internal server error' });
  }
}

// ── GET /api/slots?action=series-info&booking_id=X ──────────────────────────
// Returns all bookings in a series, given any booking ID from that series.
async function handleSeriesInfo(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  const { booking_id } = req.query;
  if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Find the series_id for this booking
    const [target] = await sql`
      SELECT series_id FROM lesson_bookings
      WHERE id = ${booking_id} AND learner_id = ${user.id}
        AND COALESCE(school_id, 1) = ${schoolId}
    `;
    if (!target)
      return res.status(404).json({ error: 'Booking not found' });
    if (!target.series_id)
      return res.json({ ok: true, series: null, message: 'This booking is not part of a series' });

    // Load all bookings in the series
    const bookings = await sql`
      SELECT
        lb.id,
        lb.scheduled_date::text,
        lb.start_time::text,
        lb.end_time::text,
        lb.status,
        lb.cancelled_at,
        lb.credit_returned,
        lb.series_id,
        i.name AS instructor_name,
        lt.name AS lesson_type_name,
        lt.colour AS lesson_type_colour,
        COALESCE(
          lt.duration_minutes,
          CASE
            WHEN lb.end_time > lb.start_time
            THEN ROUND(EXTRACT(EPOCH FROM (lb.end_time - lb.start_time)) / 60)::int
            ELSE NULL
          END,
          ${DEFAULT_SLOT_MINUTES}
        ) AS duration_minutes
      FROM lesson_bookings lb
      JOIN instructors i ON i.id = lb.instructor_id
      LEFT JOIN lesson_types lt ON lt.id = lb.lesson_type_id
      WHERE lb.series_id = ${target.series_id} AND lb.learner_id = ${user.id}
        AND COALESCE(lb.school_id, 1) = ${schoolId}
      ORDER BY lb.scheduled_date, lb.start_time
    `;

    const confirmed = bookings.filter(b => b.status === SCHEDULED);
    const future = confirmed.filter(b => new Date(`${b.scheduled_date}T${b.start_time}Z`) > new Date());

    return res.json({
      ok: true,
      series_id: target.series_id,
      total: bookings.length,
      confirmed: confirmed.length,
      remaining: future.length,
      bookings
    });

  } catch (err) {
    console.error('slots series-info error:', err);
    reportError('/api/slots', err);
    return res.status(500).json({ error: 'Failed to load series info', details: 'Internal server error' });
  }
}

// ── ICS calendar file generation ──────────────────────────────────────────────

function generateICS(booking) {
  const dtStart = toICSDate(booking.scheduled_date, booking.start_time);
  const dtEnd   = toICSDate(booking.scheduled_date, booking.end_time);
  const uid     = `booking-${booking.id}@coachcarter.uk`;
  const now     = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CoachCarter//Lesson Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${booking.lesson_type_name || 'Driving Lesson'} — ${booking.instructor_name}`,
    `DESCRIPTION:${booking.duration_str || '1.5 hours'} ${booking.lesson_type_name || 'driving lesson'} with ${booking.instructor_name}.\\n\\nManage your bookings: https://coachcarter.uk/learner/book.html\\n\\nNeed to cancel? Do so at least 48 hours before and the lesson credit returns to your balance.`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Driving lesson in 2 hours',
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Driving lesson in 15 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

// "2026-03-15", "09:30" → "20260315T093000"
function toICSDate(dateStr, timeStr) {
  const d = dateStr.replace(/-/g, '');
  const t = timeStr.replace(/:/g, '').slice(0, 6);
  return `${d}T${t.padEnd(6, '0')}`;
}

// ── Date/time helpers ─────────────────────────────────────────────────────────

// "09:30" or "09:30:00" → minutes from midnight
function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// 570 → "09:30"
function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// "2026-03-15" → Date (UTC midnight)
function parseDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const d = new Date(str + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}

// Date → "YYYY-MM-DD"
function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d, n) {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

// "2026-03-15" or Date → "Saturday 15 March 2026"
function formatDateDisplay(str) {
  const iso = str instanceof Date ? str.toISOString().slice(0, 10) : String(str).slice(0, 10);
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });
}

module.exports._bookCreditFundedSlotsTransaction = bookCreditFundedSlotsTransaction;
module.exports._createRecurringBlockBankHoldTransaction = createRecurringBlockBankHoldTransaction;
module.exports._expireStaleRecurringBlockBankHoldForLearner = expireStaleRecurringBlockBankHoldForLearner;
module.exports._buildRecurringBlockPreview = buildRecurringBlockPreview;
module.exports._parseRecurringBlockLessons = parseRecurringBlockLessons;
module.exports._CREDIT_BOOKING_SOURCE_TYPES = CREDIT_BOOKING_SOURCE_TYPES;
module.exports._hasBufferedSlotConflict = hasBufferedSlotConflict;
module.exports._findAdjacentTravelSpacingConflict = findAdjacentTravelSpacingConflict;
module.exports._testDateSlotOverlapConflictsPg = testDateSlotOverlapConflictsPg;
