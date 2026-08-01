const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  CUTOVER_OPERATIONS,
  READINESS_BLOCKERS,
  buildCappedFirstBatchDryRun,
  buildCutoverConfig,
  buildRollbackControl,
  buildShadowCycleEvidence,
  evaluateCutoverReadiness,
  evaluateImmediatePostBatchReconciliation,
} = require('../api/_payout-v2-cutover');
const {
  V1_DISABLED_CODE,
  assertV1PayoutEngine,
} = require('../api/_payout-engine-version');
const {
  processPayoutForInstructor,
} = require('../api/_payout-helpers');

const fp = (character) => `sha256:${character.repeat(64)}`;

function approvedConfig(overrides = {}) {
  return buildCutoverConfig({
    school_id: 1,
    version_no: 1,
    payout_route: 'instructor_direct',
    first_live_instructor_id: 11,
    first_live_cap_pence: 2500,
    mutation_operator_id: 41,
    mutation_operator_authority_class: 'scoped_operator',
    operator_allowed_operations: [
      CUTOVER_OPERATIONS.ENGINE_TRANSITION,
      CUTOVER_OPERATIONS.FIRST_LIVE_BATCH,
      CUTOVER_OPERATIONS.ROLLBACK_CONTROL,
    ],
    risk_reserve_config_fingerprint: fp('a'),
    protected_balance_calculation_fingerprint: fp('b'),
    protected_balance_scope_kind: 'global',
    route_evidence_reference: 'owner-decision:school-1-direct',
    external_cash_classification: 'complete',
    external_cash_evidence_reference: 'forensic:external-cash-2026-07-26',
    setmore_classification: 'not_applicable',
    setmore_evidence_reference: 'forensic:setmore-not-applicable',
    owner_approved_by: 'platform-owner',
    owner_approved_at: '2026-07-26T10:00:00.000Z',
    owner_approval_reference: 'approval:payout-v2-cutover-v1',
    rollback_criteria: {
      ambiguous_transfer: 'freeze',
      negative_protected_cash: 'freeze',
      v1_overlap: 'freeze',
    },
    ...overrides,
  });
}

function acceptedShadow(ordinal, overrides = {}) {
  return buildShadowCycleEvidence({
    school_id: 1,
    cycle_ordinal: ordinal,
    period_start: ordinal === 1 ? '2026-07-17' : '2026-07-24',
    period_end: ordinal === 1 ? '2026-07-17' : '2026-07-24',
    shadow_statement_fingerprint: ordinal === 1 ? fp('c') : fp('d'),
    v1_preview_fingerprint: ordinal === 1 ? fp('e') : fp('f'),
    comparison_fingerprint: ordinal === 1 ? fp('1') : fp('2'),
    unexplained_difference_count: 0,
    ambiguous_source_count: 0,
    decision: 'accepted',
    owner_approved_by: 'platform-owner',
    owner_approved_at: '2026-07-26T10:00:00.000Z',
    evidence_reference: `shadow-friday-${ordinal}`,
    ...overrides,
  });
}

function readyEvidence(overrides = {}) {
  const config = overrides.config || approvedConfig();
  return evaluateCutoverReadiness({
    school_id: 1,
    payout_engine_version: 'v1',
    config,
    shadow_cycles: [acceptedShadow(1), acceptedShadow(2)],
    protected_balance: {
      scope_kind: 'global',
      school_id: null,
      calculation_fingerprint: fp('b'),
      position_fingerprint: fp('9'),
      risk_reserve_config_fingerprint: fp('a'),
      complete: true,
      blocker_codes: [],
      transfer_readiness_pence: 2500,
    },
    diagnostics: {
      cross_school_violation_count: 0,
      cross_route_claim_count: 0,
      legacy_positive_count: 0,
      ambiguous_external_cash_count: 0,
      unresolved_transfer_count: 0,
      active_incident_count: 0,
    },
    ...overrides,
  });
}

