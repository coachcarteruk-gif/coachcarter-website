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
const {
  computePlatformBalance,
  describeRefundExposureValuationPolicy,
} = require('../api/_platform-balance');

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

function makePlatformBalanceSqlMock({ instructors = [], eligibleRows = [] } = {}) {
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });

    if (text.includes('FROM instructors') && text.includes('stripe_onboarding_complete = TRUE')) {
      return Promise.resolve(instructors);
    }
    if (text.includes('SELECT lb.id AS booking_id')) {
      return Promise.resolve(eligibleRows);
    }
    if (text.includes('COUNT(lb.id)::int AS chargeable_lessons')) {
      return Promise.resolve([]);
    }
    if (text.includes('live_credit_pence')) {
      return Promise.resolve([{ live_credit_pence: 0, net_cash_in_pence: 0 }]);
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

  test('Next Payout Preview totals include snapshotted BCS gross and active BCS fees', async () => {
    const attributedBooking = {
      ...eligibleBcsFundedBooking,
      price_pence: 12345,
      stripe_fee_pence: 678,
    };
    const { sql, calls } = makePlatformBalanceSqlMock({
      instructors: [instructor],
      eligibleRows: [attributedBooking],
    });
    const stripe = {
      balance: {
        retrieve: async () => ({
          available: [{ currency: 'gbp', amount: 20000 }],
          pending: [{ currency: 'gbp', amount: 3000 }],
        }),
      },
    };

    const result = await computePlatformBalance(sql, stripe);

    expect(result).toMatchObject({
      available_pence: 20000,
      pending_pence: 3000,
      total_payout_pence: 11667,
      balance_after_payout_pence: 8333,
      status: 'green',
    });
    expect(result.payout_preview).toHaveLength(1);
    expect(result.payout_preview[0]).toMatchObject({
      instructor_id: instructor.id,
      gross_pence: 12345,
      stripe_fees_pence: 678,
      amount_pence: 11667,
      lesson_count: 1,
    });
    expect(calls.some(call => call.text.includes('SELECT lb.id AS booking_id'))).toBe(true);
  });

  test('refund exposure remains explicitly advisory legacy aggregate valuation', async () => {
    const { sql, calls } = makePlatformBalanceSqlMock();
    const stripe = {
      balance: {
        retrieve: async () => ({
          available: [{ currency: 'gbp', amount: 20000 }],
          pending: [],
        }),
      },
    };

    const result = await computePlatformBalance(sql, stripe);
    const exposureQuery = calls.find(call => call.text.includes('live_credit_pence'));

    expect(result.refund_exposure_basis).toMatchObject({
      kind: 'advisory_legacy_aggregate_shadow',
      exact_refund_liability: false,
      balance_source: 'learner_users.balance_minutes',
    });
    expect(result.refund_exposure_basis.deferred).toEqual(expect.arrayContaining([
      'learner_credit_balances per-instructor valuation',
      'credit_transactions effective_rate_pence_per_minute source valuation',
      'goodwill absorbed_by treatment',
    ]));
    expect(exposureQuery.text).toContain('lu.balance_minutes');
    expect(exposureQuery.text).toContain("s.config -> 'pricing' ->> 'bulk_hourly_pence'");
    expect(exposureQuery.text).toContain('stripe_session_id IS NOT NULL');
    expect(exposureQuery.text).not.toContain('learner_credit_balances');
    expect(exposureQuery.text).not.toContain('effective_rate_pence_per_minute');
  });

  test('refund exposure policy helper marks current widget advisory and future exact contract separate', () => {
    const policy = describeRefundExposureValuationPolicy();

    expect(policy.current).toMatchObject({
      kind: 'advisory_legacy_aggregate_shadow',
      exact_refund_liability: false,
      balance_source: 'learner_users.balance_minutes',
    });
    expect(policy.future_exact_contract).toMatchObject({
      exact_refund_liability: true,
      balance_source: 'learner_credit_balances',
    });
    expect(policy.future_exact_contract.forbidden_balance_sources)
      .toContain('learner_users.balance_minutes');
  });

  test('future exact refund exposure contract requires source-aware school-scoped valuation', () => {
    const { future_exact_contract: exact } = describeRefundExposureValuationPolicy();

    expect(exact.required_school_scoped_sources).toEqual(expect.arrayContaining([
      'learner_credit_balances',
      'credit_transactions',
      'booking_credit_sources',
      'refund_events',
      'refund_event_lines',
    ]));
    expect(exact.valuation_sources).toEqual(expect.arrayContaining([
      'credit_transactions.effective_rate_pence_per_minute',
      'booking_credit_sources.rate_pence_per_minute',
      'credit_source_adjustments',
      'absorbed_by',
      'Stripe-originated purchase/refund rows',
    ]));
    expect(exact.cash_cap_policy).toContain('without discarding source-level liability rows');
  });

  test('admin platform balance copy does not present refund exposure as exact cash needed', () => {
    const portal = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'portal.js'), 'utf8');

    expect(portal).toContain('legacy aggregate credit exposure signal');
    expect(portal).toContain('not an exact per-instructor refund liability');
    expect(portal).not.toContain('additional cash needed');
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
