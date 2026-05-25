// @ts-check
// Focused coverage for the Step 5 payout read-model cutover.
//
// These are pure unit tests. They do not run payout crons, Stripe transfers,
// migrations, or prod writes.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const {
  getEligibleBookings,
  processPayoutForInstructor,
  simulatePayoutForInstructor,
} = require('../api/_payout-helpers');

const helperPath = path.join(__dirname, '..', 'api', '_payout-helpers.js');

function helperSource() {
  return fs.readFileSync(helperPath, 'utf8');
}

function normalized(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function makeSqlMock({ eligibleRows = [] } = {}) {
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });

    if (text.includes('SELECT lb.id AS booking_id')) {
      return Promise.resolve(eligibleRows);
    }
    if (text.includes('INSERT INTO instructor_payouts')) {
      return Promise.resolve([{ id: 9001 }]);
    }
    return Promise.resolve([]);
  };
  return { sql, calls };
}

const instructor = {
  id: 44,
  name: 'Payout Read Model Instructor',
  email: 'payout-read-model@example.test',
  commission_rate: '1.0',
  weekly_franchise_fee_pence: null,
  stripe_account_id: 'acct_test',
  payouts_start_date: '2026-05-15',
};

const eligibleBcsFundedBooking = {
  booking_id: 501,
  scheduled_date: '2026-05-22',
  start_time: '09:00',
  end_time: '10:30',
  status: 'chargeable',
  price_pence: 10000,
  stripe_fee_pence: 321,
  duration_minutes: 90,
  lesson_type_name: 'Standard Lesson',
};

test.describe('payout Step 5 read model', () => {
  test('getEligibleBookings prefers list_price_pence over live lesson-type pricing', () => {
    const source = helperSource();

    expect(source).toContain('COALESCE(');
    expect(source).toContain('lb.list_price_pence');
    expect(source.indexOf('lb.list_price_pence'))
      .toBeLessThan(source.indexOf('CASE WHEN iln.custom_hourly_rate_pence IS NOT NULL'));
  });

  test('getEligibleBookings uses active BCS stripe fees when present', () => {
    const source = helperSource();

    expect(source).toContain('FROM booking_credit_sources');
    expect(source).toContain('WHERE refunded_at IS NULL');
    expect(source).toContain('SUM(stripe_fee_pence)');
    expect(source).toContain('COUNT(*)::int AS active_bcs_count');
    expect(source).toContain('CASE WHEN active_bcs_fees.active_bcs_count > 0');
    expect(source).toContain('THEN active_bcs_fees.stripe_fee_pence');
  });

  test('bookings without active BCS still fall back to lesson_bookings stripe_fee_pence then zero', () => {
    const source = helperSource();

    expect(source).toContain('ELSE COALESCE(lb.stripe_fee_pence, 0)');
  });

  test('getEligibleBookings excludes active instructor-absorbed BCS bookings', () => {
    const source = helperSource();

    expect(source).toContain('AND NOT EXISTS (');
    expect(source).toContain('FROM booking_credit_sources absorbed_bcs');
    expect(source).toContain('absorbed_bcs.refunded_at IS NULL');
    expect(source).toContain("absorbed_bcs.absorbed_by = 'instructor'");
  });

  test('credit-funded BCS fee flows through preview math via getEligibleBookings', async () => {
    const { sql, calls } = makeSqlMock({ eligibleRows: [eligibleBcsFundedBooking] });

    const result = await simulatePayoutForInstructor(sql, instructor);

    expect(result).toMatchObject({
      instructor_id: instructor.id,
      gross_pence: 10000,
      stripe_fees_pence: 321,
      amount_pence: 9679,
      lesson_count: 1,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('SELECT lb.id AS booking_id');
  });

  test('processPayoutForInstructor and simulatePayoutForInstructor use the same eligible-bookings query and math', async () => {
    const processSql = makeSqlMock({ eligibleRows: [eligibleBcsFundedBooking] });
    const simulateSql = makeSqlMock({ eligibleRows: [eligibleBcsFundedBooking] });
    const stripe = {
      transfers: {
        create: async () => ({ id: 'tr_test_read_model' }),
      },
    };

    const processed = await processPayoutForInstructor(processSql.sql, stripe, instructor);
    const simulated = await simulatePayoutForInstructor(simulateSql.sql, instructor);

    expect(normalized(processSql.calls[0].text)).toBe(normalized(simulateSql.calls[0].text));
    expect(processed).toMatchObject({
      instructor_id: simulated.instructor_id,
      instructor_name: simulated.instructor_name,
      instructor_email: simulated.instructor_email,
      amount_pence: simulated.amount_pence,
      gross_pence: simulated.gross_pence,
      stripe_fees_pence: simulated.stripe_fees_pence,
      lesson_count: simulated.lesson_count,
      status: 'completed',
    });
  });

  test('getEligibleBookings remains callable with the payout floor argument', async () => {
    const { sql, calls } = makeSqlMock({ eligibleRows: [] });

    await getEligibleBookings(sql, instructor.id, instructor.payouts_start_date);

    expect(calls[0].values).toContain(instructor.id);
    expect(calls[0].values).toContain(instructor.payouts_start_date);
  });
});
