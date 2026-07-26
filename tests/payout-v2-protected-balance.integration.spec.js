// @ts-check
// Rollback-only database coverage for inactive Payout v2 Slice 6.
//
// Run:
//   CC_TEST_DB=1 npx playwright test tests/payout-v2-protected-balance.integration.spec.js

const { test, expect } = require('@playwright/test');
const { Client, neonConfig } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const {
  computePayoutV2ProtectedBalance,
  loadPayoutV2LiquidityEvidence,
} = require('../api/_payout-v2-protected-balance');

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
    ) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
})();

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'migrations', '035_payout_v2_ledger_foundation.sql'),
  'utf8'
);
const protectedBalanceDiagnosticSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'diagnostics', 'payout-v2-protected-balance.sql'),
  'utf8'
);
const hash = (letter) => `sha256:${letter.repeat(64)}`;

function sqlTag(client) {
  return async (strings, ...values) => {
    let text = '';
    for (let index = 0; index < strings.length; index += 1) {
      text += strings[index];
      if (index < values.length) text += `$${index + 1}`;
    }
    const result = await client.query(text, values);
    return result.rows;
  };
}

test.describe.configure({ mode: 'serial' });
test.describe('Payout v2 protected balance database contracts', () => {
  test.skip(!ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run rollback-only contracts');

  let client;
  let sql;
  let schoolId;
  let instructorId;
  let bookingId;
  let savepoint = 0;
  let failureSavepoint = 0;

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL === process.env.POSTGRES_URL_TEST) {
      throw new Error('Refusing integration tests: POSTGRES_URL_TEST equals POSTGRES_URL');
    }
    if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket === 'function') {
      neonConfig.webSocketConstructor = globalThis.WebSocket;
    }
    client = new Client({ connectionString: process.env.POSTGRES_URL_TEST });
    await client.connect();
    await client.query('BEGIN');
    await client.query(migrationSql);
    const fixture = await client.query(`
      SELECT lb.school_id, lb.instructor_id, lb.id AS booking_id
        FROM lesson_bookings lb
        JOIN instructors i ON i.id = lb.instructor_id AND i.school_id = lb.school_id
       ORDER BY lb.id
       LIMIT 1
    `);
    if (fixture.rowCount !== 1) throw new Error('A same-school booking fixture is required');
    ({ school_id: schoolId, instructor_id: instructorId, booking_id: bookingId } = fixture.rows[0]);
    sql = sqlTag(client);
  });

  test.beforeEach(async () => {
    if (!ENABLED) return;
    savepoint += 1;
    await client.query(`SAVEPOINT slice6_${savepoint}`);
    await client.query('SET CONSTRAINTS ALL DEFERRED');
  });

  test.afterEach(async () => {
    if (!ENABLED) return;
    await client.query(`ROLLBACK TO SAVEPOINT slice6_${savepoint}`);
  });

  test.afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  async function expectDatabaseRejection(work, pattern = /./) {
    failureSavepoint += 1;
    const name = `slice6_expected_failure_${failureSavepoint}`;
    await client.query(`SAVEPOINT ${name}`);
    let caught = null;
    try {
      await work();
    } catch (error) {
      caught = error;
    }
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    expect(caught).not.toBeNull();
    expect(String(caught.message)).toMatch(pattern);
  }

  test('config scope is explicit and configuration history is append-only', async () => {
    await client.query(`
      INSERT INTO payout_v2_liquidity_config_versions (
        school_id, scope_kind, risk_reserve_pence, effective_at,
        reason, operator_id, config_fingerprint
      ) VALUES (NULL, 'global', 2500, NOW(), 'Rollback-only global reserve', 1, $1)
    `, [hash('a')]);
    await expect(client.query(`
      UPDATE payout_v2_liquidity_config_versions SET risk_reserve_pence = 0
      WHERE config_fingerprint = $1
    `, [hash('a')])).rejects.toThrow(/financial history|forbidden/i);
  });

  test('tenant refund obligations require a real school and latest state drives exposure', async () => {
    await client.query(`
      INSERT INTO payout_v2_refund_obligation_events (
        school_id, logical_identity, sequence_no, state, amount_pence,
        evidence_status, reason, operator_id, event_fingerprint, occurred_at
      ) VALUES
        ($1, 'refund:test:one', 1, 'approved', 300, 'complete',
         'Rollback-only approval', 1, $2, NOW()),
        ($1, 'refund:test:one', 2, 'executed', 300, 'complete',
         'Rollback-only execution', 1, $3, NOW()),
        ($1, 'refund:test:two', 1, 'approved', 450, 'complete',
         'Rollback-only approval', 1, $4, NOW())
    `, [schoolId, hash('b'), hash('c'), hash('d')]);
    const evidence = await loadPayoutV2LiquidityEvidence(sql, {
      scope: { kind: 'school', school_id: schoolId },
    });
    expect(Number(evidence.obligations.approved_refund_pence)).toBe(450);
    await expect(client.query(`
      INSERT INTO payout_v2_refund_obligation_events (
        school_id, logical_identity, sequence_no, state, amount_pence,
        evidence_status, reason, operator_id, event_fingerprint, occurred_at
      ) VALUES (2147483647, 'refund:cross-school', 1, 'approved', 1,
                'complete', 'Cross-school refusal', 1, $1, NOW())
    `, [hash('e')])).rejects.toThrow();
  });

  test('authoritative aggregation separates unclaimed, ready, in-flight, refunds, and reserve', async () => {
    await client.query(`
      INSERT INTO payout_v2_liquidity_config_versions (
        school_id, scope_kind, risk_reserve_pence, effective_at,
        reason, operator_id, config_fingerprint
      ) VALUES (NULL, 'global', 400, NOW(), 'Rollback-only global reserve', 1, $1)
    `, [hash('f')]);
    const source = await client.query(`
      INSERT INTO payout_funding_sources (
        school_id, instructor_id, funding_class, gross_collected_pence,
        stripe_fee_pence, payable_pool_pence, refundable_pool_pence,
        source_status, source_fingerprint, occurred_at, metadata
      ) VALUES (
        $1, $2, 'platform_goodwill', 1000, 0, 1000, 0, 'available',
        $3, NOW(), '{"evidence_reference":"rollback-only"}'::jsonb
      ) RETURNING id
    `, [schoolId, instructorId, hash('1')]);
    const earning = await client.query(`
      INSERT INTO booking_earnings (
        school_id, booking_id, instructor_id, payout_route,
        gross_price_snapshot_pence, stripe_fee_snapshot_pence,
        instructor_earning_pence, platform_fee_pence,
        franchise_fee_allocation_pence, earning_status, earned_at,
        calculation_version, calculation_fingerprint, calculation_json
      ) VALUES (
        $1, $2, $3, 'instructor_direct', 1000, 0, 1000, 0, 0,
        'earned', NOW(), 'slice6-test', $4, '{}'::jsonb
      ) RETURNING id
    `, [schoolId, bookingId, instructorId, hash('2')]);
    await client.query(`
      INSERT INTO booking_earning_sources (
        school_id, booking_earning_id, funding_source_id,
        gross_contribution_pence, stripe_fee_contribution_pence,
        payable_contribution_pence, instructor_earning_contribution_pence,
        allocation_fingerprint
      ) VALUES ($1, $2, $3, 1000, 0, 1000, 1000, $4)
    `, [schoolId, earning.rows[0].id, source.rows[0].id, hash('3')]);
    await client.query(`
      INSERT INTO payout_batches (
        school_id, instructor_id, payout_route, period_start, period_end,
        gross_pence, stripe_fees_pence, platform_fee_pence,
        franchise_fee_pence, instructor_amount_pence, state,
        calculation_version, plan_fingerprint, plan_json, created_by_type
      ) VALUES (
        $1, $2, 'instructor_direct', CURRENT_DATE, CURRENT_DATE,
        200, 0, 0, 0, 200, 'planned',
        'slice6-test', $3, '{}'::jsonb, 'system'
      )
    `, [schoolId, instructorId, hash('4')]);
    await client.query(`
      INSERT INTO payout_v2_refund_obligation_events (
        school_id, logical_identity, sequence_no, state, amount_pence,
        evidence_status, reason, operator_id, event_fingerprint, occurred_at
      ) VALUES ($1, 'refund:slice6:approved', 1, 'approved', 300,
                'complete', 'Rollback-only approval', 1, $2, NOW())
    `, [schoolId, hash('5')]);

    const calculation = await computePayoutV2ProtectedBalance({
      sql,
      scope: { kind: 'global', school_id: null },
      now: () => new Date('2026-07-25T12:00:00.000Z'),
      readStripeBalance: async () => ({
        scope: { kind: 'global', school_id: null },
        available_pence: 10_000,
        pending_pence: 5_000,
        read_at: '2026-07-25T12:00:00.000Z',
      }),
      exactExposureProvider: async () => ({
        platform_refund_exposure_pence: 100,
        warnings: [],
        legacy_unknown_absorber_pence: 0,
        legacy_unpriced_pence: 0,
        unvalued_legacy_minutes: 0,
      }),
    });
    expect(calculation.components).toMatchObject({
      exact_unused_refundable_source_exposure_pence: 100,
      earned_untransferred_instructor_obligations_pence: 1200,
      submitted_reconciling_not_reflected_pence: 0,
      approved_unexecuted_refund_obligations_pence: 300,
      configured_dispute_refund_risk_reserve_pence: 400,
    });
    expect(calculation.transfer_readiness_pence).toBe(9800);
    expect(calculation.protected_free_cash_pence).toBe(8000);
  });

  test('snapshot/operator/alert evidence is immutable and globally idempotent', async () => {
    await client.query(`
      INSERT INTO payout_v2_protected_balance_snapshots (
        scope_kind, snapshot_identity, calculation_version,
        calculation_fingerprint, position_fingerprint, input_timestamp,
        stripe_available_pence, stripe_pending_pence,
        protected_free_cash_pence, transfer_readiness_pence,
        calculation_json, authority_class, evidence_fingerprint
      ) VALUES (
        'global', 'snapshot:2026-07-25T12:00Z', 'slice6-test',
        $1, $2, NOW(), 100, 50, -25, 75, '{}'::jsonb, 'cron', $3
      )
    `, [hash('6'), hash('7'), hash('8')]);
    await expectDatabaseRejection(
      () => client.query(`
        DELETE FROM payout_v2_protected_balance_snapshots
        WHERE snapshot_identity = 'snapshot:2026-07-25T12:00Z'
      `),
      /financial history|forbidden/i
    );

    await client.query(`
      INSERT INTO payout_v2_operator_evidence (
        scope_kind, evidence_type, logical_identity, authority_class,
        reason, calculation_fingerprint, proposed_amount_pence,
        before_protected_balance_pence, after_protected_balance_pence,
        decision, evidence_fingerprint, evidence_json
      ) VALUES (
        'global', 'withdrawal_preflight', 'withdrawal:test:one', 'superadmin',
        'Rollback-only preflight', $1, 10, 100, 90, 'approved', $2, '{}'::jsonb
      )
    `, [hash('6'), hash('9')]);
    await expectDatabaseRejection(
      () => client.query(`
        INSERT INTO payout_v2_operator_evidence (
          scope_kind, evidence_type, logical_identity, authority_class,
          reason, decision, evidence_fingerprint, evidence_json
        ) VALUES (
          'global', 'mutation_refusal', 'withdrawal:test:one', 'superadmin',
          'Conflicting replay', 'refused', $1, '{}'::jsonb
        )
      `, [hash('0')]),
      /duplicate|unique/i
    );
  });

  test('alert claim deduplication prevents repeated snapshot storms', async () => {
    await client.query(`
      INSERT INTO payout_v2_protected_balance_alert_events (
        scope_kind, alert_identity, event_identity, phase, classification,
        status, calculation_fingerprint, position_fingerprint,
        protected_free_cash_pence, event_fingerprint, evidence_json
      ) VALUES (
        'global', $1, 'alert:test:claim', 'claim', 'ordinary_liability_growth',
        'claimed', $2, $3, -1, $4, '{}'::jsonb
      )
    `, [hash('a'), hash('b'), hash('c'), hash('d')]);
    await expect(client.query(`
      INSERT INTO payout_v2_protected_balance_alert_events (
        scope_kind, alert_identity, event_identity, phase, classification,
        status, calculation_fingerprint, position_fingerprint,
        protected_free_cash_pence, event_fingerprint, evidence_json
      ) VALUES (
        'global', $1, 'alert:test:claim', 'claim', 'ordinary_liability_growth',
        'claimed', $2, $3, -1, $4, '{}'::jsonb
      )
    `, [hash('a'), hash('b'), hash('c'), hash('e')])).rejects.toThrow(/duplicate|unique/i);
  });

  test('the Slice 6 diagnostic executes read-only inside rollback', async () => {
    const before = await client.query(`
      SELECT COUNT(*)::int AS count FROM payout_v2_operator_evidence
    `);
    const results = await client.query(protectedBalanceDiagnosticSql);
    const after = await client.query(`
      SELECT COUNT(*)::int AS count FROM payout_v2_operator_evidence
    `);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(8);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
});
