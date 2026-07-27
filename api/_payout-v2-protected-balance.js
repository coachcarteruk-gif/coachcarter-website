const crypto = require('crypto');
const { canonicalJson } = require('./_payout-v2-contracts');
const { computeExactRefundExposure } = require('./_platform-balance');

const PROTECTED_BALANCE_CALCULATION_VERSION = 'payout-v2-protected-balance-v1';
const WITHDRAWAL_PREFLIGHT_VERSION = 'payout-v2-withdrawal-preflight-v1';
const DEFAULT_STRIPE_EVIDENCE_MAX_AGE_MS = 5 * 60 * 1000;

const BLOCKER_CODES = Object.freeze({
  APPROVED_REFUND_EVIDENCE_CONTRADICTORY: 'APPROVED_REFUND_EVIDENCE_CONTRADICTORY',
  CALCULATION_FINGERPRINT_CHANGED: 'CALCULATION_FINGERPRINT_CHANGED',
  CALCULATION_INCOMPLETE: 'CALCULATION_INCOMPLETE',
  CROSS_SCHOOL_EVIDENCE: 'CROSS_SCHOOL_EVIDENCE',
  EXACT_EXPOSURE_BLOCKED: 'EXACT_EXPOSURE_BLOCKED',
  LEGACY_POSITIVE_CONTRIBUTION: 'LEGACY_POSITIVE_CONTRIBUTION',
  MANUAL_REVIEW_EVIDENCE: 'MANUAL_REVIEW_EVIDENCE',
  MISSING_RISK_RESERVE_CONFIGURATION: 'MISSING_RISK_RESERVE_CONFIGURATION',
  NEGATIVE_PROJECTED_PROTECTED_BALANCE: 'NEGATIVE_PROJECTED_PROTECTED_BALANCE',
  RECONCILING_TRANSFER_AMBIGUOUS: 'RECONCILING_TRANSFER_AMBIGUOUS',
  SCHOOL_CASH_NOT_SEGREGATED: 'SCHOOL_CASH_NOT_SEGREGATED',
  SCOPE_MISMATCH: 'SCOPE_MISMATCH',
  STRIPE_BALANCE_MISSING: 'STRIPE_BALANCE_MISSING',
  STRIPE_BALANCE_SCOPE_MISMATCH: 'STRIPE_BALANCE_SCOPE_MISMATCH',
  STRIPE_BALANCE_STALE: 'STRIPE_BALANCE_STALE',
  UNEXPLAINED_BALANCE_MOVEMENT: 'UNEXPLAINED_BALANCE_MOVEMENT',
  WITHDRAWAL_REQUIRES_GLOBAL_SCOPE: 'WITHDRAWAL_REQUIRES_GLOBAL_SCOPE',
});

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function integer(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} must be an integer`);
  return parsed;
}

function nonNegativeInteger(value, field) {
  const parsed = integer(value, field);
  if (parsed < 0) throw new Error(`${field} must be non-negative`);
  return parsed;
}

function positiveInteger(value, field) {
  const parsed = integer(value, field);
  if (parsed <= 0) throw new Error(`${field} must be a positive integer`);
  return parsed;
}

function normalizeScope(scope) {
  if (!scope || !['global', 'school'].includes(scope.kind)) {
    throw new Error('scope.kind must be global or school');
  }
  if (scope.kind === 'global') {
    if (scope.school_id !== null && scope.school_id !== undefined) {
      throw new Error('global scope must not include school_id');
    }
    return { kind: 'global', school_id: null };
  }
  return { kind: 'school', school_id: positiveInteger(scope.school_id, 'scope.school_id') };
}

function normalizeBlocker(blocker) {
  if (typeof blocker === 'string') return { code: blocker, detail: null };
  if (!blocker || typeof blocker.code !== 'string' || !blocker.code.trim()) {
    throw new Error('blocker.code is required');
  }
  return {
    code: blocker.code.trim(),
    detail: blocker.detail == null ? null : String(blocker.detail).slice(0, 300),
  };
}

function uniqueBlockers(blockers) {
  const seen = new Set();
  return (blockers || []).map(normalizeBlocker).filter((blocker) => {
    const key = `${blocker.code}:${blocker.detail || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.code.localeCompare(b.code) || String(a.detail).localeCompare(String(b.detail)));
}

