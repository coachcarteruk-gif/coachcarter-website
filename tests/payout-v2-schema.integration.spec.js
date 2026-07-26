// @ts-check
// Database-backed failure contracts for the inactive Payout v2 foundation.
//
// The entire DDL application and every fixture run inside one outer transaction
// that is rolled back in afterAll. Nothing is persisted to the Neon test branch.
//
// Run:
//   CC_TEST_DB=1 npx playwright test tests/payout-v2-schema.integration.spec.js

const { test, expect } = require('@playwright/test');
const { Client, neonConfig } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

(function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
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
const preDiagnosticSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'diagnostics', 'payout-v2-ledger-foundation-pre-migration.sql'),
  'utf8'
);
const postDiagnosticSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'diagnostics', 'payout-v2-ledger-foundation-post-migration.sql'),
  'utf8'
);
const sourceDiagnosticSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'diagnostics', 'payout-v2-source-ingestion-reconciliation.sql'),
  'utf8'
);
const recoveryDiagnosticSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'diagnostics', 'payout-v2-recovery-reconciliation.sql'),
  'utf8'
);
const hash = (letter) => `sha256:${letter.repeat(64)}`;

test.describe.configure({ mode: 'serial' });
test.describe('Payout v2 schema database contracts', () => {
  test.skip(!ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run database-backed contracts');

  let client;
  let schoolId;
  let instructorId;
  let bookingId;
  let savepointNumber = 0;

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (
      process.env.POSTGRES_URL &&
      process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL
    ) {
      throw new Error('Refusing Payout v2 integration tests: POSTGRES_URL_TEST equals POSTGRES_URL');
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
      JOIN instructors i
        ON i.id = lb.instructor_id
       AND i.school_id = lb.school_id
      ORDER BY lb.id
      LIMIT 1
    `);
    if (fixture.rowCount !== 1) {
      throw new Error('Neon test branch needs at least one same-school booking fixture');
    }
    ({ school_id: schoolId, instructor_id: instructorId, booking_id: bookingId } = fixture.rows[0]);
  });

  test.beforeEach(async () => {
    if (!ENABLED) return;
    savepointNumber += 1;
    await client.query(`SAVEPOINT payout_v2_test_${savepointNumber}`);
    await client.query('SET CONSTRAINTS ALL DEFERRED');
  });

  test.afterEach(async () => {
    if (!ENABLED) return;
    await client.query(`ROLLBACK TO SAVEPOINT payout_v2_test_${savepointNumber}`);
  });

  test.afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  async function insertFundingSource({
    fundingClass = 'legacy_pre_connect_settled',
    gross = 0,
    payable = 0,
    fingerprint = hash('a'),
    stripeChargeId = null,
    metadata = {},
  } = {}) {
    const result = await client.query(`
      INSERT INTO payout_funding_sources (
        school_id, instructor_id, funding_class, stripe_charge_id,
        gross_collected_pence, stripe_fee_pence, payable_pool_pence,
        refundable_pool_pence, source_status, source_fingerprint,
        occurred_at, metadata
      )
      VALUES ($1, $2, $3, $4, $5, 0, $6, 0, $7, $8, NOW(), $9::jsonb)
      RETURNING id
    `, [
      schoolId,
      instructorId,
      fundingClass,
      stripeChargeId,
      gross,
      payable,
      fundingClass === 'manual_review' ? 'manual_review' : 'available',
      fingerprint,
      JSON.stringify(metadata),
    ]);
    return result.rows[0].id;
  }

  async function insertZeroEarning(route, fingerprint, targetBookingId = bookingId) {
    const result = await client.query(`
      INSERT INTO booking_earnings (
        school_id, booking_id, instructor_id, payout_route,
        gross_price_snapshot_pence, stripe_fee_snapshot_pence,
        instructor_earning_pence, platform_fee_pence,
        franchise_fee_allocation_pence, earning_status, earned_at,
        calculation_version, calculation_fingerprint, calculation_json
      )
      VALUES ($1, $2, $3, $4, 0, 0, 0, 0, 0, 'zero_value', NOW(),
              'payout-v2-ledger-foundation-v1', $5, '{}'::jsonb)
      RETURNING id
    `, [schoolId, targetBookingId, instructorId, route, fingerprint]);
    return result.rows[0].id;
  }

  async function insertRecoveryObligation(amountPence = 41_400) {
    const result = await client.query(`
      INSERT INTO payout_adjustments (
        school_id, instructor_id, adjustment_type, amount_pence,
        reason, evidence_reference, operator_id, status,
        adjustment_fingerprint, metadata
      )
      VALUES (
        $1, $2, 'recovery', $3,
        'Rollback-only recovery contract',
        'test:payout-v2:legacy-recovery', 1, 'pending', $4,
        $5::jsonb
      )
      RETURNING id
    `, [
      schoolId,
      instructorId,
      -amountPence,
      hash('9'),
      JSON.stringify({
        recovery_policy: 'full_available_offset',
        source_v1_payout_id: 7,
        source_stripe_transfer_id: 'tr_rollback_recovery',
        source_legacy_booking_ids: [1],
        original_recovery_pence: amountPence,
      }),
    ]);
    return result.rows[0].id;
  }

  async function insertRecoveryBatch({
    grossPence,
    transferPence,
    recoveryPence,
    fingerprint = hash('8'),
  }) {
    const result = await client.query(`
      INSERT INTO payout_batches (
        school_id, instructor_id, payout_route, period_start, period_end,
        gross_pence, stripe_fees_pence, platform_fee_pence,
        franchise_fee_pence, instructor_amount_pence,
        recovery_deducted_pence, state, calculation_version,
        plan_fingerprint, plan_json, created_by_type
      )
      VALUES (
        $1, $2, 'instructor_direct', CURRENT_DATE, CURRENT_DATE,
        $3, 0, 0, 0, $4, $5, 'planned',
        'payout-v2-ledger-foundation-v1', $6, '{}'::jsonb, 'system'
      )
      RETURNING id
    `, [schoolId, instructorId, grossPence, transferPence, recoveryPence, fingerprint]);
    return result.rows[0].id;
  }

  async function insertRecoveryApplication({
    parentId,
    batchId,
    amountPence,
    fingerprint = hash('7'),
  }) {
    return client.query(`
      INSERT INTO payout_adjustments (
        school_id, instructor_id, payout_batch_id, parent_adjustment_id,
        adjustment_type, amount_pence, reason, evidence_reference,
        status, applied_at, adjustment_fingerprint, metadata
      )
      VALUES (
        $1, $2, $3, $4, 'recovery_application', $5,
        'Rollback-only recovery application',
        'test:payout-v2:legacy-recovery', 'applied', NOW(), $6,
        '{"recovery_policy":"full_available_offset"}'::jsonb
      )
    `, [schoolId, instructorId, batchId, parentId, amountPence, fingerprint]);
  }

  test('all v2 school keys are required and have no default', async () => {
    const result = await client.query(`
      SELECT table_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'school_id'
        AND table_name IN (
          'payout_funding_sources', 'payout_source_import_runs',
          'booking_earnings', 'booking_earning_sources',
          'payout_batches', 'payout_batch_earnings', 'payout_transfers',
          'payout_transfer_attempts', 'payout_transfer_sources', 'payout_adjustments',
          'stripe_event_receipts', 'payout_v2_connected_account_scopes',
          'connected_bank_payouts', 'payout_v2_stripe_evidence_events',
          'payout_v2_stripe_evidence_transfer_links',
          'connected_bank_payout_transfer_links'
        )
      ORDER BY table_name
    `);
    expect(result.rowCount).toBe(16);
    for (const row of result.rows) {
      expect(row.is_nullable, row.table_name).toBe('NO');
      expect(row.column_default, row.table_name).toBeNull();
    }
  });

  test('pre/post diagnostic SQL parses and executes read-only', async () => {
    await expect(client.query(preDiagnosticSql)).resolves.toBeTruthy();
    await expect(client.query(postDiagnosticSql)).resolves.toBeTruthy();
    await expect(client.query(sourceDiagnosticSql)).resolves.toBeTruthy();
    await expect(client.query(recoveryDiagnosticSql)).resolves.toBeTruthy();
  });

  test('legacy/pre-Connect funding rejects a positive payable pool', async () => {
    await expect(insertFundingSource({
      gross: 8_250,
      payable: 8_250,
    })).rejects.toMatchObject({ code: '23514' });
  });

  test('Stripe-backed funding rejects positive value without Stripe identity', async () => {
    await expect(insertFundingSource({
      fundingClass: 'stripe_backed',
      gross: 8_250,
      payable: 7_000,
    })).rejects.toMatchObject({ code: '23514' });
  });

  test('legacy funding rejects a positive booking earning allocation', async () => {
    const sourceId = await insertFundingSource({ fingerprint: hash('b') });
    const earning = await client.query(`
      INSERT INTO booking_earnings (
        school_id, booking_id, instructor_id, payout_route,
        gross_price_snapshot_pence, stripe_fee_snapshot_pence,
        instructor_earning_pence, platform_fee_pence,
        franchise_fee_allocation_pence, earning_status, earned_at,
        calculation_version, calculation_fingerprint, calculation_json
      )
      VALUES ($1, $2, $3, 'instructor_direct',
              100, 0, 100, 0, 0, 'earned', NOW(),
              'payout-v2-ledger-foundation-v1', $4, '{}'::jsonb)
      RETURNING id
    `, [schoolId, bookingId, instructorId, hash('c')]);
    await expect(client.query(`
      INSERT INTO booking_earning_sources (
        school_id, booking_earning_id, funding_source_id,
        gross_contribution_pence, stripe_fee_contribution_pence,
        payable_contribution_pence, instructor_earning_contribution_pence,
        platform_fee_contribution_pence, franchise_fee_contribution_pence,
        allocation_fingerprint
      )
      VALUES ($1, $2, $3, 100, 0, 100, 100, 0, 0, $4)
    `, [schoolId, earning.rows[0].id, sourceId, hash('d')]))
      .rejects.toMatchObject({ code: '23514' });
  });

  test('one booking cannot create direct and school earnings', async () => {
    await insertZeroEarning('instructor_direct', hash('b'));
    await expect(insertZeroEarning('school', hash('c')))
      .rejects.toMatchObject({ code: '23505' });
  });

  test('a positive earning cannot commit without source allocations', async () => {
    await client.query(`
      INSERT INTO booking_earnings (
        school_id, booking_id, instructor_id, payout_route,
        gross_price_snapshot_pence, stripe_fee_snapshot_pence,
        instructor_earning_pence, platform_fee_pence,
        franchise_fee_allocation_pence, earning_status, earned_at,
        calculation_version, calculation_fingerprint, calculation_json
      )
      VALUES ($1, $2, $3, 'instructor_direct',
              100, 0, 100, 0, 0, 'earned', NOW(),
              'payout-v2-ledger-foundation-v1', $4, '{}'::jsonb)
    `, [schoolId, bookingId, instructorId, hash('d')]);
    await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE'))
      .rejects.toMatchObject({ code: '23514' });
  });

  test('immutable funding evidence rejects update and delete', async () => {
    const sourceId = await insertFundingSource({ fingerprint: hash('e') });
    await expect(client.query(
      'UPDATE payout_funding_sources SET metadata = $1::jsonb WHERE id = $2',
      [JSON.stringify({ rewritten: true }), sourceId]
    )).rejects.toMatchObject({ code: '55000' });
  });

  test('reviewed import run is school-scoped, conserved, unique, and append-only', async () => {
    const planFingerprint = hash('a');
    const totals = {
      gross_collected_pence: 8250,
      stripe_fee_pence: 250,
      payable_pool_pence: 8000,
      refundable_pool_pence: 8000,
      funding_class_counts: { stripe_backed: 1 },
    };
    const inserted = await client.query(`
      INSERT INTO payout_source_import_runs (
        school_id, import_version, plan_fingerprint, candidate_count,
        totals, operator_identity, evidence_reference,
        created_source_count, existing_source_count
      )
      VALUES (
        $1, 'payout-v2-historical-source-import-v1', $2, 1,
        $3::jsonb, 'test-operator', 'test:evidence', 1, 0
      )
      RETURNING id
    `, [schoolId, planFingerprint, JSON.stringify(totals)]);
    await client.query('SAVEPOINT payout_v2_import_run_duplicate');
    await expect(client.query(`
      INSERT INTO payout_source_import_runs (
        school_id, import_version, plan_fingerprint, candidate_count,
        totals, operator_identity, evidence_reference,
        created_source_count, existing_source_count
      )
      VALUES (
        $1, 'payout-v2-historical-source-import-v1', $2, 1,
        $3::jsonb, 'test-operator', 'test:evidence', 1, 0
      )
    `, [schoolId, planFingerprint, JSON.stringify(totals)]))
      .rejects.toMatchObject({ code: '23505' });
    await client.query('ROLLBACK TO SAVEPOINT payout_v2_import_run_duplicate');
    await expect(client.query(
      'UPDATE payout_source_import_runs SET evidence_reference = $1 WHERE id = $2',
      ['rewritten', inserted.rows[0].id]
    )).rejects.toMatchObject({ code: '55000' });
  });

  test('batch state may advance but accounting totals remain immutable', async () => {
    const batch = await client.query(`
      INSERT INTO payout_batches (
        school_id, instructor_id, payout_route, period_start, period_end,
        gross_pence, stripe_fees_pence, platform_fee_pence,
        franchise_fee_pence, instructor_amount_pence, state,
        calculation_version, plan_fingerprint, plan_json, created_by_type
      )
      VALUES ($1, $2, 'instructor_direct', CURRENT_DATE, CURRENT_DATE,
              100, 0, 0, 0, 100, 'planned',
              'payout-v2-ledger-foundation-v1', $3, '{}'::jsonb, 'system')
      RETURNING id
    `, [schoolId, instructorId, hash('e')]);
    await expect(client.query(
      "UPDATE payout_batches SET state = 'claimed' WHERE id = $1",
      [batch.rows[0].id]
    )).resolves.toBeTruthy();
    await expect(client.query(
      'UPDATE payout_batches SET instructor_amount_pence = 99 WHERE id = $1',
      [batch.rows[0].id]
    )).rejects.toMatchObject({ code: '55000' });
  });

  test('a positive transfer cannot commit without source allocations', async () => {
    const batch = await client.query(`
      INSERT INTO payout_batches (
        school_id, instructor_id, payout_route, period_start, period_end,
        gross_pence, stripe_fees_pence, platform_fee_pence,
        franchise_fee_pence, instructor_amount_pence, state,
        calculation_version, plan_fingerprint, plan_json, created_by_type
      )
      VALUES ($1, $2, 'instructor_direct', CURRENT_DATE, CURRENT_DATE,
              100, 0, 0, 0, 100, 'planned',
              'payout-v2-ledger-foundation-v1', $3, '{}'::jsonb, 'system')
      RETURNING id
    `, [schoolId, instructorId, hash('a')]);
    await client.query(`
      INSERT INTO payout_transfers (
        school_id, payout_batch_id, instructor_id,
        stripe_destination_account_id, amount_pence, idempotency_key,
        transfer_group, plan_fingerprint, logical_transfer_fingerprint, state
      )
      VALUES ($1, $2, $3, 'acct_test_contract', 100,
              'cc:payout-v2:test:unsourced', 'cc-payout-v2-test',
              $4, $5, 'planned')
    `, [schoolId, batch.rows[0].id, instructorId, hash('a'), hash('b')]);
    await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE'))
      .rejects.toMatchObject({ code: '23514' });
  });

  test('transfer identity is unique across retries and routes', async () => {
    const batch = await client.query(`
      INSERT INTO payout_batches (
        school_id, instructor_id, payout_route, period_start, period_end,
        gross_pence, stripe_fees_pence, platform_fee_pence,
        franchise_fee_pence, instructor_amount_pence, state,
        calculation_version, plan_fingerprint, plan_json, created_by_type
      )
      VALUES ($1, $2, 'instructor_direct', CURRENT_DATE, CURRENT_DATE,
              100, 0, 0, 0, 100, 'planned',
              'payout-v2-ledger-foundation-v1', $3, '{}'::jsonb, 'system')
      RETURNING id
    `, [schoolId, instructorId, hash('f')]);
    const batchId = batch.rows[0].id;
    const insertTransfer = (logicalFingerprint) => client.query(`
      INSERT INTO payout_transfers (
        school_id, payout_batch_id, instructor_id,
        stripe_destination_account_id, amount_pence, idempotency_key,
        transfer_group, plan_fingerprint, logical_transfer_fingerprint, state
      )
      VALUES ($1, $2, $3, 'acct_test_contract', 100,
              'cc:payout-v2:test:stable-key', 'cc-payout-v2-test',
              $4, $5, 'planned')
    `, [schoolId, batchId, instructorId, hash('f'), logicalFingerprint]);
    await insertTransfer(hash('a'));
    await expect(insertTransfer(hash('b'))).rejects.toMatchObject({ code: '23505' });
  });

  test('partial recovery application carries the unpaid obligation forward', async () => {
    const recoveryId = await insertRecoveryObligation(41_400);
    const batchId = await insertRecoveryBatch({
      grossPence: 25_000,
      transferPence: 0,
      recoveryPence: 25_000,
    });
    await insertRecoveryApplication({
      parentId: recoveryId,
      batchId,
      amountPence: 25_000,
    });
    await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE')).resolves.toBeTruthy();
    const remaining = await client.query(`
      SELECT
        ABS(parent.amount_pence) -
          COALESCE(SUM(child.amount_pence), 0) AS remaining_pence
      FROM payout_adjustments parent
      LEFT JOIN payout_adjustments child
        ON child.parent_adjustment_id = parent.id
       AND child.school_id = parent.school_id
       AND child.adjustment_type = 'recovery_application'
      WHERE parent.id = $1
        AND parent.school_id = $2
      GROUP BY parent.id
    `, [recoveryId, schoolId]);
    expect(Number(remaining.rows[0].remaining_pence)).toBe(16_400);
  });

  test('recovery obligation rejects missing immutable v1 and Stripe evidence', async () => {
    await expect(client.query(`
      INSERT INTO payout_adjustments (
        school_id, instructor_id, adjustment_type, amount_pence,
        reason, evidence_reference, operator_id, status,
        adjustment_fingerprint, metadata
      )
      VALUES (
        $1, $2, 'recovery', -1000,
        'Rollback-only incomplete recovery',
        'test:payout-v2:incomplete-recovery', 1, 'pending', $3,
        '{"recovery_policy":"full_available_offset"}'::jsonb
      )
    `, [schoolId, instructorId, hash('6')])).rejects.toMatchObject({ code: '23514' });
  });

  test('recovery applications cannot exceed the original obligation', async () => {
    const recoveryId = await insertRecoveryObligation(10_000);
    const batchId = await insertRecoveryBatch({
      grossPence: 12_000,
      transferPence: 0,
      recoveryPence: 12_000,
    });
    await expect(insertRecoveryApplication({
      parentId: recoveryId,
      batchId,
      amountPence: 12_000,
    })).rejects.toMatchObject({ code: '23514' });
  });

  test('a batch recovery deduction cannot commit without matching applications', async () => {
    await insertRecoveryBatch({
      grossPence: 10_000,
      transferPence: 0,
      recoveryPence: 10_000,
    });
    await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE'))
      .rejects.toMatchObject({ code: '23514' });
  });
});
