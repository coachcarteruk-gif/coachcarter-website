const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  PAYOUT_V2_EARNING_CALCULATION_VERSION,
  planPayoutV2Earnings,
} = require('../api/_payout-v2-earning-planner');
const {
  classifyComparison,
} = require('../api/_payout-v2-shadow');
const {
  SCHEDULED,
  CHARGEABLE,
  REFUNDED,
} = require('../api/_booking-status');

let sourceSequence = 0;

function stripeSource(overrides = {}) {
  sourceSequence += 1;
  const id = overrides.fundingSourceId || sourceSequence;
  return {
    fundingSourceId: id,
    bookingCreditSourceId: 10_000 + id,
    schoolId: 7,
    instructorId: 9,
    fundingClass: 'stripe_backed',
    sourceStatus: 'available',
    sourceFingerprint: `sha256:${String(id % 10).repeat(64)}`,
    grossContributionPence: 10_000,
    stripeFeeContributionPence: 300,
    payablePoolPence: 9_700,
    alreadyAllocatedPence: 0,
    evidence: {
      stripe_payment_intent_id: `pi_earning_${id}`,
      stripe_charge_id: `ch_earning_${id}`,
      stripe_balance_transaction_id: `txn_earning_${id}`,
    },
    ...overrides,
  };
}

function zeroSource(fundingClass, overrides = {}) {
  sourceSequence += 1;
  const id = overrides.fundingSourceId === null
    ? null
    : overrides.fundingSourceId || sourceSequence;
  return {
    fundingSourceId: id,
    bookingCreditSourceId: id == null ? null : 20_000 + id,
    schoolId: 7,
    instructorId: 9,
    fundingClass,
    sourceStatus: 'available',
    sourceFingerprint: id == null ? null : `sha256:${String(id % 10).repeat(64)}`,
    grossContributionPence: 0,
    stripeFeeContributionPence: 0,
    payablePoolPence: 0,
    alreadyAllocatedPence: 0,
    evidence: {},
    ...overrides,
  };
}

function booking(id, status = CHARGEABLE, fundingSources = [stripeSource()], overrides = {}) {
  return {
    bookingId: id,
    schoolId: 7,
    instructorId: 9,
    status,
    scheduledDate: `2026-07-${String(10 + id).padStart(2, '0')}`,
    earnedAt: `2026-07-${String(10 + id).padStart(2, '0')}T11:00:00.000Z`,
    payoutRoute: 'instructor_direct',
    isTestAccount: false,
    existingV1Routes: [],
    fundingSources,
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    schoolId: 7,
    payoutRoute: 'instructor_direct',
    destinationInstructorId: 9,
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    policy: {
      kind: 'commission',
      commissionRateBps: 8_500,
      evidenceReference: 'test:commission-snapshot',
      snapshottedAt: '2026-07-31T09:00:00.000Z',
    },
    recoveries: [],
    bookings: [booking(1)],
    ...overrides,
  };
}

test.beforeEach(() => {
  sourceSequence = 0;
});