function protectedPositionIdentity(result) {
  return {
    calculation_version: result.calculation_version,
    scope: result.scope,
    stripe_available_pence: result.stripe_available_pence,
    components: result.components,
    transfer_readiness_pence: result.transfer_readiness_pence,
    protected_free_cash_pence: result.protected_free_cash_pence,
    blocker_codes: result.blockers.map((blocker) => blocker.code),
  };
}

function calculateProtectedBalance(input) {
  const scope = normalizeScope(input.scope);
  const cashScope = normalizeScope(input.cash_scope || input.scope);
  const inputTimestamp = new Date(input.input_timestamp);
  if (Number.isNaN(inputTimestamp.getTime())) throw new Error('input_timestamp must be an ISO timestamp');

  const stripeAvailablePence = integer(input.stripe_available_pence, 'stripe_available_pence');
  const pendingPence = integer(input.stripe_pending_pence, 'stripe_pending_pence');
  const components = {
    exact_unused_refundable_source_exposure_pence: nonNegativeInteger(
      input.exact_unused_refundable_source_exposure_pence,
      'exact_unused_refundable_source_exposure_pence'
    ),
    earned_untransferred_instructor_obligations_pence: nonNegativeInteger(
      input.earned_untransferred_instructor_obligations_pence,
      'earned_untransferred_instructor_obligations_pence'
    ),
    submitted_reconciling_not_reflected_pence: nonNegativeInteger(
      input.submitted_reconciling_not_reflected_pence,
      'submitted_reconciling_not_reflected_pence'
    ),
    approved_unexecuted_refund_obligations_pence: nonNegativeInteger(
      input.approved_unexecuted_refund_obligations_pence,
      'approved_unexecuted_refund_obligations_pence'
    ),
    configured_dispute_refund_risk_reserve_pence: nonNegativeInteger(
      input.configured_dispute_refund_risk_reserve_pence,
      'configured_dispute_refund_risk_reserve_pence'
    ),
  };
  const transfersReadyNowPence = nonNegativeInteger(
    input.transfers_ready_now_pence,
    'transfers_ready_now_pence'
  );
  const blockers = [...(input.blockers || [])];
  if (scope.kind !== cashScope.kind || scope.school_id !== cashScope.school_id) {
    blockers.push({ code: BLOCKER_CODES.STRIPE_BALANCE_SCOPE_MISMATCH });
  }

  const protectedFreeCashPence = stripeAvailablePence
    - components.exact_unused_refundable_source_exposure_pence
    - components.earned_untransferred_instructor_obligations_pence
    - components.submitted_reconciling_not_reflected_pence
    - components.approved_unexecuted_refund_obligations_pence
    - components.configured_dispute_refund_risk_reserve_pence;
  const transferReadinessPence = stripeAvailablePence - transfersReadyNowPence;

  const result = {
    calculation_version: PROTECTED_BALANCE_CALCULATION_VERSION,
    scope,
    cash_scope: cashScope,
    input_timestamp: inputTimestamp.toISOString(),
    stripe_evidence: {
      status: input.stripe_evidence_status || 'fresh',
      read_at: input.stripe_read_at || inputTimestamp.toISOString(),
    },
    stripe_available_pence: stripeAvailablePence,
    stripe_pending_pence: pendingPence,
    pending_cash_treatment: 'display_only_not_withdrawable',
    components,
    transfers_ready_now_pence: transfersReadyNowPence,
    transfer_readiness_pence: transferReadinessPence,
    protected_free_cash_pence: protectedFreeCashPence,
    blockers: uniqueBlockers(blockers),
    double_count_prevention: {
      learner_exposure: 'unused source value only; active BCS usage and source adjustments are removed',
      earned_obligations: 'unclaimed earnings plus claimed batches without transfer intents',
      transfer_obligations: 'only intents not proven removed from Stripe available cash',
      refunds: 'latest approved obligation event only; executed or voided identities are excluded',
      pending_cash: 'never included in available cash',
    },
  };
  result.position_fingerprint = sha256(protectedPositionIdentity(result));
  result.calculation_fingerprint = sha256({
    ...protectedPositionIdentity(result),
    input_timestamp: result.input_timestamp,
    stripe_evidence: result.stripe_evidence,
  });
  result.operator_review_required = result.blockers.length > 0 || protectedFreeCashPence < 0;
  result.safe_for_platform_withdrawal = !result.operator_review_required;
  return result;
}

