const { computePlatformBalance } = require('./_platform-balance');
const {
  computePayoutV2ProtectedBalance,
  calculateWithdrawalPreflight,
  sha256,
} = require('./_payout-v2-protected-balance');

async function computeInactivePlatformBalanceV2({
  sql,
  stripe,
  scope,
  readStripeBalance,
  now,
  exactExposureProvider,
  liquidityEvidenceProvider,
  legacyBalanceAuthority = computePlatformBalance,
  protectedBalanceAuthority = computePayoutV2ProtectedBalance,
}) {
  const schoolId = scope.kind === 'school' ? scope.school_id : undefined;
  const [legacy, protectedBalance] = await Promise.all([
    legacyBalanceAuthority(sql, stripe, { schoolId }),
    protectedBalanceAuthority({
      sql,
      scope,
      readStripeBalance,
      now,
      exactExposureProvider,
      liquidityEvidenceProvider,
    }),
  ]);
  return {
    ...legacy,
    payout_v2_protected_balance: protectedBalance,
    protected_free_cash_pence: protectedBalance.protected_free_cash_pence,
    transfer_readiness_pence: protectedBalance.transfer_readiness_pence,
    protected_balance_components: protectedBalance.components,
    protected_balance_blockers: protectedBalance.blockers,
    protected_balance_calculation_version: protectedBalance.calculation_version,
    protected_balance_calculation_fingerprint: protectedBalance.calculation_fingerprint,
    protected_balance_inactive: true,
  };
}

async function persistProtectedBalanceSnapshot(sql, {
  calculation,
  snapshot_identity,
  authority_class,
}) {
  if (!calculation?.calculation_fingerprint) throw new Error('calculation fingerprint is required');
  if (typeof snapshot_identity !== 'string' || !snapshot_identity.trim()) {
    throw new Error('snapshot_identity is required');
  }
  if (!['cron', 'superadmin', 'scoped_operator'].includes(authority_class)) {
    throw new Error('authority_class is invalid');
  }
  const evidenceFingerprint = sha256({
    snapshot_identity,
    calculation_fingerprint: calculation.calculation_fingerprint,
    scope: calculation.scope,
  });
  const [row] = await sql`
    INSERT INTO payout_v2_protected_balance_snapshots (
      school_id, scope_kind, snapshot_identity, calculation_version,
      calculation_fingerprint, position_fingerprint, input_timestamp,
      stripe_available_pence, stripe_pending_pence,
      protected_free_cash_pence, transfer_readiness_pence,
      calculation_json, blocker_codes, authority_class, evidence_fingerprint
    )
    VALUES (
      ${calculation.scope.school_id},
      ${calculation.scope.kind},
      ${snapshot_identity.trim()},
      ${calculation.calculation_version},
      ${calculation.calculation_fingerprint},
      ${calculation.position_fingerprint},
      ${calculation.input_timestamp},
      ${calculation.stripe_available_pence},
      ${calculation.stripe_pending_pence},
      ${calculation.protected_free_cash_pence},
      ${calculation.transfer_readiness_pence},
      ${JSON.stringify(calculation)}::jsonb,
      ${JSON.stringify(calculation.blockers.map((blocker) => blocker.code))}::jsonb,
      ${authority_class},
      ${evidenceFingerprint}
    )
    ON CONFLICT (snapshot_identity) DO NOTHING
    RETURNING *
  `;
  if (row) return { inserted: true, snapshot: row };
  const [existing] = await sql`
    SELECT *
      FROM payout_v2_protected_balance_snapshots
     WHERE snapshot_identity = ${snapshot_identity.trim()}
  `;
  if (!existing || existing.calculation_fingerprint !== calculation.calculation_fingerprint) {
    throw new Error('snapshot identity replay conflicts with immutable calculation evidence');
  }
  return { inserted: false, replay: true, snapshot: existing };
}

