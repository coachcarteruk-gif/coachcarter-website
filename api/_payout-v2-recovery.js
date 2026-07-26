const {
  fingerprintPayoutPlan,
} = require('./_payout-v2-contracts');

const PAYOUT_V2_RECOVERY_VERSION = 'payout-v2-recovery-v1';
const FULL_AVAILABLE_OFFSET_POLICY = 'full_available_offset';

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
}

function requireNonNegativePence(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer in pence`);
  }
}

function cleanRequiredText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}

function normalizeRecoveries(recoveries) {
  if (!Array.isArray(recoveries)) {
    throw new TypeError('recoveries must be an array');
  }
  return recoveries.map((recovery, index) => {
    requirePositiveInteger(recovery.id, `recoveries[${index}].id`);
    requireNonNegativePence(
      recovery.remainingPence,
      `recoveries[${index}].remainingPence`
    );
    const createdAt = new Date(recovery.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new TypeError(`recoveries[${index}].createdAt must be a valid date`);
    }
    return {
      id: recovery.id,
      remainingPence: recovery.remainingPence,
      createdAt: createdAt.toISOString(),
    };
  }).sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt) || left.id - right.id
  ));
}

/**
 * Apply the owner-approved policy: retain all available future instructor
 * entitlement until the recovery is cleared, never below a zero transfer.
 */
function planFullOffsetRecovery({ availablePence, recoveries }) {
  requireNonNegativePence(availablePence, 'availablePence');
  const ordered = normalizeRecoveries(recoveries);
  let available = availablePence;
  const allocations = [];

  for (const recovery of ordered) {
    if (available === 0) break;
    const appliedPence = Math.min(available, recovery.remainingPence);
    if (appliedPence === 0) continue;
    allocations.push({
      recoveryAdjustmentId: recovery.id,
      appliedPence,
      remainingPence: recovery.remainingPence - appliedPence,
    });
    available -= appliedPence;
  }

  const recoveryDeductedPence = allocations.reduce(
    (total, allocation) => total + allocation.appliedPence,
    0
  );
  const outstandingBeforePence = ordered.reduce(
    (total, recovery) => total + recovery.remainingPence,
    0
  );
  const result = {
    availableBeforeRecoveryPence: availablePence,
    recoveryDeductedPence,
    instructorTransferPence: available,
    outstandingBeforePence,
    outstandingAfterPence: outstandingBeforePence - recoveryDeductedPence,
    allocations,
  };
  return {
    ...result,
    planFingerprint: fingerprintPayoutPlan(result, PAYOUT_V2_RECOVERY_VERSION),
  };
}

function openingRecoveryFingerprint({
  schoolId,
  instructorId,
  amountPence,
  sourcePayoutId,
  legacyBookingIds,
}) {
  return fingerprintPayoutPlan({
    school_id: schoolId,
    instructor_id: instructorId,
    amount_pence: amountPence,
    source_v1_payout_id: sourcePayoutId,
    source_legacy_booking_ids: [...legacyBookingIds].sort((a, b) => a - b),
    recovery_policy: FULL_AVAILABLE_OFFSET_POLICY,
  }, PAYOUT_V2_RECOVERY_VERSION);
}

function buildOpeningRecoveryRecord({
  schoolId,
  instructorId,
  amountPence,
  sourcePayoutId,
  sourceStripeTransferId,
  legacyBookingIds,
  evidenceReference,
  operatorId,
}) {
  requirePositiveInteger(schoolId, 'schoolId');
  requirePositiveInteger(instructorId, 'instructorId');
  requirePositiveInteger(amountPence, 'amountPence');
  requirePositiveInteger(sourcePayoutId, 'sourcePayoutId');
  requirePositiveInteger(operatorId, 'operatorId');
  const transferId = cleanRequiredText(sourceStripeTransferId, 'sourceStripeTransferId');
  if (!transferId.startsWith('tr_')) {
    throw new TypeError('sourceStripeTransferId must be a Stripe transfer ID');
  }
  const evidence = cleanRequiredText(evidenceReference, 'evidenceReference');
  if (!Array.isArray(legacyBookingIds) || legacyBookingIds.length === 0) {
    throw new TypeError('legacyBookingIds must contain the reviewed legacy bookings');
  }
  const uniqueBookingIds = [...new Set(legacyBookingIds)];
  for (const bookingId of uniqueBookingIds) {
    requirePositiveInteger(bookingId, 'legacyBookingIds[]');
  }
  if (uniqueBookingIds.length !== legacyBookingIds.length) {
    throw new TypeError('legacyBookingIds must not contain duplicates');
  }

  return {
    school_id: schoolId,
    instructor_id: instructorId,
    adjustment_type: 'recovery',
    amount_pence: -amountPence,
    currency: 'gbp',
    reason: 'Recover duplicate legacy-funded Connect payout from future instructor payouts',
    evidence_reference: evidence,
    operator_id: operatorId,
    status: 'pending',
    adjustment_fingerprint: openingRecoveryFingerprint({
      schoolId,
      instructorId,
      amountPence,
      sourcePayoutId,
      legacyBookingIds: uniqueBookingIds,
    }),
    metadata: {
      calculation_version: PAYOUT_V2_RECOVERY_VERSION,
      recovery_policy: FULL_AVAILABLE_OFFSET_POLICY,
      source_v1_payout_id: sourcePayoutId,
      source_stripe_transfer_id: transferId,
      source_legacy_booking_ids: uniqueBookingIds.sort((a, b) => a - b),
      original_recovery_pence: amountPence,
      preserve_historical_payout: true,
    },
  };
}

async function writeOpeningRecoveryAdjustment({
  sql,
  schoolId,
  instructorId,
  amountPence,
  sourcePayoutId,
  legacyBookingIds,
  evidenceReference,
  operatorId,
}) {
  if (typeof sql !== 'function') {
    throw new TypeError('sql must be a Neon-compatible tagged query function');
  }
  requirePositiveInteger(schoolId, 'schoolId');
  requirePositiveInteger(instructorId, 'instructorId');
  requirePositiveInteger(amountPence, 'amountPence');
  requirePositiveInteger(sourcePayoutId, 'sourcePayoutId');
  if (!Array.isArray(legacyBookingIds) || legacyBookingIds.length === 0) {
    throw new TypeError('legacyBookingIds must contain the reviewed legacy bookings');
  }
  const bookingIds = [...new Set(legacyBookingIds || [])];
  if (bookingIds.length !== legacyBookingIds.length) {
    throw new TypeError('legacyBookingIds must not contain duplicates');
  }
  for (const bookingId of bookingIds) {
    requirePositiveInteger(bookingId, 'legacyBookingIds[]');
  }

  const evidenceRows = await sql`
    SELECT
      ip.id AS payout_id,
      ip.school_id,
      ip.instructor_id,
      ip.amount_pence AS payout_amount_pence,
      ip.status,
      ip.stripe_transfer_id,
      COUNT(pli.id)::int AS matched_line_count,
      COALESCE(SUM(pli.instructor_amount_pence), 0)::int AS matched_amount_pence
    FROM instructor_payouts ip
    JOIN instructors i
      ON i.id = ip.instructor_id
     AND i.school_id = ip.school_id
    JOIN payout_line_items pli
      ON pli.payout_id = ip.id
     AND pli.school_id = ip.school_id
    JOIN lesson_bookings lb
      ON lb.id = pli.booking_id
     AND lb.school_id = pli.school_id
    WHERE ip.id = ${sourcePayoutId}
      AND ip.school_id = ${schoolId}
      AND ip.instructor_id = ${instructorId}
      AND pli.booking_id = ANY(${bookingIds}::integer[])
      AND EXISTS (
        SELECT 1
        FROM booking_credit_sources bcs
        JOIN credit_transactions ct
          ON ct.id = bcs.credit_transaction_id
         AND ct.school_id = bcs.school_id
        WHERE bcs.booking_id = pli.booking_id
          AND bcs.school_id = pli.school_id
          AND ct.type = 'legacy_grandfather'
      )
    GROUP BY ip.id, ip.school_id, ip.instructor_id
    LIMIT 1
  `;
  const evidence = evidenceRows[0];
  if (
    !evidence ||
    evidence.status !== 'completed' ||
    !evidence.stripe_transfer_id ||
    Number(evidence.matched_line_count) !== bookingIds.length ||
    Number(evidence.matched_amount_pence) !== amountPence
  ) {
    const err = new Error(
      'Recovery evidence does not match the completed payout lines in the requested school'
    );
    err.code = 'PAYOUT_V2_RECOVERY_EVIDENCE_MISMATCH';
    throw err;
  }

  const record = buildOpeningRecoveryRecord({
    schoolId,
    instructorId,
    amountPence,
    sourcePayoutId,
    sourceStripeTransferId: evidence.stripe_transfer_id,
    legacyBookingIds: bookingIds,
    evidenceReference,
    operatorId,
  });
  const inserted = await sql`
    INSERT INTO payout_adjustments (
      school_id,
      instructor_id,
      adjustment_type,
      amount_pence,
      currency,
      reason,
      evidence_reference,
      operator_id,
      status,
      adjustment_fingerprint,
      metadata
    )
    VALUES (
      ${record.school_id},
      ${record.instructor_id},
      ${record.adjustment_type},
      ${record.amount_pence},
      ${record.currency},
      ${record.reason},
      ${record.evidence_reference},
      ${record.operator_id},
      ${record.status},
      ${record.adjustment_fingerprint},
      ${JSON.stringify(record.metadata)}::jsonb
    )
    ON CONFLICT (school_id, adjustment_fingerprint) DO NOTHING
    RETURNING *
  `;
  const rows = inserted[0] ? inserted : await sql`
    SELECT *
    FROM payout_adjustments
    WHERE school_id = ${schoolId}
      AND adjustment_fingerprint = ${record.adjustment_fingerprint}
    LIMIT 1
  `;
  const adjustment = rows[0];
  const storedMetadata = adjustment?.metadata || {};
  const storedBookingIds = Array.isArray(storedMetadata.source_legacy_booking_ids)
    ? storedMetadata.source_legacy_booking_ids.map(Number).sort((a, b) => a - b)
    : [];
  const expectedBookingIds = [...bookingIds].sort((a, b) => a - b);
  if (
    !adjustment ||
    Number(adjustment.school_id) !== schoolId ||
    Number(adjustment.instructor_id) !== instructorId ||
    Number(adjustment.amount_pence) !== -amountPence ||
    adjustment.adjustment_type !== 'recovery' ||
    adjustment.evidence_reference !== record.evidence_reference ||
    Number(storedMetadata.source_v1_payout_id) !== sourcePayoutId ||
    storedMetadata.source_stripe_transfer_id !== evidence.stripe_transfer_id ||
    JSON.stringify(storedBookingIds) !== JSON.stringify(expectedBookingIds)
  ) {
    const err = new Error('Recovery adjustment replay contradicted immutable evidence');
    err.code = 'PAYOUT_V2_RECOVERY_CONFLICT';
    throw err;
  }
  return {
    created: Boolean(inserted[0]),
    adjustment,
  };
}

function buildRecoveryApplicationRecord({
  schoolId,
  instructorId,
  recoveryAdjustmentId,
  payoutBatchId,
  appliedPence,
  parentEvidenceReference,
  planFingerprint,
}) {
  requirePositiveInteger(schoolId, 'schoolId');
  requirePositiveInteger(instructorId, 'instructorId');
  requirePositiveInteger(recoveryAdjustmentId, 'recoveryAdjustmentId');
  requirePositiveInteger(payoutBatchId, 'payoutBatchId');
  requirePositiveInteger(appliedPence, 'appliedPence');
  const evidenceReference = cleanRequiredText(
    parentEvidenceReference,
    'parentEvidenceReference'
  );
  cleanRequiredText(planFingerprint, 'planFingerprint');

  return {
    school_id: schoolId,
    instructor_id: instructorId,
    parent_adjustment_id: recoveryAdjustmentId,
    payout_batch_id: payoutBatchId,
    adjustment_type: 'recovery_application',
    amount_pence: appliedPence,
    currency: 'gbp',
    reason: 'Recovery applied against future instructor payout',
    evidence_reference: evidenceReference,
    status: 'applied',
    adjustment_fingerprint: fingerprintPayoutPlan({
      school_id: schoolId,
      instructor_id: instructorId,
      recovery_adjustment_id: recoveryAdjustmentId,
      payout_batch_id: payoutBatchId,
      applied_pence: appliedPence,
      recovery_plan_fingerprint: planFingerprint,
    }, PAYOUT_V2_RECOVERY_VERSION),
    metadata: {
      calculation_version: PAYOUT_V2_RECOVERY_VERSION,
      recovery_policy: FULL_AVAILABLE_OFFSET_POLICY,
      recovery_plan_fingerprint: planFingerprint,
    },
  };
}

module.exports = {
  PAYOUT_V2_RECOVERY_VERSION,
  FULL_AVAILABLE_OFFSET_POLICY,
  planFullOffsetRecovery,
  buildOpeningRecoveryRecord,
  writeOpeningRecoveryAdjustment,
  buildRecoveryApplicationRecord,
};