function calculateWithdrawalPreflight({
  calculation,
  proposed_withdrawal_pence,
  requested_scope,
  expected_calculation_fingerprint,
  idempotency_identity,
  phase = 'review',
}) {
  const scope = normalizeScope(requested_scope);
  const amount = positiveInteger(proposed_withdrawal_pence, 'proposed_withdrawal_pence');
  if (!['review', 'attempt'].includes(phase)) throw new Error('phase must be review or attempt');
  if (typeof idempotency_identity !== 'string' || !/^payout-v2:withdrawal:[a-z0-9:_-]{8,180}$/.test(idempotency_identity)) {
    throw new Error('idempotency_identity must be a deterministic payout-v2 withdrawal identity');
  }

  const blockers = [...(calculation.blockers || [])];
  if (
    calculation.scope.kind !== scope.kind
    || calculation.scope.school_id !== scope.school_id
  ) {
    blockers.push({ code: BLOCKER_CODES.SCOPE_MISMATCH });
  }
  if (scope.kind !== 'global') blockers.push({ code: BLOCKER_CODES.WITHDRAWAL_REQUIRES_GLOBAL_SCOPE });
  if (!calculation.calculation_fingerprint) blockers.push({ code: BLOCKER_CODES.CALCULATION_INCOMPLETE });
  if (
    phase === 'attempt'
    && expected_calculation_fingerprint !== calculation.calculation_fingerprint
  ) {
    blockers.push({ code: BLOCKER_CODES.CALCULATION_FINGERPRINT_CHANGED });
  }

  const projected = integer(calculation.protected_free_cash_pence, 'protected_free_cash_pence') - amount;
  if (projected < 0) blockers.push({ code: BLOCKER_CODES.NEGATIVE_PROJECTED_PROTECTED_BALANCE });
  const normalizedBlockers = uniqueBlockers(blockers);
  const allowed = normalizedBlockers.length === 0;
  const result = {
    preflight_version: WITHDRAWAL_PREFLIGHT_VERSION,
    phase,
    scope,
    calculation_fingerprint: calculation.calculation_fingerprint,
    position_fingerprint: calculation.position_fingerprint,
    protected_free_cash_pence: calculation.protected_free_cash_pence,
    proposed_withdrawal_pence: amount,
    projected_protected_free_cash_pence: projected,
    stripe_read_status: calculation.stripe_evidence,
    allowed,
    blockers: normalizedBlockers,
    idempotency_identity,
    replay_semantics: 'same identity is a no-op only when amount, scope, and calculation fingerprint are identical',
    operator_wording: allowed
      ? 'Preflight passed. Recheck this exact calculation fingerprint immediately before the manual Stripe Dashboard withdrawal.'
      : 'Withdrawal refused. Do not move platform cash until every blocker is resolved and a new preflight is reviewed.',
  };
  result.preflight_fingerprint = sha256(result);
  return result;
}

