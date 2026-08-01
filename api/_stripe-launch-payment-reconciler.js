const { withNeonTransaction } = require('./_db-transaction');
const { fetchSessionFundingEvidence } = require('./_stripe-fee');
const {
  LAUNCH_ACCOUNTING_VERSION,
  SHADOW_WRITER_MODE,
  buildLaunchEvidenceDecision,
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
  stripeEvidenceFetcher = fetchSessionFundingEvidence,
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
  const candidates = await sql`
    SELECT c.id, c.school_id, c.stripe_payment_intent_id
    FROM lesson_payment_contracts c
    JOIN stripe_connect_launch_configs cfg
      ON cfg.school_id = c.school_id
     AND cfg.accounting_version = ${LAUNCH_ACCOUNTING_VERSION}
     AND cfg.mode = ${SHADOW_WRITER_MODE}
    WHERE c.evidence_status = 'pending'
    ORDER BY c.created_at, c.id
    LIMIT ${limit}
  `;
  const summary = {
    checked: candidates.length,
    completed: 0,
    pending: 0,
    contradictory: 0,
    failed: 0,
    results: [],
  };
  for (const candidate of candidates) {
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
  return summary;
}

module.exports = {
  comparePendingContract,
  finalizePendingContract,
  reconcilePendingLaunchPaymentContracts,
};
