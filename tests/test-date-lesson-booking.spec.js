// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test.describe('test date lesson booking contract', () => {
  test('schema stores a narrow booking purpose and practical test snapshot', () => {
    const migration = read('db/migration.sql');
    expect(migration).toContain("booking_purpose TEXT NOT NULL DEFAULT 'lesson'");
    expect(migration).toContain('test_start_time TEXT');
    expect(migration).toContain('test_centre TEXT');
    expect(migration).toContain("booking_purpose IN ('lesson', 'test_date')");
  });

  test('slots API exposes dedicated test-date actions without changing normal cap constants', () => {
    const slots = read('api/slots.js');
    expect(slots).toContain('const MAX_DAYS_AHEAD      = 28');
    expect(slots).toContain('const TEST_DATE_DURATION_MINUTES = 90');
    expect(slots).toContain('const TEST_DATE_MAX_DAYS_AHEAD = 366');
    expect(slots).toContain("action === 'test-date-availability'");
    expect(slots).toContain("action === 'book-test-date'");
    expect(slots).toContain("action === 'checkout-test-date'");
    expect(slots).toContain('enforceBookingWindow: false');
    expect(slots).toContain('isWithinTestDateUpperBound(testDate)');
    expect(slots).toContain('parseInt(submittedDuration, 10) !== TEST_DATE_DURATION_MINUTES');
  });

  test('test-date options are generated around test time minus 45 minutes on quarter-hour starts', () => {
    const slots = read('api/slots.js');
    expect(slots).toContain('test_time');
    expect(slots).toContain('TEST_DATE_WARMUP_OFFSET_MINUTES = 45');
    expect(slots).toContain('Math.round(ideal / 15) * 15');
    expect(slots).toContain('isQuarterHourStart(selectedStartTime)');
    expect(slots).toContain('testStartCoveredByLesson');
  });

  test('credit-funded booking preserves LCB/BCS path and snapshots test metadata', () => {
    const slots = read('api/slots.js');
    expect(slots).toContain('bookCreditFundedSlotsTransaction({');
    expect(slots).toContain('bookingPurpose = \'lesson\'');
    expect(slots).toContain('booking_purpose, test_start_time, test_centre');
    expect(slots).toContain('bookingPurpose: TEST_DATE_PURPOSE');
    expect(slots).toContain('testStartTime: ctx.testTime');
    expect(slots).toContain('chargeMins: TEST_DATE_DURATION_MINUTES');
    expect(slots).toContain('useTestDateOverlapGuards: true');
    expect(slots).toContain('SET test_instructor_booked = TRUE');
  });

  test('direct-pay metadata and webhook preserve test-date purpose', () => {
    const slots = read('api/slots.js');
    const webhook = read('api/webhook.js');
    expect(slots).toContain("payment_type: 'slot_booking'");
    expect(slots).toContain('booking_purpose: TEST_DATE_PURPOSE');
    expect(slots).toContain('test_date: ctx.testDate');
    expect(slots).toContain('test_time: ctx.testTime');
    expect(slots).toContain('duration_minutes: String(TEST_DATE_DURATION_MINUTES)');
    expect(slots).toContain('allow_promotion_codes: false');
    expect(webhook).toContain("metadata.booking_purpose === 'test_date'");
    expect(webhook).toContain('booking_purpose, test_start_time, test_centre');
    expect(webhook).toContain('SET test_instructor_booked = TRUE');
  });

  test('server-side test-date paths reject repeat bookings before payment or credit mutation', () => {
    const slots = read('api/slots.js');
    const repeatCheck = slots.indexOf('learner.test_instructor_booked');
    const creditMutation = slots.indexOf('bookCreditFundedSlotsTransaction({');
    const checkoutCreation = slots.indexOf('stripe.checkout.sessions.create({', slots.indexOf('async function handleCheckoutTestDate'));

    expect(slots).toContain('COALESCE(test_instructor_booked, FALSE) AS test_instructor_booked');
    expect(slots).toContain("Your practical test date lesson is already booked.");
    expect(repeatCheck).toBeGreaterThanOrEqual(0);
    expect(repeatCheck).toBeLessThan(creditMutation);
    expect(repeatCheck).toBeLessThan(checkoutCreation);
  });

  test('test-date final guards use interval overlap, not exact start equality', () => {
    const slots = read('api/slots.js');
    const webhook = read('api/webhook.js');

    expect(slots).toContain('async function testDateSlotOverlapConflictsPg');
    expect(slots).toContain('AND start_time < $5::time');
    expect(slots).toContain('AND end_time > $4::time');
    expect(slots).toContain('lockTestDateSlotMutation(client');
    expect(slots).toContain('ON CONFLICT (instructor_id, scheduled_date, start_time) DO NOTHING');
    expect(webhook).toContain('TEST_DATE_SLOT_OVERLAP');
    expect(webhook).toContain('excludeReservationSessionId: session.id');
    expect(webhook).toContain('AND start_time < $5::time');
    expect(webhook).toContain('AND end_time > $4::time');
  });

  test('saved test date/time, same-school active instructor, generated quarter-hour start, and coverage are server requirements', () => {
    const slots = read('api/slots.js');
    expect(slots).toContain('Save your practical test date and time in your profile');
    expect(slots).toContain('AND school_id = ${schoolId}');
    expect(slots).toContain('AND active = true');
    expect(slots).toContain('isQuarterHourStart(selectedStartTime)');
    expect(slots).toContain('options.find(o => o.start_time === selectedStartTime)');
    expect(slots).toContain('testStartCoveredByLesson(selectedOption.start_time, selectedOption.end_time, testTime)');
    expect(slots).toContain('This instructor does not currently offer the 90-minute test date lesson length.');
  });

  test('learner booking page renders a separate test date panel', () => {
    const html = read('public/learner/book.html');
    const js = read('public/learner/book.js');
    expect(html).toContain('id="testDatePanel"');
    expect(html).toContain('id="testDateStartOptions"');
    expect(js).toContain("'/api/slots?action=test-date-availability&instructor_id='");
    expect(js).toContain("'book-test-date'");
    expect(js).toContain("'checkout-test-date'");
    expect(js).toContain('selectedTestDateStart');
  });
});
