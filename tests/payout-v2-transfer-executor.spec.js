// @ts-check

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  logicalTransferIdentity,
  sourceTransferGroup,
  buildSourceLinkedTransferPlan,
  stripeCreateParams,
  assertStripeIdentity,
  emitTransferAlert,
  verifySourceCapacity,
  assertBatchPlanSnapshot,
} = require('../api/_payout-v2-transfer-executor');

const PLAN_FINGERPRINT = `sha256:${'a'.repeat(64)}`;

function baseBatch(overrides = {}) {
  return {
    id: 91,
    school_id: 7,
    instructor_id: 12,
    destination_school_id: null,
    payout_route: 'instructor_direct',
    currency: 'gbp',
    instructor_amount_pence: 9000,
    plan_fingerprint: PLAN_FINGERPRINT,
    ...overrides,
  };
}

function baseClaims(overrides = {}) {
  return [
    {
      booking_earning_id: 31,
      calculation_json: { net_shadow_transfer_pence: 5000 },
    },
    {
      booking_earning_id: 32,
      calculation_json: { net_shadow_transfer_pence: 4000 },
    },
  ].map((row) => ({ ...row, ...overrides }));
}

function sourceAllocation({
  earningId,
  sourceId,
  contribution,
  charge,
  schoolId = 7,
  fundingClass = 'stripe_backed',
  metadata = {},
}) {
  return {
    school_id: schoolId,
    booking_earning_id: earningId,
    funding_source_id: sourceId,
    allocation_fingerprint: `sha256:${String(sourceId).padStart(64, '0')}`,
    instructor_earning_contribution_pence: contribution,
    funding_class: fundingClass,
    source_status: 'available',
    stripe_charge_id: charge,
    metadata,
  };
}