function blockerFromExposure(exposure) {
  const blockers = [];
  for (const warning of exposure?.warnings || []) {
    blockers.push({
      code: BLOCKER_CODES.EXACT_EXPOSURE_BLOCKED,
      detail: warning.code || 'EXPOSURE_WARNING',
    });
  }
  if (Number(exposure?.legacy_unknown_absorber_pence || 0) > 0) {
    blockers.push({ code: BLOCKER_CODES.MANUAL_REVIEW_EVIDENCE, detail: 'LEGACY_UNKNOWN_ABSORBER' });
  }
  if (Number(exposure?.legacy_unpriced_pence || 0) > 0 || Number(exposure?.unvalued_legacy_minutes || 0) > 0) {
    blockers.push({ code: BLOCKER_CODES.EXACT_EXPOSURE_BLOCKED, detail: 'LEGACY_UNPRICED' });
  }
  return blockers;
}

async function loadPayoutV2LiquidityEvidence(sql, { scope }) {
  const normalizedScope = normalizeScope(scope);
  const schoolId = normalizedScope.school_id;
  const configRows = normalizedScope.kind === 'global'
    ? await sql`
        SELECT risk_reserve_pence, config_fingerprint, effective_at
          FROM payout_v2_liquidity_config_versions
         WHERE scope_kind = 'global'
           AND school_id IS NULL
         ORDER BY effective_at DESC, id DESC
         LIMIT 1
      `
    : await sql`
        SELECT risk_reserve_pence, config_fingerprint, effective_at
          FROM payout_v2_liquidity_config_versions
         WHERE scope_kind = 'school'
           AND school_id = ${schoolId}
         ORDER BY effective_at DESC, id DESC
         LIMIT 1
      `;

  const obligationRows = normalizedScope.kind === 'global'
    ? await sql`
        WITH
        unclaimed AS (
          SELECT COALESCE(SUM(be.instructor_earning_pence), 0)::bigint AS pence
            FROM booking_earnings be
           WHERE be.earning_status IN ('earned', 'claimed', 'transferring')
             AND NOT EXISTS (
               SELECT 1 FROM payout_batch_earnings pbe
                WHERE pbe.school_id = be.school_id
                  AND pbe.booking_earning_id = be.id
             )
        ),
        ready_batches AS (
          SELECT COALESCE(SUM(pb.instructor_amount_pence), 0)::bigint AS pence
            FROM payout_batches pb
           WHERE pb.state IN ('planned', 'claimed')
             AND NOT EXISTS (
               SELECT 1 FROM payout_transfers pt
                WHERE pt.school_id = pb.school_id
                  AND pt.payout_batch_id = pb.id
             )
        ),
        in_flight AS (
          SELECT COALESCE(SUM(pt.amount_pence), 0)::bigint AS pence,
                 COUNT(*) FILTER (WHERE pt.state = 'reconciling')::int AS reconciling_count
            FROM payout_transfers pt
           WHERE pt.state IN ('planned', 'submitting', 'reconciling')
             AND pt.stripe_transfer_id IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM payout_transfer_attempts pta
                WHERE pta.school_id = pt.school_id
                  AND pta.payout_transfer_id = pt.id
                  AND pta.outcome IN ('succeeded', 'found')
             )
        ),
        refunds AS (
          SELECT COALESCE(SUM(latest.amount_pence), 0)::bigint AS pence,
                 COUNT(*) FILTER (WHERE latest.evidence_status <> 'complete')::int AS contradictory_count
            FROM (
              SELECT DISTINCT ON (pro.school_id, pro.logical_identity)
                     pro.amount_pence, pro.state, pro.evidence_status
                FROM payout_v2_refund_obligation_events pro
               ORDER BY pro.school_id, pro.logical_identity, pro.sequence_no DESC, pro.id DESC
            ) latest
           WHERE latest.state = 'approved'
        )
        SELECT
          (SELECT pence FROM unclaimed) AS unclaimed_pence,
          (SELECT pence FROM ready_batches) AS ready_batch_pence,
          (SELECT pence FROM in_flight) AS in_flight_pence,
          (SELECT reconciling_count FROM in_flight) AS reconciling_count,
          (SELECT pence FROM refunds) AS approved_refund_pence,
          (SELECT contradictory_count FROM refunds) AS contradictory_refund_count
      `
    : await sql`
        WITH
        unclaimed AS (
          SELECT COALESCE(SUM(be.instructor_earning_pence), 0)::bigint AS pence
            FROM booking_earnings be
           WHERE be.school_id = ${schoolId}
             AND be.earning_status IN ('earned', 'claimed', 'transferring')
             AND NOT EXISTS (
               SELECT 1 FROM payout_batch_earnings pbe
                WHERE pbe.school_id = ${schoolId}
                  AND pbe.booking_earning_id = be.id
             )
        ),
        ready_batches AS (
          SELECT COALESCE(SUM(pb.instructor_amount_pence), 0)::bigint AS pence
            FROM payout_batches pb
           WHERE pb.school_id = ${schoolId}
             AND pb.state IN ('planned', 'claimed')
             AND NOT EXISTS (
               SELECT 1 FROM payout_transfers pt
                WHERE pt.school_id = ${schoolId}
                  AND pt.payout_batch_id = pb.id
             )
        ),
        in_flight AS (
          SELECT COALESCE(SUM(pt.amount_pence), 0)::bigint AS pence,
                 COUNT(*) FILTER (WHERE pt.state = 'reconciling')::int AS reconciling_count
            FROM payout_transfers pt
           WHERE pt.school_id = ${schoolId}
             AND pt.state IN ('planned', 'submitting', 'reconciling')
             AND pt.stripe_transfer_id IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM payout_transfer_attempts pta
                WHERE pta.school_id = ${schoolId}
                  AND pta.payout_transfer_id = pt.id
                  AND pta.outcome IN ('succeeded', 'found')
             )
        ),
        refunds AS (
          SELECT COALESCE(SUM(latest.amount_pence), 0)::bigint AS pence,
                 COUNT(*) FILTER (WHERE latest.evidence_status <> 'complete')::int AS contradictory_count
            FROM (
              SELECT DISTINCT ON (pro.logical_identity)
                     pro.amount_pence, pro.state, pro.evidence_status
                FROM payout_v2_refund_obligation_events pro
               WHERE pro.school_id = ${schoolId}
               ORDER BY pro.logical_identity, pro.sequence_no DESC, pro.id DESC
            ) latest
           WHERE latest.state = 'approved'
        )
        SELECT
          (SELECT pence FROM unclaimed) AS unclaimed_pence,
          (SELECT pence FROM ready_batches) AS ready_batch_pence,
          (SELECT pence FROM in_flight) AS in_flight_pence,
          (SELECT reconciling_count FROM in_flight) AS reconciling_count,
          (SELECT pence FROM refunds) AS approved_refund_pence,
          (SELECT contradictory_count FROM refunds) AS contradictory_refund_count
      `;

  const reviewRows = normalizedScope.kind === 'global'
    ? await sql`
        SELECT
          COUNT(*) FILTER (WHERE funding_class = 'manual_review' OR source_status = 'manual_review')::int AS manual_review_count,
          COUNT(*) FILTER (
            WHERE funding_class = 'legacy_pre_connect_settled' AND payable_pool_pence > 0
          )::int AS legacy_positive_count
          FROM payout_funding_sources
      `
    : await sql`
        SELECT
          COUNT(*) FILTER (WHERE funding_class = 'manual_review' OR source_status = 'manual_review')::int AS manual_review_count,
          COUNT(*) FILTER (
            WHERE funding_class = 'legacy_pre_connect_settled' AND payable_pool_pence > 0
          )::int AS legacy_positive_count
          FROM payout_funding_sources
         WHERE school_id = ${schoolId}
      `;

  return {
    config: configRows[0] || null,
    obligations: obligationRows[0] || {},
    review: reviewRows[0] || {},
  };
}

