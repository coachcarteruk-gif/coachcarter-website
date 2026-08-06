const { withNeonTransaction } = require('./_db-transaction');
const {
  fetchLaunchPaymentObject,
  fetchSessionFundingEvidence,
} = require('./_stripe-fee');
const {
  LAUNCH_ACCOUNTING_VERSION,
  SHADOW_WRITER_MODE,
  PAYMENT_ORIGINS,
  buildLaunchEvidenceDecision,
  compareLocalStripeFeeEvidence,
  materializeLaunchPaymentContract,
  parseLaunchPaymentCandidate,
} = require('./_stripe-launch-payment-contracts');

const RECOVERY_CONFIRMATION = 'RECOVER_STRIPE_LAUNCH_CANDIDATE_CONFIRMED';

function recoveryError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function requiredRecoveryText(value, field, pattern) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || (pattern && !pattern.test(text))) {
    throw recoveryError('STRIPE_LAUNCH_RECOVERY_INPUT_INVALID', `${field} is invalid`);
  }
  return text;
}

function requiredRecoveryInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw recoveryError('STRIPE_LAUNCH_RECOVERY_INPUT_INVALID', `${field} is invalid`);
  }
  return parsed;
}

function stripeId(value) {
  return typeof value === 'string' ? value : value?.id || null;
}

