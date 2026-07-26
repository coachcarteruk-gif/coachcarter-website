const {
  PAYOUT_V2_SOURCE_INGESTION_VERSION,
  fingerprintPayoutPlan,
} = require('./_payout-v2-contracts');

const SOURCE_KINDS = Object.freeze({
  CREDIT_PURCHASE: 'credit_purchase',
  DIRECT_BOOKING: 'direct_booking',
  LEGACY_CREDIT: 'legacy_credit',
});

const EXPECTED_CREDIT_TRANSACTION_TYPES = Object.freeze({
  [SOURCE_KINDS.CREDIT_PURCHASE]: 'purchase',
  [SOURCE_KINDS.DIRECT_BOOKING]: 'slot_purchase',
  [SOURCE_KINDS.LEGACY_CREDIT]: 'legacy_grandfather',
});

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
}

function cleanStripeId(value, prefix) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  return text.startsWith(prefix) ? text : null;
}

function sourceFingerprint({ schoolId, creditTransactionId, sourceKind }) {
  return fingerprintPayoutPlan(
    {
      school_id: schoolId,
      credit_transaction_id: creditTransactionId,
      source_kind: sourceKind,
    },
    PAYOUT_V2_SOURCE_INGESTION_VERSION
  );
}

async function loadCreditTransaction(sql, { schoolId, creditTransactionId }) {
  requirePositiveInteger(schoolId, 'schoolId');
  requirePositiveInteger(creditTransactionId, 'creditTransactionId');
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
    WHERE ct.id = ${creditTransactionId}
      AND ct.school_id = ${schoolId}
      AND (ct.learner_id IS NULL OR lu.id IS NOT NULL)
    LIMIT 1
  `;

  if (!rows[0]) {
    const err = new Error('Payout v2 funding source transaction was not found in the requested school');
    err.code = 'PAYOUT_V2_SOURCE_SCOPE_MISMATCH';
    throw err;
  }
  return rows[0];
}

function buildStripeSourceRecord({
  sourceRow,
  schoolId,
  sourceKind,
  stripeEvidence = {},
  eventContext = {},
}) {
  const expectedType = EXPECTED_CREDIT_TRANSACTION_TYPES[sourceKind];
  if (!expectedType || sourceKind === SOURCE_KINDS.LEGACY_CREDIT) {
    throw new TypeError('sourceKind must be credit_purchase or direct_booking');
  }
  if (sourceRow.type !== expectedType) {
    const err = new Error(
      `Payout v2 ${sourceKind} ingestion expected ${expectedType}, received ${sourceRow.type}`
    );
    err.code = 'PAYOUT_V2_SOURCE_TYPE_MISMATCH';
    throw err;
  }

  const grossPence = Number(sourceRow.amount_pence);
  const evidenceAmountPence = Number(stripeEvidence.amountPence);
  const feePence = stripeEvidence.feePence;
  const currency = typeof stripeEvidence.currency === 'string'
    ? stripeEvidence.currency.trim().toLowerCase()
    : null;
  const checkoutSessionId = cleanStripeId(
    stripeEvidence.checkoutSessionId || sourceRow.stripe_session_id,
    'cs_'
  );
  const paymentIntentId = cleanStripeId(
    stripeEvidence.paymentIntentId || sourceRow.stripe_payment_intent_id,
    'pi_'
  );
  const chargeId = cleanStripeId(stripeEvidence.chargeId, 'ch_');
  const balanceTransactionId = cleanStripeId(
    stripeEvidence.balanceTransactionId,
    'txn_'
  );
  const paymentIntentStatus = typeof stripeEvidence.paymentIntentStatus === 'string'
    ? stripeEvidence.paymentIntentStatus.trim().toLowerCase()
    : null;
  const chargePaymentIntentId = cleanStripeId(
    stripeEvidence.chargePaymentIntentId,
    'pi_'
  );
  const balanceTransactionSourceId = cleanStripeId(
    stripeEvidence.balanceTransactionSourceId,
    'ch_'
  );
  const balanceTransactionType = typeof stripeEvidence.balanceTransactionType === 'string'
    ? stripeEvidence.balanceTransactionType.trim().toLowerCase()
    : null;
  const balanceTransactionCurrency = typeof stripeEvidence.balanceTransactionCurrency === 'string'
    ? stripeEvidence.balanceTransactionCurrency.trim().toLowerCase()
    : null;
  const balanceTransactionAmountPence = Number(
    stripeEvidence.balanceTransactionAmountPence
  );

  const reviewReasons = [];
  if (!Number.isSafeInteger(grossPence) || grossPence <= 0) {
    reviewReasons.push('missing_or_invalid_collected_amount');
  }
  if (!Number.isSafeInteger(evidenceAmountPence) || evidenceAmountPence <= 0) {
    reviewReasons.push('missing_stripe_amount_evidence');
  } else if (Number.isSafeInteger(grossPence) && evidenceAmountPence !== grossPence) {
    reviewReasons.push('stripe_amount_contradicts_credit_transaction');
  }
  if (currency !== 'gbp') reviewReasons.push('missing_or_unsupported_currency_evidence');
  if (!paymentIntentId) reviewReasons.push('missing_payment_intent_identity');
  if (paymentIntentStatus !== 'succeeded') {
    reviewReasons.push('payment_intent_not_proven_succeeded');
  }
  if (!chargeId) reviewReasons.push('missing_charge_identity');
  if (stripeEvidence.chargePaid !== true) {
    reviewReasons.push('charge_not_proven_paid');
  }
  if (stripeEvidence.chargeCaptured !== true) {
    reviewReasons.push('charge_not_proven_captured');
  }
  if (!chargePaymentIntentId) {
    reviewReasons.push('missing_charge_payment_intent_link');
  } else if (paymentIntentId && chargePaymentIntentId !== paymentIntentId) {
    reviewReasons.push('charge_payment_intent_link_contradiction');
  }
  if (!balanceTransactionId) reviewReasons.push('missing_balance_transaction_identity');
  if (stripeEvidence.source !== 'balance_transaction') {
    reviewReasons.push('fee_not_proven_by_balance_transaction');
  }
  if (!balanceTransactionSourceId) {
    reviewReasons.push('missing_balance_transaction_charge_link');
  } else if (chargeId && balanceTransactionSourceId !== chargeId) {
    reviewReasons.push('balance_transaction_charge_link_contradiction');
  }
  if (balanceTransactionType !== 'charge') {
    reviewReasons.push('missing_or_unsupported_balance_transaction_type');
  }
  if (balanceTransactionCurrency !== 'gbp') {
    reviewReasons.push('balance_transaction_currency_contradiction');
  }
  if (
    !Number.isSafeInteger(balanceTransactionAmountPence) ||
    balanceTransactionAmountPence <= 0
  ) {
    reviewReasons.push('missing_balance_transaction_amount');
  } else if (
    Number.isSafeInteger(evidenceAmountPence) &&
    balanceTransactionAmountPence !== evidenceAmountPence
  ) {
    reviewReasons.push('balance_transaction_amount_contradiction');
  }
  if (!Number.isSafeInteger(feePence) || feePence < 0) {
    reviewReasons.push('missing_stripe_fee_evidence');
  } else if (Number.isSafeInteger(grossPence) && feePence > grossPence) {
    reviewReasons.push('stripe_fee_exceeds_collected_amount');
  }
  if (
    sourceRow.stripe_session_id &&
    checkoutSessionId &&
    sourceRow.stripe_session_id !== checkoutSessionId
  ) {
    reviewReasons.push('checkout_session_identity_contradiction');
  }
  if (
    sourceRow.stripe_payment_intent_id &&
    paymentIntentId &&
    sourceRow.stripe_payment_intent_id !== paymentIntentId
  ) {
    reviewReasons.push('payment_intent_identity_contradiction');
  }

  const isStripeBacked = reviewReasons.length === 0;
  const safeGrossPence = Number.isSafeInteger(grossPence) && grossPence >= 0 ? grossPence : 0;
  const safeFeePence = Number.isSafeInteger(feePence) && feePence >= 0 && feePence <= safeGrossPence
    ? feePence
    : 0;
  const netPence = isStripeBacked ? safeGrossPence - safeFeePence : 0;
  const fingerprint = sourceFingerprint({
    schoolId,
    creditTransactionId: Number(sourceRow.id),
    sourceKind,
  });

  return {
    school_id: schoolId,
    learner_id: sourceRow.learner_id == null ? null : Number(sourceRow.learner_id),
    instructor_id: Number(sourceRow.instructor_id),
    funding_class: isStripeBacked ? 'stripe_backed' : 'manual_review',
    credit_transaction_id: Number(sourceRow.id),
    stripe_checkout_session_id: checkoutSessionId,
    stripe_payment_intent_id: paymentIntentId,
    stripe_charge_id: chargeId,
    stripe_balance_transaction_id: balanceTransactionId,
    currency: currency === 'gbp' ? currency : 'gbp',
    gross_collected_pence: safeGrossPence,
    stripe_fee_pence: safeFeePence,
    payable_pool_pence: netPence,
    refundable_pool_pence: netPence,
    source_status: isStripeBacked ? 'available' : 'manual_review',
    source_fingerprint: fingerprint,
    occurred_at: sourceRow.created_at,
    metadata: {
      ingestion_version: PAYOUT_V2_SOURCE_INGESTION_VERSION,
      source_kind: sourceKind,
      fee_evidence: isStripeBacked ? 'stripe_balance_transaction' : 'unverified',
      payment_relationship_evidence: isStripeBacked
        ? 'payment_intent_charge_balance_transaction'
        : 'unverified',
      review_reasons: reviewReasons,
      stripe_event_id: cleanStripeId(eventContext.stripeEventId, 'evt_'),
      stripe_event_type: typeof eventContext.stripeEventType === 'string'
        ? eventContext.stripeEventType
        : null,
    },
  };
}

function buildLegacySourceRecord({ sourceRow, schoolId }) {
  if (sourceRow.type !== EXPECTED_CREDIT_TRANSACTION_TYPES[SOURCE_KINDS.LEGACY_CREDIT]) {
    const err = new Error(
      `Payout v2 legacy ingestion expected legacy_grandfather, received ${sourceRow.type}`
    );
    err.code = 'PAYOUT_V2_SOURCE_TYPE_MISMATCH';
    throw err;
  }

  const sourceAmountPence = Number(sourceRow.amount_pence);
  const safeGrossPence = Number.isSafeInteger(sourceAmountPence) && sourceAmountPence >= 0
    ? sourceAmountPence
    : 0;

  return {
    school_id: schoolId,
    learner_id: sourceRow.learner_id == null ? null : Number(sourceRow.learner_id),
    instructor_id: Number(sourceRow.instructor_id),
    funding_class: 'legacy_pre_connect_settled',
    credit_transaction_id: Number(sourceRow.id),
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
    stripe_charge_id: null,
    stripe_balance_transaction_id: null,
    currency: 'gbp',
    gross_collected_pence: safeGrossPence,
    stripe_fee_pence: 0,
    payable_pool_pence: 0,
    refundable_pool_pence: 0,
    source_status: 'available',
    source_fingerprint: sourceFingerprint({
      schoolId,
      creditTransactionId: Number(sourceRow.id),
      sourceKind: SOURCE_KINDS.LEGACY_CREDIT,
    }),
    occurred_at: sourceRow.created_at,
    metadata: {
      ingestion_version: PAYOUT_V2_SOURCE_INGESTION_VERSION,
      source_kind: SOURCE_KINDS.LEGACY_CREDIT,
      fee_evidence: 'not_applicable_pre_connect_settled',
      positive_historical_amount_observed: safeGrossPence > 0,
      forced_zero_payable_value: true,
    },
  };
}

function comparableSource(row) {
  const metadata = row.metadata && typeof row.metadata === 'object'
    ? row.metadata
    : {};
  return {
    school_id: Number(row.school_id),
    learner_id: row.learner_id == null ? null : Number(row.learner_id),
    instructor_id: Number(row.instructor_id),
    funding_class: row.funding_class,
    credit_transaction_id: Number(row.credit_transaction_id),
    stripe_checkout_session_id: row.stripe_checkout_session_id || null,
    stripe_payment_intent_id: row.stripe_payment_intent_id || null,
    stripe_charge_id: row.stripe_charge_id || null,
    stripe_balance_transaction_id: row.stripe_balance_transaction_id || null,
    currency: row.currency,
    gross_collected_pence: Number(row.gross_collected_pence),
    stripe_fee_pence: Number(row.stripe_fee_pence),
    payable_pool_pence: Number(row.payable_pool_pence),
    refundable_pool_pence: Number(row.refundable_pool_pence),
    source_status: row.source_status,
    source_fingerprint: row.source_fingerprint,
    metadata: {
      ingestion_version: metadata.ingestion_version || null,
      source_kind: metadata.source_kind || null,
      fee_evidence: metadata.fee_evidence || null,
      payment_relationship_evidence:
        metadata.payment_relationship_evidence || null,
      review_reasons: Array.isArray(metadata.review_reasons)
        ? [...metadata.review_reasons]
        : [],
      positive_historical_amount_observed:
        metadata.positive_historical_amount_observed === true,
      forced_zero_payable_value: metadata.forced_zero_payable_value === true,
    },
  };
}

async function insertImmutableSource(sql, record) {
  let inserted;
  try {
    const rows = await sql`
      INSERT INTO payout_funding_sources (
        school_id,
        learner_id,
        instructor_id,
        funding_class,
        credit_transaction_id,
        stripe_checkout_session_id,
        stripe_payment_intent_id,
        stripe_charge_id,
        stripe_balance_transaction_id,
        currency,
        gross_collected_pence,
        stripe_fee_pence,
        payable_pool_pence,
        refundable_pool_pence,
        source_status,
        source_fingerprint,
        occurred_at,
        metadata
      )
      VALUES (
        ${record.school_id},
        ${record.learner_id},
        ${record.instructor_id},
        ${record.funding_class},
        ${record.credit_transaction_id},
        ${record.stripe_checkout_session_id},
        ${record.stripe_payment_intent_id},
        ${record.stripe_charge_id},
        ${record.stripe_balance_transaction_id},
        ${record.currency},
        ${record.gross_collected_pence},
        ${record.stripe_fee_pence},
        ${record.payable_pool_pence},
        ${record.refundable_pool_pence},
        ${record.source_status},
        ${record.source_fingerprint},
        ${record.occurred_at},
        ${JSON.stringify(record.metadata)}::jsonb
      )
      ON CONFLICT (school_id, source_fingerprint) DO NOTHING
      RETURNING *
    `;
    inserted = rows[0] || null;
  } catch (err) {
    if (err?.code !== '23505') throw err;
  }

  const rows = inserted ? [inserted] : await sql`
    SELECT *
    FROM payout_funding_sources
    WHERE school_id = ${record.school_id}
      AND credit_transaction_id = ${record.credit_transaction_id}
    LIMIT 1
  `;
  const existing = rows[0];
  if (!existing) {
    const err = new Error('Payout v2 funding source conflict did not resolve inside the requested school');
    err.code = 'PAYOUT_V2_SOURCE_CONFLICT';
    throw err;
  }

  const expectedComparable = comparableSource(record);
  const actualComparable = comparableSource(existing);
  if (JSON.stringify(actualComparable) !== JSON.stringify(expectedComparable)) {
    const err = new Error('Payout v2 funding source replay contradicted immutable source evidence');
    err.code = 'PAYOUT_V2_SOURCE_CONFLICT';
    throw err;
  }

  return {
    created: Boolean(inserted),
    source: existing,
  };
}

async function writeStripeFundingSource({
  sql,
  schoolId,
  creditTransactionId,
  sourceKind,
  stripeEvidence,
  eventContext,
}) {
  const sourceRow = await loadCreditTransaction(sql, { schoolId, creditTransactionId });
  const record = buildStripeSourceRecord({
    sourceRow,
    schoolId,
    sourceKind,
    stripeEvidence,
    eventContext,
  });
  return insertImmutableSource(sql, record);
}

async function writeLegacyFundingSource({ sql, schoolId, creditTransactionId }) {
  const sourceRow = await loadCreditTransaction(sql, { schoolId, creditTransactionId });
  const record = buildLegacySourceRecord({ sourceRow, schoolId });
  return insertImmutableSource(sql, record);
}

function isPayoutV2SchemaUnavailable(err) {
  if (err?.code !== '42P01' && err?.code !== '42703') return false;
  const message = String(err?.message || '');
  return /payout_funding_sources|stripe_event_receipts|source_fingerprint/i
    .test(message);
}

module.exports = {
  SOURCE_KINDS,
  buildStripeSourceRecord,
  buildLegacySourceRecord,
  insertImmutableSource,
  writeStripeFundingSource,
  writeLegacyFundingSource,
  isPayoutV2SchemaUnavailable,
};
