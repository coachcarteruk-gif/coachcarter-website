// @ts-check
// Rollback-only Neon verification for inactive Payout v2 Slice 7 preparation.
//
// Run:
//   CC_TEST_DB=1 npx playwright test tests/payout-v2-cutover.integration.spec.js

const { test, expect } = require('@playwright/test');
const { Client, neonConfig } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const {
  CUTOVER_CONFIRMATION_PHRASE,
  CUTOVER_CONTRACT_VERSION,
  CUTOVER_OPERATIONS,
  buildCutoverConfig,
  buildShadowCycleEvidence,
  evaluateCutoverReadiness,
  transitionSchoolToPayoutV2,
} = require('../api/_payout-v2-cutover');

(function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
})();

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'migrations', '035_payout_v2_ledger_foundation.sql'),
  'utf8'
);
const diagnosticSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'diagnostics', 'payout-v2-cutover-readiness.sql'),
  'utf8'
);
const fp = (character) => `sha256:${character.repeat(64)}`;

test.describe.configure({ mode: 'serial' });
test.describe('Payout v2 controlled-cutover database contracts', () => {
  test.skip(!ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run database-backed contracts');

  let client;
  let schoolId;
  let instructorId;
  let savepointNumber = 0;

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (
      process.env.POSTGRES_URL
      && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL
    ) {
      throw new Error('Refusing Slice 7 integration tests: POSTGRES_URL_TEST equals POSTGRES_URL');
    }
    if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket === 'function') {
      neonConfig.webSocketConstructor = globalThis.WebSocket;
    }
    client = new Client({ connectionString: process.env.POSTGRES_URL_TEST });
    await client.connect();
    await client.query('BEGIN');
    await client.query(migrationSql);
    const fixture = await client.query(`
      SELECT s.id AS school_id, i.id AS instructor_id
        FROM schools s
        JOIN instructors i ON i.school_id = s.id
       WHERE s.active = TRUE
       ORDER BY s.id, i.id
       LIMIT 1
    `);
    if (fixture.rowCount !== 1) {
      throw new Error('Neon test branch needs one active school/instructor fixture');
    }
    schoolId = Number(fixture.rows[0].school_id);
    instructorId = Number(fixture.rows[0].instructor_id);
  });

  test.beforeEach(async () => {
    if (!ENABLED) return;
    savepointNumber += 1;
    await client.query(`SAVEPOINT payout_v2_cutover_${savepointNumber}`);
    await client.query(
      `UPDATE schools SET payout_engine_version = 'v1' WHERE id = $1`,
      [schoolId]
    );
  });

  test.afterEach(async () => {
    if (!ENABLED) return;
    await client.query(`ROLLBACK TO SAVEPOINT payout_v2_cutover_${savepointNumber}`);
  });

  test.afterAll(async () => {
    if (!ENABLED || !client) return;
    await client.query('ROLLBACK');
    await client.end();
  });

  function makeConfig(overrides = {}) {
    return buildCutoverConfig({
      school_id: schoolId,
      version_no: 1,
      payout_route: 'instructor_direct',
      first_live_instructor_id: instructorId,
      first_live_cap_pence: 2500,
      mutation_operator_id: 4041,
      mutation_operator_authority_class: 'scoped_operator',
      operator_allowed_operations: [
        CUTOVER_OPERATIONS.ENGINE_TRANSITION,
        CUTOVER_OPERATIONS.FIRST_LIVE_BATCH,
        CUTOVER_OPERATIONS.ROLLBACK_CONTROL,
      ],
      risk_reserve_config_fingerprint: fp('a'),
      protected_balance_calculation_fingerprint: fp('b'),
      protected_balance_scope_kind: 'global',
      route_evidence_reference: 'test:route-owner-decision',
      external_cash_classification: 'complete',
      external_cash_evidence_reference: 'test:external-cash-classified',
      setmore_classification: 'not_applicable',
      setmore_evidence_reference: 'test:setmore-not-applicable',
      owner_approved_by: 'test-platform-owner',
      owner_approved_at: '2026-07-26T10:00:00.000Z',
      owner_approval_reference: 'test:owner-approval',
      rollback_criteria: { ambiguous_transfer: 'freeze_and_reconcile' },
      ...overrides,
    });
  }

  async function insertConfig(config = makeConfig()) {
    const result = await client.query(
      `INSERT INTO payout_v2_cutover_config_versions (
         contract_version, school_id, version_no, payout_route, first_live_instructor_id,
         first_live_cap_pence, mutation_operator_id,
         mutation_operator_authority_class, operator_allowed_operations,
         risk_reserve_config_fingerprint,
         protected_balance_calculation_fingerprint, protected_balance_scope_kind,
         route_evidence_reference,
         external_cash_classification, external_cash_evidence_reference,
         setmore_classification, setmore_evidence_reference,
         owner_approved_by, owner_approved_at, owner_approval_reference,
         rollback_criteria, config_fingerprint
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20, $21::jsonb, $22
       )
       RETURNING id`,
      [
        config.contract_version,
        config.school_id,
        config.version_no,
        config.payout_route,
        config.first_live_instructor_id,
        config.first_live_cap_pence,
        config.mutation_operator_id,
        config.mutation_operator_authority_class,
        JSON.stringify(config.operator_allowed_operations),
        config.risk_reserve_config_fingerprint,
        config.protected_balance_calculation_fingerprint,
        config.protected_balance_scope_kind,
        config.route_evidence_reference,
        config.external_cash_classification,
        config.external_cash_evidence_reference,
        config.setmore_classification,
        config.setmore_evidence_reference,
        config.owner_approved_by,
        config.owner_approved_at,
        config.owner_approval_reference,
        JSON.stringify(config.rollback_criteria),
        config.config_fingerprint,
      ]
    );
    return { config, id: Number(result.rows[0].id) };
  }

  function makeShadow(ordinal) {
    return buildShadowCycleEvidence({
      school_id: schoolId,
      cycle_ordinal: ordinal,
      period_start: ordinal === 1 ? '2026-07-17' : '2026-07-24',
      period_end: ordinal === 1 ? '2026-07-17' : '2026-07-24',
      shadow_statement_fingerprint: ordinal === 1 ? fp('c') : fp('d'),
      v1_preview_fingerprint: ordinal === 1 ? fp('e') : fp('f'),
      comparison_fingerprint: ordinal === 1 ? fp('1') : fp('2'),
      unexplained_difference_count: 0,
      ambiguous_source_count: 0,
      decision: 'accepted',
      owner_approved_by: 'test-platform-owner',
      owner_approved_at: '2026-07-26T10:00:00.000Z',
      evidence_reference: `test:shadow-${ordinal}`,
    });
  }

  async function insertShadow(shadow) {
    await client.query(
      `INSERT INTO payout_v2_shadow_cycle_evidence (
         contract_version, school_id, cycle_ordinal, period_start, period_end,
         shadow_statement_fingerprint, v1_preview_fingerprint,
         comparison_fingerprint, unexplained_difference_count,
         ambiguous_source_count, decision, owner_approved_by,
         owner_approved_at, evidence_reference, evidence_fingerprint
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        shadow.contract_version,
        shadow.school_id,
        shadow.cycle_ordinal,
        shadow.period_start,
        shadow.period_end,
        shadow.shadow_statement_fingerprint,
        shadow.v1_preview_fingerprint,
        shadow.comparison_fingerprint,
        shadow.unexplained_difference_count,
        shadow.ambiguous_source_count,
        shadow.decision,
        shadow.owner_approved_by,
        shadow.owner_approved_at,
        shadow.evidence_reference,
        shadow.evidence_fingerprint,
      ]
    );
  }

  async function insertReadyFixture() {
    await client.query(
      `INSERT INTO payout_v2_liquidity_config_versions (
         school_id, scope_kind, risk_reserve_pence, effective_at, reason,
         operator_id, config_fingerprint, evidence_json
       )
       VALUES (NULL, 'global', 500, NOW(),
               'Rollback-only Slice 7 reserve fixture', 4041, $1, $2::jsonb)`,
      [fp('a'), JSON.stringify({ test_only: true })]
    );
    await client.query(
      `INSERT INTO payout_v2_protected_balance_snapshots (
         school_id, scope_kind, snapshot_identity, calculation_version,
         calculation_fingerprint, position_fingerprint, input_timestamp,
         stripe_available_pence, stripe_pending_pence,
         protected_free_cash_pence, transfer_readiness_pence,
         calculation_json, blocker_codes, authority_class,
         evidence_fingerprint
       )
       VALUES (NULL, 'global', $1, 'test-protected-v1', $2, $3, NOW(),
               5000, 0, 2500, 2500, $4::jsonb, '[]'::jsonb,
               'scoped_operator', $5)`,
      [
        `test:cutover-protected:${schoolId}:${savepointNumber}`,
        fp('b'),
        fp('9'),
        JSON.stringify({ test_only: true, school_id: schoolId }),
        fp('8'),
      ]
    );
    const { config, id: configId } = await insertConfig();
    const shadows = [makeShadow(1), makeShadow(2)];
    await insertShadow(shadows[0]);
    await insertShadow(shadows[1]);
    const readiness = evaluateCutoverReadiness({
      school_id: schoolId,
      payout_engine_version: 'v1',
      config,
      shadow_cycles: shadows,
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
    });
    expect(readiness.status).toBe('ready');
    await client.query(
      `INSERT INTO payout_v2_cutover_readiness_snapshots (
         contract_version, school_id, config_version_id, status, readiness_fingerprint,
         payout_engine_version, protected_balance_calculation_fingerprint,
         protected_balance_position_fingerprint, shadow_cycle_fingerprints,
         blocker_codes, diagnostics_json, evidence_json
       )
       VALUES ($1, $2, $3, $4, $5, 'v1', $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb)`,
      [
        readiness.contract_version,
        schoolId,
        configId,
        readiness.status,
        readiness.readiness_fingerprint,
        readiness.protected_balance_calculation_fingerprint,
        readiness.protected_balance_position_fingerprint,
        JSON.stringify(readiness.shadow_cycle_fingerprints),
        JSON.stringify(readiness.blockers),
        JSON.stringify(readiness.diagnostics),
        JSON.stringify(readiness),
      ]
    );
    return { config, configId, readiness };
  }

  test('same-school foreign key rejects a cross-tenant first-live instructor', async () => {
    await client.query(
      `INSERT INTO migration_markers (key, notes)
       VALUES ('public_endpoints_tenant_resolved',
               'rollback-only payout v2 cross-school FK test fixture')
       ON CONFLICT (key) DO NOTHING`
    );
    const otherSchool = await client.query(
      `INSERT INTO schools (name, slug, active)
       VALUES ('Payout v2 cross-school fixture', $1, TRUE)
       RETURNING id`,
      [`payout-v2-cutover-fixture-${savepointNumber}`]
    );
    const other = await client.query(
      `INSERT INTO instructors (name, email, school_id, active)
       VALUES ('Cross-school instructor', $1, $2, TRUE)
       RETURNING id, school_id`,
      [
        `payout-v2-cross-school-${savepointNumber}@example.invalid`,
        Number(otherSchool.rows[0].id),
      ]
    );
    const config = makeConfig({
      first_live_instructor_id: Number(other.rows[0].id),
    });
    await expect(insertConfig(config)).rejects.toMatchObject({ code: '23503' });
  });

  test('shadow decisions are unique per cycle and accepted evidence cannot be ambiguous', async () => {
    await insertShadow(makeShadow(1));
    await expect(insertShadow(makeShadow(1))).rejects.toMatchObject({ code: '23505' });
    await client.query('ROLLBACK TO SAVEPOINT payout_v2_cutover_' + savepointNumber);
    await expect(
      client.query(
        `INSERT INTO payout_v2_shadow_cycle_evidence (
           contract_version, school_id, cycle_ordinal, period_start, period_end,
           shadow_statement_fingerprint, v1_preview_fingerprint,
           comparison_fingerprint, unexplained_difference_count,
           ambiguous_source_count, decision, owner_approved_by,
           owner_approved_at, evidence_reference, evidence_fingerprint
         )
         VALUES ($1, $2, 1, DATE '2026-07-17', DATE '2026-07-17',
                 $3, $4, $5, 0, 1, 'accepted', 'owner', NOW(), 'test', $6)`,
        [CUTOVER_CONTRACT_VERSION, schoolId, fp('c'), fp('e'), fp('1'), fp('7')]
      )
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('config, shadow and readiness evidence are append-only', async () => {
    const { configId } = await insertReadyFixture();
    await expect(
      client.query(
        `UPDATE payout_v2_cutover_config_versions
            SET first_live_cap_pence = first_live_cap_pence + 1
          WHERE id = $1`,
        [configId]
      )
    ).rejects.toThrow(/append-only/);
  });

  test('named authority transition is transactional, idempotent and refuses school admins', async () => {
    const { readiness } = await insertReadyFixture();
    const transitionInput = {
      schoolId,
      readinessFingerprint: readiness.readiness_fingerprint,
      actor: {
        id: 4041,
        authenticated: true,
        authority_class: 'scoped_operator',
        configuration_present: true,
        allowed_operations: [CUTOVER_OPERATIONS.ENGINE_TRANSITION],
        allowed_school_ids: [schoolId],
        allow_global: false,
      },
      reason: 'Owner-approved controlled first-school cutover',
      confirmationPhrase: CUTOVER_CONFIRMATION_PHRASE,
      idempotencyIdentity:
        `payout-v2:cutover:school-${schoolId}:${readiness.readiness_fingerprint}`,
      eventIdentity: `test:cutover:${schoolId}:${readiness.readiness_fingerprint}`,
      evidence: { test_only: true, no_stripe_call: true },
      runInTransaction: async (work) => work(client),
    };

    await expect(
      transitionSchoolToPayoutV2({
        ...transitionInput,
        actor: {
          id: 4041,
          authenticated: true,
          authority_class: 'school_admin',
        },
      })
    ).rejects.toThrow(/owner-approved mutation operator/);

    const result = await transitionSchoolToPayoutV2(transitionInput);
    expect(result.payout_engine_version).toBe('v2');
    const school = await client.query(
      `SELECT payout_engine_version FROM schools WHERE id = $1`,
      [schoolId]
    );
    expect(school.rows[0].payout_engine_version).toBe('v2');
    const event = await client.query(
      `SELECT event_type, status FROM payout_v2_cutover_events WHERE id = $1`,
      [result.event_id]
    );
    expect(event.rows[0]).toMatchObject({
      event_type: 'engine_transition',
      status: 'recorded',
    });

    const replay = await transitionSchoolToPayoutV2(transitionInput);
    expect(replay.idempotent_replay).toBe(true);
    const eventCount = await client.query(
      `SELECT COUNT(*)::integer AS count
         FROM payout_v2_cutover_events
        WHERE event_identity = $1`,
      [transitionInput.eventIdentity]
    );
    expect(eventCount.rows[0].count).toBe(1);
  });

  test('cutover diagnostic executes read-only for one explicit school', async () => {
    await insertReadyFixture();
    const rendered = diagnosticSql.replace(/:'school_id'/g, String(schoolId));
    const before = await client.query(
      `SELECT COUNT(*)::integer AS count FROM payout_v2_cutover_events WHERE school_id = $1`,
      [schoolId]
    );
    const result = await client.query(rendered);
    const after = await client.query(
      `SELECT COUNT(*)::integer AS count FROM payout_v2_cutover_events WHERE school_id = $1`,
      [schoolId]
    );
    expect(result.rowCount).toBe(1);
    expect(Number(result.rows[0].school_id)).toBe(schoolId);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
});
