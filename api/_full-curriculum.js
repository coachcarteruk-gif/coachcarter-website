'use strict';

const FULL_CURRICULUM_SLUG = 'full-curriculum';
const INTERNAL_PHASE_SLUGS = Object.freeze([
  'phase-1-fundamental',
  'phase-2-intermediate',
  'phase-3-independent',
]);
const ACTIVE_ENROLMENT_STATUSES = Object.freeze([
  'paid_matching',
  'active',
  'assessment_pending',
  'retake_pending',
  'retake_active',
]);
const BASE_WEEK_MINUTES = 90;
const MAX_PROGRAMME_WEEKS = 24;
const RETAKE_TOTAL_MINUTES = 600;
const RETAKE_ALLOWED_DURATIONS = Object.freeze([90, 120]);
const DEFAULT_OPERATIONAL_TIMEZONE = 'Europe/London';

function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value }).format();
    return true;
  } catch (error) {
    return false;
  }
}

function operationalTimeZone(config) {
  const configured = String(config?.timezone || '').trim();
  return configured && configured.length <= 100 && isValidTimeZone(configured)
    ? configured
    : DEFAULT_OPERATIONAL_TIMEZONE;
}

function zonedDateTimeToDate(date, time, timezone = DEFAULT_OPERATIONAL_TIMEZONE) {
  const zone = String(timezone || '').trim();
  if (!isValidTimeZone(zone)) return null;
  const dateMatch = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(time || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!dateMatch || !timeMatch) return null;

  const wanted = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const partsAt = (instant) => Object.fromEntries(
    formatter.formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  const offsetAt = (instant) => {
    const parts = partsAt(instant);
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
      - instant.getTime();
  };

  const localAsUtc = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute, 0);
  let instant = new Date(localAsUtc);
  instant = new Date(localAsUtc - offsetAt(instant));
  instant = new Date(localAsUtc - offsetAt(instant));
  const actual = partsAt(instant);
  if (actual.year !== wanted.year || actual.month !== wanted.month || actual.day !== wanted.day
      || actual.hour !== wanted.hour || actual.minute !== wanted.minute) return null;
  return instant;
}

function parseRecurringAvailability(windows, timezone = DEFAULT_OPERATIONAL_TIMEZONE) {
  const zone = String(timezone || '').trim();
  if (!zone || zone.length > 100 || !isValidTimeZone(zone)) {
    return { ok: false, code: 'INVALID_AVAILABILITY_TIMEZONE' };
  }
  if (!Array.isArray(windows) || windows.length > 50) {
    return { ok: false, code: 'INVALID_AVAILABILITY_WINDOWS' };
  }
  const normalised = [];
  const seen = new Set();
  for (const window of windows) {
    const weekday = Number(window?.weekday);
    const startTime = String(window?.local_start_time || '').trim();
    const endTime = String(window?.local_end_time || '').trim();
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7
        || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)
        || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)
        || endTime <= startTime) {
      return { ok: false, code: 'INVALID_AVAILABILITY_WINDOW' };
    }
    const key = `${weekday}:${startTime}:${endTime}`;
    if (seen.has(key)) return { ok: false, code: 'DUPLICATE_AVAILABILITY_WINDOW' };
    seen.add(key);
    normalised.push({ weekday, localStartTime: startTime, localEndTime: endTime });
  }
  normalised.sort((left, right) => left.weekday - right.weekday
    || left.localStartTime.localeCompare(right.localStartTime)
    || left.localEndTime.localeCompare(right.localEndTime));
  return { ok: true, timezone: zone, windows: normalised };
}

function isInternalPhaseProduct(product) {
  return INTERNAL_PHASE_SLUGS.includes(String(product?.slug || product || ''));
}

function parseFutureTestBooking(
  { test_date, test_time, test_centre },
  now = new Date(),
  timezone = DEFAULT_OPERATIONAL_TIMEZONE
) {
  const date = String(test_date || '').trim();
  const time = String(test_time || '').trim();
  const centre = String(test_centre || '').trim().replace(/\s+/g, ' ');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, code: 'INVALID_TEST_DATE' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, code: 'INVALID_TEST_TIME' };
  if (centre.length < 2 || centre.length > 160) return { ok: false, code: 'INVALID_TEST_CENTRE' };
  const testAt = zonedDateTimeToDate(date, time, timezone);
  if (!testAt || testAt <= now) return { ok: false, code: 'TEST_BOOKING_NOT_FUTURE' };
  return { ok: true, testDate: date, testTime: time, testCentre: centre, testAt, timezone };
}

function programmeBoundaries(startAt, firstTestAt) {
  const start = new Date(startAt);
  const test = new Date(firstTestAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(test.getTime()) || test <= start) return null;
  const cap = new Date(start.getTime() + MAX_PROGRAMME_WEEKS * 7 * 24 * 60 * 60 * 1000);
  return {
    startsAt: start,
    firstTestAt: test,
    twentyFourWeekCapAt: cap,
    baseEndsAt: test < cap ? test : cap,
  };
}

