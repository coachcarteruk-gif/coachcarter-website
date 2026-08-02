const { withNeonTransaction } = require('./_db-transaction');
const {
  fetchLaunchPaymentObject,
  fetchSessionFundingEvidence,
} = require('./_stripe-fee');
const {
  LAUNCH_ACCOUNTING_VERSION,
  SHADOW_WRITER_MODE,
  buildLaunchEvidenceDecision,
  materializeLaunchPaymentContract,
} = require('./_stripe-launch-payment-contracts');

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
  comparePendingContract,
  finalizePendingContract,
  reconcilePendingLaunchPaymentContracts,
};