function asIsoTimestamp(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function comparePendingContract(contract, evidence) {
  const contradictions = [];
  const comparisons = [
    ['stripe_payment_intent_id', contract.stripe_payment_intent_id, evidence.paymentIntentId],
    ['stripe_charge_id', contract.stripe_charge_id, evidence.chargeId],
    ['stripe_balance_transaction_id', contract.stripe_balance_transaction_id, evidence.balanceTransactionId],
    ['gross_amount_minor', Number(contract.gross_amount_minor), Number(evidence.amountPence)],
    ['stripe_fee_minor', Number(contract.stripe_fee_minor), Number(evidence.feePence)],
    ['currency', contract.currency, String(evidence.currency || '').toLowerCase()],
    ['stripe_payment_created_at', asIsoTimestamp(contract.stripe_payment_created_at), asIsoTimestamp(evidence.paymentCreatedAt)],
    ['stripe_funds_available_at', asIsoTimestamp(contract.stripe_funds_available_at), asIsoTimestamp(evidence.fundsAvailableAt)],
  ];
  for (const [field, actual, wanted] of comparisons) {
    if (actual !== wanted) contradictions.push(`reconcile_${field}_contradiction`);
  }
  if (evidence.paymentIntentStatus !== 'succeeded') {
    contradictions.push('reconcile_payment_intent_not_succeeded');
  }
  if (evidence.chargePaid !== true || evidence.chargeCaptured !== true) {
    contradictions.push('reconcile_charge_not_paid_and_captured');
  }
  if (evidence.chargePaymentIntentId !== contract.stripe_payment_intent_id) {
    contradictions.push('reconcile_charge_payment_intent_contradiction');
  }
  if (evidence.balanceTransactionSourceId !== contract.stripe_charge_id) {
    contradictions.push('reconcile_balance_transaction_charge_contradiction');
  }
  if (evidence.source !== 'balance_transaction') {
    contradictions.push('reconcile_fee_not_proven_by_balance_transaction');
  }
  if (evidence.balanceTransactionType !== 'charge') {
    contradictions.push('reconcile_balance_transaction_type_contradiction');
  }
  if (Number(evidence.balanceTransactionAmountPence) !== Number(contract.gross_amount_minor)) {
    contradictions.push('reconcile_balance_transaction_amount_contradiction');
  }
  if (String(evidence.balanceTransactionCurrency || '').toLowerCase() !== contract.currency) {
    contradictions.push('reconcile_balance_transaction_currency_contradiction');
  }
  return contradictions;
}

async function finalizePendingContract({
  connectionString,
  schoolId,
  contractId,
  evidence,
  now,
  transactionRunner = withNeonTransaction,
}) {
  return transactionRunner({ connectionString }, async (client) => {
    const locked = await client.query(
      `SELECT c.*, s.evidence_completeness AS source_evidence_completeness
         FROM lesson_payment_contracts c
         JOIN payout_funding_sources s
           ON s.id = c.funding_source_id AND s.school_id = c.school_id
         JOIN stripe_connect_launch_configs cfg
           ON cfg.school_id = c.school_id
          AND cfg.accounting_version = $1
          AND cfg.mode = $2
        WHERE c.school_id = $3
          AND c.id = $4
          AND c.evidence_status = 'pending'
        FOR UPDATE OF c, s`,
      [LAUNCH_ACCOUNTING_VERSION, SHADOW_WRITER_MODE, schoolId, contractId]
    );
    const contract = locked.rows[0];
    if (!contract) return { status: 'not_pending' };

    const decision = buildLaunchEvidenceDecision({ fundingEvidence: evidence, now });
    if (decision.missing.length > 0) {
      return { status: 'pending', reasons: decision.missing };
    }
    const contradictions = [
      ...decision.contradictory,
      ...comparePendingContract(contract, evidence),
    ];
    if (contradictions.length > 0) {
      const code = [...new Set(contradictions)].sort().join('|').slice(0, 500);
      await client.query(
        `UPDATE payout_funding_sources
            SET evidence_completeness = 'contradictory', contradiction_code = $1
          WHERE id = $2 AND school_id = $3 AND evidence_completeness = 'pending'`,
        [code, contract.funding_source_id, schoolId]
      );
      await client.query(
        `UPDATE lesson_payment_contracts
            SET evidence_status = 'contradictory', contradiction_code = $1
          WHERE id = $2 AND school_id = $3 AND evidence_status = 'pending'`,
        [code, contractId, schoolId]
      );
      return { status: 'contradictory', contradiction_code: code };
    }
    if (!decision.fundsAvailable) {
      return { status: 'pending', reasons: ['stripe_funds_not_available'] };
    }

    const completedAt = asIsoTimestamp(now);
    const sourceUpdate = await client.query(
      `UPDATE payout_funding_sources
          SET evidence_completeness = 'complete', contradiction_code = NULL
        WHERE id = $1 AND school_id = $2 AND evidence_completeness = 'pending'
        RETURNING id`,
      [contract.funding_source_id, schoolId]
    );
    const contractUpdate = await client.query(
      `UPDATE lesson_payment_contracts
          SET evidence_status = 'complete', completed_at = $1
        WHERE id = $2 AND school_id = $3 AND evidence_status = 'pending'
        RETURNING id`,
      [completedAt, contractId, schoolId]
    );
    if (!sourceUpdate.rows[0] || !contractUpdate.rows[0]) {
      throw new Error('Pending launch payment contract changed during reconciliation');
    }
    return { status: 'complete', completed_at: completedAt };
  });
}

async function recoverExactLaunchPaymentCandidate({
  sql,
  connectionString,
  schoolId,
  candidateId,
  checkoutSessionId,
  paymentIntentId,
  chargeId,
  balanceTransactionId,
  bookingId,
  creditTransactionId,
  bookingCreditSourceId,
  origin,
  grossAmountMinor,
  stripeFeeMinor,
  currency,
  dryRun = true,
  confirmation = null,
  paymentObjectFetcher = fetchLaunchPaymentObject,
  stripeEvidenceFetcher = fetchSessionFundingEvidence,
  contractMaterializer = materializeLaunchPaymentContract,
  now = new Date(),
  transactionRunner = withNeonTransaction,
}) {
  if (typeof sql !== 'function') {
    throw new TypeError('sql must be a Neon-compatible tagged query function');
  }
  const scopedSchoolId = requiredRecoveryInteger(schoolId, 'schoolId');
  const scopedBookingId = requiredRecoveryInteger(bookingId, 'bookingId');
  const scopedCreditTransactionId = requiredRecoveryInteger(
    creditTransactionId,
    'creditTransactionId'
  );
  const scopedBookingCreditSourceId = requiredRecoveryInteger(
    bookingCreditSourceId,
    'bookingCreditSourceId'
  );
  const expectedCandidateId = requiredRecoveryText(
    candidateId,
    'candidateId',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  ).toLowerCase();
  const expectedCheckoutSessionId = requiredRecoveryText(
    checkoutSessionId,
    'checkoutSessionId',
    /^cs_(?:test_)?[A-Za-z0-9]+$/
  );
  const expectedPaymentIntentId = requiredRecoveryText(
    paymentIntentId,
    'paymentIntentId',
    /^pi_[A-Za-z0-9]+$/
  );
  const expectedChargeId = requiredRecoveryText(chargeId, 'chargeId', /^ch_[A-Za-z0-9]+$/);
  const expectedBalanceTransactionId = requiredRecoveryText(
    balanceTransactionId,
    'balanceTransactionId',
    /^txn_[A-Za-z0-9]+$/
  );
  if (origin !== PAYMENT_ORIGINS.TEST_DATE_DIRECT) {
    throw recoveryError(
      'STRIPE_LAUNCH_RECOVERY_ORIGIN_REJECTED',
      'Exact candidate recovery is restricted to test_date_direct'
    );
  }
  const expectedGross = requiredRecoveryInteger(grossAmountMinor, 'grossAmountMinor');
  const expectedFee = requiredRecoveryInteger(stripeFeeMinor, 'stripeFeeMinor');
  const expectedCurrency = requiredRecoveryText(currency, 'currency', /^[a-zA-Z]{3}$/).toLowerCase();
  if (dryRun !== true && confirmation !== RECOVERY_CONFIRMATION) {
    throw recoveryError(
      'STRIPE_LAUNCH_RECOVERY_CONFIRMATION_REQUIRED',
      'Exact candidate recovery confirmation is required'
    );
  }

  const localRows = await sql`
    SELECT ct.id AS credit_transaction_id,
           ct.school_id,
           ct.learner_id,
           ct.instructor_id,
           ct.amount_pence,
           ct.stripe_fee_pence AS credit_transaction_fee_pence,
           ct.stripe_session_id,
           ct.stripe_payment_intent_id,
           i.active AS instructor_active,
           b.id AS booking_id,
           b.status AS booking_status,
           b.booking_purpose,
           b.lesson_payment_contract_id AS booking_contract_id,
           b.stripe_fee_pence AS booking_fee_pence,
           b.stripe_fee_source,
           bcs.id AS booking_credit_source_id,
           bcs.contribution_pence,
           bcs.stripe_fee_pence AS booking_credit_source_fee_pence,
           bcs.refunded_at,
           cfg.cutover_at,
           (SELECT COUNT(*)::int
              FROM booking_credit_sources active_bcs
              JOIN lesson_bookings active_b
                ON active_b.id = active_bcs.booking_id
               AND active_b.school_id = active_bcs.school_id
             WHERE active_bcs.school_id = ${scopedSchoolId}
               AND active_bcs.credit_transaction_id = ${scopedCreditTransactionId}
               AND active_b.status IN ('scheduled', 'chargeable')
               AND active_bcs.refunded_at IS NULL) AS active_mapping_count,
           (SELECT COUNT(*)::int
              FROM payout_funding_sources s
             WHERE s.school_id = ${scopedSchoolId}
               AND (
                 s.credit_transaction_id = ${scopedCreditTransactionId}
                 OR s.lesson_payment_contract_id = ${expectedCandidateId}::uuid
                 OR s.stripe_payment_intent_id = ${expectedPaymentIntentId}
                 OR s.stripe_charge_id = ${expectedChargeId}
               )) AS funding_source_count,
           (SELECT COUNT(*)::int
              FROM lesson_payment_contracts c
             WHERE c.school_id = ${scopedSchoolId}
               AND (
                 c.id = ${expectedCandidateId}::uuid
                 OR c.stripe_payment_intent_id = ${expectedPaymentIntentId}
                 OR c.stripe_charge_id = ${expectedChargeId}
               )) AS payment_contract_count
      FROM credit_transactions ct
      JOIN booking_credit_sources bcs
        ON bcs.id = ${scopedBookingCreditSourceId}
       AND bcs.school_id = ct.school_id
       AND bcs.credit_transaction_id = ct.id
      JOIN lesson_bookings b
        ON b.id = ${scopedBookingId}
       AND b.school_id = bcs.school_id
       AND b.id = bcs.booking_id
       AND b.learner_id = ct.learner_id
       AND b.instructor_id = ct.instructor_id
      JOIN instructors i
        ON i.id = ct.instructor_id
       AND i.school_id = ct.school_id
      JOIN learner_users lu
        ON lu.id = ct.learner_id
       AND lu.school_id = ct.school_id
      JOIN stripe_connect_launch_configs cfg
        ON cfg.school_id = ct.school_id
       AND cfg.accounting_version = ${LAUNCH_ACCOUNTING_VERSION}
       AND cfg.mode = ${SHADOW_WRITER_MODE}
     WHERE ct.id = ${scopedCreditTransactionId}
       AND ct.school_id = ${scopedSchoolId}
       AND ct.type = 'slot_purchase'
     LIMIT 2
  `;
  if (localRows.length !== 1) {
    throw recoveryError(
      'STRIPE_LAUNCH_RECOVERY_LOCAL_IDENTITY_MISMATCH',
      'Exact local payment candidate identity is not singular'
    );
  }
  const local = localRows[0];
  const localMismatch = (
    Number(local.credit_transaction_id) !== scopedCreditTransactionId
    || Number(local.booking_id) !== scopedBookingId
    || Number(local.booking_credit_source_id) !== scopedBookingCreditSourceId
    || local.stripe_session_id !== expectedCheckoutSessionId
    || local.stripe_payment_intent_id !== expectedPaymentIntentId
    || Number(local.amount_pence) !== expectedGross
    || Number(local.contribution_pence) !== expectedGross
    || local.booking_status !== 'scheduled'
    || local.booking_purpose !== 'test_date'
    || local.instructor_active !== true
    || local.refunded_at != null
    || local.booking_contract_id != null
    || Number(local.active_mapping_count) !== 1
  );
  if (localMismatch) {
    throw recoveryError(
      'STRIPE_LAUNCH_RECOVERY_LOCAL_IDENTITY_MISMATCH',
      'Exact local payment candidate evidence does not match'
    );
  }
  if (Number(local.funding_source_count) !== 0 || Number(local.payment_contract_count) !== 0) {
    throw recoveryError(
      'STRIPE_LAUNCH_RECOVERY_NOT_MISSING',
      'Exact payment candidate already has financial evidence'
    );
  }

  let paymentObject;
  let evidence;
  try {
    paymentObject = await paymentObjectFetcher({
      stripe_checkout_session_id: expectedCheckoutSessionId,
      stripe_payment_intent_id: expectedPaymentIntentId,
    });
    evidence = await stripeEvidenceFetcher(paymentObject);
  } catch (_) {
    throw recoveryError(
      'STRIPE_LAUNCH_RECOVERY_STRIPE_READ_FAILED',
      'Fresh immutable Stripe evidence could not be read'
    );
  }
  const paymentObjectIntentId = stripeId(paymentObject?.payment_intent);
  const candidate = parseLaunchPaymentCandidate(paymentObject?.metadata || {}, origin);
  const decision = buildLaunchEvidenceDecision({ fundingEvidence: evidence, now });
  const localFeeContradictions = compareLocalStripeFeeEvidence({
    creditTransactionFeePence: local.credit_transaction_fee_pence,
    bookingFeePence: local.booking_fee_pence,
    bookingFeeSource: local.stripe_fee_source,
    bookingContributionFeePence: local.booking_credit_source_fee_pence,
    stripeFeePence: expectedFee,
  });
  const evidenceMismatch = (
    paymentObject?.object !== 'checkout.session'
    || paymentObject?.id !== expectedCheckoutSessionId
    || paymentObject?.payment_status !== 'paid'
    || paymentObjectIntentId !== expectedPaymentIntentId
    || candidate?.candidateId !== expectedCandidateId
    || evidence?.paymentIntentId !== expectedPaymentIntentId
    || evidence?.paymentIntentStatus !== 'succeeded'
    || evidence?.chargeId !== expectedChargeId
    || evidence?.chargePaid !== true
    || evidence?.chargeCaptured !== true
    || evidence?.chargePaymentIntentId !== expectedPaymentIntentId
    || evidence?.balanceTransactionId !== expectedBalanceTransactionId
    || evidence?.balanceTransactionSourceId !== expectedChargeId
    || evidence?.balanceTransactionType !== 'charge'
    || evidence?.balanceTransactionStatus !== 'available'
    || Number(evidence?.balanceTransactionAmountPence) !== expectedGross
    || String(evidence?.balanceTransactionCurrency || '').toLowerCase() !== expectedCurrency
    || Number(evidence?.amountPence) !== expectedGross
    || String(evidence?.currency || '').toLowerCase() !== expectedCurrency
    || Number(evidence?.feePence) !== expectedFee
    || evidence?.source !== 'balance_transaction'
    || localFeeContradictions.length > 0
    || !decision.paymentCreatedAt
    || new Date(decision.paymentCreatedAt).getTime() < new Date(local.cutover_at).getTime()
    || decision.missing.length > 0
    || decision.contradictory.length > 0
    || decision.fundsAvailable !== true
  );
  if (evidenceMismatch) {
    throw recoveryError(
      'STRIPE_LAUNCH_RECOVERY_STRIPE_IDENTITY_MISMATCH',
      'Fresh immutable Stripe evidence does not match the exact candidate'
    );
  }

  const agreementRows = await sql`
    SELECT COUNT(*)::int AS agreement_count
      FROM instructor_payout_agreement_versions a
     WHERE a.school_id = ${scopedSchoolId}
       AND a.instructor_id = ${Number(local.instructor_id)}
       AND a.status = 'active'
       AND a.starts_at <= ${decision.paymentCreatedAt}::timestamptz
       AND (a.ends_at IS NULL OR a.ends_at > ${decision.paymentCreatedAt}::timestamptz)
  `;
  if (Number(agreementRows[0]?.agreement_count) !== 1) {
    throw recoveryError(
      'STRIPE_LAUNCH_RECOVERY_AGREEMENT_MISMATCH',
      'Exact candidate recovery requires one active agreement at payment creation'
    );
  }

  const identity = {
    school_id: scopedSchoolId,
    candidate_id: expectedCandidateId,
    origin,
    booking_id: scopedBookingId,
    credit_transaction_id: scopedCreditTransactionId,
    booking_credit_source_id: scopedBookingCreditSourceId,
    checkout_session_id: expectedCheckoutSessionId,
    payment_intent_id: expectedPaymentIntentId,
    charge_id: expectedChargeId,
    balance_transaction_id: expectedBalanceTransactionId,
    gross_amount_minor: expectedGross,
    stripe_fee_minor: expectedFee,
    currency: expectedCurrency,
  };
  if (dryRun === true) {
    return { status: 'ready', dry_run: true, identity };
  }

  const result = await contractMaterializer({
    connectionString,
    schoolId: scopedSchoolId,
    creditTransactionId: scopedCreditTransactionId,
    bookingId: scopedBookingId,
    metadata: paymentObject.metadata,
    expectedOrigin: origin,
    fundingEvidence: evidence,
    eventContext: {
      stripeEventId: null,
      stripeEventType: 'exact_candidate_recovery',
    },
    now,
    transactionRunner,
  });
  if (
    result?.materialized !== true
    || result?.contract?.id !== expectedCandidateId
    || result?.contract?.evidence_status !== 'complete'
    || result?.contract?.ineligibility_code != null
    || result?.contract?.contradiction_code != null
  ) {
    throw recoveryError(
      'STRIPE_LAUNCH_RECOVERY_RESULT_INVALID',
      'Exact candidate recovery did not produce one complete contract'
    );
  }

  const postflight = await sql`
    SELECT
      (SELECT COUNT(*)::int
         FROM payout_funding_sources s
        WHERE s.school_id = ${scopedSchoolId}
          AND s.credit_transaction_id = ${scopedCreditTransactionId}
          AND s.lesson_payment_contract_id = ${expectedCandidateId}::uuid
          AND s.stripe_payment_intent_id = ${expectedPaymentIntentId}
          AND s.stripe_charge_id = ${expectedChargeId}
          AND s.stripe_balance_transaction_id = ${expectedBalanceTransactionId}
          AND s.evidence_completeness = 'complete'
          AND s.contradiction_code IS NULL) AS funding_source_count,
      (SELECT COUNT(*)::int
         FROM lesson_payment_contracts c
        WHERE c.school_id = ${scopedSchoolId}
          AND c.id = ${expectedCandidateId}::uuid
          AND c.origin = ${origin}
          AND c.stripe_payment_intent_id = ${expectedPaymentIntentId}
          AND c.stripe_charge_id = ${expectedChargeId}
          AND c.stripe_balance_transaction_id = ${expectedBalanceTransactionId}
          AND c.gross_amount_minor = ${expectedGross}
          AND c.stripe_fee_minor = ${expectedFee}
          AND c.currency = ${expectedCurrency}
          AND c.evidence_status = 'complete'
          AND c.ineligibility_code IS NULL
          AND c.contradiction_code IS NULL) AS payment_contract_count,
      (SELECT COUNT(*)::int
         FROM lesson_bookings b
        WHERE b.school_id = ${scopedSchoolId}
          AND b.id = ${scopedBookingId}
          AND b.lesson_payment_contract_id = ${expectedCandidateId}::uuid) AS booking_link_count
  `;
  const verified = postflight[0];
  if (
    Number(verified?.funding_source_count) !== 1
    || Number(verified?.payment_contract_count) !== 1
    || Number(verified?.booking_link_count) !== 1
  ) {
    throw recoveryError(
      'STRIPE_LAUNCH_RECOVERY_POSTFLIGHT_FAILED',
      'Exact candidate recovery postflight was not singular'
    );
  }
  return { status: 'complete', dry_run: false, identity };
}

async function reconcilePendingLaunchPaymentContracts({
  sql,
  connectionString,
  schoolId = null,
  paymentObjectFetcher = fetchLaunchPaymentObject,
  stripeEvidenceFetcher = fetchSessionFundingEvidence,
  contractMaterializer = materializeLaunchPaymentContract,
  now = new Date(),
  limit = 25,
  transactionRunner = withNeonTransaction,
}) {
  if (typeof sql !== 'function') {
    throw new TypeError('sql must be a Neon-compatible tagged query function');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError('limit must be an integer from 1 to 100');
  }
  if (schoolId !== null && (!Number.isSafeInteger(Number(schoolId)) || Number(schoolId) < 1)) {
    throw new TypeError('schoolId must be a positive integer when provided');
  }
  const scopedSchoolId = schoolId === null ? null : Number(schoolId);
  const pendingRows = scopedSchoolId === null ? await sql`
    SELECT c.id, c.school_id, c.stripe_payment_intent_id
    FROM lesson_payment_contracts c
    JOIN stripe_connect_launch_configs cfg
      ON cfg.school_id = c.school_id
     AND cfg.accounting_version = ${LAUNCH_ACCOUNTING_VERSION}
     AND cfg.mode = ${SHADOW_WRITER_MODE}
    WHERE c.evidence_status = 'pending'
    ORDER BY c.created_at, c.id
    LIMIT ${limit}
  ` : await sql`
    SELECT c.id, c.school_id, c.stripe_payment_intent_id
    FROM lesson_payment_contracts c
    JOIN stripe_connect_launch_configs cfg
      ON cfg.school_id = c.school_id
     AND cfg.accounting_version = ${LAUNCH_ACCOUNTING_VERSION}
     AND cfg.mode = ${SHADOW_WRITER_MODE}
    WHERE c.evidence_status = 'pending'
      AND c.school_id = ${scopedSchoolId}
    ORDER BY c.created_at, c.id
    LIMIT ${limit}
  `;
  const pendingCandidates = scopedSchoolId === null
    ? pendingRows
    : pendingRows.filter((row) => Number(row.school_id) === scopedSchoolId);

  // Give the recovery queue its own limit so a large set of future-available
  // pending contracts cannot starve origins that have no contract yet.
  let originCandidates = [];
  if (limit > 0) {
    const originRows = await sql`
      SELECT DISTINCT ON (ct.school_id, ct.id)
             ct.school_id,
             ct.id AS credit_transaction_id,
             b.id AS booking_id,
             ct.stripe_session_id AS stripe_checkout_session_id,
             ct.stripe_payment_intent_id,
             CASE
               WHEN EXISTS (
                 SELECT 1
                   FROM lesson_requests lr
                  WHERE lr.school_id = ct.school_id
                    AND lr.booking_id = b.id
                    AND lr.status = 'accepted'
                    AND lr.payment_intent_id = ct.stripe_payment_intent_id
               ) THEN 'captured_request'
               WHEN EXISTS (
                 SELECT 1
                   FROM lesson_offers o
                  WHERE o.school_id = ct.school_id
                    AND o.booking_id = b.id
                    AND o.status = 'accepted'
               ) THEN 'one_off_offer'
               WHEN b.booking_purpose = 'test_date' THEN 'test_date_direct'
               ELSE 'direct_slot'
             END AS payment_origin
        FROM stripe_connect_launch_configs cfg
        JOIN credit_transactions ct
          ON ct.school_id = cfg.school_id
         AND ct.type = 'slot_purchase'
         AND ct.created_at >= cfg.cutover_at
        JOIN booking_credit_sources bcs
          ON bcs.school_id = ct.school_id
         AND bcs.credit_transaction_id = ct.id
         AND bcs.refunded_at IS NULL
        JOIN lesson_bookings b
          ON b.school_id = bcs.school_id
         AND b.id = bcs.booking_id
         AND b.status IN ('scheduled', 'chargeable')
        LEFT JOIN payout_funding_sources s
          ON s.school_id = ct.school_id
         AND s.credit_transaction_id = ct.id
       WHERE cfg.accounting_version = ${LAUNCH_ACCOUNTING_VERSION}
         AND cfg.mode = ${SHADOW_WRITER_MODE}
         AND (${scopedSchoolId}::bigint IS NULL OR cfg.school_id = ${scopedSchoolId})
         AND s.id IS NULL
         AND (ct.stripe_session_id IS NOT NULL OR ct.stripe_payment_intent_id IS NOT NULL)
       ORDER BY ct.school_id, ct.id, b.id
       LIMIT ${limit}
    `;
    originCandidates = scopedSchoolId === null
      ? originRows
      : originRows.filter((row) => Number(row.school_id) === scopedSchoolId);
  }

  const summary = {
    checked: pendingCandidates.length + originCandidates.length,
    pending_contracts: pendingCandidates.length,
    unmaterialized_origins: originCandidates.length,
    completed: 0,
    pending: 0,
    contradictory: 0,
    ineligible: 0,
    failed: 0,
    results: [],
  };
  for (const candidate of pendingCandidates) {
    try {
      const evidence = await stripeEvidenceFetcher({
        id: candidate.stripe_payment_intent_id,
        object: 'payment_intent',
        payment_intent: candidate.stripe_payment_intent_id,
      });
      const result = await finalizePendingContract({
        connectionString,
        schoolId: Number(candidate.school_id),
        contractId: candidate.id,
        evidence,
        now,
        transactionRunner,
      });
      if (result.status === 'complete') summary.completed += 1;
      else if (result.status === 'contradictory') summary.contradictory += 1;
      else summary.pending += 1;
      summary.results.push({ contract_id: candidate.id, ...result });
    } catch (err) {
      summary.failed += 1;
      summary.results.push({
        contract_id: candidate.id,
        status: 'failed',
        code: err?.code || 'RECONCILE_FAILED',
      });
    }
  }

  for (const candidate of originCandidates) {
    try {
      const paymentObject = await paymentObjectFetcher(candidate);
      const evidence = await stripeEvidenceFetcher(paymentObject);
      const result = await contractMaterializer({
        connectionString,
        schoolId: Number(candidate.school_id),
        creditTransactionId: Number(candidate.credit_transaction_id),
        bookingId: Number(candidate.booking_id),
        metadata: paymentObject?.metadata || {},
        expectedOrigin: candidate.payment_origin,
        fundingEvidence: evidence,
        eventContext: {
          stripeEventId: null,
          stripeEventType: 'reconciliation',
        },
        now,
        transactionRunner,
      });
      const status = result.materialized
        ? (result.contract?.evidence_status || 'pending')
        : (result.status || 'pending');
      if (status === 'complete') summary.completed += 1;
      else if (status === 'contradictory') summary.contradictory += 1;
      else if (status === 'ineligible') summary.ineligible += 1;
      else summary.pending += 1;
      summary.results.push({
        credit_transaction_id: candidate.credit_transaction_id,
        booking_id: candidate.booking_id,
        payment_origin: candidate.payment_origin,
        status,
        ...(Array.isArray(result.reasons) ? { reasons: result.reasons } : {}),
      });
    } catch (err) {
      if (err?.code === 'STRIPE_LAUNCH_EVIDENCE_INCOMPLETE') {
        summary.pending += 1;
        summary.results.push({
          credit_transaction_id: candidate.credit_transaction_id,
          booking_id: candidate.booking_id,
          payment_origin: candidate.payment_origin,
          status: 'pending',
          reasons: ['stripe_evidence_incomplete'],
        });
        continue;
      }
      summary.failed += 1;
      summary.results.push({
        credit_transaction_id: candidate.credit_transaction_id,
        booking_id: candidate.booking_id,
        payment_origin: candidate.payment_origin,
        status: 'failed',
        code: err?.code || 'RECONCILE_FAILED',
      });
    }
  }
  return summary;
}

module.exports = {
  RECOVERY_CONFIRMATION,
  comparePendingContract,
  finalizePendingContract,
  recoverExactLaunchPaymentCandidate,
  reconcilePendingLaunchPaymentContracts,
};
