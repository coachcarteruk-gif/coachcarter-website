'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { createBankDatabase } = require('./helpers/flexible-bank-database');
const { validateBankPurchase, recordBankPurchase } = require('../api/_flexible-bank-purchase');
const { correctDeliveredDuration, DurationCorrectionError } = require('../api/_delivered-duration-correction');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const admin = { id: 1, email: 'admin@example.test' };
let db, client;
const query = async (text, args) => {
  const result = await db.query(text, args);
  return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
};
const sql = async (strings, ...values) => (await query(strings.reduce((s, p, i) => s + (i ? '$' + i : '') + p, ''), values)).rows;
async function snapshot() {
  return (await query(`SELECT *,scheduled_date::text AS scheduled_date,start_time::text AS start_time,end_time::text AS end_time
    FROM lesson_bookings WHERE id=501`)).rows[0];
}
async function correction(lessonTypeId = 2, extra = {}) {
  const expected = await snapshot();
  const args = { schoolId: 1, bookingId: 501, lessonTypeId, expected,
    changes: { scheduled_date: expected.scheduled_date, start_time: expected.start_time.slice(0, 5),
      pickup_address: null, dropoff_address: null, notes: 'Actual delivered length' }, admin, req: { headers: {} },
    now: new Date('2026-09-27T12:00:00Z'), ...extra };
  await db.exec('SAVEPOINT correction');
  try { const result = await correctDeliveredDuration(client, args); await db.exec('RELEASE SAVEPOINT correction'); return result; }
  catch (err) { await db.exec('ROLLBACK TO SAVEPOINT correction'); throw err; }
}
async function seedFlexible() {
  await recordBankPurchase(client, { schoolId: 1, admin, req: { headers: {} }, input: validateBankPurchase({
    client_request_id: crypto.randomUUID(), learner_id: 41, product_version_id: 30, amount_pence: 81000,
    received_on: '2026-09-24', bank_reference: 'duration-fixture', consent_evidence_reference: 'fixture', reason: 'fixture',
    funds_received_confirmed: true, adult_age_confirmed: true, consumer_terms_accepted: true,
    immediate_access_requested: true, disclosure_version: 'flexible-hours-consumer-rights-v1',
  }) });
  await db.exec(`UPDATE lesson_bookings SET payment_method='flexible_package',list_price_pence=8100 WHERE id=501;
    INSERT INTO flexible_package_booking_allocations
      (school_id,learner_id,source_id,booking_id,instructor_id,units_allocated,unit_minutes,rate_pence_per_unit,contribution_pence)
    SELECT 1,41,id,501,1,3,30,2700,8100 FROM flexible_package_sources WHERE learner_id=41;`);
  await db.exec('DELETE FROM booking_credit_sources; DELETE FROM credit_transactions; UPDATE learner_credit_balances SET balance_minutes=0');
}

