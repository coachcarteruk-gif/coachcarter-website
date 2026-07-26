const {
  authorizePayoutV2Mutation,
} = require('./_payout-v2-authority');
const {
  canonicalJson,
} = require('./_payout-v2-contracts');
const {
  sha256,
} = require('./_payout-v2-protected-balance');

const CUTOVER_CONTRACT_VERSION = 'payout-v2-controlled-cutover-v1';
const CUTOVER_CONFIRMATION_PHRASE = 'AUTHORISE PAYOUT V2 SCHOOL CUTOVER';
const FIRST_LIVE_CONFIRMATION_PHRASE = 'AUTHORISE CAPPED PAYOUT V2 FIRST BATCH';
const CUTOVER_READINESS_MAX_AGE_MINUTES = 15;

const CUTOVER_OPERATIONS = Object.freeze({
  ENGINE_TRANSITION: 'cutover_engine_transition',
  FIRST_LIVE_BATCH: 'first_live_batch',
  ROLLBACK_CONTROL: 'cutover_rollback_control',
});

const READINESS_BLOCKERS = Object.freeze({
  ACTIVE_INCIDENT: 'ACTIVE_INCIDENT',
  AMBIGUOUS_EXTERNAL_OR_CASH_SOURCE: 'AMBIGUOUS_EXTERNAL_OR_CASH_SOURCE',
  CONFIG_FINGERPRINT_INVALID: 'CONFIG_FINGERPRINT_INVALID',
  CONFIG_MISSING: 'CONFIG_MISSING',
  CROSS_ROUTE_CLAIM: 'CROSS_ROUTE_CLAIM',
  CROSS_SCHOOL_VIOLATION: 'CROSS_SCHOOL_VIOLATION',
  ENGINE_NOT_V1: 'ENGINE_NOT_V1',
  EXTERNAL_CASH_CLASSIFICATION_INCOMPLETE: 'EXTERNAL_CASH_CLASSIFICATION_INCOMPLETE',
  FIRST_LIVE_CAP_INVALID: 'FIRST_LIVE_CAP_INVALID',
  FIRST_LIVE_INSTRUCTOR_INVALID: 'FIRST_LIVE_INSTRUCTOR_INVALID',
  FIRST_LIVE_ROUTE_NOT_INSTRUCTOR_DIRECT: 'FIRST_LIVE_ROUTE_NOT_INSTRUCTOR_DIRECT',
  LEGACY_POSITIVE_CONTRIBUTION: 'LEGACY_POSITIVE_CONTRIBUTION',
  MUTATION_OPERATOR_AUTHORITY_INCOMPLETE: 'MUTATION_OPERATOR_AUTHORITY_INCOMPLETE',
  OWNER_APPROVAL_MISSING: 'OWNER_APPROVAL_MISSING',
  PROTECTED_BALANCE_BLOCKED: 'PROTECTED_BALANCE_BLOCKED',
  PROTECTED_BALANCE_FINGERPRINT_MISMATCH: 'PROTECTED_BALANCE_FINGERPRINT_MISMATCH',
  PROTECTED_BALANCE_INSUFFICIENT: 'PROTECTED_BALANCE_INSUFFICIENT',
  PROTECTED_BALANCE_SCOPE_INVALID: 'PROTECTED_BALANCE_SCOPE_INVALID',
  RISK_RESERVE_EVIDENCE_MISSING: 'RISK_RESERVE_EVIDENCE_MISSING',
  RISK_RESERVE_FINGERPRINT_MISMATCH: 'RISK_RESERVE_FINGERPRINT_MISMATCH',
  ROLLBACK_CRITERIA_INCOMPLETE: 'ROLLBACK_CRITERIA_INCOMPLETE',
  ROUTE_CONFIGURATION_INCOMPLETE: 'ROUTE_CONFIGURATION_INCOMPLETE',
  SETMORE_CLASSIFICATION_INCOMPLETE: 'SETMORE_CLASSIFICATION_INCOMPLETE',
  SHADOW_CYCLES_NOT_DISTINCT: 'SHADOW_CYCLES_NOT_DISTINCT',
  SHADOW_CYCLE_AMBIGUOUS: 'SHADOW_CYCLE_AMBIGUOUS',
  SHADOW_CYCLE_FINGERPRINT_INVALID: 'SHADOW_CYCLE_FINGERPRINT_INVALID',
  SHADOW_CYCLE_UNEXPLAINED_DIFFERENCE: 'SHADOW_CYCLE_UNEXPLAINED_DIFFERENCE',
  TWO_ACCEPTED_SHADOW_CYCLES_REQUIRED: 'TWO_ACCEPTED_SHADOW_CYCLES_REQUIRED',
  UNRESOLVED_TRANSFER: 'UNRESOLVED_TRANSFER',
  V1_INFLIGHT_MUTATION: 'V1_INFLIGHT_MUTATION',
});

