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
  summarizeExactRefundExposureRows,
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

function makePlatformBalanceSqlMock({
  instructors = [],
  eligibleRows = [],
  exactRows = [],
  exactNetCashInPence = 0,
} = {}) {
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });

    if (text.includes('exact_refund_exposure_sources')) {
      return Promise.resolve(exactRows);
    }
    if (text.includes('stripe_net_cash_in_pence')) {
      return Promise.resolve([{ stripe_net_cash_in_pence: exactNetCashInPence }]);
    }
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

function exactSource(overrides = {}) {
  return {
    school_id: 1,
    learner_id: 77,
    instructor_id: 44,
    lcb_balance_minutes: 90,
    credit_transaction_id: 7001,
    created_at: '2026-05-01T09:00:00.000Z',
    source_minutes: 120,
    source_amount_pence: 12000,
    effective_rate_pence_per_minute: 100,
    source: 'stripe',
    absorbed_by: null,
    stripe_session_id: 'cs_paid',
    stripe_payment_intent_id: 'pi_paid',
    stripe_charge_id: 'ch_paid',
    active_minutes_drawn: 30,
    active_contribution_pence: 3000,
    adjusted_minutes: 0,
    adjusted_pence: 0,
    ...overrides,
  };
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

  test('cron/global platform balance preview does not default omitted schoolId to school 1', async () => {
    const schoolTwoInstructor = {
      ...instructor,
      id: 55,
      name: 'School Two Instructor',
    };
    const { sql, calls } = makePlatformBalanceSqlMock({
      instructors: [schoolTwoInstructor],
      eligibleRows: [eligibleBcsFundedBooking],
    });
    const stripe = {
      balance: {
        retrieve: async () => ({
          available: [{ currency: 'gbp', amount: 20000 }],
          pending: [],
        }),
      },
    };

    const result = await computePlatformBalance(sql, stripe);
    const instructorQuery = calls.find(call =>
      call.text.includes('FROM instructors') &&
      call.text.includes('stripe_onboarding_complete = TRUE')
    );
    const exactQuery = calls.find(call => call.text.includes('exact_refund_exposure_sources'));
    const exactCashQuery = calls.find(call => call.text.includes('stripe_net_cash_in_pence'));

    expect(result.total_payout_pence).toBe(9679);
    expect(result.exact_refund_exposure).toMatchObject({
      scope: 'global',
      school_id: null,
    });
    expect(result.payout_preview[0]).toMatchObject({
      instructor_id: schoolTwoInstructor.id,
      amount_pence: 9679,
    });
    expect(instructorQuery.text).not.toContain('school_id = ?');
    expect(instructorQuery.values).toEqual([]);
    expect(exactQuery.text).toContain('lu.school_id = lcb.school_id');
    expect(exactQuery.text).toContain('i.school_id = lcb.school_id');
    expect(exactQuery.text).toContain('ct.school_id = lcb.school_id');
    expect(exactQuery.text).toContain('bcs.school_id = lcb.school_id');
    expect(exactCashQuery.text).toContain('lu.school_id = ct.school_id');
    expect(exactCashQuery.values).toEqual([]);
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
    expect(exposureQuery.text).toContain('stripe_payment_intent_id IS NOT NULL');
    expect(exposureQuery.text).toContain('stripe_charge_id IS NOT NULL');
    expect(exposureQuery.text).not.toContain('learner_credit_balances');
    expect(exposureQuery.text).not.toContain('effective_rate_pence_per_minute');
    expect(result.legacy_advisory_refund_exposure_pence).toBe(result.refund_exposure_pence);
    expect(result.exact_refund_exposure_basis).toMatchObject({
      exact_refund_liability: true,
      balance_source: 'learner_credit_balances',
    });
  });

  test('exact refund exposure values live instructor-scoped credit at source rate', () => {
    const result = summarizeExactRefundExposureRows([
      exactSource(),
    ], { schoolId: 1, netCashInPence: 20000 });

    expect(result).toMatchObject({
      exact_refund_liability: true,
      platform_refund_exposure_pence: 9000,
      gross_source_liability_pence: 9000,
      stripe_cash_backed_pence: 9000,
      stripe_cash_backed_capped_pence: 9000,
      platform_goodwill_pence: 0,
      instructor_absorbed_pence: 0,
    });
    expect(result.sources).toEqual([expect.objectContaining({
      credit_transaction_id: 7001,
      classification: 'stripe_cash_backed',
      valued_minutes: 90,
      value_pence: 9000,
      rate_pence_per_minute: 100,
      valuation_basis: 'credit_transactions.effective_rate_pence_per_minute',
    })]);
  });

  test('exact refund exposure separates platform and instructor absorbed goodwill', () => {
    const result = summarizeExactRefundExposureRows([
      exactSource({
        learner_id: 80,
        instructor_id: 4,
        credit_transaction_id: 8001,
        source: 'goodwill',
        absorbed_by: 'platform',
        stripe_session_id: null,
        stripe_payment_intent_id: null,
        stripe_charge_id: null,
        source_minutes: 60,
        lcb_balance_minutes: 60,
        active_minutes_drawn: 0,
        source_amount_pence: 0,
      }),
      exactSource({
        learner_id: 81,
        instructor_id: 5,
        credit_transaction_id: 8002,
        source: 'goodwill',
        absorbed_by: 'instructor',
        stripe_session_id: null,
        stripe_payment_intent_id: null,
        stripe_charge_id: null,
        source_minutes: 60,
        lcb_balance_minutes: 60,
        active_minutes_drawn: 0,
        source_amount_pence: 0,
      }),
    ], { schoolId: 1, netCashInPence: 0 });

    expect(result).toMatchObject({
      platform_refund_exposure_pence: 6000,
      platform_goodwill_pence: 6000,
      instructor_absorbed_pence: 6000,
      stripe_cash_backed_pence: 0,
    });
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ credit_transaction_id: 8001, classification: 'platform_goodwill' }),
      expect.objectContaining({ credit_transaction_id: 8002, classification: 'instructor_absorbed' }),
    ]));
  });

  test('exact refund exposure classifies legacy missing absorber and unpriced fallback separately', () => {
    const result = summarizeExactRefundExposureRows([
      exactSource({
        learner_id: 90,
        instructor_id: 7,
        credit_transaction_id: 9001,
        source: 'goodwill',
        absorbed_by: null,
        stripe_session_id: null,
        stripe_payment_intent_id: null,
        stripe_charge_id: null,
        effective_rate_pence_per_minute: 0,
        source_minutes: 120,
        lcb_balance_minutes: 60,
        active_minutes_drawn: 0,
        active_contribution_pence: 0,
        source_amount_pence: 12000,
      }),
    ], { schoolId: 1, netCashInPence: 0 });

    expect(result).toMatchObject({
      platform_refund_exposure_pence: 0,
      legacy_unknown_absorber_pence: 6000,
      legacy_unpriced_pence: 6000,
      gross_source_liability_pence: 6000,
    });
    expect(result.sources[0]).toMatchObject({
      classification: 'legacy_unknown_absorber',
      valuation_basis: 'legacy_source_remaining_pence_fallback',
      legacy_unpriced: true,
    });
  });

  test('exact refund exposure SQL is school-scoped and never uses learner_users balance as source of truth', async () => {
    const { sql, calls } = makePlatformBalanceSqlMock({
      exactRows: [exactSource({ school_id: 2 })],
      exactNetCashInPence: 20000,
    });
    const stripe = {
      balance: {
        retrieve: async () => ({
          available: [{ currency: 'gbp', amount: 20000 }],
          pending: [],
        }),
      },
    };

    const result = await computePlatformBalance(sql, stripe, { schoolId: 2 });
    const instructorQuery = calls.find(call =>
      call.text.includes('FROM instructors') &&
      call.text.includes('stripe_onboarding_complete = TRUE')
    );
    const exactQuery = calls.find(call => call.text.includes('exact_refund_exposure_sources'));
    const exactCashQuery = calls.find(call => call.text.includes('stripe_net_cash_in_pence'));

    expect(result.exact_refund_exposure_pence).toBe(9000);
    expect(result.legacy_advisory_refund_exposure_pence).toBe(0);
    expect(result.refund_exposure_pence).toBe(0);
    expect(instructorQuery.text).toContain('school_id = ?');
    expect(instructorQuery.values).toContain(2);
    expect(exactQuery.text).toContain('lcb.school_id = ?');
    expect(exactQuery.text).toContain('ct.school_id = ?');
    expect(exactQuery.text).toContain('bcs.school_id = ?');
    expect(exactQuery.text).toContain('lu.school_id = ?');
    expect(exactQuery.text).toContain('i.school_id = ?');
    expect(exactQuery.text).toContain('lcb.balance_minutes::int AS lcb_balance_minutes');
    expect(exactQuery.text).not.toContain('lu.balance_minutes');
    expect(exactQuery.values).toEqual(expect.arrayContaining([2]));
    expect(exactCashQuery.text).toContain('ct.school_id = ?');
    expect(exactCashQuery.text).toContain('lu.school_id = ?');
    expect(exactCashQuery.text).toContain('ct.stripe_session_id IS NOT NULL');
    expect(exactCashQuery.text).toContain('ct.stripe_payment_intent_id IS NOT NULL');
    expect(exactCashQuery.text).toContain('ct.stripe_charge_id IS NOT NULL');
    expect(exactCashQuery.values).toEqual(expect.arrayContaining([2]));
  });

  test('exact refund exposure cash cap counts PaymentIntent-only and Charge-only Stripe rows', async () => {
    const { sql, calls } = makePlatformBalanceSqlMock({
      exactRows: [
        exactSource({
          credit_transaction_id: 7101,
          stripe_session_id: null,
          stripe_payment_intent_id: 'pi_only',
          stripe_charge_id: null,
        }),
        exactSource({
          learner_id: 78,
          credit_transaction_id: 7102,
          stripe_session_id: null,
          stripe_payment_intent_id: null,
          stripe_charge_id: 'ch_only',
        }),
      ],
      exactNetCashInPence: 12000,
    });
    const stripe = {
      balance: {
        retrieve: async () => ({
          available: [{ currency: 'gbp', amount: 30000 }],
          pending: [],
        }),
      },
    };

    const result = await computePlatformBalance(sql, stripe, { schoolId: 1 });
    const exactCashQuery = calls.find(call => call.text.includes('stripe_net_cash_in_pence'));

    expect(result.exact_refund_exposure).toMatchObject({
      stripe_cash_backed_pence: 18000,
      stripe_cash_backed_capped_pence: 12000,
      platform_refund_exposure_pence: 12000,
      stripe_originated_net_cash_in_pence: 12000,
    });
    expect(result.exact_refund_exposure.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ credit_transaction_id: 7101, classification: 'stripe_cash_backed' }),
      expect.objectContaining({ credit_transaction_id: 7102, classification: 'stripe_cash_backed' }),
    ]));
    expect(exactCashQuery.text).toContain('ct.stripe_payment_intent_id IS NOT NULL');
    expect(exactCashQuery.text).toContain('ct.stripe_charge_id IS NOT NULL');
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

    expect(portal).toContain('Exact unused-credit exposure');
    expect(portal).toContain('source-attributed instructor balances');
    expect(portal).toContain('Legacy advisory');
    expect(portal).toContain('trend/advisory comparator');
    expect(portal).not.toContain('additional cash needed');
  });

  test('platform balance read model does not call refund, Stripe refund, or payout mutation code', () => {
    const platformBalanceSource = fs.readFileSync(path.join(__dirname, '..', 'api', '_platform-balance.js'), 'utf8');

    expect(platformBalanceSource).not.toContain('_refund-executor');
    expect(platformBalanceSource).not.toContain('stripe.refunds.create');
    expect(platformBalanceSource).not.toContain('refunds.create');
    expect(platformBalanceSource).not.toContain('transfers.create');
    expect(platformBalanceSource).not.toContain('INSERT INTO instructor_payouts');
    expect(platformBalanceSource).not.toContain('UPDATE lesson_bookings');
    expect(platformBalanceSource).not.toContain('UPDATE learner_credit_balances');
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
