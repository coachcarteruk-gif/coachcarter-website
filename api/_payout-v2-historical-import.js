const {
  fingerprintPayoutPlan,
} = require('./_payout-v2-contracts');
const {
  SOURCE_KINDS,
  buildStripeSourceRecord,
  buildLegacySourceRecord,
  insertImmutableSource,
} = require('./_payout-v2-source-writer');
const { fetchSessionFundingEvidence } = require('./_stripe-fee');

const PAYOUT_V2_HISTORICAL_IMPORT_VERSION = 'payout-v2-historical-source-import-v1';

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
}

function requireNonEmptyText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}

function sourceKindForType(type) {
  if (type === 'purchase') return SOURCE_KINDS.CREDIT_PURCHASE;
  if (type === 'slot_purchase') return SOURCE_KINDS.DIRECT_BOOKING;
  if (type === 'legacy_grandfather') return SOURCE_KINDS.LEGACY_CREDIT;
  throw new TypeError(`Unsupported historical source transaction type: ${type}`);
}

function normalizeCandidateRow(row) {
  return {
    id: Number(row.id),
    school_id: Number(row.school_id),
    learner_id: row.learner_id == null ? null : Number(row.learner_id),
    instructor_id: Number(row.instructor_id),
    type: row.type,
    amount_pence: row.amount_pence == null ? null : Number(row.amount_pence),
    stripe_fee_pence: row.stripe_fee_pence == null ? null : Number(row.stripe_fee_pence),
    stripe_session_id: row.stripe_session_id || null,
    stripe_payment_intent_id: row.stripe_payment_intent_id || null,
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString(),
  };
}

async function loadHistoricalCandidates(sql, { schoolId }) {
  requirePositiveInteger(schoolId, 'schoolId');
  if (typeof sql !== 'function') {
    throw new TypeError('sql must be a Neon-compatible tagged query function');
  }
  const rows = await sql`
    SELECT
      ct.id,
      ct.school_id,
      ct.learner_id,
      ct.instructor_id,
      ct.type,
      ct.amount_pence,
      ct.stripe_fee_pence,
      ct.stripe_session_id,
      ct.stripe_payment_intent_id,
      ct.created_at
    FROM credit_transactions ct
    JOIN instructors i
      ON i.id = ct.instructor_id
     AND i.school_id = ct.school_id
    LEFT JOIN learner_users lu
      ON lu.id = ct.learner_id
     AND lu.school_id = ct.school_id
    WHERE ct.school_id = ${schoolId}
      AND ct.type IN ('purchase', 'slot_purchase', 'legacy_grandfather')
      AND (ct.learner_id IS NULL OR lu.id IS NOT NULL)
    ORDER BY ct.id
  `;
  return rows.map(normalizeCandidateRow);
}

function candidateSnapshotFingerprint(rows, schoolId) {
  return fingerprintPayoutPlan(
    {
      school_id: schoolId,
      candidates: rows.map(normalizeCandidateRow),
    },
    PAYOUT_V2_HISTORICAL_IMPORT_VERSION
  );
}

function publicSourceRecord(record) {
  return {
    school_id: record.school_id,
    learner_id: record.learner_id,
    instructor_id: record.instructor_id,
    funding_class: record.funding_class,
    credit_transaction_id: record.credit_transaction_id,
    stripe_checkout_session_id: record.stripe_checkout_session_id,
    stripe_payment_intent_id: record.stripe_payment_intent_id,
    stripe_charge_id: record.stripe_charge_id,
    stripe_balance_transaction_id: record.stripe_balance_transaction_id,
    currency: record.currency,
    gross_collected_pence: record.gross_collected_pence,
    stripe_fee_pence: record.stripe_fee_pence,
    payable_pool_pence: record.payable_pool_pence,
    refundable_pool_pence: record.refundable_pool_pence,
    source_status: record.source_status,
    source_fingerprint: record.source_fingerprint,
    occurred_at: record.occurred_at instanceof Date
      ? record.occurred_at.toISOString()
      : new Date(record.occurred_at).toISOString(),
    metadata: record.metadata,
  };
}

function summarizeRecords(records) {
  return records.reduce((summary, record) => {
    summary.gross_collected_pence += record.gross_collected_pence;
    summary.stripe_fee_pence += record.stripe_fee_pence;
    summary.payable_pool_pence += record.payable_pool_pence;
    summary.refundable_pool_pence += record.refundable_pool_pence;
    summary.funding_class_counts[record.funding_class] =
      (summary.funding_class_counts[record.funding_class] || 0) + 1;
    return summary;
  }, {
    gross_collected_pence: 0,
    stripe_fee_pence: 0,
    payable_pool_pence: 0,
    refundable_pool_pence: 0,
    funding_class_counts: {},
  });
}