async function persistWithdrawalPreflightEvidence(sql, {
  preflight,
  authority,
  reason,
  confirmation_fingerprint,
}) {
  if (!preflight?.preflight_fingerprint) throw new Error('preflight fingerprint is required');
  if (!authority?.authority_class) throw new Error('authority evidence is required');
  const schoolId = preflight.scope.school_id;
  const authorityRefusalCodes = (authority.refusals || [])
    .map((refusal) => refusal?.code)
    .filter(Boolean);
  const preflightRefusalCodes = (preflight.blockers || [])
    .map((blocker) => blocker?.code)
    .filter(Boolean);
  const refusalCodes = [...new Set([
    ...authorityRefusalCodes,
    ...preflightRefusalCodes,
  ])].sort();
  const approved = authority.allowed === true
    && preflight.allowed === true
    && refusalCodes.length === 0;
  const operatorId = authority.audit_context?.actor_id ?? authority.actor_id ?? null;
  const recordedReason = reason || authority.audit_context?.reason;
  const confirmationFingerprint = confirmation_fingerprint
    || authority.audit_context?.confirmation_fingerprint
    || null;
  const expectedCalculationFingerprint = authority.audit_context?.expected_fingerprint
    || preflight.calculation_fingerprint;
  const [row] = await sql`
    INSERT INTO payout_v2_operator_evidence (
      school_id, scope_kind, evidence_type, logical_identity,
      authority_class, operator_id, reason, confirmation_fingerprint,
      expected_calculation_fingerprint, calculation_fingerprint,
      proposed_amount_pence, before_protected_balance_pence,
      after_protected_balance_pence, decision, refusal_codes,
      evidence_fingerprint, evidence_json
    )
    VALUES (
      ${schoolId},
      ${preflight.scope.kind},
      'withdrawal_preflight',
      ${preflight.idempotency_identity},
      ${authority.authority_class},
      ${operatorId},
      ${recordedReason},
      ${confirmationFingerprint},
      ${expectedCalculationFingerprint},
      ${preflight.calculation_fingerprint},
      ${preflight.proposed_withdrawal_pence},
      ${preflight.protected_free_cash_pence},
      ${preflight.projected_protected_free_cash_pence},
      ${approved ? 'approved' : 'refused'},
      ${JSON.stringify(refusalCodes)}::jsonb,
      ${preflight.preflight_fingerprint},
      ${JSON.stringify({
        preflight,
        authority: {
          allowed: authority.allowed === true,
          authority_class: authority.authority_class,
          operation: authority.operation || null,
          refusals: authority.refusals || [],
          audit_context: authority.audit_context || null,
        },
      })}::jsonb
    )
    ON CONFLICT (logical_identity) DO NOTHING
    RETURNING *
  `;
  if (row) return { inserted: true, evidence: row };
  const [existing] = await sql`
    SELECT *
      FROM payout_v2_operator_evidence
     WHERE logical_identity = ${preflight.idempotency_identity}
  `;
  if (!existing || existing.evidence_fingerprint !== preflight.preflight_fingerprint) {
    throw new Error('operator evidence identity replay conflicts with immutable preflight');
  }
  return { inserted: false, replay: true, evidence: existing };
}

async function persistProtectedBalanceAlertEvidence(sql, payload) {
  const { phase, alert } = payload;
  if (!['claim', 'result'].includes(phase)) throw new Error('alert evidence phase is invalid');
  const eventIdentity = `${alert.deduplication_identity}:${phase}`;
  const eventFingerprint = sha256({
    eventIdentity,
    status: payload.status || (phase === 'claim' ? 'claimed' : null),
    transport_reference: payload.transport_reference || null,
    failure_code: payload.failure_code || null,
  });
  const [row] = await sql`
    INSERT INTO payout_v2_protected_balance_alert_events (
      school_id, scope_kind, alert_identity, event_identity, phase,
      classification, status, calculation_fingerprint, position_fingerprint,
      protected_free_cash_pence, blocker_codes, transport_reference,
      failure_code, event_fingerprint, evidence_json
    )
    VALUES (
      ${alert.scope.school_id},
      ${alert.scope.kind},
      ${alert.deduplication_identity},
      ${eventIdentity},
      ${phase},
      ${alert.classification},
      ${payload.status || (phase === 'claim' ? 'claimed' : 'failed')},
      ${alert.calculation_fingerprint},
      ${alert.position_fingerprint},
      ${alert.protected_free_cash_pence},
      ${JSON.stringify(alert.blocker_codes)}::jsonb,
      ${payload.transport_reference || null},
      ${payload.failure_code || null},
      ${eventFingerprint},
      ${JSON.stringify({ alert, ...payload, alert: undefined })}::jsonb
    )
    ON CONFLICT (event_identity) DO NOTHING
    RETURNING *
  `;
  if (row) return { inserted: true, row };
  const [existing] = await sql`
    SELECT event_fingerprint
      FROM payout_v2_protected_balance_alert_events
     WHERE event_identity = ${eventIdentity}
  `;
  if (!existing || existing.event_fingerprint !== eventFingerprint) {
    throw new Error('alert evidence replay conflicts with immutable event');
  }
  return { duplicate: true };
}

function buildWithdrawalPreflightFromPlatformBalance(args) {
  const calculation = args.platformBalance?.payout_v2_protected_balance;
  if (!calculation) throw new Error('payout_v2_protected_balance is required');
  return calculateWithdrawalPreflight({ ...args, calculation });
}

module.exports = {
  buildWithdrawalPreflightFromPlatformBalance,
  computeInactivePlatformBalanceV2,
  persistProtectedBalanceAlertEvidence,
  persistProtectedBalanceSnapshot,
  persistWithdrawalPreflightEvidence,
};