async function computePayoutV2ProtectedBalance({
  sql,
  scope,
  readStripeBalance,
  now = () => new Date(),
  stripeEvidenceMaxAgeMs = DEFAULT_STRIPE_EVIDENCE_MAX_AGE_MS,
  exactExposureProvider = computeExactRefundExposure,
  liquidityEvidenceProvider = loadPayoutV2LiquidityEvidence,
}) {
  if (typeof readStripeBalance !== 'function') {
    throw new Error('readStripeBalance injection is required');
  }
  const normalizedScope = normalizeScope(scope);
  const capturedAt = now();
  const [stripeEvidence, exposure, liquidity] = await Promise.all([
    readStripeBalance({ scope: normalizedScope }),
    exactExposureProvider(sql, {
      schoolId: normalizedScope.kind === 'school' ? normalizedScope.school_id : undefined,
    }),
    liquidityEvidenceProvider(sql, { scope: normalizedScope }),
  ]);
  const blockers = blockerFromExposure(exposure);
  const stripeReadAt = stripeEvidence?.read_at ? new Date(stripeEvidence.read_at) : null;
  if (!stripeEvidence || !stripeReadAt || Number.isNaN(stripeReadAt.getTime())) {
    blockers.push({ code: BLOCKER_CODES.STRIPE_BALANCE_MISSING });
  } else if (capturedAt.getTime() - stripeReadAt.getTime() > stripeEvidenceMaxAgeMs) {
    blockers.push({ code: BLOCKER_CODES.STRIPE_BALANCE_STALE });
  }
  if (!liquidity.config) blockers.push({ code: BLOCKER_CODES.MISSING_RISK_RESERVE_CONFIGURATION });
  if (Number(liquidity.obligations.reconciling_count || 0) > 0) {
    blockers.push({ code: BLOCKER_CODES.RECONCILING_TRANSFER_AMBIGUOUS });
  }
  if (Number(liquidity.obligations.contradictory_refund_count || 0) > 0) {
    blockers.push({ code: BLOCKER_CODES.APPROVED_REFUND_EVIDENCE_CONTRADICTORY });
  }
  if (Number(liquidity.review.manual_review_count || 0) > 0) {
    blockers.push({ code: BLOCKER_CODES.MANUAL_REVIEW_EVIDENCE });
  }
  if (Number(liquidity.review.legacy_positive_count || 0) > 0) {
    blockers.push({ code: BLOCKER_CODES.LEGACY_POSITIVE_CONTRIBUTION });
  }
  if (normalizedScope.kind === 'school' && stripeEvidence?.scope?.kind === 'global') {
    blockers.push({ code: BLOCKER_CODES.SCHOOL_CASH_NOT_SEGREGATED });
  }

  const unclaimed = Number(liquidity.obligations.unclaimed_pence || 0);
  const ready = Number(liquidity.obligations.ready_batch_pence || 0);
  return calculateProtectedBalance({
    scope: normalizedScope,
    cash_scope: stripeEvidence?.scope || normalizedScope,
    input_timestamp: capturedAt.toISOString(),
    stripe_available_pence: Number(stripeEvidence?.available_pence || 0),
    stripe_pending_pence: Number(stripeEvidence?.pending_pence || 0),
    stripe_read_at: stripeReadAt?.toISOString() || null,
    stripe_evidence_status: blockers.some((b) => b.code === BLOCKER_CODES.STRIPE_BALANCE_MISSING)
      ? 'missing'
      : blockers.some((b) => b.code === BLOCKER_CODES.STRIPE_BALANCE_STALE) ? 'stale' : 'fresh',
    exact_unused_refundable_source_exposure_pence: Number(exposure?.platform_refund_exposure_pence || 0),
    earned_untransferred_instructor_obligations_pence: unclaimed + ready,
    submitted_reconciling_not_reflected_pence: Number(liquidity.obligations.in_flight_pence || 0),
    approved_unexecuted_refund_obligations_pence: Number(liquidity.obligations.approved_refund_pence || 0),
    configured_dispute_refund_risk_reserve_pence: Number(liquidity.config?.risk_reserve_pence || 0),
    transfers_ready_now_pence: ready,
    blockers,
  });
}