function createHistoricalImportPlan({
  schoolId,
  operatorIdentity,
  evidenceReference,
  candidateRows,
  records,
}) {
  requirePositiveInteger(schoolId, 'schoolId');
  const cleanOperatorIdentity = requireNonEmptyText(operatorIdentity, 'operatorIdentity');
  const cleanEvidenceReference = requireNonEmptyText(evidenceReference, 'evidenceReference');
  const normalizedRows = candidateRows.map(normalizeCandidateRow);
  const publicRecords = records.map(publicSourceRecord);
  if (normalizedRows.length !== publicRecords.length) {
    throw new Error('Historical import candidates and records must have identical lengths');
  }
  for (let index = 0; index < normalizedRows.length; index += 1) {
    if (normalizedRows[index].id !== publicRecords[index].credit_transaction_id) {
      throw new Error('Historical import records must remain ordered by credit transaction ID');
    }
    if (
      normalizedRows[index].school_id !== schoolId ||
      publicRecords[index].school_id !== schoolId
    ) {
      const err = new Error('Historical import candidate crossed the requested school scope');
      err.code = 'PAYOUT_V2_IMPORT_SCOPE_MISMATCH';
      throw err;
    }
  }

  const planBody = {
    import_version: PAYOUT_V2_HISTORICAL_IMPORT_VERSION,
    school_id: schoolId,
    operator_identity: cleanOperatorIdentity,
    evidence_reference: cleanEvidenceReference,
    candidate_snapshot_fingerprint: candidateSnapshotFingerprint(normalizedRows, schoolId),
    candidate_count: publicRecords.length,
    totals: summarizeRecords(publicRecords),
    candidates: publicRecords,
  };
  return {
    ...planBody,
    plan_fingerprint: fingerprintPayoutPlan(
      planBody,
      PAYOUT_V2_HISTORICAL_IMPORT_VERSION
    ),
  };
}

async function buildHistoricalImportPlan({
  sql,
  schoolId,
  stripeClient,
  operatorIdentity,
  evidenceReference,
}) {
  if (!stripeClient) throw new TypeError('stripeClient is required for reviewed import planning');
  const candidateRows = await loadHistoricalCandidates(sql, { schoolId });
  const records = [];

  for (const sourceRow of candidateRows) {
    const sourceKind = sourceKindForType(sourceRow.type);
    if (sourceKind === SOURCE_KINDS.LEGACY_CREDIT) {
      records.push(buildLegacySourceRecord({ sourceRow, schoolId }));
      continue;
    }
    const stripeEvidence = await fetchSessionFundingEvidence({
      id: sourceRow.stripe_session_id || sourceRow.stripe_payment_intent_id,
      object: sourceRow.stripe_session_id ? 'checkout.session' : 'payment_intent',
      payment_intent: sourceRow.stripe_payment_intent_id,
    }, stripeClient);
    records.push(buildStripeSourceRecord({
      sourceRow,
      schoolId,
      sourceKind,
      stripeEvidence,
      eventContext: {},
    }));
  }

  return createHistoricalImportPlan({
    schoolId,
    operatorIdentity,
    evidenceReference,
    candidateRows,
    records,
  });
}

function assertExpectedPlan(plan, expected) {
  const mismatches = [];
  const checks = [
    ['candidate_count', expected.candidateCount, plan.candidate_count],
    ['gross_collected_pence', expected.grossCollectedPence, plan.totals.gross_collected_pence],
    ['stripe_fee_pence', expected.stripeFeePence, plan.totals.stripe_fee_pence],
    ['payable_pool_pence', expected.payablePoolPence, plan.totals.payable_pool_pence],
    ['refundable_pool_pence', expected.refundablePoolPence, plan.totals.refundable_pool_pence],
  ];
  for (const [field, expectedValue, actualValue] of checks) {
    if (!Number.isSafeInteger(expectedValue) || expectedValue < 0) {
      throw new TypeError(`expected ${field} must be an explicit non-negative safe integer`);
    }
    if (expectedValue !== actualValue) {
      mismatches.push({ field, expected: expectedValue, actual: actualValue });
    }
  }
  if (expected.reviewedPlanFingerprint !== plan.plan_fingerprint) {
    mismatches.push({
      field: 'plan_fingerprint',
      expected: expected.reviewedPlanFingerprint,
      actual: plan.plan_fingerprint,
    });
  }
  if (mismatches.length > 0) {
    const err = new Error('Reviewed historical import plan no longer matches the current plan');
    err.code = 'PAYOUT_V2_IMPORT_PLAN_DRIFT';
    err.mismatches = mismatches;
    throw err;
  }
}

async function assertCandidateSnapshotUnchanged(sql, plan) {
  const currentRows = await loadHistoricalCandidates(sql, { schoolId: plan.school_id });
  const currentFingerprint = candidateSnapshotFingerprint(currentRows, plan.school_id);
  if (currentFingerprint !== plan.candidate_snapshot_fingerprint) {
    const err = new Error('Historical import candidates changed after plan review');
    err.code = 'PAYOUT_V2_IMPORT_PLAN_DRIFT';
    throw err;
  }
}

async function applyHistoricalImportPlan(sql, plan) {
  await assertCandidateSnapshotUnchanged(sql, plan);
  let createdCount = 0;
  let existingCount = 0;
  for (const record of plan.candidates) {
    const result = await insertImmutableSource(sql, record);
    if (result.created) createdCount += 1;
    else existingCount += 1;
  }
  return { createdCount, existingCount };
}

module.exports = {
  PAYOUT_V2_HISTORICAL_IMPORT_VERSION,
  sourceKindForType,
  normalizeCandidateRow,
  loadHistoricalCandidates,
  candidateSnapshotFingerprint,
  summarizeRecords,
  createHistoricalImportPlan,
  buildHistoricalImportPlan,
  assertExpectedPlan,
  assertCandidateSnapshotUnchanged,
  applyHistoricalImportPlan,
};
