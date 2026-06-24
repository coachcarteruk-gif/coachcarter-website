const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  _hasBufferedSlotConflict,
  _findAdjacentTravelSpacingConflict,
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