const POST_BATCH_BLOCKERS = Object.freeze({
  AMBIGUOUS_TRANSFER: 'AMBIGUOUS_TRANSFER',
  IDEMPOTENCY_MISMATCH: 'IDEMPOTENCY_MISMATCH',
  LOCAL_STRIPE_TRANSFER_MISMATCH: 'LOCAL_STRIPE_TRANSFER_MISMATCH',
  PLAN_FINGERPRINT_MISMATCH: 'PLAN_FINGERPRINT_MISMATCH',
  POST_BATCH_PROTECTED_BALANCE_NEGATIVE: 'POST_BATCH_PROTECTED_BALANCE_NEGATIVE',
  STRIPE_AMOUNT_MISMATCH: 'STRIPE_AMOUNT_MISMATCH',
  UNRESOLVED_RECONCILIATION: 'UNRESOLVED_RECONCILIATION',
  V1_OVERLAP: 'V1_OVERLAP',
});

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return parsed;
}

function nonNegativeInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return parsed;
}

function fingerprint(value) {
  return sha256({
    contract_version: CUTOVER_CONTRACT_VERSION,
    value,
  });
}

function validFingerprint(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function normalizeCount(value, field) {
  return nonNegativeInteger(value == null ? 0 : value, field);
}

function addBlocker(blockers, code, detail = null) {
  if (!blockers.some((item) => item.code === code && item.detail === detail)) {
    blockers.push({ code, detail });
  }
}

function buildCutoverConfig(input) {
  const schoolId = positiveInteger(input?.school_id, 'school_id');
  const versionNo = positiveInteger(input?.version_no, 'version_no');
  const instructorId = positiveInteger(
    input?.first_live_instructor_id,
    'first_live_instructor_id'
  );
  const capPence = positiveInteger(input?.first_live_cap_pence, 'first_live_cap_pence');
  const allowedOperations = Array.isArray(input?.operator_allowed_operations)
    ? [...new Set(input.operator_allowed_operations)].sort()
    : [];
  const config = {
    contract_version: CUTOVER_CONTRACT_VERSION,
    school_id: schoolId,
    version_no: versionNo,
    payout_route: input?.payout_route || null,
    first_live_instructor_id: instructorId,
    first_live_cap_pence: capPence,
    mutation_operator_id: positiveInteger(input?.mutation_operator_id, 'mutation_operator_id'),
    mutation_operator_authority_class: input?.mutation_operator_authority_class || null,
    operator_allowed_operations: allowedOperations,
    risk_reserve_config_fingerprint: input?.risk_reserve_config_fingerprint || null,
    protected_balance_calculation_fingerprint:
      input?.protected_balance_calculation_fingerprint || null,
    protected_balance_scope_kind: input?.protected_balance_scope_kind || null,
    route_evidence_reference: input?.route_evidence_reference || null,
    external_cash_classification: input?.external_cash_classification || null,
    external_cash_evidence_reference: input?.external_cash_evidence_reference || null,
    setmore_classification: input?.setmore_classification || null,
    setmore_evidence_reference: input?.setmore_evidence_reference || null,
    owner_approved_by: input?.owner_approved_by || null,
    owner_approved_at: input?.owner_approved_at || null,
    owner_approval_reference: input?.owner_approval_reference || null,
    rollback_criteria: input?.rollback_criteria || null,
  };
  return {
    ...config,
    config_fingerprint: fingerprint(config),
  };
}

function cutoverConfigBody(config) {
  return {
    contract_version: config?.contract_version,
    school_id: config?.school_id,
    version_no: config?.version_no,
    payout_route: config?.payout_route,
    first_live_instructor_id: config?.first_live_instructor_id,
    first_live_cap_pence: config?.first_live_cap_pence,
    mutation_operator_id: config?.mutation_operator_id,
    mutation_operator_authority_class: config?.mutation_operator_authority_class,
    operator_allowed_operations: config?.operator_allowed_operations,
    risk_reserve_config_fingerprint: config?.risk_reserve_config_fingerprint,
    protected_balance_calculation_fingerprint:
      config?.protected_balance_calculation_fingerprint,
    protected_balance_scope_kind: config?.protected_balance_scope_kind,
    route_evidence_reference: config?.route_evidence_reference,
    external_cash_classification: config?.external_cash_classification,
    external_cash_evidence_reference: config?.external_cash_evidence_reference,
    setmore_classification: config?.setmore_classification,
    setmore_evidence_reference: config?.setmore_evidence_reference,
    owner_approved_by: config?.owner_approved_by,
    owner_approved_at: config?.owner_approved_at,
    owner_approval_reference: config?.owner_approval_reference,
    rollback_criteria: config?.rollback_criteria,
  };
}

function buildShadowCycleEvidence(input) {
  const ordinal = positiveInteger(input?.cycle_ordinal, 'cycle_ordinal');
  if (![1, 2].includes(ordinal)) {
    throw new TypeError('cycle_ordinal must be 1 or 2');
  }
  const unexplained = normalizeCount(
    input?.unexplained_difference_count,
    'unexplained_difference_count'
  );
  const ambiguous = normalizeCount(input?.ambiguous_source_count, 'ambiguous_source_count');
  const accepted = input?.decision === 'accepted' && unexplained === 0 && ambiguous === 0;
  const evidence = {
    contract_version: CUTOVER_CONTRACT_VERSION,
    school_id: positiveInteger(input?.school_id, 'school_id'),
    cycle_ordinal: ordinal,
    period_start: input?.period_start || null,
    period_end: input?.period_end || null,
    shadow_statement_fingerprint: input?.shadow_statement_fingerprint || null,
    v1_preview_fingerprint: input?.v1_preview_fingerprint || null,
    comparison_fingerprint: input?.comparison_fingerprint || null,
    unexplained_difference_count: unexplained,
    ambiguous_source_count: ambiguous,
    decision: accepted ? 'accepted' : 'rejected',
    owner_approved_by: input?.owner_approved_by || null,
    owner_approved_at: input?.owner_approved_at || null,
    evidence_reference: input?.evidence_reference || null,
  };
  return {
    ...evidence,
    evidence_fingerprint: fingerprint(evidence),
  };
}

function evaluateCutoverReadiness(input) {
  const schoolId = positiveInteger(input?.school_id, 'school_id');
  const blockers = [];
  const config = input?.config || null;
  const shadowCycles = Array.isArray(input?.shadow_cycles) ? input.shadow_cycles : [];
  const diagnostics = input?.diagnostics || {};
  const protectedBalance = input?.protected_balance || {};

  if (input?.payout_engine_version !== 'v1') {
    addBlocker(blockers, READINESS_BLOCKERS.ENGINE_NOT_V1);
  }

  if (!config) {
    addBlocker(blockers, READINESS_BLOCKERS.CONFIG_MISSING);
  } else {
    if (Number(config.school_id) !== schoolId) {
      addBlocker(blockers, READINESS_BLOCKERS.CONFIG_MISSING, 'school_scope_mismatch');
    }
    const expectedConfigFingerprint = fingerprint(cutoverConfigBody(config));
    if (
      !validFingerprint(config.config_fingerprint)
      || config.config_fingerprint !== expectedConfigFingerprint
    ) {
      addBlocker(blockers, READINESS_BLOCKERS.CONFIG_FINGERPRINT_INVALID);
    }
    if (config.payout_route !== 'instructor_direct') {
      addBlocker(blockers, READINESS_BLOCKERS.FIRST_LIVE_ROUTE_NOT_INSTRUCTOR_DIRECT);
    }
    if (!['instructor_direct', 'school'].includes(config.payout_route)) {
      addBlocker(blockers, READINESS_BLOCKERS.ROUTE_CONFIGURATION_INCOMPLETE);
    }
    if (!Number.isSafeInteger(Number(config.first_live_instructor_id))
      || Number(config.first_live_instructor_id) <= 0) {
      addBlocker(blockers, READINESS_BLOCKERS.FIRST_LIVE_INSTRUCTOR_INVALID);
    }
    if (!Number.isSafeInteger(Number(config.first_live_cap_pence))
      || Number(config.first_live_cap_pence) <= 0) {
      addBlocker(blockers, READINESS_BLOCKERS.FIRST_LIVE_CAP_INVALID);
    }
    if (
      !config.mutation_operator_id
      || !['superadmin', 'scoped_operator'].includes(
        config.mutation_operator_authority_class
      )
      || !Array.isArray(config.operator_allowed_operations)
      || !config.operator_allowed_operations.includes(CUTOVER_OPERATIONS.ENGINE_TRANSITION)
      || !config.operator_allowed_operations.includes(CUTOVER_OPERATIONS.FIRST_LIVE_BATCH)
    ) {
      addBlocker(blockers, READINESS_BLOCKERS.MUTATION_OPERATOR_AUTHORITY_INCOMPLETE);
    }
    if (
      !config.owner_approved_by
      || !config.owner_approved_at
      || !config.owner_approval_reference
    ) {
      addBlocker(blockers, READINESS_BLOCKERS.OWNER_APPROVAL_MISSING);
    }
    if (
      !validFingerprint(config.risk_reserve_config_fingerprint)
      || !validFingerprint(config.protected_balance_calculation_fingerprint)
    ) {
      addBlocker(blockers, READINESS_BLOCKERS.RISK_RESERVE_EVIDENCE_MISSING);
    }
    if (config.protected_balance_scope_kind !== 'global') {
      addBlocker(blockers, READINESS_BLOCKERS.PROTECTED_BALANCE_SCOPE_INVALID);
    }
    if (
      config.external_cash_classification !== 'complete'
      || !config.external_cash_evidence_reference
    ) {
      addBlocker(blockers, READINESS_BLOCKERS.EXTERNAL_CASH_CLASSIFICATION_INCOMPLETE);
    }
    if (
      !['complete', 'not_applicable'].includes(config.setmore_classification)
      || !config.setmore_evidence_reference
    ) {
      addBlocker(blockers, READINESS_BLOCKERS.SETMORE_CLASSIFICATION_INCOMPLETE);
    }
    if (!config.route_evidence_reference) {
      addBlocker(blockers, READINESS_BLOCKERS.ROUTE_CONFIGURATION_INCOMPLETE);
    }
    if (
      !config.rollback_criteria
      || typeof config.rollback_criteria !== 'object'
      || Array.isArray(config.rollback_criteria)
      || Object.keys(config.rollback_criteria).length === 0
    ) {
      addBlocker(blockers, READINESS_BLOCKERS.ROLLBACK_CRITERIA_INCOMPLETE);
    }
  }

  const accepted = shadowCycles
    .filter((cycle) => cycle?.decision === 'accepted')
    .sort((left, right) => Number(left.cycle_ordinal) - Number(right.cycle_ordinal));
  if (
    accepted.length !== 2
    || Number(accepted[0]?.cycle_ordinal) !== 1
    || Number(accepted[1]?.cycle_ordinal) !== 2
  ) {
    addBlocker(blockers, READINESS_BLOCKERS.TWO_ACCEPTED_SHADOW_CYCLES_REQUIRED);
  }
  for (const cycle of accepted) {
    if (Number(cycle.school_id) !== schoolId) {
      addBlocker(blockers, READINESS_BLOCKERS.TWO_ACCEPTED_SHADOW_CYCLES_REQUIRED);
    }
    if (
      !validFingerprint(cycle.shadow_statement_fingerprint)
      || !validFingerprint(cycle.v1_preview_fingerprint)
      || !validFingerprint(cycle.comparison_fingerprint)
      || !validFingerprint(cycle.evidence_fingerprint)
    ) {
      addBlocker(blockers, READINESS_BLOCKERS.SHADOW_CYCLE_FINGERPRINT_INVALID);
    }
    if (Number(cycle.unexplained_difference_count) !== 0) {
      addBlocker(blockers, READINESS_BLOCKERS.SHADOW_CYCLE_UNEXPLAINED_DIFFERENCE);
    }
    if (Number(cycle.ambiguous_source_count) !== 0) {
      addBlocker(blockers, READINESS_BLOCKERS.SHADOW_CYCLE_AMBIGUOUS);
    }
  }
  if (
    accepted.length === 2
    && (
      accepted[0].period_start === accepted[1].period_start
      || accepted[0].shadow_statement_fingerprint
        === accepted[1].shadow_statement_fingerprint
    )
  ) {
    addBlocker(blockers, READINESS_BLOCKERS.SHADOW_CYCLES_NOT_DISTINCT);
  }

  if (normalizeCount(diagnostics.cross_school_violation_count, 'cross_school_violation_count') > 0) {
    addBlocker(blockers, READINESS_BLOCKERS.CROSS_SCHOOL_VIOLATION);
  }
  if (normalizeCount(diagnostics.cross_route_claim_count, 'cross_route_claim_count') > 0) {
    addBlocker(blockers, READINESS_BLOCKERS.CROSS_ROUTE_CLAIM);
  }
  if (normalizeCount(diagnostics.legacy_positive_count, 'legacy_positive_count') > 0) {
    addBlocker(blockers, READINESS_BLOCKERS.LEGACY_POSITIVE_CONTRIBUTION);
  }
  if (normalizeCount(diagnostics.ambiguous_external_cash_count, 'ambiguous_external_cash_count') > 0) {
    addBlocker(blockers, READINESS_BLOCKERS.AMBIGUOUS_EXTERNAL_OR_CASH_SOURCE);
  }
  if (normalizeCount(diagnostics.unresolved_transfer_count, 'unresolved_transfer_count') > 0) {
    addBlocker(blockers, READINESS_BLOCKERS.UNRESOLVED_TRANSFER);
  }
  if (normalizeCount(diagnostics.active_incident_count, 'active_incident_count') > 0) {
    addBlocker(blockers, READINESS_BLOCKERS.ACTIVE_INCIDENT);
  }
  if (normalizeCount(diagnostics.v1_inflight_payout_count, 'v1_inflight_payout_count') > 0) {
    addBlocker(blockers, READINESS_BLOCKERS.V1_INFLIGHT_MUTATION);
  }

  if (
    !validFingerprint(protectedBalance.calculation_fingerprint)
    || !validFingerprint(protectedBalance.position_fingerprint)
    || protectedBalance.calculation_fingerprint
      !== config?.protected_balance_calculation_fingerprint
  ) {
    addBlocker(blockers, READINESS_BLOCKERS.PROTECTED_BALANCE_FINGERPRINT_MISMATCH);
  }
  if (
    protectedBalance.scope_kind !== 'global'
    || (protectedBalance.school_id !== null && protectedBalance.school_id !== undefined)
  ) {
    addBlocker(blockers, READINESS_BLOCKERS.PROTECTED_BALANCE_SCOPE_INVALID);
  }
  if (
    !validFingerprint(protectedBalance.risk_reserve_config_fingerprint)
    || protectedBalance.risk_reserve_config_fingerprint
      !== config?.risk_reserve_config_fingerprint
  ) {
    addBlocker(blockers, READINESS_BLOCKERS.RISK_RESERVE_FINGERPRINT_MISMATCH);
  }
  if (
    protectedBalance.complete !== true
    || (protectedBalance.blocker_codes || []).length > 0
  ) {
    addBlocker(blockers, READINESS_BLOCKERS.PROTECTED_BALANCE_BLOCKED);
  }
  const transferReadinessPence = normalizeCount(
    protectedBalance.transfer_readiness_pence,
    'transfer_readiness_pence'
  );
  if (
    config
    && Number.isSafeInteger(Number(config.first_live_cap_pence))
    && transferReadinessPence < Number(config.first_live_cap_pence)
  ) {
    addBlocker(blockers, READINESS_BLOCKERS.PROTECTED_BALANCE_INSUFFICIENT);
  }

  const evidence = {
    contract_version: CUTOVER_CONTRACT_VERSION,
    school_id: schoolId,
    payout_engine_version: input?.payout_engine_version || null,
    config_fingerprint: config?.config_fingerprint || null,
    shadow_cycle_fingerprints: accepted.map((cycle) => cycle.evidence_fingerprint),
    protected_balance_calculation_fingerprint:
      protectedBalance.calculation_fingerprint || null,
    protected_balance_position_fingerprint:
      protectedBalance.position_fingerprint || null,
    risk_reserve_config_fingerprint:
      protectedBalance.risk_reserve_config_fingerprint || null,
    diagnostics: {
      cross_school_violation_count: normalizeCount(
        diagnostics.cross_school_violation_count,
        'cross_school_violation_count'
      ),
      cross_route_claim_count: normalizeCount(
        diagnostics.cross_route_claim_count,
        'cross_route_claim_count'
      ),
      legacy_positive_count: normalizeCount(
        diagnostics.legacy_positive_count,
        'legacy_positive_count'
      ),
      ambiguous_external_cash_count: normalizeCount(
        diagnostics.ambiguous_external_cash_count,
        'ambiguous_external_cash_count'
      ),
      unresolved_transfer_count: normalizeCount(
        diagnostics.unresolved_transfer_count,
        'unresolved_transfer_count'
      ),
      active_incident_count: normalizeCount(
        diagnostics.active_incident_count,
        'active_incident_count'
      ),
      v1_inflight_payout_count: normalizeCount(
        diagnostics.v1_inflight_payout_count,
        'v1_inflight_payout_count'
      ),
    },
    blockers,
  };
  return {
    ...evidence,
    status: blockers.length === 0 ? 'ready' : 'blocked',
    readiness_fingerprint: fingerprint(evidence),
    mutation_allowed: false,
    stripe_call_allowed: false,
  };
}

function buildCappedFirstBatchDryRun({ readiness, config, plan }) {
  if (readiness?.status !== 'ready') {
    throw new Error('Cutover readiness must be ready before first-batch planning');
  }
  if (readiness.config_fingerprint !== config?.config_fingerprint) {
    throw new Error('Cutover config fingerprint changed after readiness review');
  }
  if (!validFingerprint(plan?.plan_fingerprint)) {
    throw new Error('A reviewed planner fingerprint is required');
  }
  if (Number(plan.school_id) !== Number(config.school_id)) {
    throw new Error('First-live plan crossed school scope');
  }
  if (plan.payout_route !== config.payout_route) {
    throw new Error('First-live plan route differs from approved config');
  }
  if (Number(plan.destination_instructor_id) !== Number(config.first_live_instructor_id)) {
    throw new Error('First-live plan instructor differs from approved config');
  }
  const amountPence = positiveInteger(
    plan?.totals?.net_shadow_transfer_pence,
    'plan.totals.net_shadow_transfer_pence'
  );
  const capPence = positiveInteger(config.first_live_cap_pence, 'first_live_cap_pence');
  if (amountPence > capPence) {
    const error = new Error('Reviewed first-live plan exceeds the approved hard cap');
    error.code = 'PAYOUT_V2_FIRST_LIVE_CAP_EXCEEDED';
    throw error;
  }
  const evidence = {
    contract_version: CUTOVER_CONTRACT_VERSION,
    school_id: Number(config.school_id),
    readiness_fingerprint: readiness.readiness_fingerprint,
    config_fingerprint: config.config_fingerprint,
    plan_fingerprint: plan.plan_fingerprint,
    payout_route: plan.payout_route,
    instructor_id: Number(plan.destination_instructor_id),
    amount_pence: amountPence,
    cap_pence: capPence,
    cap_policy: 'hard_block_no_truncation_no_partial_claims',
  };
  return {
    ...evidence,
    evidence_fingerprint: fingerprint(evidence),
    dry_run_only: true,
    mutation_allowed: false,
    stripe_call_allowed: false,
  };
}

function evaluateImmediatePostBatchReconciliation(input) {
  const blockers = [];
  if (input?.transfer_state === 'reconciling' || input?.ambiguous === true) {
    addBlocker(blockers, POST_BATCH_BLOCKERS.AMBIGUOUS_TRANSFER);
  }
  if (!input?.local_transfer_id || input.local_transfer_id !== input.stripe_transfer_id) {
    addBlocker(blockers, POST_BATCH_BLOCKERS.LOCAL_STRIPE_TRANSFER_MISMATCH);
  }
  if (input?.local_amount_pence !== input?.stripe_amount_pence) {
    addBlocker(blockers, POST_BATCH_BLOCKERS.STRIPE_AMOUNT_MISMATCH);
  }
  if (input?.local_idempotency_key !== input?.stripe_idempotency_key) {
    addBlocker(blockers, POST_BATCH_BLOCKERS.IDEMPOTENCY_MISMATCH);
  }
  if (input?.expected_plan_fingerprint !== input?.actual_plan_fingerprint) {
    addBlocker(blockers, POST_BATCH_BLOCKERS.PLAN_FINGERPRINT_MISMATCH);
  }
  if (normalizeCount(input?.unresolved_reconciliation_count, 'unresolved_reconciliation_count') > 0) {
    addBlocker(blockers, POST_BATCH_BLOCKERS.UNRESOLVED_RECONCILIATION);
  }
  if (normalizeCount(input?.v1_overlap_count, 'v1_overlap_count') > 0) {
    addBlocker(blockers, POST_BATCH_BLOCKERS.V1_OVERLAP);
  }
  if (Number(input?.protected_free_cash_pence) < 0) {
    addBlocker(blockers, POST_BATCH_BLOCKERS.POST_BATCH_PROTECTED_BALANCE_NEGATIVE);
  }
  const evidence = {
    contract_version: CUTOVER_CONTRACT_VERSION,
    school_id: positiveInteger(input?.school_id, 'school_id'),
    payout_batch_id: positiveInteger(input?.payout_batch_id, 'payout_batch_id'),
    transfer_state: input?.transfer_state || null,
    local_transfer_id: input?.local_transfer_id || null,
    stripe_transfer_id: input?.stripe_transfer_id || null,
    connected_bank_status: input?.connected_bank_status || 'unknown',
    bank_settlement_confirmed: input?.connected_bank_status === 'paid',
    blockers,
  };
  return {
    ...evidence,
    status: blockers.length === 0 ? 'reconciled' : 'incident_required',
    evidence_fingerprint: fingerprint(evidence),
    transfer_is_not_bank_settlement: true,
  };
}

function buildRollbackControl(input) {
  const triggerCodes = [...new Set(input?.trigger_codes || [])].sort();
  if (!triggerCodes.length) {
    throw new Error('At least one explicit rollback trigger code is required');
  }
  const control = {
    contract_version: CUTOVER_CONTRACT_VERSION,
    school_id: positiveInteger(input?.school_id, 'school_id'),
    trigger_codes: triggerCodes,
    reason: String(input?.reason || '').trim(),
    actions: {
      freeze_new_v2_batches: true,
      keep_webhooks_running: true,
      keep_reconciliation_running: true,
      retain_all_claims_and_ledger_rows: true,
      record_corrections_with_adjustments_or_reversals: true,
      permit_new_v1_mutation: false,
      delete_v2_rows: false,
      release_ambiguous_claims: false,
    },
  };
  if (control.reason.length < 8) {
    throw new Error('Rollback control requires a specific reason');
  }
  return {
    ...control,
    control_fingerprint: fingerprint(control),
  };
}

function defaultTransactionRunner(connectionString) {
  if (!connectionString) {
    throw new Error('connectionString or runInTransaction is required');
  }
  const { withNeonTransaction } = require('./_db-transaction');
  return (work) => withNeonTransaction(work, { connectionString });
}

/**
 * Future cutover mutation primitive. No route imports this in Slice 7.
 *
 * The reviewed readiness row, immutable config, two shadow records, authority
 * decision, event insert, and schools engine update are checked/written inside
 * one transaction. A matching event identity is an idempotent replay.
 */
async function transitionSchoolToPayoutV2({
  schoolId,
  readinessFingerprint,
  actor,
  reason,
  confirmationPhrase,
  idempotencyIdentity,
  eventIdentity,
  evidence = {},
  connectionString,
  runInTransaction,
}) {
  const scopedSchoolId = positiveInteger(schoolId, 'schoolId');
  if (!validFingerprint(readinessFingerprint)) {
    throw new Error('A valid reviewed readiness fingerprint is required');
  }
  if (typeof eventIdentity !== 'string' || !eventIdentity.trim()) {
    throw new Error('eventIdentity is required');
  }
  const transaction = runInTransaction || defaultTransactionRunner(connectionString);
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [7272, scopedSchoolId]);

    const existing = await client.query(
      `SELECT id, school_id, readiness_fingerprint, status
         FROM payout_v2_cutover_events
        WHERE event_identity = $1
        LIMIT 1`,
      [eventIdentity]
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (
        Number(row.school_id) !== scopedSchoolId
        || row.readiness_fingerprint !== readinessFingerprint
        || row.status !== 'recorded'
      ) {
        throw new Error('Cutover event identity was reused with different evidence');
      }
      return { idempotent_replay: true, event_id: Number(row.id), school_id: scopedSchoolId };
    }

    const schoolResult = await client.query(
      `SELECT id, payout_engine_version
         FROM schools
        WHERE id = $1
          AND active = TRUE
        FOR UPDATE`,
      [scopedSchoolId]
    );
    if (schoolResult.rowCount !== 1) throw new Error('Target school is missing or inactive');
    if (schoolResult.rows[0].payout_engine_version !== 'v1') {
      throw new Error('Target school payout engine is not v1');
    }

    const readinessResult = await client.query(
      `SELECT r.id, r.config_version_id, r.readiness_fingerprint,
              r.protected_balance_calculation_fingerprint,
              r.protected_balance_position_fingerprint,
              c.config_fingerprint, c.mutation_operator_id,
              c.mutation_operator_authority_class, c.operator_allowed_operations,
              c.risk_reserve_config_fingerprint,
              c.protected_balance_calculation_fingerprint AS config_protected_fingerprint,
              c.first_live_cap_pence
         FROM payout_v2_cutover_readiness_snapshots r
         JOIN payout_v2_cutover_config_versions c
           ON c.id = r.config_version_id
          AND c.school_id = r.school_id
        WHERE r.school_id = $1
          AND r.readiness_fingerprint = $2
          AND r.status = 'ready'
          AND r.created_at >= NOW() - INTERVAL '${CUTOVER_READINESS_MAX_AGE_MINUTES} minutes'
          AND NOT EXISTS (
            SELECT 1
              FROM payout_v2_cutover_config_versions newer
             WHERE newer.school_id = c.school_id
               AND newer.version_no > c.version_no
          )
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 1
        FOR UPDATE OF r`,
      [scopedSchoolId, readinessFingerprint]
    );
    if (readinessResult.rowCount !== 1) {
      throw new Error('Reviewed ready snapshot was not found for the target school');
    }
    const readinessRow = readinessResult.rows[0];
    if (
      readinessRow.protected_balance_calculation_fingerprint
      !== readinessRow.config_protected_fingerprint
    ) {
      throw new Error('Ready snapshot does not match the approved protected calculation');
    }
    const allowedOperations = readinessRow.operator_allowed_operations || [];
    if (
      Number(readinessRow.mutation_operator_id) !== Number(actor?.id)
      || readinessRow.mutation_operator_authority_class !== actor?.authority_class
      || !allowedOperations.includes(CUTOVER_OPERATIONS.ENGINE_TRANSITION)
    ) {
      throw new Error('Actor does not match the owner-approved mutation operator config');
    }

    const reserve = await client.query(
      `SELECT id
         FROM payout_v2_liquidity_config_versions
        WHERE config_fingerprint = $1
          AND scope_kind = 'global'
          AND school_id IS NULL
        LIMIT 1`,
      [readinessRow.risk_reserve_config_fingerprint]
    );
    if (reserve.rowCount !== 1) {
      throw new Error('Approved risk-reserve evidence is missing or outside school scope');
    }

    const protectedSnapshot = await client.query(
      `SELECT id
         FROM payout_v2_protected_balance_snapshots
        WHERE scope_kind = 'global'
          AND school_id IS NULL
          AND calculation_fingerprint = $1
          AND position_fingerprint = $2
          AND input_timestamp >= NOW() - INTERVAL '5 minutes'
          AND blocker_codes = '[]'::jsonb
          AND protected_free_cash_pence >= 0
          AND transfer_readiness_pence >= $3
        LIMIT 1`,
      [
        readinessRow.protected_balance_calculation_fingerprint,
        readinessRow.protected_balance_position_fingerprint,
        Number(readinessRow.first_live_cap_pence),
      ]
    );
    if (protectedSnapshot.rowCount !== 1) {
      throw new Error('Current authoritative protected-balance evidence blocks cutover');
    }

    const shadows = await client.query(
      `SELECT cycle_ordinal, period_start, shadow_statement_fingerprint
         FROM payout_v2_shadow_cycle_evidence
        WHERE school_id = $1
          AND decision = 'accepted'
          AND unexplained_difference_count = 0
          AND ambiguous_source_count = 0
        ORDER BY cycle_ordinal`,
      [scopedSchoolId]
    );
    if (
      shadows.rowCount !== 2
      || Number(shadows.rows[0].cycle_ordinal) !== 1
      || Number(shadows.rows[1].cycle_ordinal) !== 2
      || String(shadows.rows[0].period_start) === String(shadows.rows[1].period_start)
      || shadows.rows[0].shadow_statement_fingerprint
        === shadows.rows[1].shadow_statement_fingerprint
    ) {
      throw new Error('Two distinct accepted shadow cycles are required inside cutover transaction');
    }

    const incidents = await client.query(
      `SELECT 1
         FROM payout_v2_cutover_events
        WHERE school_id = $1
          AND event_type IN ('incident_opened', 'rollback_started')
          AND status = 'open'
        LIMIT 1`,
      [scopedSchoolId]
    );
    if (incidents.rowCount) throw new Error('An active payout v2 incident blocks cutover');

    const liveBlockers = await client.query(
      `SELECT
         (
           SELECT COUNT(*)
             FROM payout_funding_sources pfs
            WHERE pfs.school_id = $1
              AND (
                pfs.funding_class = 'manual_review'
                OR (
                  pfs.funding_class = 'external_cash_payable'
                  AND (
                    pfs.source_status = 'manual_review'
                    OR NOT (pfs.metadata ? 'evidence_reference')
                    OR NULLIF(BTRIM(pfs.metadata->>'evidence_reference'), '') IS NULL
                  )
                )
              )
         )::integer AS ambiguous_source_count,
         (
           SELECT COUNT(*)
             FROM payout_funding_sources pfs
            WHERE pfs.school_id = $1
              AND pfs.funding_class = 'legacy_pre_connect_settled'
              AND pfs.payable_pool_pence > 0
         )::integer AS legacy_positive_count,
         (
           SELECT COUNT(*)
             FROM payout_transfers pt
            WHERE pt.school_id = $1
              AND pt.state IN ('submitting', 'reconciling')
         )::integer AS unresolved_transfer_count,
         (
           SELECT COUNT(*)
             FROM instructor_payouts ip
             JOIN instructors i ON i.id = ip.instructor_id
            WHERE i.school_id = $1
              AND ip.status IN ('pending', 'processing')
         )::integer
         + (
           SELECT COUNT(*)
             FROM school_payouts sp
            WHERE sp.school_id = $1
              AND sp.status IN ('pending', 'processing')
         )::integer AS v1_inflight_count,
         (
           SELECT COUNT(*)
             FROM booking_earnings be
            WHERE be.school_id = $1
              AND (
                EXISTS (SELECT 1 FROM payout_line_items pli WHERE pli.booking_id = be.booking_id)
                OR EXISTS (
                  SELECT 1 FROM school_payout_line_items spli
                   WHERE spli.booking_id = be.booking_id
                )
              )
         )::integer AS cross_route_count`,
      [scopedSchoolId]
    );
    const live = liveBlockers.rows[0];
    const liveCodes = [];
    if (Number(live.ambiguous_source_count) > 0) liveCodes.push('AMBIGUOUS_SOURCE');
    if (Number(live.legacy_positive_count) > 0) liveCodes.push('LEGACY_POSITIVE');
    if (Number(live.unresolved_transfer_count) > 0) liveCodes.push('UNRESOLVED_TRANSFER');
    if (Number(live.v1_inflight_count) > 0) liveCodes.push('V1_INFLIGHT');
    if (Number(live.cross_route_count) > 0) liveCodes.push('CROSS_ROUTE');
    if (liveCodes.length) {
      throw new Error(`Current cutover blockers changed: ${liveCodes.join(',')}`);
    }

    const authority = authorizePayoutV2Mutation({
      actor,
      operation: CUTOVER_OPERATIONS.ENGINE_TRANSITION,
      scope: { kind: 'school', school_id: scopedSchoolId },
      reason,
      confirmation_phrase: confirmationPhrase,
      required_confirmation_phrase: CUTOVER_CONFIRMATION_PHRASE,
      idempotency_identity: idempotencyIdentity,
      expected_fingerprint: readinessFingerprint,
      actual_fingerprint: readinessRow.readiness_fingerprint,
    });
    if (!authority.allowed) {
      const error = new Error('Payout v2 cutover authority refused');
      error.code = 'PAYOUT_V2_CUTOVER_AUTHORITY_REFUSED';
      error.refusals = authority.refusals;
      throw error;
    }

    const sequence = await client.query(
      `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_sequence
         FROM payout_v2_cutover_events
        WHERE school_id = $1`,
      [scopedSchoolId]
    );
    const sequenceNo = Number(sequence.rows[0].next_sequence);
    const eventFingerprint = fingerprint({
      school_id: scopedSchoolId,
      sequence_no: sequenceNo,
      event_type: 'engine_transition',
      from_engine: 'v1',
      to_engine: 'v2',
      readiness_fingerprint: readinessFingerprint,
      config_fingerprint: readinessRow.config_fingerprint,
      authority: authority.audit_context,
      evidence,
    });
    const inserted = await client.query(
      `INSERT INTO payout_v2_cutover_events (
         contract_version, school_id, sequence_no, event_type, status, event_identity,
         config_version_id, readiness_fingerprint, authority_class,
         operator_id, reason, event_fingerprint, evidence_json
       )
       VALUES ($1, $2, $3, 'engine_transition', 'recorded', $4, $5, $6,
               $7, $8, $9, $10, $11::jsonb)
       RETURNING id`,
      [
        CUTOVER_CONTRACT_VERSION,
        scopedSchoolId,
        sequenceNo,
        eventIdentity,
        readinessRow.config_version_id,
        readinessFingerprint,
        authority.authority_class,
        actor.id,
        authority.audit_context.reason,
        eventFingerprint,
        canonicalJson({
          from_engine: 'v1',
          to_engine: 'v2',
          config_fingerprint: readinessRow.config_fingerprint,
          authority: authority.audit_context,
          evidence,
        }),
      ]
    );
    const engineUpdate = await client.query(
      `UPDATE schools
          SET payout_engine_version = 'v2',
              updated_at = NOW()
        WHERE id = $1
          AND payout_engine_version = 'v1'`,
      [scopedSchoolId]
    );
    if (engineUpdate.rowCount !== 1) {
      throw new Error('School engine changed before cutover transition could commit');
    }
    return {
      idempotent_replay: false,
      event_id: Number(inserted.rows[0].id),
      school_id: scopedSchoolId,
      payout_engine_version: 'v2',
      readiness_fingerprint: readinessFingerprint,
      event_fingerprint: eventFingerprint,
    };
  });
}

module.exports = {
  CUTOVER_CONFIRMATION_PHRASE,
  CUTOVER_CONTRACT_VERSION,
  CUTOVER_OPERATIONS,
  CUTOVER_READINESS_MAX_AGE_MINUTES,
  FIRST_LIVE_CONFIRMATION_PHRASE,
  POST_BATCH_BLOCKERS,
  READINESS_BLOCKERS,
  buildCappedFirstBatchDryRun,
  buildCutoverConfig,
  buildRollbackControl,
  buildShadowCycleEvidence,
  evaluateCutoverReadiness,
  evaluateImmediatePostBatchReconciliation,
  fingerprintCutoverEvidence: fingerprint,
  transitionSchoolToPayoutV2,
};