test.describe('delivered duration corrections against PostgreSQL', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async () => {
    db = await createBankDatabase();
    client = { query };
    await db.exec(read('db/migrations/058_legacy_schoolwide_hours.sql'));
    await db.exec(read('db/migrations/063_flexible_allocation_replacement_history.sql'));
    // Apply the actual 068 allocation/value changes without its unrelated
    // post-trial quote dependencies, then the new return-reason migration.
    const migration = read('db/migrations/068_post_trial_package_snapshots.sql');
    await db.exec(migration.slice(migration.indexOf('ALTER TABLE flexible_package_booking_allocations'), migration.indexOf('ALTER TABLE package_purchase_attempts', migration.indexOf('ALTER TABLE flexible_package_booking_allocations'))));
    await db.exec(read('db/migrations/073_delivered_duration_corrections.sql'));
    await db.exec(`
      ALTER TABLE lesson_bookings ADD learner_id INTEGER DEFAULT 41, ADD instructor_id INTEGER DEFAULT 1,
        ADD status TEXT DEFAULT 'chargeable', ADD scheduled_date DATE DEFAULT '2026-09-25',
        ADD start_time TIME DEFAULT '10:00', ADD end_time TIME DEFAULT '11:30',
        ADD lesson_type_id INTEGER DEFAULT 1, ADD minutes_deducted INTEGER DEFAULT 90,
        ADD list_price_pence INTEGER DEFAULT 8100, ADD payment_method TEXT DEFAULT 'credit',
        ADD cancelled_at TIMESTAMPTZ, ADD credit_returned BOOLEAN DEFAULT FALSE, ADD credit_forfeited BOOLEAN DEFAULT FALSE,
        ADD lesson_payment_contract_id UUID, ADD pickup_address TEXT, ADD dropoff_address TEXT,
        ADD instructor_notes TEXT, ADD notes TEXT, ADD edited_at TIMESTAMPTZ, ADD setmore_key TEXT;
      ALTER TABLE instructors ADD buffer_minutes INTEGER DEFAULT 30;
      CREATE TABLE lesson_types(id INTEGER PRIMARY KEY, school_id INTEGER, duration_minutes INTEGER);
      INSERT INTO lesson_types VALUES (1,1,90),(2,1,60),(3,1,120),(4,2,60),(5,1,75);
      CREATE TABLE learner_credit_balances(learner_id INTEGER,instructor_id INTEGER,school_id INTEGER,balance_minutes INTEGER,updated_at TIMESTAMPTZ);
      CREATE TABLE credit_transactions(id SERIAL PRIMARY KEY,learner_id INTEGER,instructor_id INTEGER,school_id INTEGER,
        type TEXT,minutes INTEGER,amount_pence INTEGER,effective_rate_pence_per_minute INTEGER,stripe_fee_pence INTEGER,absorbed_by TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE booking_credit_sources(id SERIAL PRIMARY KEY,school_id INTEGER,booking_id INTEGER,credit_transaction_id INTEGER,
        minutes_drawn INTEGER,rate_pence_per_minute INTEGER,contribution_pence INTEGER,stripe_fee_pence INTEGER,absorbed_by TEXT,refunded_at TIMESTAMPTZ,
        UNIQUE(booking_id,credit_transaction_id));
      CREATE TABLE credit_source_adjustments(credit_transaction_id INTEGER,minutes_adjusted INTEGER,pence_adjusted INTEGER);
      CREATE TABLE payout_line_items(booking_id INTEGER,school_id INTEGER);
      CREATE TABLE interim_v1_manual_payout_settlement_bookings(booking_id INTEGER,school_id INTEGER);
      CREATE TABLE booking_earnings(booking_id INTEGER,school_id INTEGER);
      CREATE TABLE school_payouts(id INTEGER,school_id INTEGER);
      CREATE TABLE school_payout_line_items(booking_id INTEGER,school_payout_id INTEGER);
      CREATE TABLE stripe_launch_booking_earnings(payment_contract_id UUID,school_id INTEGER);
      CREATE TABLE lesson_offers(extension_booking_id INTEGER,school_id INTEGER,instructor_id INTEGER,status TEXT,stripe_session_id TEXT);
    `);
    await db.exec(read('db/migrations/064_booking_credit_source_replacement_history.sql'));
  });
  test.afterAll(async () => { await db?.close(); });
  test.beforeEach(async () => {
    await db.exec(`BEGIN;
      INSERT INTO learner_credit_balances VALUES (41,1,1,30,NOW()),(41,2,1,600,NOW());
      INSERT INTO credit_transactions(id,learner_id,instructor_id,school_id,type,minutes,amount_pence,effective_rate_pence_per_minute,stripe_fee_pence)
        VALUES (1,41,1,1,'purchase',120,10800,90,120);
      INSERT INTO booking_credit_sources(school_id,booking_id,credit_transaction_id,minutes_drawn,rate_pence_per_minute,contribution_pence,stripe_fee_pence)
        VALUES (1,501,1,90,90,8100,90);
    `);
  });
  test.afterEach(async () => { await db.exec('ROLLBACK'); });

  async function instructorRequest(body = {}, auth = { id: 1, school_id: 1, email: 'instructor@example.test' }, method = 'POST') {
    const source = read('api/instructor.js');
    const context = { process: { env: { POSTGRES_URL: 'test-only' } }, verifyInstructorAuth: () => auth,
      correctDeliveredDuration, DurationCorrectionError, expireExtensionCheckoutSessions: async () => {},
      withNeonTransaction: async (_options, callback) => {
        await db.exec('SAVEPOINT instructor_route');
        try { const result = await callback(client); await db.exec('RELEASE SAVEPOINT instructor_route'); return result; }
        catch (error) { await db.exec('ROLLBACK TO SAVEPOINT instructor_route'); throw error; }
      }, console, reportError: () => {},
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('async function handleCorrectDeliveredDuration('), source.indexOf('async function handleEditBooking(')), context);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await context.handleCorrectDeliveredDuration({ method, headers: {}, body: {
      booking_id: 501, lesson_type_id: 2, expected_duration_minutes: 90, ...body,
    } }, res);
    return res;
  }

  for (const payment of ['credit', 'flexible_package']) {
    test(`instructor corrects own completed ${payment} lesson and a stale retry cannot return hours twice`, async () => {
      if (payment === 'flexible_package') await seedFlexible();
      await db.exec("UPDATE lesson_bookings SET instructor_notes='Keep my notes',pickup_address='Original pickup' WHERE id=501");
      const result = await instructorRequest({ scheduled_date: '2099-01-01', start_time: '18:00', instructor_id: 2, school_id: 2 });
      expect(result.statusCode).toBe(200);
      expect(result.body).toMatchObject({ ok: true, minutes_returned: 30 });
      expect(await snapshot()).toMatchObject({ status: 'chargeable', end_time: '11:00:00', minutes_deducted: 60,
        list_price_pence: 5400, scheduled_date: '2026-09-25', instructor_notes: 'Keep my notes', pickup_address: 'Original pickup' });
      const audit = (await query("SELECT * FROM audit_log WHERE action='instructor.correct_delivered_duration'")).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0].admin_id).toBeNull();
      expect(audit[0].details).toMatchObject({ instructor_id: 1, impersonation: false });
      expect((await instructorRequest()).body.code).toBe('BOOKING_CHANGED');
    });
  }

  test('instructor route enforces auth, school, ownership, method and validated inputs', async () => {
    expect((await instructorRequest({}, null)).statusCode).toBe(401);
    expect((await instructorRequest({}, undefined, 'GET')).statusCode).toBe(405);
    expect((await instructorRequest({}, { id: 2, school_id: 1 })).statusCode).toBe(404);
    expect((await instructorRequest({}, { id: 1, school_id: 2 })).statusCode).toBe(404);
    expect((await instructorRequest({ expected_duration_minutes: null })).statusCode).toBe(400);
    expect((await instructorRequest({ lesson_type_id: 4 })).body.code).toBe('INVALID_DURATION');
    await expect(correction(2, { instructor: { id: 2, school_id: 1 } })).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    expect(await snapshot()).toMatchObject({ minutes_deducted: 90 });
    expect((await query('SELECT * FROM booking_credit_sources')).rows).toHaveLength(1);
  });

  test('instructor route allows past scheduled lessons, preserves support actor and refuses claimed lessons', async () => {
    await db.exec("UPDATE lesson_bookings SET status='scheduled' WHERE id=501");
    await db.exec('INSERT INTO payout_line_items VALUES (501,1)');
    expect((await instructorRequest()).body.code).toBe('BOOKING_PAID_OUT');
    await db.exec('DELETE FROM payout_line_items');
    const result = await instructorRequest({}, { id: 1, school_id: 1, impersonation: true,
      impersonated_by_admin_id: 1, impersonated_by_admin_email: 'support@example.test' });
    expect(result.statusCode).toBe(200);
    expect(await snapshot()).toMatchObject({ status: 'scheduled', minutes_deducted: 60 });
    const audit = (await query("SELECT * FROM audit_log WHERE action='instructor.correct_delivered_duration'")).rows[0];
    expect(audit).toMatchObject({ admin_id: 1, admin_email: 'support@example.test', details: { instructor_id: 1, impersonation: true } });
  });

  test('90 → 60 returns 30 scoped minutes and preserves original value/fee evidence', async () => {
    expect(await correction()).toMatchObject({ ok: true, minutes_returned: 30 });
    expect(await snapshot()).toMatchObject({ end_time: '11:00:00', minutes_deducted: 60, list_price_pence: 5400, status: 'chargeable' });
    const rows = (await query('SELECT * FROM booking_credit_sources ORDER BY id')).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ minutes_drawn: 90, contribution_pence: 8100, stripe_fee_pence: 90 });
    expect(rows[0].refunded_at).not.toBeNull();
    expect(rows[1]).toMatchObject({ minutes_drawn: 60, contribution_pence: 5400, stripe_fee_pence: 60, refunded_at: null });
    expect((await query('SELECT balance_minutes FROM learner_credit_balances ORDER BY instructor_id')).rows).toEqual([{ balance_minutes: 60 }, { balance_minutes: 600 }]);
    expect((await query('SELECT * FROM credit_transactions')).rows).toHaveLength(1);
    expect((await query("SELECT * FROM audit_log WHERE action='admin.correct_delivered_duration'")).rows).toHaveLength(1);
  });

  test('lengthening consumes only available same-instructor sources; later shortening remains exact', async () => {
    await correction(3);
    expect(await snapshot()).toMatchObject({ minutes_deducted: 120, list_price_pence: 10800 });
    expect((await query('SELECT balance_minutes FROM learner_credit_balances WHERE instructor_id=1')).rows[0].balance_minutes).toBe(0);
    await correction(2);
    expect((await query('SELECT balance_minutes FROM learner_credit_balances WHERE instructor_id=1')).rows[0].balance_minutes).toBe(60);
  });

  test('mixed-rate shortening preserves earlier sources and apportions the final source exactly', async () => {
    await db.exec(`UPDATE credit_transactions SET minutes=60,amount_pence=5001,stripe_fee_pence=101 WHERE id=1;
      UPDATE booking_credit_sources SET minutes_drawn=60,contribution_pence=5001,stripe_fee_pence=101;
      INSERT INTO credit_transactions(id,learner_id,instructor_id,school_id,type,minutes,amount_pence,effective_rate_pence_per_minute,stripe_fee_pence)
        VALUES (2,41,1,1,'purchase',60,6001,100,121);
      INSERT INTO booking_credit_sources(school_id,booking_id,credit_transaction_id,minutes_drawn,rate_pence_per_minute,contribution_pence,stripe_fee_pence)
        VALUES (1,501,2,30,100,3001,61);
      UPDATE lesson_bookings SET list_price_pence=8002 WHERE id=501;`);
    await correction(5);
    const current = (await query('SELECT * FROM booking_credit_sources WHERE refunded_at IS NULL ORDER BY credit_transaction_id')).rows;
    expect(current[0]).toMatchObject({ minutes_drawn: 60, contribution_pence: 5001, stripe_fee_pence: 101 });
    expect(current[1]).toMatchObject({ minutes_drawn: 15, contribution_pence: 1501, stripe_fee_pence: 31 });
    expect(await snapshot()).toMatchObject({ minutes_deducted: 75, list_price_pence: 6502 });
  });

  test('Flexible Hours shortening/lengthening uses append-only allocations and never touches LCB', async () => {
    await seedFlexible();
    await correction(2);
    expect(await snapshot()).toMatchObject({ minutes_deducted: 60, list_price_pence: 5400 });
    expect((await query('SELECT remaining_minutes FROM flexible_package_balances WHERE learner_id=41')).rows[0].remaining_minutes).toBe(840);
    expect((await query('SELECT * FROM flexible_package_allocation_returns')).rows[0]).toMatchObject({ units_returned: '3', reason: 'delivered_duration_correction' });
    await correction(3);
    expect(await snapshot()).toMatchObject({ minutes_deducted: 120, list_price_pence: 10800 });
    expect((await query('SELECT remaining_minutes FROM flexible_package_balances WHERE learner_id=41')).rows[0].remaining_minutes).toBe(780);
    expect((await query('SELECT balance_minutes FROM learner_credit_balances WHERE instructor_id=1')).rows[0].balance_minutes).toBe(0);
    expect((await query('SELECT * FROM credit_transactions')).rows).toHaveLength(0);
    expect((await query('SELECT * FROM booking_credit_sources')).rows).toHaveLength(0);
  });

  test('future, cancelled, refunded, payout-claimed, wrong-school and stale edits make no changes', async () => {
    for (const update of ["status='refunded'", "cancelled_at=NOW()", "credit_forfeited=TRUE", "scheduled_date='2099-01-01'"]) {
      await db.exec('SAVEPOINT scenario');
      await db.exec('UPDATE lesson_bookings SET ' + update + ' WHERE id=501');
      await expect(correction()).rejects.toBeInstanceOf(DurationCorrectionError);
      await db.exec('ROLLBACK TO SAVEPOINT scenario');
    }
    for (const table of ['payout_line_items', 'interim_v1_manual_payout_settlement_bookings', 'booking_earnings']) {
      await db.exec('SAVEPOINT claim');
      await db.exec('INSERT INTO ' + table + ' VALUES (501,1)');
      await expect(correction()).rejects.toMatchObject({ code: 'BOOKING_PAID_OUT' });
      await db.exec('ROLLBACK TO SAVEPOINT claim');
    }
    await expect(correction(2, { schoolId: 2 })).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    await expect(correction(4)).rejects.toMatchObject({ code: 'INVALID_DURATION' });
    await expect(correction(2, { expected: { ...await snapshot(), expected_duration_minutes: 120 } })).rejects.toMatchObject({ code: 'BOOKING_CHANGED' });
    await db.exec('UPDATE lesson_bookings SET learner_id=99 WHERE id=501');
    await expect(correction()).rejects.toMatchObject({ code: 'BOOKING_SCOPE_MISMATCH' });
    expect((await query('SELECT * FROM booking_credit_sources')).rows).toHaveLength(1);
  });

  test('past scheduled lessons work before the completion cron; school timezone governs the boundary', async () => {
    await db.exec("UPDATE lesson_bookings SET status='scheduled',scheduled_date='2026-09-27' WHERE id=501");
    await expect(correction(2, { now: new Date('2026-09-27T10:29:59Z') })).rejects.toMatchObject({ code: 'NOT_DELIVERED' });
    await correction(2, { now: new Date('2026-09-27T10:30:01Z') });
    expect(await snapshot()).toMatchObject({ status: 'scheduled', minutes_deducted: 60 });
  });

  test('replaying a stale correction cannot return the same minutes twice', async () => {
    const expected = await snapshot();
    await correction(2, { expected });
    await expect(correction(2, { expected })).rejects.toMatchObject({ code: 'BOOKING_CHANGED' });
    expect((await query('SELECT balance_minutes FROM learner_credit_balances WHERE instructor_id=1')).rows[0].balance_minutes).toBe(60);
    expect((await query("SELECT * FROM audit_log WHERE action='admin.correct_delivered_duration'")).rows).toHaveLength(1);
  });

  test('longer corrections that finish in the future or overlap another lesson are refused', async () => {
    await db.exec("UPDATE lesson_bookings SET scheduled_date='2026-09-27' WHERE id=501");
    await expect(correction(3, { now: new Date('2026-09-27T10:45:00Z') })).rejects.toMatchObject({ code: 'NOT_DELIVERED' });
    await db.exec("INSERT INTO lesson_bookings(id,school_id,scheduled_date,start_time,end_time) VALUES (502,1,'2026-09-27','11:30','12:30')");
    await expect(correction(3)).rejects.toMatchObject({ code: 'LESSON_OVERLAP' });
  });

  test('Flexible Hours rejects mixed funding and rolls back allocation returns on audit failure', async () => {
    await seedFlexible();
    await db.exec(`INSERT INTO booking_credit_sources(school_id,booking_id,credit_transaction_id,minutes_drawn,contribution_pence,stripe_fee_pence)
      VALUES (1,501,999,90,8100,0)`);
    await expect(correction()).rejects.toMatchObject({ code: 'MIXED_FUNDING' });
    await db.exec('DELETE FROM booking_credit_sources');
    const realClient = client;
    client = { query: (text, args) => {
      if (text.includes('INSERT INTO audit_log')) throw new Error('simulated audit outage');
      return query(text, args);
    } };
    try { await expect(correction()).rejects.toThrow('simulated audit outage'); }
    finally { client = realClient; }
    expect((await query('SELECT * FROM flexible_package_allocation_returns')).rows).toHaveLength(0);
    expect((await query('SELECT * FROM flexible_package_booking_allocations')).rows).toHaveLength(1);
    expect(await snapshot()).toMatchObject({ minutes_deducted: 90 });
  });

  test('Flexible Hours cannot lengthen without enough package units', async () => {
    await seedFlexible();
    await db.exec(`INSERT INTO lesson_bookings(id,school_id,scheduled_date) VALUES (502,1,'2026-09-24');
      INSERT INTO flexible_package_booking_allocations
        (school_id,learner_id,source_id,booking_id,instructor_id,units_allocated,unit_minutes,rate_pence_per_unit,contribution_pence)
      SELECT 1,41,id,502,1,27,30,2700,72900 FROM flexible_package_sources WHERE learner_id=41;`);
    await expect(correction(3)).rejects.toMatchObject({ code: 'INSUFFICIENT_FLEXIBLE_UNITS' });
    expect((await query('SELECT * FROM flexible_package_allocation_returns')).rows).toHaveLength(0);
  });

  test('insufficient instructor balance cannot spend another instructor credit', async () => {
    await db.exec('UPDATE credit_transactions SET minutes=90,amount_pence=8100,stripe_fee_pence=90 WHERE id=1; UPDATE learner_credit_balances SET balance_minutes=0 WHERE instructor_id=1');
    await expect(correction(3)).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect((await query('SELECT * FROM booking_credit_sources')).rows).toHaveLength(1);
  });

  test('funding mismatch and incompatible Flexible Hours durations are rejected', async () => {
    await db.exec('UPDATE learner_credit_balances SET balance_minutes=999 WHERE instructor_id=1');
    await expect(correction()).rejects.toMatchObject({ code: 'FUNDING_MISMATCH' });
    await seedFlexible();
    await expect(correction(5)).rejects.toMatchObject({ code: 'FLEXIBLE_DURATION_INVALID' });
    expect((await query('SELECT * FROM flexible_package_allocation_returns')).rows).toHaveLength(0);
  });

  test('audit failure rolls back booking, credit, source replacements and pending-offer cancellation', async () => {
    await db.exec("INSERT INTO lesson_offers VALUES (501,1,1,'pending','cs_test_fixture')");
    const realClient = client;
    client = { query: (text, args) => {
      if (text.includes('INSERT INTO audit_log')) throw new Error('simulated audit outage');
      return query(text, args);
    } };
    try { await expect(correction()).rejects.toThrow('simulated audit outage'); }
    finally { client = realClient; }
    expect(await snapshot()).toMatchObject({ minutes_deducted: 90, list_price_pence: 8100 });
    expect((await query('SELECT * FROM booking_credit_sources')).rows).toHaveLength(1);
    expect((await query('SELECT balance_minutes FROM learner_credit_balances WHERE instructor_id=1')).rows[0].balance_minutes).toBe(30);
    expect((await query('SELECT status FROM lesson_offers')).rows[0].status).toBe('pending');
  });

  test('admin edit endpoint routes the real 90-to-60 request through the atomic correction', async () => {
    const source = read('api/admin.js');
    const body = source.slice(source.indexOf('async function handleEditBooking('), source.indexOf('\nfunction adminClientSqlTag'));
    const context = { neon: () => sql, process: { env: { POSTGRES_URL: 'test-only' } },
      verifyAdminJWT: () => admin, getAdminSchoolId: () => 1, SCHEDULED: 'scheduled', CHARGEABLE: 'chargeable',
      normaliseAdminTimeHHMM: value => value, isValidAdminIsoDate: () => true,
      correctDeliveredDuration, DurationCorrectionError, expireExtensionCheckoutSessions: async () => {},
      withNeonTransaction: async (_options, callback) => {
        await db.exec('SAVEPOINT route');
        try { const result = await callback(client); await db.exec('RELEASE SAVEPOINT route'); return result; }
        catch (error) { await db.exec('ROLLBACK TO SAVEPOINT route'); throw error; }
      }, console, reportError: () => {},
    };
    vm.createContext(context); vm.runInContext(body, context);
    const res = { statusCode: 200, status(code) { this.statusCode=code;return this; }, json(value) { this.body=value;return this; } };
    await context.handleEditBooking({ method: 'POST', body: { booking_id: 501, lesson_type_id: 2, expected_duration_minutes: 90 }, headers: {} }, res);
    expect(res.statusCode).toBe(200); expect(res.body).toMatchObject({ ok: true, minutes_returned: 30 });
    expect(await snapshot()).toMatchObject({ minutes_deducted: 60 });
  });
});