test.describe('Payout v2 controlled-cutover preparation contracts', () => {
  test('requires two distinct, accepted, zero-ambiguity shadow cycles', () => {
    const config = approvedConfig();
    const result = readyEvidence({
      config,
      shadow_cycles: [
        acceptedShadow(1),
        acceptedShadow(2, {
          period_start: '2026-07-17',
          shadow_statement_fingerprint: fp('c'),
        }),
      ],
    });
    expect(result.status).toBe('blocked');
    expect(result.blockers.map((item) => item.code)).toContain(
      READINESS_BLOCKERS.SHADOW_CYCLES_NOT_DISTINCT
    );

    const ambiguous = buildShadowCycleEvidence({
      school_id: 1,
      cycle_ordinal: 2,
      period_start: '2026-07-24',
      period_end: '2026-07-24',
      shadow_statement_fingerprint: fp('d'),
      v1_preview_fingerprint: fp('f'),
      comparison_fingerprint: fp('2'),
      unexplained_difference_count: 0,
      ambiguous_source_count: 1,
      decision: 'accepted',
      owner_approved_by: 'platform-owner',
      owner_approved_at: '2026-07-26T10:00:00.000Z',
      evidence_reference: 'shadow-friday-2',
    });
    expect(ambiguous.decision).toBe('rejected');
  });

  test('blocks missing owner decisions instead of supplying cutover defaults', () => {
    const config = {
      ...approvedConfig(),
      owner_approved_by: null,
      owner_approved_at: null,
      owner_approval_reference: null,
      external_cash_classification: 'pending',
      setmore_classification: 'pending',
    };
    const rebuilt = buildCutoverConfig(config);
    config.config_fingerprint = rebuilt.config_fingerprint;
    const result = readyEvidence({ config });
    const codes = result.blockers.map((item) => item.code);
    expect(codes).toContain(READINESS_BLOCKERS.OWNER_APPROVAL_MISSING);
    expect(codes).toContain(
      READINESS_BLOCKERS.EXTERNAL_CASH_CLASSIFICATION_INCOMPLETE
    );
    expect(codes).toContain(READINESS_BLOCKERS.SETMORE_CLASSIFICATION_INCOMPLETE);
  });

  test('accepts only the configured school, route, instructor, fingerprint and hard cap', () => {
    const config = approvedConfig();
    const readiness = readyEvidence({ config });
    expect(readiness.status).toBe('ready');
    expect(readiness.mutation_allowed).toBe(false);
    expect(readiness.stripe_call_allowed).toBe(false);

    const plan = {
      school_id: 1,
      payout_route: 'instructor_direct',
      destination_instructor_id: 11,
      plan_fingerprint: fp('3'),
      totals: { net_shadow_transfer_pence: 2400 },
    };
    const dryRun = buildCappedFirstBatchDryRun({ readiness, config, plan });
    expect(dryRun.cap_policy).toBe('hard_block_no_truncation_no_partial_claims');
    expect(dryRun.dry_run_only).toBe(true);
    expect(dryRun.stripe_call_allowed).toBe(false);

    expect(() =>
      buildCappedFirstBatchDryRun({
        readiness,
        config,
        plan: {
          ...plan,
          totals: { net_shadow_transfer_pence: 2501 },
        },
      })
    ).toThrow(/hard cap/);
    expect(() =>
      buildCappedFirstBatchDryRun({
        readiness,
        config,
        plan: { ...plan, school_id: 2 },
      })
    ).toThrow(/school scope/);
  });

  test('makes Stripe transfer reconciliation distinct from bank settlement', () => {
    const result = evaluateImmediatePostBatchReconciliation({
      school_id: 1,
      payout_batch_id: 22,
      transfer_state: 'transferred',
      ambiguous: false,
      local_transfer_id: 'tr_local',
      stripe_transfer_id: 'tr_local',
      local_amount_pence: 2400,
      stripe_amount_pence: 2400,
      local_idempotency_key: 'idem-1',
      stripe_idempotency_key: 'idem-1',
      expected_plan_fingerprint: fp('3'),
      actual_plan_fingerprint: fp('3'),
      unresolved_reconciliation_count: 0,
      v1_overlap_count: 0,
      protected_free_cash_pence: 1000,
      connected_bank_status: 'pending',
    });
    expect(result.status).toBe('reconciled');
    expect(result.transfer_is_not_bank_settlement).toBe(true);
    expect(result.bank_settlement_confirmed).toBe(false);
  });

  test('rollback freezes new work while retaining claims and reconciliation', () => {
    const control = buildRollbackControl({
      school_id: 1,
      trigger_codes: ['AMBIGUOUS_TRANSFER'],
      reason: 'Transfer outcome requires operator reconciliation',
    });
    expect(control.actions.freeze_new_v2_batches).toBe(true);
    expect(control.actions.keep_webhooks_running).toBe(true);
    expect(control.actions.keep_reconciliation_running).toBe(true);
    expect(control.actions.retain_all_claims_and_ledger_rows).toBe(true);
    expect(control.actions.permit_new_v1_mutation).toBe(false);
    expect(control.actions.release_ambiguous_claims).toBe(false);
  });
});

