// @ts-check
// Pure unit tests for partial paid repeat-offer accounting plans.

const { test, expect } = require('@playwright/test');
const { planPartialRepeatOfferAccounting } = require('../api/_bcs-repeat-offer-plan');

function source(overrides = {}) {
  return {
    id: 42,
    school_id: 1,
    minutes: 270,
    amount_pence: 24750,
    stripe_fee_pence: 431,
    effective_rate_pence_per_minute: 92,
    absorbed_by: null,
    active_minutes_drawn: 0,
    active_contribution_pence: 0,
    active_stripe_fee_pence: 0,
    adjusted_minutes: 0,
    adjusted_pence: 0,
    ...overrides,
  };
}

test.describe('planPartialRepeatOfferAccounting', () => {
  test('plans booked BCS rows plus CSA for a partially booked paid repeat offer', () => {
    const plan = planPartialRepeatOfferAccounting({
      schoolId: 1,
      source: source(),
      requestedRepeatCount: 3,
      durationMins: 90,
      bookedLessons: [
        { booking_id: 1101, minutes: 90 },
        { booking_id: 1102, minutes: 90 },
      ],
      refundedMinutes: 90,
      refundedPence: 8250,
      stripeRefundId: 're_123',
    });

    expect(plan.ok).toBe(true);
    expect(plan.bcs_draw_plan).toHaveLength(2);
    expect(plan.bcs_draw_plan.map(row => [row.booking_id, row.minutes_drawn]))
      .toEqual([[1101, 90], [1102, 90]]);
    expect(plan.csa_adjustment_plan).toEqual({
      school_id: 1,
      credit_transaction_id: 42,
      kind: 'cash_refund',
      minutes_adjusted: 90,
      pence_adjusted: 8250,
      reason: 'Partial repeat offer refund for unbooked lessons',
      stripe_refund_id: 're_123',
    });
    expect(plan.totals.bcs_minutes + plan.totals.csa_minutes).toBe(270);
    expect(plan.totals.bcs_contribution_pence + plan.totals.csa_pence_adjusted).toBe(24750);
    expect(plan.totals.bcs_stripe_fee_pence).toBeLessThanOrEqual(431);
    expect(plan.invariants).toEqual({
      minutes_conserved: true,
      contribution_conserved: true,
      active_stripe_fee_not_over_allocated: true,
      exhausted_source: true,
    });
  });

  test('supports requested total minutes without repeat count', () => {
    const plan = planPartialRepeatOfferAccounting({
      schoolId: 1,
      source: source({ minutes: 360, amount_pence: 33333, stripe_fee_pence: 611 }),
      requestedTotalMinutes: 360,
      bookedLessons: [
        { booking_id: 1201, minutes: 120 },
        { booking_id: 1202, minutes: 120 },
      ],
      unbookedMinutes: 120,
      refundedPence: 11111,
    });

    expect(plan.booked_minutes).toBe(240);
    expect(plan.csa_minutes).toBe(120);
    expect(plan.totals.bcs_contribution_pence).toBe(22222);
    expect(plan.totals.bcs_contribution_pence + plan.totals.csa_pence_adjusted).toBe(33333);
  });

  test('splits hostile odd pennies deterministically across non-even repeat counts', () => {
    const plan = planPartialRepeatOfferAccounting({
      schoolId: 2,
      source: source({
        id: 88,
        school_id: 2,
        minutes: 225,
        amount_pence: 10001,
        stripe_fee_pence: 277,
        effective_rate_pence_per_minute: 44,
      }),
      requestedRepeatCount: 5,
      durationMins: 45,
      bookedLessons: [
        { booking_id: 2101, minutes: 45 },
        { booking_id: 2102, minutes: 45 },
        { booking_id: 2103, minutes: 45 },
      ],
      refundedMinutes: 90,
    });

    expect(plan.csa_adjustment_plan).toEqual(expect.objectContaining({
      school_id: 2,
      credit_transaction_id: 88,
      minutes_adjusted: 90,
      pence_adjusted: 4000,
    }));
    expect(plan.bcs_draw_plan.map(row => [row.booking_id, row.contribution_pence, row.stripe_fee_pence]))
      .toEqual([
        [2101, 2000, 92],
        [2102, 2000, 92],
        [2103, 2001, 93],
      ]);
    expect(plan.totals.bcs_contribution_pence + plan.totals.csa_pence_adjusted).toBe(10001);
    expect(plan.totals.bcs_stripe_fee_pence).toBe(277);
    expect(plan.invariants.contribution_conserved).toBe(true);
  });

  test('allocates all remaining source Stripe fee to active BCS rows when booked plus CSA exhausts source', () => {
    const plan = planPartialRepeatOfferAccounting({
      schoolId: 1,
      source: source({
        minutes: 180,
        amount_pence: 12345,
        stripe_fee_pence: 321,
        active_minutes_drawn: 45,
        active_contribution_pence: 3000,
        active_stripe_fee_pence: 80,
      }),
      requestedTotalMinutes: 180,
      bookedLessons: [
        { booking_id: 6101, minutes: 45 },
        { booking_id: 6102, minutes: 45 },
      ],
      refundedMinutes: 45,
      refundedPence: 3115,
    });

    expect(plan.remaining_unplanned_minutes).toBe(0);
    expect(plan.totals.bcs_stripe_fee_pence).toBe(241);
    expect(plan.totals.bcs_stripe_fee_pence + 80).toBe(321);
    expect(plan.invariants.exhausted_source).toBe(true);
    expect(plan.invariants.active_stripe_fee_not_over_allocated).toBe(true);
  });

  test('honours existing CSA-adjusted source availability inputs', () => {
    const plan = planPartialRepeatOfferAccounting({
      schoolId: 1,
      source: source({
        minutes: 360,
        amount_pence: 32003,
        stripe_fee_pence: 599,
        active_minutes_drawn: 90,
        active_contribution_pence: 8001,
        active_stripe_fee_pence: 149,
      }),
      requestedTotalMinutes: 360,
      bookedLessons: [
        { booking_id: 3101, minutes: 90 },
        { booking_id: 3102, minutes: 90 },
      ],
      refundedMinutes: 90,
      refundedPence: 8000,
    });

    expect(plan.totals.bcs_minutes).toBe(180);
    expect(plan.totals.csa_minutes).toBe(90);
    expect(plan.totals.bcs_contribution_pence).toBe(16002);
    expect(plan.totals.bcs_contribution_pence + plan.totals.csa_pence_adjusted + 8001).toBe(32003);
    expect(plan.totals.bcs_stripe_fee_pence + 149).toBeLessThanOrEqual(599);
    expect(plan.invariants.minutes_conserved).toBe(true);
    expect(plan.invariants.contribution_conserved).toBe(true);
  });

  test('throws when explicit school does not match source school', () => {
    expect(() => planPartialRepeatOfferAccounting({
      schoolId: 2,
      source: source({ school_id: 1 }),
      requestedRepeatCount: 3,
      durationMins: 90,
      bookedLessons: [{ booking_id: 4101, minutes: 90 }],
      refundedMinutes: 180,
    })).toThrow(/schoolId must match source\.school_id/);
  });

  test('throws when booked plus CSA minutes over-consume the source', () => {
    expect(() => planPartialRepeatOfferAccounting({
      schoolId: 1,
      source: source(),
      requestedRepeatCount: 3,
      durationMins: 90,
      bookedLessons: [
        { booking_id: 5101, minutes: 90 },
        { booking_id: 5102, minutes: 90 },
      ],
      refundedMinutes: 120,
    })).toThrow(/booked plus CSA minutes cannot exceed available source minutes/);
  });

  test('throws when explicit refunded pence leaves source minutes unplanned', () => {
    expect(() => planPartialRepeatOfferAccounting({
      schoolId: 1,
      source: source(),
      requestedRepeatCount: 3,
      durationMins: 90,
      bookedLessons: [
        { booking_id: 7101, minutes: 90 },
      ],
      refundedMinutes: 90,
      refundedPence: 8250,
    })).toThrow(/account for all available source minutes/);
  });

  test('rejects explicit refunded pence when there are no CSA minutes to carry it', () => {
    let returnedPlan;

    expect(() => {
      returnedPlan = planPartialRepeatOfferAccounting({
        schoolId: 1,
        source: source({
          minutes: 180,
          amount_pence: 18000,
          stripe_fee_pence: 333,
        }),
        requestedTotalMinutes: 180,
        bookedLessons: [
          { booking_id: 8101, minutes: 90 },
          { booking_id: 8102, minutes: 90 },
        ],
        refundedMinutes: 0,
        refundedPence: 1000,
      });
    }).toThrow(/refundedPence requires positive CSA minutes/);

    expect(returnedPlan?.ok === true && returnedPlan?.invariants?.contribution_conserved === false)
      .toBe(false);
  });
});
