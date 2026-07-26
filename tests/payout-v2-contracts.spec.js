const { test, expect } = require('@playwright/test');
const {
  PAYOUT_V2_CALCULATION_VERSION,
  FUNDING_CLASSES,
  canonicalJson,
  fingerprintPayoutPlan,
  resolveFundingContribution,
} = require('../api/_payout-v2-contracts');

test.describe('Payout v2 pure contracts', () => {
  test('publishes a closed funding-class vocabulary and calculation version', () => {
    expect(PAYOUT_V2_CALCULATION_VERSION).toBe('payout-v2-ledger-foundation-v1');
    expect(FUNDING_CLASSES).toEqual([
      'stripe_backed',
      'legacy_pre_connect_settled',
      'platform_goodwill',
      'instructor_goodwill',
      'external_cash_payable',
      'external_cash_settled',
      'free',
      'manual_review',
    ]);
  });

  for (const fundingClass of [
    'legacy_pre_connect_settled',
    'instructor_goodwill',
    'external_cash_settled',
    'free',
  ]) {
    test(`${fundingClass} can never produce a positive payout`, () => {
      expect(resolveFundingContribution({
        fundingClass,
        payablePoolPence: 99_999,
        requestedPence: 8_250,
        evidence: { live_lesson_price_pence: 8_250 },
      })).toEqual({
        contributionPence: 0,
        blocked: false,
        reason: 'settled_or_zero_funded_source',
      });
    });
  }

  test('unknown and manual-review funding fail closed', () => {
    expect(resolveFundingContribution({
      fundingClass: 'cash',
      payablePoolPence: 8_250,
      requestedPence: 8_250,
    })).toMatchObject({ contributionPence: 0, blocked: true, reason: 'unknown_funding_class' });
    expect(resolveFundingContribution({
      fundingClass: 'manual_review',
      payablePoolPence: 0,
      requestedPence: 0,
    })).toMatchObject({ contributionPence: 0, blocked: true, reason: 'manual_review_required' });
  });

  test('Stripe-backed funding needs an immutable Stripe identity', () => {
    expect(resolveFundingContribution({
      fundingClass: 'stripe_backed',
      payablePoolPence: 7_000,
      requestedPence: 7_000,
    })).toMatchObject({
      contributionPence: 0,
      blocked: true,
      reason: 'missing_stripe_funding_evidence',
    });
    expect(resolveFundingContribution({
      fundingClass: 'stripe_backed',
      payablePoolPence: 7_000,
      requestedPence: 7_000,
      evidence: { stripe_charge_id: 'ch_contract' },
    })).toMatchObject({ contributionPence: 7_000, blocked: false, reason: null });
  });

  test('cash and platform funding require explicit evidence, not a payment label', () => {
    expect(resolveFundingContribution({
      fundingClass: 'external_cash_payable',
      payablePoolPence: 5_000,
      requestedPence: 5_000,
      evidence: { payment_method: 'cash' },
    })).toMatchObject({
      contributionPence: 0,
      blocked: true,
      reason: 'missing_explicit_funding_evidence',
    });
    expect(resolveFundingContribution({
      fundingClass: 'external_cash_payable',
      payablePoolPence: 5_000,
      requestedPence: 5_000,
      evidence: { explicitly_funded: true, evidence_reference: 'operator-case-123' },
    })).toMatchObject({ contributionPence: 5_000, blocked: false });
  });

  test('a source allocation cannot exceed its source-backed payable pool', () => {
    expect(resolveFundingContribution({
      fundingClass: 'stripe_backed',
      payablePoolPence: 6_999,
      requestedPence: 7_000,
      evidence: { stripe_payment_intent_id: 'pi_contract' },
    })).toMatchObject({
      contributionPence: 0,
      blocked: true,
      reason: 'source_payable_pool_exceeded',
    });
  });

  test('pence inputs must be non-negative safe integers', () => {
    expect(() => resolveFundingContribution({
      fundingClass: 'stripe_backed',
      payablePoolPence: 100.5,
      requestedPence: 100,
      evidence: { stripe_charge_id: 'ch_contract' },
    })).toThrow(/non-negative safe integer/);
  });

  test('canonical JSON is object-key stable and array-order sensitive', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } }))
      .toBe('{"a":{"x":3,"y":2},"z":1}');
    const first = fingerprintPayoutPlan({ school_id: 4, earnings: [11, 12], amount_pence: 5000 });
    const reorderedKeys = fingerprintPayoutPlan({ amount_pence: 5000, earnings: [11, 12], school_id: 4 });
    const reorderedArray = fingerprintPayoutPlan({ school_id: 4, earnings: [12, 11], amount_pence: 5000 });
    expect(first).toBe(reorderedKeys);
    expect(first).not.toBe(reorderedArray);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test('fingerprint changes with amount or calculation version', () => {
    const plan = { school_id: 4, amount_pence: 5000 };
    expect(fingerprintPayoutPlan(plan))
      .not.toBe(fingerprintPayoutPlan({ ...plan, amount_pence: 5001 }));
    expect(fingerprintPayoutPlan(plan, 'payout-v2-ledger-foundation-v2'))
      .not.toBe(fingerprintPayoutPlan(plan));
  });
});
