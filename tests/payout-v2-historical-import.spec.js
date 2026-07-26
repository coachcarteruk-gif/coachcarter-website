const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  SOURCE_KINDS,
  buildStripeSourceRecord,
  buildLegacySourceRecord,
} = require('../api/_payout-v2-source-writer');
const {
  PAYOUT_V2_HISTORICAL_IMPORT_VERSION,
  createHistoricalImportPlan,
  assertExpectedPlan,
} = require('../api/_payout-v2-historical-import');

function sourceRow(id, overrides = {}) {
  return {
    id,
    school_id: 7,
    learner_id: 21,
    instructor_id: 9,
    type: 'slot_purchase',
    amount_pence: 8250,
    stripe_fee_pence: 250,
    stripe_session_id: `cs_import_${id}`,
    stripe_payment_intent_id: `pi_import_${id}`,
    created_at: new Date(`2026-07-25T10:${String(id).padStart(2, '0')}:00.000Z`),
    ...overrides,
  };
}

function stripeRecord(row, evidence = {}) {
  return buildStripeSourceRecord({
    sourceRow: row,
    schoolId: 7,
    sourceKind: SOURCE_KINDS.DIRECT_BOOKING,
    stripeEvidence: {
      checkoutSessionId: row.stripe_session_id,
      paymentIntentId: row.stripe_payment_intent_id,
      paymentIntentStatus: 'succeeded',
      chargeId: `ch_import_${row.id}`,
      chargePaid: true,
      chargeCaptured: true,
      chargePaymentIntentId: row.stripe_payment_intent_id,
      balanceTransactionId: `txn_import_${row.id}`,
      balanceTransactionSourceId: `ch_import_${row.id}`,
      balanceTransactionType: 'charge',
      balanceTransactionAmountPence: row.amount_pence,
      balanceTransactionCurrency: 'gbp',
      amountPence: row.amount_pence,
      currency: 'gbp',
      feePence: row.stripe_fee_pence,
      source: 'balance_transaction',
      ...evidence,
    },
  });
}

function reviewedPlan(overrides = {}) {
  const direct = sourceRow(1);
  const legacy = sourceRow(2, {
    type: 'legacy_grandfather',
    amount_pence: 41400,
    stripe_fee_pence: 0,
    stripe_session_id: null,
    stripe_payment_intent_id: null,
  });
  return createHistoricalImportPlan({
    schoolId: 7,
    operatorIdentity: 'admin@example.test',
    evidenceReference: 'review:payout-v2:fixture',
    candidateRows: [direct, legacy],
    records: [
      stripeRecord(direct),
      buildLegacySourceRecord({ sourceRow: legacy, schoolId: 7 }),
    ],
    ...overrides,
  });
}