test.describe('Payout v2 transfer executor pure contracts', () => {
  test('logical fingerprints and Stripe idempotency keys are deterministic and plan-specific', () => {
    const input = {
      schoolId: 7,
      batchId: 91,
      destinationAccountId: 'acct_destination',
      sourceGroup: 'stripe-charge:ch_source',
      amountPence: 4500,
      currency: 'gbp',
      planFingerprint: PLAN_FINGERPRINT,
    };
    const first = logicalTransferIdentity(input);
    const retry = logicalTransferIdentity({ ...input });
    expect(retry).toEqual(first);
    expect(first.logicalFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.idempotencyKey).toMatch(/^payout-v2:[0-9a-f]{64}$/);
    expect(first.idempotencyKey).not.toContain('acct_destination');

    expect(logicalTransferIdentity({
      ...input,
      planFingerprint: `sha256:${'b'.repeat(64)}`,
    }).idempotencyKey).not.toBe(first.idempotencyKey);
    expect(logicalTransferIdentity({
      ...input,
      schoolId: 8,
    }).idempotencyKey).not.toBe(first.idempotencyKey);
  });

  test('an invalid or changed materialized batch plan fingerprint is refused', () => {
    expect(() => assertBatchPlanSnapshot({
      school_id: 7,
      instructor_id: 12,
      destination_school_id: null,
      payout_route: 'instructor_direct',
      calculation_version: 'payout-v2-earning-planner-v1',
      plan_fingerprint: PLAN_FINGERPRINT,
      plan_json: {
        calculation_version: 'payout-v2-earning-planner-v1',
        school_id: 7,
        payout_route: 'instructor_direct',
        destination_instructor_id: 12,
        destination_school_id: null,
        totals: {},
      },
    })).toThrow(/plan fingerprint is invalid/i);
  });

  test('multiple source-charge groups conserve every transfer and allocation penny', () => {
    const allocations = [
      sourceAllocation({
        earningId: 31,
        sourceId: 101,
        contribution: 3000,
        charge: 'ch_A',
      }),
      sourceAllocation({
        earningId: 31,
        sourceId: 102,
        contribution: 2000,
        charge: 'ch_B',
      }),
      sourceAllocation({
        earningId: 32,
        sourceId: 101,
        contribution: 4000,
        charge: 'ch_A',
      }),
    ];
    const transfers = buildSourceLinkedTransferPlan({
      batch: baseBatch(),
      plan: {},
      claimRows: baseClaims(),
      allocationRows: allocations,
      destinationAccountId: 'acct_direct',
    });
    expect(transfers).toHaveLength(2);
    expect(transfers.map((row) => ({
      group: row.sourceGroup,
      amount: row.amountPence,
    }))).toEqual([
      { group: 'stripe-charge:ch_A', amount: 7000 },
      { group: 'stripe-charge:ch_B', amount: 2000 },
    ]);
    for (const transfer of transfers) {
      expect(transfer.sources.reduce((sum, row) => sum + row.amountPence, 0))
        .toBe(transfer.amountPence);
    }
    expect(transfers.reduce((sum, row) => sum + row.amountPence, 0)).toBe(9000);
  });

  test('batch deductions are allocated deterministically without recalculating earnings', () => {
    const transfers = buildSourceLinkedTransferPlan({
      batch: baseBatch({ instructor_amount_pence: 4500 }),
      plan: {},
      claimRows: [
        {
          booking_earning_id: 31,
          calculation_json: { net_shadow_transfer_pence: 4500 },
        },
      ],
      allocationRows: [
        sourceAllocation({
          earningId: 31,
          sourceId: 101,
          contribution: 5000,
          charge: 'ch_A',
        }),
        sourceAllocation({
          earningId: 31,
          sourceId: 102,
          contribution: 5000,
          charge: 'ch_B',
        }),
      ],
      destinationAccountId: 'acct_direct',
    });
    expect(transfers.map((row) => row.amountPence)).toEqual([2250, 2250]);
  });

  test('direct and school routes remain destination-specific', () => {
    const common = {
      schoolId: 7,
      batchId: 91,
      sourceGroup: 'stripe-charge:ch_source',
      amountPence: 4500,
      currency: 'gbp',
      planFingerprint: PLAN_FINGERPRINT,
    };
    const direct = logicalTransferIdentity({
      ...common,
      destinationAccountId: 'acct_instructor',
    });
    const school = logicalTransferIdentity({
      ...common,
      destinationAccountId: 'acct_school',
    });
    expect(direct.logicalFingerprint).not.toBe(school.logicalFingerprint);
    expect(direct.idempotencyKey).not.toBe(school.idempotencyKey);
  });

  test('cross-school and unavailable sources fail closed', () => {
    expect(() => buildSourceLinkedTransferPlan({
      batch: baseBatch({ instructor_amount_pence: 5000 }),
      plan: {},
      claimRows: [baseClaims()[0]],
      allocationRows: [
        sourceAllocation({
          earningId: 31,
          sourceId: 101,
          contribution: 5000,
          charge: 'ch_A',
          schoolId: 8,
        }),
      ],
      destinationAccountId: 'acct_direct',
    })).toThrow(/unavailable or cannot fund/i);
  });

  test('source-cap enforcement accounts for previously transferred source pence', async () => {
    const client = {
      async query() {
        return {
          rows: [{
            payable_pool_pence: 500,
            allocated_pence: 500,
            previously_transferred_pence: 400,
          }],
        };
      },
    };
    await expect(verifySourceCapacity(client, 7, [{
      body: { payout_batch_id: 91 },
      sources: [{ fundingSourceId: 101, amountPence: 101 }],
    }])).rejects.toMatchObject({
      code: 'PAYOUT_V2_TRANSFER_SOURCE_CAP_EXCEEDED',
      reasons: ['funding_source_id:101'],
    });
    await expect(verifySourceCapacity(client, 7, [{
      body: { payout_batch_id: 91 },
      sources: [{ fundingSourceId: 101, amountPence: 100 }],
    }])).resolves.toBeUndefined();
  });

  test('non-Stripe positive sources require an evidence-linked documented group', () => {
    expect(() => sourceTransferGroup({
      funding_class: 'platform_goodwill',
      metadata: { evidence_reference: 'case:1' },
    })).toThrow(/documented immutable transfer group/i);
    expect(sourceTransferGroup({
      funding_class: 'external_cash_payable',
      metadata: {
        evidence_reference: 'bank:statement:1',
        transfer_source_group: 'bank-receipt-1',
      },
    })).toEqual({
      key: 'documented:external_cash_payable:bank-receipt-1',
      stripeSourceChargeId: null,
    });
  });

  test('Stripe request uses immutable source_transaction and deterministic metadata', () => {
    const transfer = {
      amount_pence: 1234,
      currency: 'gbp',
      stripe_destination_account_id: 'acct_destination',
      stripe_source_charge_id: 'ch_source',
      transfer_group: 'payout-v2-b91-group',
      logical_transfer_fingerprint: `sha256:${'c'.repeat(64)}`,
      idempotency_key: `payout-v2:${'d'.repeat(64)}`,
      metadata: { school_id: '7', payout_batch_id: '91' },
    };
    expect(stripeCreateParams(transfer)).toEqual({
      amount: 1234,
      currency: 'gbp',
      destination: 'acct_destination',
      source_transaction: 'ch_source',
      transfer_group: 'payout-v2-b91-group',
      metadata: {
        school_id: '7',
        payout_batch_id: '91',
        payout_v2_logical_transfer_fingerprint:
          transfer.logical_transfer_fingerprint,
        payout_v2_idempotency_key: transfer.idempotency_key,
      },
    });
  });

  test('reconciliation identity rejects amount, destination, source, and metadata drift', () => {
    const transfer = {
      amount_pence: 1234,
      currency: 'gbp',
      stripe_destination_account_id: 'acct_destination',
      stripe_source_charge_id: 'ch_source',
      transfer_group: 'payout-v2-b91-group',
      logical_transfer_fingerprint: `sha256:${'c'.repeat(64)}`,
      idempotency_key: `payout-v2:${'d'.repeat(64)}`,
    };
    const stripeTransfer = {
      id: 'tr_1',
      amount: 1234,
      currency: 'gbp',
      destination: 'acct_destination',
      source_transaction: 'ch_source',
      transfer_group: 'payout-v2-b91-group',
      metadata: {
        payout_v2_logical_transfer_fingerprint:
          transfer.logical_transfer_fingerprint,
        payout_v2_idempotency_key: transfer.idempotency_key,
      },
      created: 1,
      livemode: false,
    };
    expect(assertStripeIdentity(transfer, stripeTransfer).id).toBe('tr_1');
    expect(() => assertStripeIdentity(transfer, {
      ...stripeTransfer,
      destination: 'acct_wrong',
    })).toThrow(/contradicts immutable local intent/i);
  });

  test('failure alerts are injected, structured, non-PII, and cannot break state handling', async () => {
    const seen = [];
    expect(await emitTransferAlert(async (payload) => seen.push(payload), {
      event: 'transfer_submission_ambiguous',
      school_id: 7,
      payout_batch_id: 91,
      payout_transfer_id: 101,
      operator_review_required: true,
    })).toBe(true);
    expect(seen[0]).toEqual({
      component: 'payout_v2_transfer_executor',
      event: 'transfer_submission_ambiguous',
      school_id: 7,
      payout_batch_id: 91,
      payout_transfer_id: 101,
      operator_review_required: true,
    });
    expect(JSON.stringify(seen[0])).not.toMatch(/learner|instructor_name|email/i);
    expect(await emitTransferAlert(async () => {
      throw new Error('fake alert transport failure');
    }, { event: 'transfer_submission_ambiguous' })).toBe(false);
  });

  test('executor is inactive and has no live-price, v1 mutation, activation, route, or real-client fallback', () => {
    const root = path.resolve(__dirname, '..');
    const executor = fs.readFileSync(
      path.join(root, 'api', '_payout-v2-transfer-executor.js'),
      'utf8'
    );
    expect(executor).not.toMatch(/lesson_types|list_price|hourly_rate|bulk_hourly/i);
    expect(executor).not.toMatch(/UPDATE\s+(instructor_payouts|school_payouts|payout_line_items)/i);
    expect(executor).not.toMatch(/payout_engine_version\s*=/i);
    expect(executor).not.toMatch(/new\s+Stripe|STRIPE_SECRET_KEY/i);

    for (const file of [
      'api/admin.js',
      'api/cron-payouts.js',
      'api/instructor.js',
      'api/connect.js',
      'api/webhook.js',
    ]) {
      expect(fs.readFileSync(path.join(root, file), 'utf8'))
        .not.toContain('_payout-v2-transfer-executor');
    }
  });
});
