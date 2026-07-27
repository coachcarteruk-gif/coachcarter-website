const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  PAYOUT_V2_RECOVERY_VERSION,
  FULL_AVAILABLE_OFFSET_POLICY,
  planFullOffsetRecovery,
  buildOpeningRecoveryRecord,
  buildRecoveryApplicationRecord,
} = require('../api/_payout-v2-recovery');

function recovery(id, remainingPence, createdAt = '2026-07-25T00:00:00.000Z') {
  return { id, remainingPence, createdAt };
}

test.describe('Payout v2 full-offset recovery contracts', () => {
  test('a future payout larger than the recovery pays only the remainder', () => {
    const plan = planFullOffsetRecovery({
      availablePence: 60_000,
      recoveries: [recovery(1, 41_400)],
    });
    expect(plan).toMatchObject({
      availableBeforeRecoveryPence: 60_000,
      recoveryDeductedPence: 41_400,
      instructorTransferPence: 18_600,
      outstandingBeforePence: 41_400,
      outstandingAfterPence: 0,
      allocations: [{
        recoveryAdjustmentId: 1,
        appliedPence: 41_400,
        remainingPence: 0,
      }],
    });
    expect(plan.planFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('a smaller payout transfers zero and carries the recovery forward', () => {
    const first = planFullOffsetRecovery({
      availablePence: 25_000,
      recoveries: [recovery(1, 41_400)],
    });
    expect(first.recoveryDeductedPence).toBe(25_000);
    expect(first.instructorTransferPence).toBe(0);
    expect(first.outstandingAfterPence).toBe(16_400);

    const second = planFullOffsetRecovery({
      availablePence: 30_000,
      recoveries: [recovery(1, first.outstandingAfterPence)],
    });
    expect(second.recoveryDeductedPence).toBe(16_400);
    expect(second.instructorTransferPence).toBe(13_600);
    expect(second.outstandingAfterPence).toBe(0);
  });

  test('multiple recoveries apply oldest first and never produce a negative transfer', () => {
    const plan = planFullOffsetRecovery({
      availablePence: 12_000,
      recoveries: [
        recovery(2, 10_000, '2026-07-26T00:00:00.000Z'),
        recovery(1, 5_000, '2026-07-25T00:00:00.000Z'),
      ],
    });
    expect(plan.instructorTransferPence).toBe(0);
    expect(plan.allocations).toEqual([
      { recoveryAdjustmentId: 1, appliedPence: 5_000, remainingPence: 0 },
      { recoveryAdjustmentId: 2, appliedPence: 7_000, remainingPence: 3_000 },
    ]);
  });

  test('no available future entitlement creates no recovery application', () => {
    expect(planFullOffsetRecovery({
      availablePence: 0,
      recoveries: [recovery(1, 41_400)],
    })).toMatchObject({
      recoveryDeductedPence: 0,
      instructorTransferPence: 0,
      outstandingAfterPence: 41_400,
      allocations: [],
    });
  });

  test('opening recovery preserves the original payout and records a negative obligation', () => {
    const record = buildOpeningRecoveryRecord({
      schoolId: 1,
      instructorId: 4,
      amountPence: 41_400,
      sourcePayoutId: 7,
      sourceStripeTransferId: 'tr_recovery_contract',
      legacyBookingIds: [15, 13, 14, 11, 12],
      evidenceReference: 'forensic:payout-v2:legacy-five',
      operatorId: 3,
    });
    expect(record).toMatchObject({
      school_id: 1,
      instructor_id: 4,
      adjustment_type: 'recovery',
      amount_pence: -41_400,
      status: 'pending',
      metadata: {
        calculation_version: PAYOUT_V2_RECOVERY_VERSION,
        recovery_policy: FULL_AVAILABLE_OFFSET_POLICY,
        source_v1_payout_id: 7,
        source_legacy_booking_ids: [11, 12, 13, 14, 15],
        original_recovery_pence: 41_400,
        preserve_historical_payout: true,
      },
    });
  });

  test('application rows are positive, batch-linked children of the obligation', () => {
    const record = buildRecoveryApplicationRecord({
      schoolId: 1,
      instructorId: 4,
      recoveryAdjustmentId: 9,
      payoutBatchId: 12,
      appliedPence: 25_000,
      parentEvidenceReference: 'forensic:payout-v2:legacy-five',
      planFingerprint: `sha256:${'a'.repeat(64)}`,
    });
    expect(record).toMatchObject({
      school_id: 1,
      instructor_id: 4,
      parent_adjustment_id: 9,
      payout_batch_id: 12,
      adjustment_type: 'recovery_application',
      amount_pence: 25_000,
      status: 'applied',
    });
    expect(record.adjustment_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('writer is explicitly school scoped and contains no £414 hardcode', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', '_payout-v2-recovery.js'),
      'utf8'
    );
    expect(source).toContain('ip.school_id = ${schoolId}');
    expect(source).toContain('pli.school_id = ip.school_id');
    expect(source).toContain('lb.school_id = pli.school_id');
    expect(source).toContain("ct.type = 'legacy_grandfather'");
    expect(source).toContain('bcs.school_id = pli.school_id');
    expect(source).not.toContain('41400');
    expect(source).not.toMatch(/schoolId\s*\|\|\s*1|school_id[^,\n]*DEFAULT\s+1/i);
  });
});