function buildProtectedBalanceAlert(calculation, {
  previous_snapshot = null,
  known_available_movement_pence = 0,
} = {}) {
  if (calculation.protected_free_cash_pence >= 0 && calculation.blockers.length === 0) return null;
  const blockerCodes = calculation.blockers.map((blocker) => blocker.code);
  let classification = 'ordinary_liability_growth';
  if (blockerCodes.includes(BLOCKER_CODES.STRIPE_BALANCE_MISSING)) classification = 'missing_stripe_balance_evidence';
  else if (blockerCodes.includes(BLOCKER_CODES.STRIPE_BALANCE_STALE)) classification = 'stale_stripe_balance_evidence';
  else if (previous_snapshot) {
    const observedDelta = calculation.stripe_available_pence - Number(previous_snapshot.stripe_available_pence);
    const unexplainedDelta = observedDelta - integer(known_available_movement_pence, 'known_available_movement_pence');
    if (unexplainedDelta < 0 && previous_snapshot.external_dashboard_payout_observed === true) {
      classification = 'observed_external_manual_dashboard_withdrawal';
    } else if (unexplainedDelta !== 0) {
      classification = 'unexplained_balance_movement';
    }
  }
  const alert = {
    alert_version: 'payout-v2-protected-balance-alert-v1',
    scope: calculation.scope,
    classification,
    protected_free_cash_pence: calculation.protected_free_cash_pence,
    calculation_fingerprint: calculation.calculation_fingerprint,
    position_fingerprint: calculation.position_fingerprint,
    blocker_codes: blockerCodes,
    non_pii: true,
  };
  alert.deduplication_identity = sha256({
    scope: alert.scope,
    classification,
    position_fingerprint: alert.position_fingerprint,
    blocker_codes: blockerCodes,
  });
  return alert;
}

