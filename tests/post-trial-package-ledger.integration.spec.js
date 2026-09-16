const { test, expect } = require('@playwright/test');
const { Client } = require('pg');

const connectionString = process.env.PACKAGE_TEST_DATABASE_URL;
const loopbackDatabase = (() => {
  if (!connectionString) return false;
  try {
    return ['127.0.0.1', 'localhost', '::1'].includes(new URL(connectionString).hostname);
  } catch (_) {
    return false;
  }
})();

test.describe('migration 068 exact-cash ledger', () => {
  test.skip(!loopbackDatabase, 'PACKAGE_TEST_DATABASE_URL must target disposable loopback PostgreSQL');

  test('conserves uneven pennies through return, reduction, reschedule and drain', async () => {
    const db = new Client({ connectionString });
    await db.connect();
    await db.query('BEGIN');
    try {
      await db.query(`INSERT INTO migration_markers(key,notes) VALUES
        ('public_endpoints_tenant_resolved','temporary package ledger integration fixture')
        ON CONFLICT (key) DO NOTHING`);
      const school = (await db.query(`INSERT INTO schools(name,slug) VALUES ('Ledger test','ledger-'||gen_random_uuid()) RETURNING id`)).rows[0];
      const otherSchool = (await db.query(`INSERT INTO schools(name,slug) VALUES ('Other ledger test','other-ledger-'||gen_random_uuid()) RETURNING id`)).rows[0];
      const learner = (await db.query(`INSERT INTO learner_users(name,email,school_id) VALUES ('Ledger learner','ledger-'||gen_random_uuid()||'@test.invalid',$1) RETURNING id`, [school.id])).rows[0];
      const instructor = (await db.query(`INSERT INTO instructors(name,email,school_id) VALUES ('Ledger instructor','instructor-'||gen_random_uuid()||'@test.invalid',$1) RETURNING id`, [school.id])).rows[0];
      const admin = (await db.query(`INSERT INTO admin_users(name,email,password_hash,school_id) VALUES ('Ledger admin','admin-'||gen_random_uuid()||'@test.invalid','x',$1) RETURNING id`, [school.id])).rows[0];
      const bookingIds = [];
      for (let i = 0; i < 4; i += 1) {
        const row = (await db.query(`INSERT INTO lesson_bookings(learner_id,instructor_id,scheduled_date,start_time,end_time,status,school_id)
          VALUES ($1,$2,CURRENT_DATE + $3::integer,'10:00','11:00','scheduled',$4) RETURNING id`, [learner.id, instructor.id, i + 1, school.id])).rows[0];
        bookingIds.push(row.id);
      }
      const source = (await db.query(`INSERT INTO flexible_package_sources
        (school_id,learner_id,initial_units,unit_minutes,rate_pence_per_unit,original_value_pence,available_at,legacy_conversion)
        VALUES ($1,$2,20,30,50.05,1001,NOW(),$3::jsonb) RETURNING id`, [school.id, learner.id, JSON.stringify({
          request_id: 'ledger-test', fingerprint: 'ledger-test', instructor_id: String(instructor.id), minutes: 600,
          hourly_rate_pence: 100, evidence: {}, source_draws: [],
        })])).rows[0];
      const allocate = async (bookingId, units, pence) => (await db.query(`INSERT INTO flexible_package_booking_allocations
        (school_id,learner_id,source_id,booking_id,instructor_id,units_allocated,unit_minutes,rate_pence_per_unit,contribution_pence)
        VALUES ($1,$2,$3,$4,$5,$6,30,50.05,$7) RETURNING id`,
      [school.id, learner.id, source.id, bookingId, instructor.id, units, pence])).rows[0];

      const first = await allocate(bookingIds[0], 3, 150);
      const second = await allocate(bookingIds[1], 4, 200);
      await db.query(`INSERT INTO flexible_package_allocation_returns
        (school_id,allocation_id,booking_id,units_returned,reason) VALUES ($1,$2,$3,3,'rescheduled_48h_plus')`,
      [school.id, first.id, bookingIds[0]]);
      let remaining = (await db.query(`SELECT remaining_units::numeric,refundable_value_pence FROM flexible_package_source_remaining WHERE source_id=$1 AND school_id=$2`, [source.id, school.id])).rows[0];
      expect(Number(remaining.remaining_units)).toBe(16);
      expect(remaining.refundable_value_pence).toBe(801);

      await db.query(`INSERT INTO flexible_package_source_reductions
        (school_id,learner_id,source_id,units_reduced,rate_pence_per_unit,gross_refund_pence,stripe_fee_deduction_pence,
         learner_refund_pence,kind,provider_refund_id,evidence_reference,recorded_by_admin_id)
        VALUES ($1,$2,$3,2,50,100,0,100,'manual_original_method_refund',$4,'ledger test',$5)`,
      [school.id, learner.id, source.id, `re_${Date.now()}`, admin.id]);
      await db.query(`INSERT INTO flexible_package_allocation_returns
        (school_id,allocation_id,booking_id,units_returned,reason) VALUES ($1,$2,$3,4,'rescheduled_48h_plus')`,
      [school.id, second.id, bookingIds[1]]);
      await allocate(bookingIds[2], 4, 200);
      await allocate(bookingIds[3], 14, 701);

      remaining = (await db.query(`SELECT remaining_units::numeric,refundable_value_pence FROM flexible_package_source_remaining WHERE source_id=$1 AND school_id=$2`, [source.id, school.id])).rows[0];
      expect(Number(remaining.remaining_units)).toBe(0);
      expect(remaining.refundable_value_pence).toBe(0);
      const totals = (await db.query(`SELECT
        (SELECT COALESCE(SUM(a.contribution_pence),0) FROM flexible_package_booking_allocations a
          WHERE a.source_id=$1 AND NOT EXISTS (SELECT 1 FROM flexible_package_allocation_returns r WHERE r.allocation_id=a.id))::int active,
        (SELECT COALESCE(SUM(gross_refund_pence),0) FROM flexible_package_source_reductions WHERE source_id=$1)::int reduced`, [source.id])).rows[0];
      expect(totals.active + totals.reduced).toBe(1001);

      await expect(db.query(`INSERT INTO flexible_package_booking_allocations
        (school_id,learner_id,source_id,booking_id,instructor_id,units_allocated,unit_minutes,rate_pence_per_unit,contribution_pence)
        VALUES ($1,NULL,$2,$3,$4,1,30,50.05,50)`, [otherSchool.id, source.id, bookingIds[3], instructor.id]))
        .rejects.toMatchObject({ code: '23503' });
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  });
});
