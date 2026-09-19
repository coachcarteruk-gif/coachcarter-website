const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_free_trial_safeguards';
const {
  _hasBufferedSlotConflict,
  _findAdjacentTravelSpacingConflict,
  _effectiveBookingWindowDays,
  _isDateWithinBookingWindow,
  _FREE_TRIAL_MAX_DAYS_AHEAD,
} = require('../api/slots');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test.describe('free trial scheduling safeguards', () => {
  test('buffer blocks an exact-touching trial before an existing lesson', () => {
    expect(_hasBufferedSlotConflict(
      9 * 60,
      10 * 60,
      10 * 60,
      11 * 60,
      30
    )).toBe(true);
  });

  test('exact-touching boundary is allowed when no buffer is required', () => {
    expect(_hasBufferedSlotConflict(
      9 * 60,
      10 * 60,
      10 * 60,
      11 * 60,
      0
    )).toBe(false);
  });

  test('zero buffer still blocks true overlaps', () => {
    expect(_hasBufferedSlotConflict(
      9 * 60,
      10 * 60,
      9 * 60 + 30,
      10 * 60 + 30,
      0
    )).toBe(true);
  });

  test('same-postcode travel spacing blocks an exact-touching trial before an existing lesson', () => {
    const conflict = _findAdjacentTravelSpacingConflict({
      slotStart: 9 * 60,
      slotEnd: 10 * 60,
      pickupPostcode: 'B1 1AA',
      bookedSlots: [{
        start: 10 * 60,
        end: 11 * 60,
        postcode: 'B1 1AA',
      }],
    });

    expect(conflict).toMatchObject({
      direction: 'after',
      gap_minutes: 0,
      travel_minutes: 0,
    });
  });

  test('free trial picker resolves the active trial lesson type by slug', () => {
    const page = read('public/free-trial.js');
    const api = read('api/slots.js');

    expect(page).toContain('lesson_type_slug=trial');
    expect(page).not.toContain('FREE_TRIAL_LESSON_TYPE_ID');
    expect(page).not.toContain('lesson_type_id=37');
    expect(api).toContain('lesson_type_slug');
    expect(api).toContain('WHERE slug = ${slug} AND active = true AND school_id = ${schoolId}');
  });

  test('free trial picker requests the full bounded 28-day window', () => {
    const page = read('public/free-trial.js');

    expect(page).toContain('var DAYS_AHEAD = 28;');
    expect(page).toContain("lesson_type_slug=trial");
  });

  test('free trial window is the shorter of 28 days and the instructor setting', () => {
    expect(_FREE_TRIAL_MAX_DAYS_AHEAD).toBe(28);
    expect(_effectiveBookingWindowDays(84, _FREE_TRIAL_MAX_DAYS_AHEAD)).toBe(28);
    expect(_effectiveBookingWindowDays(14, _FREE_TRIAL_MAX_DAYS_AHEAD)).toBe(14);
  });

  test('free trial booking allows day 28 but rejects a malicious day-29 submission', () => {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day28 = new Date(today);
    day28.setUTCDate(day28.getUTCDate() + 28);
    const day29 = new Date(today);
    day29.setUTCDate(day29.getUTCDate() + 29);

    expect(_isDateWithinBookingWindow(day28, 84, _FREE_TRIAL_MAX_DAYS_AHEAD)).toBe(true);
    expect(_isDateWithinBookingWindow(day29, 84, _FREE_TRIAL_MAX_DAYS_AHEAD)).toBe(false);
  });

  test('ordinary paid booking windows retain the platform and instructor limits', () => {
    expect(_effectiveBookingWindowDays(84)).toBe(84);
    expect(_effectiveBookingWindowDays(21)).toBe(21);

    const api = read('api/slots.js');
    const paidCheckout = functionBody(api, 'handleCheckoutSlot');
    const freeTrialBooking = functionBody(api, 'handleBookFreeTrial');
    expect(paidCheckout).toContain('isDateWithinBookingWindow(checkoutDate, instructor.max_booking_days_ahead)');
    expect(paidCheckout).not.toContain('FREE_TRIAL_MAX_DAYS_AHEAD');
    expect(freeTrialBooking).toContain('FREE_TRIAL_MAX_DAYS_AHEAD,');
    expect(freeTrialBooking).toContain('todayStart');
  });

  test('free trial reschedules use the same bounded window', () => {
    const reschedule = functionBody(read('api/slots.js'), 'handleReschedule');

    expect(reschedule).toContain("booking.lesson_type_slug === 'trial'");
    expect(reschedule).toContain('? FREE_TRIAL_MAX_DAYS_AHEAD');
    expect(reschedule).toContain('Free trials can only be rescheduled up to');
  });

  test('learner cancellation releases self-serve free trial bookings', () => {
    const api = read('api/slots.js');
    const cancel = functionBody(api, 'handleCancel');

    expect(api).toContain('function isSelfServeFreeTrialBooking(booking)');
    expect(api).toContain("booking?.created_by === 'free_trial_self_serve'");
    expect(api).toContain("booking?.payment_method === 'free'");
    expect(cancel).toContain('const isSelfServeFreeTrial = isSelfServeFreeTrialBooking(booking);');
    expect(cancel).toContain('&& !isSelfServeFreeTrial');
    expect(cancel).toContain('const bookingReleased = creditReturned || isSelfServeFreeTrial;');
    expect(cancel).toContain('} else if (isSelfServeFreeTrial) {');
    expect(cancel).toContain('SET status = ${REFUNDED}, cancelled_at = NOW(), credit_returned = FALSE, credit_forfeited = FALSE');
    expect(cancel).toContain('if (bookingReleased) {');
    expect(cancel).toContain('Free trial cancelled.');

    const selfServeBranch = cancel.slice(
      cancel.indexOf('} else if (isSelfServeFreeTrial) {'),
      cancel.indexOf('} else {', cancel.indexOf('} else if (isSelfServeFreeTrial) {'))
    );
    expect(selfServeBranch).not.toContain('markBookingCreditSourcesRefunded');
    expect(selfServeBranch).not.toContain('lockBalanceAdjustLCB');
    expect(selfServeBranch).not.toContain('free_trial_allowed');
    expect(cancel).not.toContain('UPDATE learner_users SET free_trial_allowed');
  });

  test('instructor cancellation keeps self-serve free trials out of credits', () => {
    const api = read('api/instructor.js');
    const cancel = functionBody(api, 'handleCancelBooking');

    expect(api).toContain('function isSelfServeFreeTrialBooking(booking)');
    expect(cancel).toContain('lb.created_by, lb.payment_method');
    expect(cancel).toContain('const isSelfServeFreeTrial = isSelfServeFreeTrialBooking(booking);');
    expect(cancel).toContain('const isZeroCreditFree = isZeroCreditFreeBooking(booking);');
    expect(cancel).toContain('const minsToReturn = isZeroCreditFree ? 0');
    expect(cancel).toContain('Number(booking.minutes_deducted ?? 90)');
    expect(cancel).not.toContain('Number(booking.minutes_deducted || 90)');
    expect(cancel).toContain('credit_returned = ${!isZeroCreditFree}, credit_forfeited = FALSE');
    expect(cancel).toContain('if (!isZeroCreditFree) {');

    const refundBranch = cancel.slice(
      cancel.indexOf('if (!isZeroCreditFree) {'),
      cancel.indexOf('// Email the learner', cancel.indexOf('if (!isZeroCreditFree) {'))
    );
    expect(refundBranch).toContain('markBookingCreditSourcesRefunded');
    expect(refundBranch).toContain('lockBalanceAdjustLCB');
    expect(cancel).toContain('No lesson credit was used for this free trial.');
    expect(cancel).toContain('No lesson credit was used for this free booking.');
    expect(cancel).not.toContain('UPDATE learner_users SET free_trial_allowed');
  });

  test('migration repairs already-cancelled self-serve free trial rows only', () => {
    const migration = read('db/migration.sql');

    expect(migration).toContain('Free-trial cancellation repair');
    expect(migration).toContain("SET status = 'refunded'");
    expect(migration).toContain("WHERE status = 'scheduled'");
    expect(migration).toContain('AND cancelled_at IS NOT NULL');
    expect(migration).toContain("AND created_by = 'free_trial_self_serve'");
    expect(migration).toContain("AND payment_method = 'free'");
    expect(migration).toContain('AND COALESCE(minutes_deducted, 0) = 0');
  });
});
