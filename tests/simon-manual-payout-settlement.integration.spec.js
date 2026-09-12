// @ts-check
// Database-backed migration rehearsal. It is gated, refuses the configured
// Production URL, and rolls the entire DDL rehearsal back.

const { test, expect } = require('@playwright/test');
const { Client } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const enabled = process.env.CC_TEST_DB === '1' && Boolean(process.env.POSTGRES_URL_TEST);
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'migrations', '062_interim_v1_manual_payout_settlements.sql'),
  'utf8'
);
const boundaryMigrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'migrations', '057_interim_v1_manual_settlement_boundary.sql'),
  'utf8'
).replace(/^\+--/, '--');
const productionPreflightSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'diagnostics', 'simon-manual-payout-settlement-062-preflight.sql'),
  'utf8'
).replace(/BEGIN TRANSACTION READ ONLY;/, '').replace(/ROLLBACK;\s*$/, '');
const evidenceMigrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'migrations', '061_authoritative_payout_evidence.sql'),
  'utf8'
);
test.describe.configure({ mode: 'serial' });
function quotedIdentifier(value) {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error('Unsafe generated role identifier');
  return `"${value}"`;
}

test.describe('Simon manual payout settlement migration 062', () => {
  test.skip(!enabled, 'Requires CC_TEST_DB=1 and an isolated POSTGRES_URL_TEST');
  test.setTimeout(60_000);

  test('rehearses in a rolled-back non-Production transaction', async () => {
    if (process.env.POSTGRES_URL
        && process.env.POSTGRES_URL === process.env.POSTGRES_URL_TEST) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL');
    }
    const client = new Client({ connectionString: process.env.POSTGRES_URL_TEST });
    await client.connect();
    try {
      await client.query('BEGIN');
      const prerequisite = await client.query(
        `SELECT to_regclass('public.interim_v1_manual_settlement_boundaries')::text AS boundary,
                to_regclass('public.payout_funding_basis_events')::text AS funding_basis`
      );
      if (!prerequisite.rows[0].boundary) await client.query(boundaryMigrationSql);
      if (!prerequisite.rows[0].funding_basis) await client.query(evidenceMigrationSql);
      await client.query(migrationSql);
      await client.query(productionPreflightSql);

      const relations = await client.query(`
        SELECT to_regclass('public.interim_v1_manual_payout_settlements')::text AS settlements,
               to_regclass('public.interim_v1_manual_payout_settlement_bookings')::text AS bookings
      `);
      expect(relations.rows[0]).toEqual({
        settlements: 'interim_v1_manual_payout_settlements',
        bookings: 'interim_v1_manual_payout_settlement_bookings',
      });

      const moneyColumns = await client.query(`
        SELECT column_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'interim_v1_manual_payout_settlement_bookings'
           AND column_name ~ '(amount|pence|fee|currency)'
      `);
      expect(moneyColumns.rows).toEqual([]);

      const triggers = await client.query(`
        SELECT c.relname AS table_name, t.tgname AS trigger_name
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND t.tgname IN (
             'interim_v1_manual_payout_settlements_append_only',
             'interim_v1_manual_payout_bookings_append_only',
             'interim_v1_manual_payout_bookings_claim_guard',
             'payout_line_items_manual_settlement_guard',
             'school_payout_line_items_manual_settlement_guard',
             'booking_earnings_manual_settlement_guard',
             'stripe_launch_booking_earnings_manual_settlement_guard'
           )
         ORDER BY c.relname, t.tgname
      `);
      expect(triggers.rows).toHaveLength(7);
      expect(new Set(triggers.rows.map((row) => row.table_name))).toEqual(new Set([
        'interim_v1_manual_payout_settlements',
        'interim_v1_manual_payout_settlement_bookings',
        'payout_line_items',
        'school_payout_line_items',
        'booking_earnings',
        'stripe_launch_booking_earnings',
      ]));

      const rowCounts = await client.query(`
        SELECT
          (SELECT COUNT(*)::int FROM interim_v1_manual_payout_settlements) AS settlements,
          (SELECT COUNT(*)::int FROM interim_v1_manual_payout_settlement_bookings) AS bookings
      `);
      expect(rowCounts.rows[0]).toEqual({ settlements: 0, bookings: 0 });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
  });

  test('restricted runtime needs no launch-ledger SELECT while the security-definer guard remains active', async () => {
    if (process.env.POSTGRES_URL
        && process.env.POSTGRES_URL === process.env.POSTGRES_URL_TEST) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL');
    }
    const client = new Client({ connectionString: process.env.POSTGRES_URL_TEST });
    const suffix = crypto.randomBytes(6).toString('hex');
    const role = `cc_test_manual_settlement_${suffix}`;
    const roleIdentifier = quotedIdentifier(role);
    await client.connect();
    try {
      await client.query('BEGIN');
      const prerequisite = await client.query(
        `SELECT to_regclass('public.interim_v1_manual_settlement_boundaries')::text AS boundary,
                to_regclass('public.payout_funding_basis_events')::text AS funding_basis`
      );
      if (!prerequisite.rows[0].boundary) await client.query(boundaryMigrationSql);
      if (!prerequisite.rows[0].funding_basis) await client.query(evidenceMigrationSql);

      await client.query(migrationSql);
      let admin = await client.query(
        `SELECT id FROM admin_users WHERE school_id = 1 AND active = TRUE ORDER BY id LIMIT 1`
      );
      if (admin.rowCount !== 1) {
        admin = await client.query(
          `INSERT INTO admin_users (name, email, password_hash, role, active, school_id)
           VALUES ('Manual settlement test admin', $1, 'not-a-login', 'superadmin', TRUE, 1)
           RETURNING id`,
          [`manual-settlement-admin-${suffix}@example.test`]
        );
      }
      const instructor = await client.query(
        `INSERT INTO instructors (name, email, active, payouts_paused, school_id)
         VALUES ('Restricted runtime test instructor', $1, TRUE, TRUE, 1)
         RETURNING id`,
        [`manual-settlement-instructor-${suffix}@example.test`]
      );
      const instructorId = Number(instructor.rows[0].id);
      const learner = await client.query(
        `INSERT INTO learner_users (name, email, school_id, is_test_account)
         VALUES ('Restricted runtime test learner', $1, 1, FALSE)
         RETURNING id`,
        [`manual-settlement-learner-${suffix}@example.test`]
      );
      const booking = await client.query(
        `INSERT INTO lesson_bookings (
           learner_id, instructor_id, scheduled_date, start_time, end_time,
           status, school_id
         ) VALUES ($1, $2, '2026-09-05', '10:00', '11:00', 'chargeable', 1)
         RETURNING id`,
        [Number(learner.rows[0].id), instructorId]
      );
      const bookingId = Number(booking.rows[0].id);
      const boundaryId = crypto.randomUUID();
      await client.query(
        `INSERT INTO interim_v1_manual_settlement_boundaries (
           id, school_id, instructor_id, settled_before_at,
           first_system_period_end_at, time_zone, reason,
           evidence_reference, created_by_admin_id
         ) VALUES ($1, 1, $2, '2026-09-04T11:00:00Z',
           '2026-09-11T11:00:00Z', 'Europe/London',
           'Restricted runtime regression boundary', 'test-only', $3)`,
        [boundaryId, instructorId, Number(admin.rows[0].id)]
      );

      await client.query(`CREATE ROLE ${roleIdentifier} NOLOGIN`);
      await client.query(`GRANT ${roleIdentifier} TO CURRENT_USER`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${roleIdentifier}`);
      await client.query(`GRANT SELECT ON public.instructors,
        public.interim_v1_manual_settlement_boundaries, public.lesson_bookings,
        public.learner_users, public.payout_line_items, public.school_payout_line_items,
        public.school_payouts, public.booking_earnings,
        public.interim_v1_manual_payout_settlements,
        public.interim_v1_manual_payout_settlement_bookings TO ${roleIdentifier}`);
      await client.query(`GRANT INSERT ON public.interim_v1_manual_payout_settlements,
        public.interim_v1_manual_payout_settlement_bookings TO ${roleIdentifier}`);
      await client.query(`GRANT UPDATE ON public.lesson_bookings TO ${roleIdentifier}`);

      const privileges = await client.query(
        `SELECT has_table_privilege($1, 'public.stripe_launch_booking_earnings', 'SELECT') AS launch_select,
                has_table_privilege($1, 'public.interim_v1_manual_payout_settlements', 'INSERT') AS settlement_insert,
                has_table_privilege($1, 'public.interim_v1_manual_payout_settlement_bookings', 'INSERT') AS claim_insert,
                has_function_privilege($1, 'public.interim_v1_guard_manual_payout_booking_claim()', 'EXECUTE') AS guard_execute`,
        [role]
      );
      expect(privileges.rows[0]).toEqual({
        launch_select: false,
        settlement_insert: true,
        claim_insert: true,
        guard_execute: false,
      });

      await client.query(`SET LOCAL ROLE ${roleIdentifier}`);
      await client.query('SAVEPOINT denied_launch_read');
      let deniedRead;
      try {
        await client.query('SELECT 1 FROM stripe_launch_booking_earnings LIMIT 1');
      } catch (error) {
        deniedRead = error;
      }
      expect(deniedRead?.code).toBe('42501');
      await client.query('ROLLBACK TO SAVEPOINT denied_launch_read');
      await client.query('RELEASE SAVEPOINT denied_launch_read');

      const bookings = await client.query(
        `SELECT lb.id AS booking_id,
                ((lb.scheduled_date + lb.end_time) AT TIME ZONE mb.time_zone) AS booking_ends_at,
                pli.id AS direct_claim_id, school_claim.id AS school_claim_id,
                earning.id AS v2_earning_id,
                existing_manual.settlement_id AS manual_settlement_id
           FROM lesson_bookings lb
           JOIN learner_users lu
             ON lu.id = lb.learner_id AND lu.school_id = lb.school_id
           JOIN interim_v1_manual_settlement_boundaries mb
             ON mb.school_id = lb.school_id AND mb.instructor_id = lb.instructor_id
           LEFT JOIN payout_line_items pli
             ON pli.school_id = lb.school_id AND pli.booking_id = lb.id
           LEFT JOIN LATERAL (
             SELECT spli.id
               FROM school_payout_line_items spli
               JOIN school_payouts sp
                 ON sp.id = spli.school_payout_id AND sp.school_id = lb.school_id
              WHERE spli.booking_id = lb.id
              LIMIT 1
           ) school_claim ON TRUE
           LEFT JOIN booking_earnings earning
             ON earning.school_id = lb.school_id AND earning.booking_id = lb.id
           LEFT JOIN interim_v1_manual_payout_settlement_bookings existing_manual
             ON existing_manual.school_id = lb.school_id AND existing_manual.booking_id = lb.id
          WHERE lb.school_id = 1 AND lb.instructor_id = $1
            AND lb.status = 'chargeable'
            AND COALESCE(lu.is_test_account, FALSE) = FALSE
            AND ((lb.scheduled_date + lb.end_time) AT TIME ZONE mb.time_zone) >= mb.settled_before_at
            AND ((lb.scheduled_date + lb.end_time) AT TIME ZONE mb.time_zone) < mb.first_system_period_end_at
          ORDER BY lb.id
          FOR UPDATE OF lb`,
        [instructorId]
      );
      expect(bookings.rows.map((row) => Number(row.booking_id))).toEqual([bookingId]);

      const settlementId = crypto.randomUUID();
      await client.query(
        `INSERT INTO interim_v1_manual_payout_settlements (
           id, school_id, instructor_id, manual_settlement_boundary_id,
           period_start_at, period_end_at, time_zone,
           authoritative_earning_pence, franchise_fee_deducted_pence,
           bank_payment_pence, currency, paid_local_date, bank_reference,
           covered_booking_count, evidence_reference, reason,
           idempotency_key, settlement_fingerprint, created_by_admin_id
         ) VALUES (
           $1, 1, $2, $3,
           '2026-09-04T11:00:00Z', '2026-09-11T11:00:00Z', 'Europe/London',
           5500, 0, 5500, 'gbp', '2026-09-11', 'restricted-role-test',
           1, 'restricted-role-regression', 'Rolled-back restricted-role rehearsal',
           $4, $5, $6
         )`,
        [settlementId, instructorId, boundaryId,
          `cc-interim-v1-manual-settlement-${settlementId}`,
          `sha256:${crypto.randomBytes(32).toString('hex')}`, Number(admin.rows[0].id)]
      );
      for (const booking of bookings.rows) {
        await client.query(
          `INSERT INTO interim_v1_manual_payout_settlement_bookings (
             settlement_id, school_id, instructor_id, booking_id, booking_ends_at
           ) VALUES ($1, 1, $2, $3, $4)`,
          [settlementId, instructorId, Number(booking.booking_id), booking.booking_ends_at]
        );
      }
      const claims = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM interim_v1_manual_payout_settlement_bookings
          WHERE school_id = 1 AND settlement_id = $1`,
        [settlementId]
      );
      expect(claims.rows[0].count).toBe(1);

      await client.query('ROLLBACK');
      const residue = await client.query(
        `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS role_exists,
                (SELECT COUNT(*)::int FROM admin_users WHERE email LIKE $2) AS admins,
                (SELECT COUNT(*)::int FROM instructors WHERE email LIKE $2) AS instructors,
                (SELECT COUNT(*)::int FROM learner_users WHERE email LIKE $2) AS learners`,
        [role, `%${suffix}%`]
      );
      expect(residue.rows[0]).toEqual({
        role_exists: false,
        admins: 0,
        instructors: 0,
        learners: 0,
      });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
  });
});
