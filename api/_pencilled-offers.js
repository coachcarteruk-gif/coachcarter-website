'use strict';

const {
  operationalTimeZone,
  zonedDateTimeToDate,
} = require('./_full-curriculum');

const PENCILLED_OFFER_HOLD_HOURS = 48;
const PENCILLED_OFFER_EXPIRY_HOURS = Object.freeze([12, 24, 48]);
const PENCILLED_OFFER_MAX_LOCAL_DAYS_AHEAD = 84;

function isPencilledOffer(value) {
  return value?.pencilled === true;
}

function localDateAt(instant, timezone) {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function localCalendarDayDifference(fromDate, toDate) {
  const parse = value => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const milliseconds = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const roundTrip = new Date(milliseconds).toISOString().slice(0, 10);
    return roundTrip === value ? milliseconds : null;
  };
  const from = parse(fromDate);
  const to = parse(toDate);
  if (from === null || to === null) return null;
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

function pencilledOfferTimes({ scheduledDate, startTime, schoolConfig, timezone, expiryHours = PENCILLED_OFFER_HOLD_HOURS }) {
  if (!PENCILLED_OFFER_EXPIRY_HOURS.includes(expiryHours)) return null;
  const resolvedTimezone = timezone || operationalTimeZone(schoolConfig);
  const lessonStartsAt = zonedDateTimeToDate(scheduledDate, startTime, resolvedTimezone);
  if (!lessonStartsAt) return null;
  const expiresAt = new Date(
    lessonStartsAt.getTime() - expiryHours * 60 * 60 * 1000
  );
  return {
    timezone: resolvedTimezone,
    expiryHours,
    lessonStartsAt,
    expiresAt,
    payBy: expiresAt,
  };
}

function invalid(code) {
  return { ok: false, code };
}

function normaliseTime(value) {
  const match = String(value ?? '').match(/^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/);
  return match ? `${match[1]}:${match[2]}` : null;
}

// `schoolId` and `learnerSchoolId` are trusted scope resolved by the caller
// from authenticated/database state. This helper validates their relationship;
// it does not establish account ownership from request fields.
function validatePencilledOfferCreation(input, options = {}) {
  if (input?.pencilled !== true) return invalid('PENCILLED_FLAG_REQUIRED');

  const schoolId = Number(options.schoolId);
  const learnerId = Number(input.learner_id);
  const learnerSchoolId = Number(options.learnerSchoolId);
  if (!Number.isSafeInteger(schoolId) || schoolId <= 0) return invalid('INVALID_SCHOOL');
  if (!Number.isSafeInteger(learnerId) || learnerId <= 0) return invalid('EXISTING_LEARNER_REQUIRED');
  if (learnerSchoolId !== schoolId) return invalid('LEARNER_SCHOOL_MISMATCH');

  if (String(input.kind || 'manual') !== 'manual') return invalid('MANUAL_OFFER_REQUIRED');
  if (input.extension_booking_id != null) return invalid('EXTENSION_NOT_ALLOWED');
  if (!input.scheduled_date || !input.start_time || !input.end_time) return invalid('FIXED_SLOT_REQUIRED');
  const startTime = normaliseTime(input.start_time);
  const endTime = normaliseTime(input.end_time);
  if (!startTime || !endTime || endTime <= startTime) return invalid('INVALID_FIXED_SLOT');
  if (input.max_repeat_weeks != null && Number(input.max_repeat_weeks) !== 1) {
    return invalid('REPEAT_NOT_ALLOWED');
  }
  if (String((options.lessonTypeSlug ?? input.lesson_type_slug) || '') === 'trial') {
    return invalid('TRIAL_NOT_ALLOWED');
  }
  const pricePence = Number(input.offer_price_pence);
  if (!Number.isSafeInteger(pricePence) || pricePence <= 0) return invalid('POSITIVE_PRICE_REQUIRED');

  const now = new Date(options.now ?? Date.now());
  if (Number.isNaN(now.getTime())) return invalid('INVALID_NOW');
  const expiryHours = input.pencilled_expiry_hours === undefined
    ? PENCILLED_OFFER_HOLD_HOURS : input.pencilled_expiry_hours;
  if (!PENCILLED_OFFER_EXPIRY_HOURS.includes(expiryHours)) return invalid('INVALID_PENCILLED_EXPIRY_HOURS');
  const times = pencilledOfferTimes({
    scheduledDate: input.scheduled_date,
    startTime,
    schoolConfig: options.schoolConfig,
    timezone: options.timezone,
    expiryHours,
  });
  if (!times) return invalid('INVALID_LESSON_START');

  const today = localDateAt(now, times.timezone);
  const daysAhead = localCalendarDayDifference(today, input.scheduled_date);
  if (daysAhead === null || daysAhead < 0) return invalid('LESSON_DATE_IN_PAST');
  if (daysAhead > PENCILLED_OFFER_MAX_LOCAL_DAYS_AHEAD) return invalid('LESSON_BEYOND_84_LOCAL_DAYS');
  if (now >= times.expiresAt) return invalid('PAYMENT_DEADLINE_REACHED');

  return {
    ok: true,
    learnerId,
    schoolId,
    pricePence,
    daysAhead,
    ...times,
  };
}

function pencilledPaymentWasOnTime({ offer, paymentSucceededAt }) {
  if (!isPencilledOffer(offer)) return false;
  if (paymentSucceededAt == null || paymentSucceededAt === '') return false;
  const deadlineValue = offer.expires_at ?? offer.expiresAt ?? offer.pay_by ?? offer.payBy;
  if (deadlineValue == null || deadlineValue === '') return false;
  const paidAt = new Date(paymentSucceededAt);
  const deadline = new Date(deadlineValue);
  if (Number.isNaN(paidAt.getTime()) || Number.isNaN(deadline.getTime())) return false;
  return paidAt < deadline;
}

module.exports = {
  PENCILLED_OFFER_HOLD_HOURS,
  PENCILLED_OFFER_MAX_LOCAL_DAYS_AHEAD,
  isPencilledOffer,
  localCalendarDayDifference,
  pencilledOfferTimes,
  validatePencilledOfferCreation,
  pencilledPaymentWasOnTime,
};