function buildProgrammeWeeks(startAt, firstTestAt) {
  const bounds = programmeBoundaries(startAt, firstTestAt);
  if (!bounds) return [];
  const weeks = [];
  for (let index = 0; index < MAX_PROGRAMME_WEEKS; index += 1) {
    const weekStart = new Date(bounds.startsAt.getTime() + index * 7 * 24 * 60 * 60 * 1000);
    if (weekStart >= bounds.baseEndsAt) break;
    const naturalEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    weeks.push({
      weekNumber: index + 1,
      weekStart,
      weekEnd: naturalEnd < bounds.baseEndsAt ? naturalEnd : bounds.baseEndsAt,
      opportunityMinutes: BASE_WEEK_MINUTES,
    });
  }
  return weeks;
}

function catalogueEligibility(product, options = {}) {
  const slug = String(product?.slug || '');
  const purchasingEnabled = options.purchasingEnabled === true;
  const sameSchoolLearner = options.sameSchoolLearner === true;
  if (isInternalPhaseProduct(slug)) {
    return {
      state: 'internal_stage', purchase_eligible: false, checkout_available: false,
      reason: 'This is an internal Full Curriculum progress stage, not a product for purchase.',
    };
  }
  if (slug !== FULL_CURRICULUM_SLUG) {
    return {
      state: 'visible_not_fulfilled', purchase_eligible: false, checkout_available: false,
      reason: 'This package is visible for comparison, but its fulfilment is not implemented in this test foundation.',
    };
  }
  if (!purchasingEnabled) {
    return {
      state: 'available_to_compare', purchase_eligible: false, checkout_available: false,
      reason: 'Full Curriculum test purchasing is disabled for this school.',
    };
  }
  if (!sameSchoolLearner) {
    return {
      state: 'authentication_required', purchase_eligible: false, checkout_available: false,
      reason: 'Sign in as the learner who will own the programme.',
    };
  }
  if (options.hasActiveEnrolment === true) {
    return {
      state: 'already_enrolled', purchase_eligible: false, checkout_available: false,
      reason: 'This learner already has an active Full Curriculum enrolment.',
    };
  }
  if (options.testBookingStatus !== 'verified' || options.testBookingFuture !== true) {
    return {
      state: options.testBookingStatus === 'pending' ? 'verification_pending' : 'test_booking_required',
      purchase_eligible: false,
      checkout_available: false,
      reason: options.testBookingStatus === 'pending'
        ? 'An admin must manually verify the supplied DVSA practical car test details before checkout.'
        : 'A verified future DVSA practical car test booking belonging to this learner is required.',
    };
  }
  return {
    state: 'test_checkout_available', purchase_eligible: true, checkout_available: true,
    reason: 'Eligible for the dedicated test-mode Full Curriculum checkout.',
  };
}

function weeklyCancellationOutcome({ cancelledBy, noticeHours, replacementDelivered = false }) {
  if (cancelledBy === 'coachcarter' || cancelledBy === 'instructor') {
    return {
      opportunityStatus: replacementDelivered ? 'booked' : 'replacement_required',
      used: replacementDelivered,
      mayExtend: !replacementDelivered,
    };
  }
  if (cancelledBy === 'learner' && Number(noticeHours) < 48) {
    return { opportunityStatus: 'used_late_cancel', used: true, mayExtend: false };
  }
  if (cancelledBy === 'learner') {
    return { opportunityStatus: replacementDelivered ? 'booked' : 'unused', used: replacementDelivered, mayExtend: false };
  }
  return { opportunityStatus: 'manual_review', used: false, mayExtend: false };
}

function retakeWindow(secondTestAt) {
  const closesAt = new Date(secondTestAt);
  if (Number.isNaN(closesAt.getTime())) return null;
  return {
    opensAt: new Date(closesAt.getTime() - 28 * 24 * 60 * 60 * 1000),
    closesAt,
  };
}

function validateRetakeAllocation({ durationMinutes, bookingAt, secondTestAt, alreadyConsumedMinutes = 0 }) {
  const duration = Number(durationMinutes);
  const consumed = Number(alreadyConsumedMinutes);
  const window = retakeWindow(secondTestAt);
  const booking = new Date(bookingAt);
  if (!RETAKE_ALLOWED_DURATIONS.includes(duration)) return { ok: false, code: 'RETAKE_DURATION_NOT_ALLOWED' };
  if (!window || Number.isNaN(booking.getTime()) || booking < window.opensAt) return { ok: false, code: 'RETAKE_WINDOW_NOT_OPEN' };
  if (booking >= window.closesAt) return { ok: false, code: 'RETAKE_ALLOWANCE_EXPIRED' };
  if (!Number.isSafeInteger(consumed) || consumed < 0 || consumed + duration > RETAKE_TOTAL_MINUTES) {
    return { ok: false, code: 'RETAKE_ALLOWANCE_EXCEEDED' };
  }
  return { ok: true, remainingMinutes: RETAKE_TOTAL_MINUTES - consumed - duration, window };
}

module.exports = {
  ACTIVE_ENROLMENT_STATUSES,
  BASE_WEEK_MINUTES,
  DEFAULT_OPERATIONAL_TIMEZONE,
  FULL_CURRICULUM_SLUG,
  INTERNAL_PHASE_SLUGS,
  MAX_PROGRAMME_WEEKS,
  RETAKE_ALLOWED_DURATIONS,
  RETAKE_TOTAL_MINUTES,
  buildProgrammeWeeks,
  catalogueEligibility,
  isInternalPhaseProduct,
  operationalTimeZone,
  parseRecurringAvailability,
  parseFutureTestBooking,
  programmeBoundaries,
  retakeWindow,
  validateRetakeAllocation,
  weeklyCancellationOutcome,
  zonedDateTimeToDate,
};