test.describe('Payout v2 authoritative earning planner', () => {
  test('is deterministic, versioned, fingerprinted, and conserves exact pence', () => {
    const input = baseInput();
    const first = planPayoutV2Earnings(input);
    const second = planPayoutV2Earnings({
      ...input,
      bookings: [...input.bookings].reverse(),
    });
    expect(first.calculation_version).toBe(PAYOUT_V2_EARNING_CALCULATION_VERSION);
    expect(first.plan_fingerprint).toBe(second.plan_fingerprint);
    expect(first.plan_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.exact_pence_conservation).toBe(true);
    expect(first.totals).toMatchObject({
      gross_pence: 10_000,
      stripe_fees_pence: 300,
      platform_fee_pence: 1_500,
      net_shadow_transfer_pence: 8_200,
    });
    expect(first.bookings[0].funding_allocations[0]).toMatchObject({
      gross_contribution_pence: 10_000,
      stripe_fee_contribution_pence: 300,
      instructor_earning_contribution_pence: 8_200,
      platform_fee_contribution_pence: 1_500,
    });
  });

  for (const [status, reason] of [
    [SCHEDULED, 'scheduled_not_earned'],
    [REFUNDED, 'refunded_no_new_earning'],
  ]) {
    test(`${status} bookings produce no earning`, () => {
      const plan = planPayoutV2Earnings(baseInput({
        bookings: [booking(1, status)],
      }));
      expect(plan.totals.gross_pence).toBe(0);
      expect(plan.totals.net_shadow_transfer_pence).toBe(0);
      expect(plan.bookings[0]).toMatchObject({
        included: false,
        blocked: false,
        review_reason: reason,
        earning_status: 'zero_value',
      });
    });
  }

  for (const fundingClass of [
    'legacy_pre_connect_settled',
    'instructor_goodwill',
    'external_cash_settled',
    'free',
  ]) {
    test(`${fundingClass} remains zero-payable`, () => {
      const plan = planPayoutV2Earnings(baseInput({
        bookings: [booking(1, CHARGEABLE, [zeroSource(fundingClass)])],
      }));
      expect(plan.bookings[0]).toMatchObject({
        included: true,
        blocked: false,
        earning_status: 'zero_value',
        instructor_earning_pence: 0,
      });
      expect(plan.totals.net_shadow_transfer_pence).toBe(0);
    });
  }

  test('free booking evidence can produce a retained zero earning without a source row', () => {
    const plan = planPayoutV2Earnings(baseInput({
      bookings: [booking(1, CHARGEABLE, [], { zeroFundingClass: 'free' })],
    }));
    expect(plan.bookings[0]).toMatchObject({
      included: true,
      blocked: false,
      earning_status: 'zero_value',
      funding_classes: ['free'],
    });
  });

  test('manual review and missing funding fail closed', () => {
    const manual = zeroSource('manual_review', {
      sourceStatus: 'manual_review',
    });
    const plan = planPayoutV2Earnings(baseInput({
      bookings: [
        booking(1, CHARGEABLE, [manual]),
        booking(2, CHARGEABLE, []),
      ],
    }));
    expect(plan.bookings.map((row) => row.blocker_reason)).toEqual([
      'manual_review_required',
      'missing_immutable_funding_source',
    ]);
    expect(plan.totals.net_shadow_transfer_pence).toBe(0);
  });

  test('explicit platform goodwill and external cash payable can fund earnings', () => {
    const explicit = (fundingClass, id) => stripeSource({
      fundingSourceId: id,
      bookingCreditSourceId: 30_000 + id,
      fundingClass,
      grossContributionPence: 5_000,
      stripeFeeContributionPence: 0,
      payablePoolPence: 5_000,
      evidence: {
        explicitly_funded: true,
        evidence_reference: `operator:${fundingClass}:${id}`,
      },
    });
    const plan = planPayoutV2Earnings(baseInput({
      bookings: [
        booking(1, CHARGEABLE, [explicit('platform_goodwill', 91)]),
        booking(2, CHARGEABLE, [explicit('external_cash_payable', 92)]),
      ],
    }));
    expect(plan.blocked_booking_count).toBe(0);
    expect(plan.totals.gross_pence).toBe(10_000);
    expect(plan.totals.net_shadow_transfer_pence).toBe(8_500);
  });

  test('mixed sources allocate every penny deterministically', () => {
    const plan = planPayoutV2Earnings(baseInput({
      bookings: [booking(1, CHARGEABLE, [
        stripeSource({
          fundingSourceId: 1,
          grossContributionPence: 6_001,
          stripeFeeContributionPence: 181,
          payablePoolPence: 5_820,
        }),
        stripeSource({
          fundingSourceId: 2,
          grossContributionPence: 3_999,
          stripeFeeContributionPence: 119,
          payablePoolPence: 3_880,
        }),
      ])],
    }));
    const allocations = plan.bookings[0].funding_allocations;
    expect(allocations.reduce((sum, row) => sum + row.gross_contribution_pence, 0))
      .toBe(10_000);
    expect(allocations.reduce(
      (sum, row) => sum +
        row.stripe_fee_contribution_pence +
        row.instructor_earning_contribution_pence +
        row.platform_fee_contribution_pence +
        row.franchise_fee_contribution_pence,
      0
    )).toBe(10_000);
  });

  test('source pool cap, already-allocated cap, and insufficient funding block', () => {
    const insufficient = stripeSource({ fundingSourceId: 1, payablePoolPence: 9_699 });
    const allocated = stripeSource({
      fundingSourceId: 2,
      payablePoolPence: 9_700,
      alreadyAllocatedPence: 2_000,
    });
    const plan = planPayoutV2Earnings(baseInput({
      bookings: [
        booking(1, CHARGEABLE, [insufficient]),
        booking(2, CHARGEABLE, [allocated]),
      ],
    }));
    expect(plan.bookings[0].blocker_reason).toBe('source_payable_pool_exceeded');
    expect(plan.bookings[1].blocker_reason).toBe('source_payable_pool_exceeded');
  });

  test('direct route is single-instructor and cannot overlap the school route', () => {
    const directMismatch = planPayoutV2Earnings(baseInput({
      bookings: [booking(1, CHARGEABLE, [stripeSource()], {
        instructorId: 10,
      })],
    }));
    expect(directMismatch.bookings[0].blocker_reason)
      .toBe('mixed_instructor_direct_statement');

    const existingBoth = planPayoutV2Earnings(baseInput({
      bookings: [booking(1, CHARGEABLE, [stripeSource()], {
        existingV1Routes: ['instructor_direct', 'school'],
      })],
    }));
    expect(existingBoth.bookings[0].blocker_reason)
      .toBe('booking_claimed_by_both_v1_routes');
  });

  test('same-school sources pass and cross-school sources fail closed', () => {
    const plan = planPayoutV2Earnings(baseInput({
      bookings: [
        booking(1),
        booking(2, CHARGEABLE, [stripeSource({ schoolId: 8 })]),
      ],
    }));
    expect(plan.bookings[0].blocked).toBe(false);
    expect(plan.bookings[1].blocker_reason).toBe('cross_school_funding_source');
  });

  test('school route conserves Stripe fee and platform fee', () => {
    const plan = planPayoutV2Earnings(baseInput({
      payoutRoute: 'school',
      destinationInstructorId: undefined,
      policy: {
        kind: 'school_platform_fee',
        platformFeeBps: 100,
        evidenceReference: 'test:school-platform-fee',
        snapshottedAt: '2026-07-31T09:00:00.000Z',
      },
      bookings: [booking(1, CHARGEABLE, [stripeSource()], {
        payoutRoute: 'school',
      })],
    }));
    expect(plan.totals).toMatchObject({
      gross_pence: 10_000,
      stripe_fees_pence: 300,
      platform_fee_pence: 100,
      net_shadow_transfer_pence: 9_600,
    });
  });

  test('franchise, off-system deposit policy, prior shortfall, and recovery conserve exactly', () => {
    const plan = planPayoutV2Earnings(baseInput({
      policy: {
        kind: 'franchise',
        weeklyFranchiseFeePence: 5_000,
        depositPence: 0,
        priorShortfallPence: 3_000,
        evidenceReference: 'test:franchise-snapshot',
        snapshottedAt: '2026-07-31T09:00:00.000Z',
      },
      recoveries: [{
        id: 41,
        remainingPence: 4_000,
        createdAt: '2026-07-01T00:00:00.000Z',
      }],
      bookings: [booking(1), booking(2)],
    }));
    expect(plan.totals).toMatchObject({
      gross_pence: 20_000,
      stripe_fees_pence: 600,
      franchise_fee_pence: 5_000,
      deposit_deducted_pence: 0,
      shortfall_deducted_pence: 3_000,
      recovery_deducted_pence: 4_000,
      net_shadow_transfer_pence: 7_400,
      remaining_recovery_pence: 0,
    });
    expect(plan.recovery_allocations).toEqual([{
      recoveryAdjustmentId: 41,
      appliedPence: 4_000,
      remainingPence: 0,
    }]);
    expect(plan.bookings.reduce(
      (sum, row) => sum + row.net_shadow_transfer_pence,
      0
    )).toBe(7_400);
    expect(plan.normalized_input.policy.vehicle_deposit_policy).toBe('off_system');
  });

  test('Payout v2 refuses to deduct or track an on-system vehicle deposit', () => {
    expect(() => planPayoutV2Earnings(baseInput({
      policy: {
        kind: 'franchise',
        weeklyFranchiseFeePence: 5_000,
        depositPence: 1,
        priorShortfallPence: 0,
        evidenceReference: 'test:franchise-snapshot',
        snapshottedAt: '2026-07-31T09:00:00.000Z',
      },
    }))).toThrow('vehicle deposits are handled off-system');
  });

  test('recovery can fully offset a statement and carries the remainder', () => {
    const plan = planPayoutV2Earnings(baseInput({
      recoveries: [{
        id: 41,
        remainingPence: 20_000,
        createdAt: '2026-07-01T00:00:00.000Z',
      }],
    }));
    expect(plan.totals.net_shadow_transfer_pence).toBe(0);
    expect(plan.totals.recovery_deducted_pence).toBe(8_200);
    expect(plan.totals.remaining_recovery_pence).toBe(11_800);
  });

  test('comparison separates deliberate policy differences from unexplained drift', () => {
    const deliberatePlan = planPayoutV2Earnings(baseInput({
      recoveries: [{
        id: 41,
        remainingPence: 1_000,
        createdAt: '2026-07-01T00:00:00.000Z',
      }],
    }));
    expect(classifyComparison(deliberatePlan, { transfer_pence: 8_200 }))
      .toMatchObject({
        difference_pence: -1_000,
        unexplained_difference: false,
        classification: 'deliberate_policy_difference',
      });

    const matchedPlan = planPayoutV2Earnings(baseInput());
    expect(classifyComparison(matchedPlan, { transfer_pence: 8_199 }))
      .toMatchObject({
        difference_pence: 1,
        unexplained_difference: true,
        classification: 'unexplained_difference',
      });

    expect(classifyComparison(matchedPlan, {
      transfer_pence: 0,
      vehicle_deposit_pence: 25_000,
    })).toMatchObject({
      deliberate_policy_differences: ['vehicle_deposit_handled_off_system'],
      unexplained_difference: false,
      classification: 'deliberate_policy_difference',
    });
  });

  test('planner and materializer contain no live-price fallback or Stripe mutation', () => {
    const planner = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', '_payout-v2-earning-planner.js'),
      'utf8'
    );
    const materializer = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', '_payout-v2-materializer.js'),
      'utf8'
    );
    for (const source of [planner, materializer]) {
      expect(source).not.toMatch(
        /lesson_types\.price_pence|custom_hourly_rate|hourly_rate_pence|bulk_hourly_pence|list_price_pence/
      );
      expect(source).not.toMatch(
        /transfers\.create|refunds\.create|paymentIntents\.(capture|create)|checkout\.sessions\.create/
      );
      expect(source).not.toContain('payout_engine_version');
    }
    expect(materializer).not.toMatch(
      /\b(UPDATE|DELETE)\s+(instructor_payouts|payout_line_items|school_payouts|school_payout_line_items)\b/i
    );
  });

  test('shadow surfaces remain read-only, explicitly scoped, and separate from materialisation', () => {
    const shadow = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', '_payout-v2-shadow.js'),
      'utf8'
    );
    const command = fs.readFileSync(
      path.resolve(__dirname, '..', 'scripts', 'payout-v2-shadow-statement.js'),
      'utf8'
    );
    const admin = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', 'admin.js'),
      'utf8'
    );
    const diagnostic = fs.readFileSync(
      path.resolve(
        __dirname,
        '..',
        'db',
        'diagnostics',
        'payout-v2-earning-shadow-reconciliation.sql'
      ),
      'utf8'
    );
    for (const source of [shadow, command]) {
      expect(source).not.toMatch(
        /(?:^|\n)\s*(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i
      );
      expect(source).not.toMatch(
        /transfers\.create|refunds\.create|paymentIntents\.(capture|create)|checkout\.sessions\.create/
      );
    }
    expect(command).toContain("positiveInteger('PAYOUT_V2_SCHOOL_ID')");
    expect(diagnostic).toContain(":'school_id'::integer");
    expect(admin).toContain("action === 'payout-v2-shadow-statement'");
    expect(admin).not.toMatch(
      /payout-v2-(?:materiali[sz]e|activate|transfer)/
    );
  });
});