test.describe('Payout v2 reviewed historical import contracts', () => {
  test('plan fingerprint and totals are deterministic and versioned', () => {
    const first = reviewedPlan();
    const second = reviewedPlan();
    expect(first).toEqual(second);
    expect(first.import_version).toBe(PAYOUT_V2_HISTORICAL_IMPORT_VERSION);
    expect(first.plan_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.candidate_count).toBe(2);
    expect(first.totals).toMatchObject({
      gross_collected_pence: 49650,
      stripe_fee_pence: 250,
      payable_pool_pence: 8000,
      refundable_pool_pence: 8000,
      funding_class_counts: {
        stripe_backed: 1,
        legacy_pre_connect_settled: 1,
      },
    });
  });

  test('reviewed fingerprint drifts on immutable candidate or evidence change', () => {
    const original = reviewedPlan();
    const changedRow = sourceRow(1, { amount_pence: 8249 });
    const legacy = sourceRow(2, {
      type: 'legacy_grandfather',
      amount_pence: 41400,
      stripe_fee_pence: 0,
      stripe_session_id: null,
      stripe_payment_intent_id: null,
    });
    const changed = createHistoricalImportPlan({
      schoolId: 7,
      operatorIdentity: 'admin@example.test',
      evidenceReference: 'review:payout-v2:fixture',
      candidateRows: [changedRow, legacy],
      records: [
        stripeRecord(changedRow),
        buildLegacySourceRecord({ sourceRow: legacy, schoolId: 7 }),
      ],
    });
    expect(changed.plan_fingerprint).not.toBe(original.plan_fingerprint);
    expect(changed.candidate_snapshot_fingerprint)
      .not.toBe(original.candidate_snapshot_fingerprint);
  });

  test('expected count, totals, and reviewed fingerprint all fail closed', () => {
    const plan = reviewedPlan();
    const expected = {
      candidateCount: plan.candidate_count,
      grossCollectedPence: plan.totals.gross_collected_pence,
      stripeFeePence: plan.totals.stripe_fee_pence,
      payablePoolPence: plan.totals.payable_pool_pence,
      refundablePoolPence: plan.totals.refundable_pool_pence,
      reviewedPlanFingerprint: plan.plan_fingerprint,
    };
    expect(() => assertExpectedPlan(plan, expected)).not.toThrow();
    for (const changed of [
      { candidateCount: expected.candidateCount + 1 },
      { grossCollectedPence: expected.grossCollectedPence + 1 },
      { stripeFeePence: expected.stripeFeePence + 1 },
      { payablePoolPence: expected.payablePoolPence + 1 },
      { refundablePoolPence: expected.refundablePoolPence + 1 },
      { reviewedPlanFingerprint: 'sha256:' + '0'.repeat(64) },
    ]) {
      expect(() => assertExpectedPlan(plan, { ...expected, ...changed }))
        .toThrow(expect.objectContaining({ code: 'PAYOUT_V2_IMPORT_PLAN_DRIFT' }));
    }
  });

  test('missing evidence remains manual review and positive legacy remains zero payable', () => {
    const missing = sourceRow(3);
    const legacy = sourceRow(4, {
      type: 'legacy_grandfather',
      amount_pence: 41400,
      stripe_fee_pence: 0,
      stripe_session_id: null,
      stripe_payment_intent_id: null,
    });
    const plan = createHistoricalImportPlan({
      schoolId: 7,
      operatorIdentity: 'admin@example.test',
      evidenceReference: 'review:payout-v2:manual-review',
      candidateRows: [missing, legacy],
      records: [
        stripeRecord(missing, {
          chargeId: null,
          balanceTransactionId: null,
          feePence: null,
        }),
        buildLegacySourceRecord({ sourceRow: legacy, schoolId: 7 }),
      ],
    });
    expect(plan.candidates[0]).toMatchObject({
      funding_class: 'manual_review',
      payable_pool_pence: 0,
      refundable_pool_pence: 0,
    });
    expect(plan.candidates[1]).toMatchObject({
      funding_class: 'legacy_pre_connect_settled',
      gross_collected_pence: 41400,
      payable_pool_pence: 0,
      refundable_pool_pence: 0,
    });
  });

  test('runner defaults dry and requires independent mutation gates', () => {
    const runner = fs.readFileSync(
      path.resolve(__dirname, '..', 'scripts', 'payout-v2-historical-source-import.js'),
      'utf8'
    );
    expect(runner).toContain("const mode = args.mode || 'dry-run'");
    expect(runner).toContain('PAYOUT_V2_IMPORT_MUTATION_ENABLED');
    expect(runner).toContain('PAYOUT_V2_REVIEWED_HISTORICAL_IMPORT');
    expect(runner).toContain('APPLY_PAYOUT_V2_HISTORICAL_IMPORT');
    expect(runner).toContain('TEST_ROLLBACK_PAYOUT_V2_HISTORICAL_IMPORT');
    expect(runner).toContain('reviewed-plan-fingerprint');
    expect(runner).toContain('expected-candidate-count');
    expect(runner).toContain('operator-identity');
    expect(runner).toContain('evidence-reference');
    expect(runner).toContain('PAYOUT_V2_IMPORT_RUN_INCOMPLETE');
    expect(runner).not.toMatch(/transfers\.create|refunds\.create|paymentIntents\.capture/);
  });

  test('historical planner contains no live-price or external cash inference', () => {
    const importer = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', '_payout-v2-historical-import.js'),
      'utf8'
    );
    expect(importer).not.toMatch(
      /lesson_types\.price_pence|custom_hourly_rate|hourly_rate_pence|bulk_hourly_pence|list_price_pence/
    );
    expect(importer).not.toMatch(/external_cash_payable|payment_method\s*=\s*'cash'|setmore/i);
  });
});
