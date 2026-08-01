// @ts-check
// Rollback-isolated database contracts for migration 039.
//
// This suite is intentionally triple-gated. It runs only when the caller sets
// CC_TEST_DB=1, supplies POSTGRES_URL_TEST, and explicitly confirms that target
// with CC_TEST_DB_CONFIRMED_NON_PRODUCTION=1. The migration and all fixtures are
// applied inside one outer transaction that is rolled back in afterAll.

const { test, expect } = require('@playwright/test');
const { Client, neonConfig } = require('@neondatabase/serverless');
const crypto = require('crypto');
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
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
})();

const ENABLED = process.env.CC_TEST_DB === '1'
  && !!process.env.POSTGRES_URL_TEST
  && process.env.CC_TEST_DB_CONFIRMED_NON_PRODUCTION === '1';
const root = path.resolve(__dirname, '..');
const migrationSql = fs.readFileSync(
  path.join(root, 'db', 'migrations', '039_stripe_launch_schema_foundation.sql'),
  'utf8'
);
const preDiagnosticSql = fs.readFileSync(
  path.join(root, 'db', 'diagnostics', 'stripe-launch-schema-foundation-pre-migration.sql'),
  'utf8'
);
const postDiagnosticSql = fs.readFileSync(
  path.join(root, 'db', 'diagnostics', 'stripe-launch-schema-foundation-post-migration.sql'),
  'utf8'
);
const TABLES = [
  'stripe_connect_launch_configs', 'stripe_connect_launch_events',
  'instructor_payout_agreement_versions', 'lesson_payment_contracts',
  'lesson_outcome_revisions', 'lesson_issue_tokens', 'lesson_issue_reports',
  'lesson_issue_actions', 'refund_intents', 'refund_attempts',
  'connect_account_state_events', 'payout_runs', 'instructor_payout_batches',
  'instructor_payout_obligations',
  'instructor_payout_obligation_applications',
  'stripe_launch_booking_earnings', 'stripe_launch_transfer_intents',
  'stripe_launch_transfer_attempts', 'payout_batch_earning_dispositions',
  'payout_statements', 'payout_statement_delivery_attempts',
  'payment_disputes', 'payment_dispute_events',
  'dispute_evidence_pack_versions', 'dispute_notification_attempts',
  'financial_job_occurrences',
];

const uuid = (last) => `00000000-0000-4000-8000-${last.padStart(12, '0')}`;
const hash = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