test.describe('Payout engine route isolation', () => {
  test('v1 guard refuses a v2 school before a booking read, write, or Stripe call', async () => {
    const queries = [];
    const sql = async (strings) => {
      const query = strings.join('?');
      queries.push(query);
      if (query.includes('payout_engine_version') && query.includes('FROM schools')) {
        return [{ payout_engine_version: 'v2' }];
      }
      throw new Error(`Unexpected query after v1 refusal: ${query}`);
    };
    let stripeCalls = 0;
    const stripe = {
      transfers: {
        create: async () => {
          stripeCalls += 1;
          return { id: 'tr_should_not_exist' };
        },
      },
    };
    await expect(
      processPayoutForInstructor(sql, stripe, {
        id: 11,
        school_id: 1,
        name: 'Instructor',
      })
    ).rejects.toMatchObject({ code: V1_DISABLED_CODE });
    expect(queries).toHaveLength(1);
    expect(stripeCalls).toBe(0);
  });

  test('v1 guard requires an explicit school and accepts only engine v1', async () => {
    await expect(assertV1PayoutEngine(async () => [], null)).rejects.toMatchObject({
      code: 'PAYOUT_SCHOOL_SCOPE_REQUIRED',
    });
    const sql = async () => [{ payout_engine_version: 'v1' }];
    await expect(assertV1PayoutEngine(sql, 7)).resolves.toEqual({
      school_id: 7,
      payout_engine_version: 'v1',
    });
  });

  test('inactive cutover mutation is absent from live routes', () => {
    const root = path.resolve(__dirname, '..');
    const liveFiles = [
      'api/admin.js',
      'api/cron-payouts.js',
      'api/webhook.js',
      'api/slots.js',
      'api/offers.js',
    ];
    for (const relative of liveFiles) {
      const source = fs.readFileSync(path.join(root, relative), 'utf8');
      expect(source).not.toContain('_payout-v2-cutover');
      expect(source).not.toContain('transitionSchoolToPayoutV2');
    }
  });

  test('Slice 7 schema is mirrored and its diagnostic is read-only and scoped', () => {
    const root = path.resolve(__dirname, '..');
    const migration = fs.readFileSync(
      path.join(root, 'db/migrations/035_payout_v2_ledger_foundation.sql'),
      'utf8'
    );
    const aggregate = fs.readFileSync(path.join(root, 'db/migration.sql'), 'utf8');
    const marker = '-- Instructor Payout v2: inactive, append-only ledger foundation.';
    const nextMigrationMarker = '-- Stripe Connect Simon launch: inert Slice 1 schema foundation.';
    const start = aggregate.indexOf(marker);
    const end = aggregate.indexOf(nextMigrationMarker, start);
    expect(end).toBeGreaterThan(start);
    expect(aggregate.slice(start, end).replace(/\r\n/g, '\n').trim()).toBe(
      migration.replace(/\r\n/g, '\n').trim()
    );
    for (const table of [
      'payout_v2_cutover_config_versions',
      'payout_v2_shadow_cycle_evidence',
      'payout_v2_cutover_readiness_snapshots',
      'payout_v2_cutover_events',
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(migration).toContain(`${table}_append_only`);
    }

    const diagnostic = fs.readFileSync(
      path.join(root, 'db/diagnostics/payout-v2-cutover-readiness.sql'),
      'utf8'
    );
    expect(diagnostic).toContain(":'school_id'::integer");
    expect(diagnostic).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i);
  });
});
