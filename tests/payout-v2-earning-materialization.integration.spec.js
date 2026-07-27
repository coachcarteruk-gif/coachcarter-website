// @ts-check
// Rollback-only Neon verification for inactive Payout v2 Slice 3 materialisation.
//
// Run:
//   CC_TEST_DB=1 npx playwright test tests/payout-v2-earning-materialization.integration.spec.js

const { test, expect } = require('@playwright/test');
const { Client, neonConfig } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const {
  makeSqlTag,
  loadPayoutV2ShadowInput,
  buildPayoutV2ShadowStatement,
} = require('../api/_payout-v2-shadow');
const {
  planPayoutV2Earnings,
} = require('../api/_payout-v2-earning-planner');
const {
  materializePayoutV2ShadowPlanInTransaction,
} = require('../api/_payout-v2-materializer');
const { CHARGEABLE } = require('../api/_booking-status');

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
const earningDiagnosticSql = fs.readFileSync(
  path.resolve(
    __dirname,
    '..',
    'db',
    'diagnostics',
    'payout-v2-earning-shadow-reconciliation.sql'
  ),
  'utf8'
);

test.describe.configure({ mode: 'serial' });
test.describe('Payout v2 earning materialisation database contracts', () => {
  test.skip(!ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run database-backed contracts');

  let client;
  let sql;
  let schoolId;
  let instructorId;
  let learnerId;
  let bookingId;
  let creditTransactionId;
  let fundingSourceId;
  let savepointNumber = 0;
  const snapshotAt = '2026-07-25T09:00:00.000Z';

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
    sql = makeSqlTag(client);

    const fixture = await client.query(`
      SELECT lu.school_id, lu.id AS learner_id, i.id AS instructor_id
      FROM learner_users lu
      JOIN instructors i
        ON i.school_id = lu.school_id
      WHERE COALESCE(lu.is_test_account, FALSE) = FALSE
      ORDER BY lu.id, i.id
      LIMIT 1
    `);
    if (fixture.rowCount !== 1) {
      throw new Error('Neon test branch needs one non-test same-school learner/instructor fixture');
    }
    ({
      school_id: schoolId,
      learner_id: learnerId,
      instructor_id: instructorId,
    } = fixture.rows[0]);
  });

  test.beforeEach(async () => {
    if (!ENABLED) return;
    savepointNumber += 1;
    await client.query(`SAVEPOINT payout_v2_earning_${savepointNumber}`);
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    await client.query(
      `UPDATE instructors
          SET commission_rate = 0.85,
              weekly_franchise_fee_pence = NULL
        WHERE id = $1
          AND school_id = $2`,
      [instructorId, schoolId]
    );
    const booking = await client.query(
      `INSERT INTO lesson_bookings (
         learner_id, instructor_id, scheduled_date, start_time, end_time,
         status, payment_method, created_by, minutes_deducted, school_id,
         list_price_pence, list_price_source
       )
       VALUES (
         $1, $2, DATE '2099-12-30', TIME '09:00', TIME '10:30',
         $3, 'credit', 'learner', 90, $4,
         999999, 'live_compute_insert'
       )
       RETURNING id`,
      [learnerId, instructorId, CHARGEABLE, schoolId]
    );
    bookingId = booking.rows[0].id;

    const credit = await client.query(
      `INSERT INTO credit_transactions (
         learner_id, instructor_id, school_id, type, credits, minutes,
         amount_pence, payment_method, stripe_session_id,
         stripe_payment_intent_id, stripe_fee_pence, source
       )
       VALUES (
         $1, $2, $3, 'purchase', 1, 90,
         10000, 'card', 'cs_payout_v2_earning_fixture',
         'pi_payout_v2_earning_fixture', 300, 'stripe'
       )
       RETURNING id`,
      [learnerId, instructorId, schoolId]
    );
    creditTransactionId = credit.rows[0].id;

    await client.query(
      `INSERT INTO booking_credit_sources (
         school_id, booking_id, credit_transaction_id, minutes_drawn,
         rate_pence_per_minute, contribution_pence, stripe_fee_pence,
         absorbed_by
       )
       VALUES ($1, $2, $3, 90, 111, 10000, 300, NULL)`,
      [schoolId, bookingId, creditTransactionId]
    );

    const source = await client.query(
      `INSERT INTO payout_funding_sources (
         school_id, learner_id, instructor_id, funding_class,
         credit_transaction_id, stripe_checkout_session_id,
         stripe_payment_intent_id, stripe_charge_id,
         stripe_balance_transaction_id, gross_collected_pence,
         stripe_fee_pence, payable_pool_pence, refundable_pool_pence,
         source_status, source_fingerprint, occurred_at, metadata
       )
       VALUES (
         $1, $2, $3, 'stripe_backed',
         $4, 'cs_payout_v2_earning_fixture',
         'pi_payout_v2_earning_fixture', 'ch_payout_v2_earning_fixture',
         'txn_payout_v2_earning_fixture', 10000,
         300, 9700, 9700,
         'available', $5, NOW(),
         '{"fee_evidence":"stripe_balance_transaction"}'::jsonb
       )
       RETURNING id`,
      [
        schoolId,
        learnerId,
        instructorId,
        creditTransactionId,
        `sha256:${'e'.repeat(64)}`,
      ]
    );
    fundingSourceId = source.rows[0].id;
  });

  test.afterEach(async () => {
    if (!ENABLED) return;
    await client.query(`ROLLBACK TO SAVEPOINT payout_v2_earning_${savepointNumber}`);
  });

  test.afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  async function reviewedPlan() {
    const input = await loadPayoutV2ShadowInput({
      sql,
      schoolId: Number(schoolId),
      payoutRoute: 'instructor_direct',
      instructorId: Number(instructorId),
      periodStart: '2099-12-30',
      periodEnd: '2099-12-30',
      snapshotAt,
    });
    return planPayoutV2Earnings(input);
  }

  test('materialises earning, allocation, batch, and claim atomically with exact conservation', async () => {
    const beforeSwitch = await client.query(
      'SELECT payout_engine_version FROM schools WHERE id = $1',
      [schoolId]
    );
    const beforeV1 = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM instructor_payouts WHERE school_id = $1)::int AS payouts,
         (SELECT COUNT(*) FROM payout_line_items WHERE school_id = $1)::int AS lines`,
      [schoolId]
    );
    const shadow = await buildPayoutV2ShadowStatement({
      sql,
      schoolId: Number(schoolId),
      payoutRoute: 'instructor_direct',
      instructorId: Number(instructorId),
      periodStart: '2099-12-30',
      periodEnd: '2099-12-30',
      snapshotAt,
    });
    expect(shadow).toMatchObject({
      mode: 'read_only_shadow',
      totals: { gross_pence: 10000 },
      v1_preview: {
        comparison_only_uses_current_v1_live_fallbacks: true,
        gross_pence: 999999,
      },
      comparison: {
        unexplained_difference: true,
        classification: 'unexplained_difference',
      },
      mutation_guarantee: {
        claims_created: false,
        locks_taken: false,
        financial_rows_written: false,
        stripe_calls: false,
      },
    });
    const plan = await reviewedPlan();
    expect(plan.blocked_booking_count).toBe(0);
    const result = await materializePayoutV2ShadowPlanInTransaction({
      client,
      schoolId: Number(schoolId),
      reviewedPlan: plan,
    });
    expect(result).toMatchObject({
      ok: true,
      mode: 'inactive_shadow_materialisation',
      batch_created: true,
      created_earning_count: 1,
      created_allocation_count: 1,
      stripe_transfer_created: false,
      activation_switch_changed: false,
    });

    const rows = await client.query(
      `SELECT
         be.booking_id,
         be.gross_price_snapshot_pence,
         be.stripe_fee_snapshot_pence,
         be.instructor_earning_pence,
         be.platform_fee_pence,
         bes.funding_source_id,
         pb.state,
         pb.gross_pence,
         pb.instructor_amount_pence,
         COUNT(pt.id)::int AS transfer_rows
       FROM booking_earnings be
       JOIN booking_earning_sources bes
         ON bes.booking_earning_id = be.id
        AND bes.school_id = be.school_id
       JOIN payout_batch_earnings pbe
         ON pbe.booking_earning_id = be.id
        AND pbe.school_id = be.school_id
       JOIN payout_batches pb
         ON pb.id = pbe.payout_batch_id
        AND pb.school_id = pbe.school_id
       LEFT JOIN payout_transfers pt
         ON pt.payout_batch_id = pb.id
        AND pt.school_id = pb.school_id
       WHERE be.school_id = $1
         AND be.booking_id = $2
       GROUP BY be.id, bes.id, pb.id`,
      [schoolId, bookingId]
    );
    expect(rows.rows[0]).toMatchObject({
      booking_id: bookingId,
      gross_price_snapshot_pence: 10000,
      stripe_fee_snapshot_pence: 300,
      instructor_earning_pence: 8200,
      platform_fee_pence: 1500,
      funding_source_id: fundingSourceId,
      state: 'planned',
      gross_pence: 10000,
      instructor_amount_pence: 8200,
      transfer_rows: 0,
    });
    const afterSwitch = await client.query(
      'SELECT payout_engine_version FROM schools WHERE id = $1',
      [schoolId]
    );
    const afterV1 = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM instructor_payouts WHERE school_id = $1)::int AS payouts,
         (SELECT COUNT(*) FROM payout_line_items WHERE school_id = $1)::int AS lines`,
      [schoolId]
    );
    expect(afterSwitch.rows).toEqual(beforeSwitch.rows);
    expect(afterV1.rows).toEqual(beforeV1.rows);
  });

  test('retry and serialized concurrent replay return the same immutable batch', async () => {
    const plan = await reviewedPlan();
    const first = await materializePayoutV2ShadowPlanInTransaction({
      client,
      schoolId: Number(schoolId),
      reviewedPlan: plan,
    });
    const [second, third] = await Promise.all([
      materializePayoutV2ShadowPlanInTransaction({
        client,
        schoolId: Number(schoolId),
        reviewedPlan: plan,
      }),
      materializePayoutV2ShadowPlanInTransaction({
        client,
        schoolId: Number(schoolId),
        reviewedPlan: plan,
      }),
    ]);
    expect(second.batch_id).toBe(first.batch_id);
    expect(third.batch_id).toBe(first.batch_id);
    expect(second.batch_created).toBe(false);
    expect(third.batch_created).toBe(false);
    const counts = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM booking_earnings
           WHERE school_id = $1 AND booking_id = $2)::int AS earnings,
         (SELECT COUNT(*) FROM booking_earning_sources
           WHERE school_id = $1 AND funding_source_id = $3)::int AS allocations,
         (SELECT COUNT(*) FROM payout_batches
           WHERE school_id = $1 AND plan_fingerprint = $4)::int AS batches`,
      [schoolId, bookingId, fundingSourceId, plan.plan_fingerprint]
    );
    expect(counts.rows[0]).toEqual({
      earnings: 1,
      allocations: 1,
      batches: 1,
    });
  });

  test('plan drift and cross-school materialisation fail before ledger writes', async () => {
    const plan = await reviewedPlan();
    await client.query(
      `UPDATE booking_credit_sources
          SET contribution_pence = contribution_pence - 1
        WHERE school_id = $1
          AND booking_id = $2`,
      [schoolId, bookingId]
    );
    await expect(materializePayoutV2ShadowPlanInTransaction({
      client,
      schoolId: Number(schoolId),
      reviewedPlan: plan,
    })).rejects.toMatchObject({ code: 'PAYOUT_V2_EARNING_PLAN_DRIFT' });

    await expect(materializePayoutV2ShadowPlanInTransaction({
      client,
      schoolId: Number(schoolId) + 1,
      reviewedPlan: plan,
    })).rejects.toMatchObject({ code: 'PAYOUT_V2_EARNING_PLAN_DRIFT' });
    const count = await client.query(
      `SELECT COUNT(*)::int AS rows
         FROM booking_earnings
        WHERE school_id = $1
          AND booking_id = $2`,
      [schoolId, bookingId]
    );
    expect(count.rows[0].rows).toBe(0);
  });

  test('a partial writer failure rolls back every earning-side write', async () => {
    const plan = await reviewedPlan();
    await client.query('SAVEPOINT payout_v2_partial_writer');
    const failingClient = {
      query: async (text, values) => {
        if (/^\s*INSERT INTO payout_batches/i.test(text)) {
          throw new Error('injected_batch_failure');
        }
        return client.query(text, values);
      },
    };
    await expect(materializePayoutV2ShadowPlanInTransaction({
      client: failingClient,
      schoolId: Number(schoolId),
      reviewedPlan: plan,
    })).rejects.toThrow('injected_batch_failure');
    await client.query('ROLLBACK TO SAVEPOINT payout_v2_partial_writer');
    const count = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM booking_earnings
           WHERE school_id = $1 AND booking_id = $2)::int AS earnings,
         (SELECT COUNT(*) FROM payout_batches
           WHERE school_id = $1 AND plan_fingerprint = $3)::int AS batches`,
      [schoolId, bookingId, plan.plan_fingerprint]
    );
    expect(count.rows[0]).toEqual({ earnings: 0, batches: 0 });
  });

  test('materialises a full-offset recovery application and carries the remainder', async () => {
    const recovery = await client.query(
      `INSERT INTO payout_adjustments (
         school_id, instructor_id, adjustment_type, amount_pence, currency,
         reason, evidence_reference, operator_id, status,
         adjustment_fingerprint, metadata
       )
       VALUES (
         $1, $2, 'recovery', -9000, 'gbp',
         'rollback-only recovery fixture',
         'forensic:payout-v2:rollback-fixture',
         1, 'pending', $3,
         jsonb_build_object(
           'recovery_policy', 'full_available_offset',
           'source_v1_payout_id', 999999,
           'source_stripe_transfer_id', 'tr_rollback_fixture',
           'source_legacy_booking_ids', jsonb_build_array($4::integer),
           'original_recovery_pence', 9000
         )
       )
       RETURNING id`,
      [schoolId, instructorId, `sha256:${'f'.repeat(64)}`, bookingId]
    );
    const plan = await reviewedPlan();
    expect(plan.totals).toMatchObject({
      recovery_deducted_pence: 8200,
      net_shadow_transfer_pence: 0,
      remaining_recovery_pence: 800,
    });
    const result = await materializePayoutV2ShadowPlanInTransaction({
      client,
      schoolId: Number(schoolId),
      reviewedPlan: plan,
    });
    expect(result.recovery_application_ids).toHaveLength(1);
    const application = await client.query(
      `SELECT
         parent_adjustment_id,
         payout_batch_id::int AS payout_batch_id,
         amount_pence,
         adjustment_type,
         status
       FROM payout_adjustments
       WHERE school_id = $1
         AND id = $2`,
      [schoolId, result.recovery_application_ids[0]]
    );
    expect(application.rows[0]).toMatchObject({
      parent_adjustment_id: recovery.rows[0].id,
      payout_batch_id: result.batch_id,
      amount_pence: 8200,
      adjustment_type: 'recovery_application',
      status: 'applied',
    });
    const transfers = await client.query(
      `SELECT COUNT(*)::int AS rows
       FROM payout_transfers
       WHERE school_id = $1
         AND payout_batch_id = $2`,
      [schoolId, result.batch_id]
    );
    expect(transfers.rows[0].rows).toBe(0);
  });

  test('earning reconciliation diagnostic parses and returns no blockers', async () => {
    const plan = await reviewedPlan();
    await materializePayoutV2ShadowPlanInTransaction({
      client,
      schoolId: Number(schoolId),
      reviewedPlan: plan,
    });
    const statements = earningDiagnosticSql
      .replaceAll(":'school_id'", String(schoolId))
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements.length).toBe(7);
    for (const statement of statements) {
      const result = await client.query(statement);
      expect(result.rows).toEqual([]);
    }
  });
});