test.describe.configure({ mode: 'serial' });
test.describe('Stripe launch Slice 1 database contracts', () => {
  test.skip(
    !ENABLED,
    'Requires CC_TEST_DB=1, POSTGRES_URL_TEST, and CC_TEST_DB_CONFIRMED_NON_PRODUCTION=1'
  );

  let client;
  let schoolId;
  let instructorId;
  let learnerId;
  let bookingId;
  let adminId;
  let historicSourceId;
  let beforeHistoric;
  let afterHistoric;
  let savepoint = 0;

  async function historicFingerprint() {
    const result = await client.query(`
      SELECT
        (SELECT COUNT(*)::INTEGER FROM lesson_bookings) AS booking_count,
        (SELECT md5(COALESCE(string_agg(
          concat_ws('|', id, school_id, learner_id, instructor_id, status,
            scheduled_date, start_time, end_time), ',' ORDER BY id), ''))
         FROM lesson_bookings) AS booking_fingerprint,
        (SELECT COUNT(*)::INTEGER FROM payout_funding_sources) AS source_count,
        (SELECT md5(COALESCE(string_agg(
          concat_ws('|', id, school_id, learner_id, instructor_id, funding_class,
            currency, gross_collected_pence, stripe_fee_pence,
            payable_pool_pence, refundable_pool_pence, source_status,
            source_fingerprint), ',' ORDER BY id), ''))
         FROM payout_funding_sources) AS source_fingerprint
    `);
    return result.rows[0];
  }

  async function insertConfig(id = uuid('101')) {
    await client.query(`
      INSERT INTO stripe_connect_launch_configs (
        id, school_id, cutover_at, accounting_version, mode,
        created_by_admin_id, created_at
      ) VALUES ($1, $2, NOW() + INTERVAL '30 days', 'simon_launch_v1',
        'disabled', $3, NOW())
    `, [id, schoolId, adminId]);
    return id;
  }

  async function insertAgreement(id = uuid('201')) {
    await client.query(`
      INSERT INTO instructor_payout_agreement_versions (
        id, school_id, instructor_id, version_number, starts_at, status,
        split_bps, weekly_franchise_fee_minor, currency, accepted_at,
        acceptance_evidence_reference, document_version,
        created_by_admin_id, approved_by_admin_id, created_at, approved_at,
        agreement_fingerprint
      ) VALUES (
        $1, $2, $3, 1, NOW() - INTERVAL '1 day', 'active',
        5000, 100, 'gbp', NOW(), 'test:agreement:accepted', 'test-v1',
        $4, $4, NOW(), NOW(), $5
      )
    `, [id, schoolId, instructorId, adminId, hash(`agreement:${id}`)]);
    return id;
  }

  async function insertRun(id = uuid('301')) {
    const result = await client.query(`
      INSERT INTO payout_runs (
        id, school_id, accounting_version, lock_at, transfer_at,
        service_window_start, service_window_end, state, first_live,
        planner_version, planner_fingerprint, gross_minor, stripe_fee_minor,
        net_minor, instructor_share_minor, platform_share_minor,
        obligation_applied_minor, transfer_minor, held_minor, currency, created_at
      ) VALUES (
        $1, $2, 'simon_launch_v1', NOW(), NOW() + INTERVAL '2 hours',
        NOW() - INTERVAL '7 days', NOW(), 'planned', FALSE,
        'test-planner-v1', $3, 0, 0, 0, 0, 0, 0, 0, 0, 'gbp', NOW()
      ) RETURNING lock_at
    `, [id, schoolId, hash(`run:${id}`)]);
    return { id, lockAt: result.rows[0].lock_at };
  }

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (
      process.env.POSTGRES_URL
      && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL
    ) throw new Error('Refusing migration 039 tests: test URL equals production URL');

    if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket === 'function') {
      neonConfig.webSocketConstructor = globalThis.WebSocket;
    }
    client = new Client({ connectionString: process.env.POSTGRES_URL_TEST });
    await client.connect();
    await client.query('BEGIN');

    const collision = await client.query(`
      SELECT COUNT(*)::INTEGER AS present
      FROM unnest($1::TEXT[]) AS expected(name)
      WHERE to_regclass('public.' || expected.name) IS NOT NULL
    `, [TABLES]);
    if (collision.rows[0].present !== 0) {
      throw new Error('Refusing migration 039 rehearsal: Slice 1 relations already exist');
    }

    const fixture = await client.query(`
      SELECT b.school_id, b.instructor_id, b.learner_id,
             b.id AS booking_id, a.id AS admin_id
      FROM lesson_bookings b
      JOIN instructors i
        ON i.id = b.instructor_id AND i.school_id = b.school_id
      JOIN learner_users l
        ON l.id = b.learner_id AND l.school_id = b.school_id
      JOIN admin_users a ON a.school_id = b.school_id
      JOIN schools s ON s.id = b.school_id AND s.payout_engine_version = 'v1'
      ORDER BY b.id, a.id
      LIMIT 1
    `);
    if (fixture.rowCount !== 1) {
      throw new Error('Test branch needs one same-school booking, learner, instructor, and admin on v1');
    }
    ({
      school_id: schoolId,
      instructor_id: instructorId,
      learner_id: learnerId,
      booking_id: bookingId,
      admin_id: adminId,
    } = fixture.rows[0]);

    const historicSource = await client.query(`
      INSERT INTO payout_funding_sources (
        school_id, learner_id, instructor_id, funding_class,
        gross_collected_pence, stripe_fee_pence, payable_pool_pence,
        refundable_pool_pence, source_status, source_fingerprint,
        occurred_at, metadata
      ) VALUES ($1, $2, $3, 'legacy_pre_connect_settled',
        0, 0, 0, 0, 'available', $4, NOW(),
        '{"fixture":"migration-039-production-shaped"}'::jsonb)
      RETURNING id
    `, [schoolId, learnerId, instructorId, hash(`historic:${Date.now()}:${process.pid}`)]);
    historicSourceId = historicSource.rows[0].id;
    beforeHistoric = await historicFingerprint();
    await client.query(preDiagnosticSql);
    await client.query(migrationSql);
    afterHistoric = await historicFingerprint();
  });

  test.beforeEach(async () => {
    if (!ENABLED) return;
    savepoint += 1;
    await client.query(`SAVEPOINT stripe_launch_slice_1_${savepoint}`);
    await client.query('SET CONSTRAINTS ALL DEFERRED');
  });

  test.afterEach(async () => {
    if (!ENABLED) return;
    await client.query(`ROLLBACK TO SAVEPOINT stripe_launch_slice_1_${savepoint}`);
  });

  test.afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  test('migrates a production-shaped fixture without changing historic facts', async () => {
    expect(afterHistoric).toEqual(beforeHistoric);
    const bridges = await client.query(`
      SELECT stripe_payment_created_at, stripe_funds_available_at,
             payment_origin, source_booking_id, lesson_payment_contract_id,
             evidence_completeness, contradiction_code
      FROM payout_funding_sources WHERE id = $1
    `, [historicSourceId]);
    expect(Object.values(bridges.rows[0]).every((value) => value === null)).toBe(true);
    const booking = await client.query(`
      SELECT lesson_payment_contract_id, slot_released_at, slot_release_reason
      FROM lesson_bookings WHERE id = $1
    `, [bookingId]);
    expect(Object.values(booking.rows[0]).every((value) => value === null)).toBe(true);
  });

  test('creates all tables, tenant indexes, constraints, functions and triggers', async () => {
    const tables = await client.query(`
      SELECT COUNT(*)::INTEGER AS count
      FROM unnest($1::TEXT[]) AS expected(name)
      WHERE to_regclass('public.' || expected.name) IS NOT NULL
    `, [TABLES]);
    expect(tables.rows[0].count).toBe(26);

    const indexes = await client.query(`
      SELECT COUNT(*)::INTEGER AS count FROM pg_indexes
      WHERE schemaname = 'public' AND indexname IN (
        'uq_admin_users_id_school_launch',
        'uq_lesson_payment_contracts_pi_global',
        'uq_lesson_bookings_active_launch_contract',
        'uq_stripe_launch_transfer_id',
        'uq_financial_job_occurrence_school'
      )
    `);
    expect(indexes.rows[0].count).toBe(5);

    const functions = await client.query(`
      SELECT COUNT(*)::INTEGER AS count
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'stripe_launch_%'
    `);
    expect(functions.rows[0].count).toBe(25);

    const tenantFks = await client.query(`
      SELECT COUNT(*)::INTEGER AS count
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
        AND contype = 'f'
        AND pg_get_constraintdef(oid) LIKE '%school_id%'
        AND conrelid::regclass::TEXT = 'stripe_connect_launch_configs'
    `);
    expect(tenantFks.rows[0].count).toBeGreaterThanOrEqual(1);
  });

  test('leaves every launch table empty and every school on v1', async () => {
    const rowCounts = await Promise.all(TABLES.map(async (tableName) => {
      const result = await client.query(`SELECT COUNT(*)::INTEGER AS count FROM ${tableName}`);
      return result.rows[0].count;
    }));
    expect(rowCounts.every((count) => count === 0)).toBe(true);
    const engines = await client.query(`
      SELECT COUNT(*)::INTEGER AS count FROM schools
      WHERE payout_engine_version <> 'v1'
    `);
    expect(engines.rows[0].count).toBe(0);
    await expect(client.query(postDiagnosticSql)).resolves.toBeTruthy();
  });

  test('rejects cross-school administrative relationships', async () => {
    const other = await client.query(`
      INSERT INTO schools (name, slug)
      VALUES ('Migration 039 tenant boundary', $1)
      RETURNING id
    `, [`migration-039-${Date.now()}-${process.pid}`]);
    await expect(client.query(`
      INSERT INTO stripe_connect_launch_configs (
        id, school_id, cutover_at, accounting_version, mode,
        created_by_admin_id, created_at
      ) VALUES ($1, $2, NOW() + INTERVAL '30 days', 'simon_launch_v1',
        'disabled', $3, NOW())
    `, [uuid('401'), other.rows[0].id, adminId])).rejects.toThrow(/foreign key/i);
  });

  test('rejects invalid modes and illegal mode transitions', async () => {
    await expect(client.query(`
      INSERT INTO stripe_connect_launch_configs (
        id, school_id, cutover_at, accounting_version, mode,
        created_by_admin_id, created_at
      ) VALUES ($1, $2, NOW(), 'simon_launch_v1', 'automatic', $3, NOW())
    `, [uuid('402'), schoolId, adminId])).rejects.toThrow(/check constraint/i);
  });

  test('prevents mutation and deletion of immutable launch configuration', async () => {
    const configId = await insertConfig(uuid('403'));
    await expect(client.query(`
      UPDATE stripe_connect_launch_configs
      SET cutover_at = cutover_at + INTERVAL '1 second'
      WHERE id = $1
    `, [configId])).rejects.toThrow(/immutable/i);
  });

  test('makes administrative evidence append-only and idempotent', async () => {
    const configId = await insertConfig(uuid('404'));
    await client.query(`
      INSERT INTO stripe_connect_launch_events (
        id, school_id, launch_config_id, event_type, mode_before, mode_after,
        actor_type, actor_admin_id, reason, evidence_json,
        idempotency_identity, occurred_at, created_at, event_fingerprint
      ) VALUES ($1, $2, $3, 'mode_changed', 'disabled', 'shadow',
        'admin', $4, 'rollback-only evidence', '{}'::jsonb,
        'migration-039:event:404', NOW(), NOW(), $5)
    `, [uuid('405'), schoolId, configId, adminId, hash('event:405')]);
    await expect(client.query(`
      INSERT INTO stripe_connect_launch_events (
        id, school_id, launch_config_id, event_type, mode_before, mode_after,
        actor_type, actor_admin_id, reason, evidence_json,
        idempotency_identity, occurred_at, created_at, event_fingerprint
      ) VALUES ($1, $2, $3, 'mode_changed', 'disabled', 'shadow',
        'admin', $4, 'duplicate command', '{}'::jsonb,
        'migration-039:event:404', NOW(), NOW(), $5)
    `, [uuid('406'), schoolId, configId, adminId, hash('event:406')]))
      .rejects.toThrow(/unique constraint/i);
  });

  test('rejects unconserved locked batch totals at deferred enforcement', async () => {
    const agreementId = await insertAgreement(uuid('407'));
    const run = await insertRun(uuid('408'));
    await client.query(`
      INSERT INTO instructor_payout_batches (
        id, school_id, payout_run_id, instructor_id, agreement_version_id,
        currency, gross_minor, stripe_fee_minor, net_minor,
        instructor_share_minor, platform_share_minor, opening_obligation_minor,
        new_obligation_minor, applied_obligation_minor, closing_obligation_minor,
        transfer_planned_minor, transfer_submitted_minor, held_minor, state,
        batch_fingerprint, created_at, locked_at
      ) VALUES (
        $1, $2, $3, $4, $5, 'gbp', 100, 0, 100, 100, 0,
        0, 0, 0, 0, 100, 0, 0, 'locked', $6, NOW(),
        (SELECT lock_at FROM payout_runs WHERE id = $3 AND school_id = $2)
      )
    `, [
      uuid('409'), schoolId, run.id, instructorId, agreementId,
      hash('batch:409'),
    ]);
    await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE'))
      .rejects.toThrow(/do not conserve locked totals/i);
  });

  test('rejects obligation over-application', async () => {
    const agreementId = await insertAgreement(uuid('410'));
    const run = await insertRun(uuid('411'));
    await client.query(`
      INSERT INTO instructor_payout_obligations (
        id, school_id, instructor_id, agreement_version_id, obligation_type,
        type_rank, incurred_at, original_amount_minor, currency,
        source_payout_run_id, idempotency_identity, evidence_fingerprint,
        created_actor_type, created_at
      ) VALUES ($1, $2, $3, $4, 'weekly_franchise_fee', 2, NOW(), 100,
        'gbp', $5, 'migration-039:obligation:410', $6, 'system', NOW())
    `, [uuid('412'), schoolId, instructorId, agreementId, run.id, hash('obligation:412')]);
    await client.query(`
      INSERT INTO instructor_payout_obligation_applications (
        id, school_id, obligation_id, instructor_id, application_type,
        amount_minor, external_reference, actor_type, reason, occurred_at,
        idempotency_identity, application_fingerprint
      ) VALUES ($1, $2, $3, $4, 'manual_repayment', 60,
        'test:repayment:one', 'system', 'rollback-only repayment', NOW(),
        'migration-039:application:413', $5)
    `, [uuid('413'), schoolId, uuid('412'), instructorId, hash('application:413')]);
    await expect(client.query(`
      INSERT INTO instructor_payout_obligation_applications (
        id, school_id, obligation_id, instructor_id, application_type,
        amount_minor, external_reference, actor_type, reason, occurred_at,
        idempotency_identity, application_fingerprint
      ) VALUES ($1, $2, $3, $4, 'manual_repayment', 41,
        'test:repayment:two', 'system', 'rollback-only over-application', NOW(),
        'migration-039:application:414', $5)
    `, [uuid('414'), schoolId, uuid('412'), instructorId, hash('application:414')]))
      .rejects.toThrow(/exceed immutable principal/i);
  });

  test('keeps existing funding facts immutable while allowing no backfill', async () => {
    await expect(client.query(`
      UPDATE payout_funding_sources
      SET gross_collected_pence = gross_collected_pence + 1
      WHERE id = $1
    `, [historicSourceId])).rejects.toThrow(/immutable/i);
  });
});