async function emitProtectedBalanceAlert({
  calculation,
  previousSnapshot,
  knownAvailableMovementPence = 0,
  alertTransport,
  persistEvidence,
}) {
  const alert = buildProtectedBalanceAlert(calculation, {
    previous_snapshot: previousSnapshot,
    known_available_movement_pence: knownAvailableMovementPence,
  });
  if (!alert) return { emitted: false, reason: 'not_required' };
  if (typeof alertTransport !== 'function' || typeof persistEvidence !== 'function') {
    throw new Error('alertTransport and persistEvidence injections are required');
  }
  const claim = await persistEvidence({ phase: 'claim', alert });
  if (claim?.duplicate) return { emitted: false, duplicate: true, deduplication_identity: alert.deduplication_identity };
  let transportResult;
  try {
    transportResult = await alertTransport(alert);
  } catch (error) {
    await persistEvidence({
      phase: 'result',
      alert,
      status: 'failed',
      transport_reference: null,
      failure_code: String(error?.code || 'ALERT_TRANSPORT_FAILED').slice(0, 100),
    });
    throw error;
  }
  await persistEvidence({
    phase: 'result',
    alert,
    status: 'emitted',
    transport_reference: transportResult?.reference || null,
    failure_code: null,
  });
  return {
    emitted: true,
    deduplication_identity: alert.deduplication_identity,
    transport_reference: transportResult?.reference || null,
  };
}

module.exports = {
  BLOCKER_CODES,
  DEFAULT_STRIPE_EVIDENCE_MAX_AGE_MS,
  PROTECTED_BALANCE_CALCULATION_VERSION,
  WITHDRAWAL_PREFLIGHT_VERSION,
  buildProtectedBalanceAlert,
  calculateProtectedBalance,
  calculateWithdrawalPreflight,
  computePayoutV2ProtectedBalance,
  emitProtectedBalanceAlert,
  loadPayoutV2LiquidityEvidence,
  normalizeScope,
  sha256,
};
