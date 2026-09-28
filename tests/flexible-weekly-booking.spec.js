'use strict';
const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createBankDatabase, content } = require('./helpers/flexible-bank-database');
const { recordBankPurchase, validateBankPurchase } = require('../api/_flexible-bank-purchase');
const { parseWeeklyBooking, commitWeeklyBooking, taggedClient, weeklySchemaReady } = require('../api/_flexible-weekly-booking');
const { cancelFlexiblePackageBookingWithClient, moveFlexiblePackageBookingAllocations } = require('../api/_flexible-package-ledger');
process.env.STRIPE_SECRET_KEY ||= 'sk_test_weekly';
const { _validateFlexibleWeeklySlots: validateSlots, _handleFlexibleWeekly: handleWeekly } = require('../api/slots');

function futureDate(days = 7) {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const body = (overrides = {}) => ({ instructor_id: 1, lesson_type_id: 1, date: futureDate(),
  start_time: '10:00', end_time: '11:30', repeat_weeks: 4, transmission_type: 'manual',
  pickup_address: 'Test address', funding_method: 'flexible_package', ...overrides });
let db;
async function transaction(_connection, callback) {
  await db.exec('SAVEPOINT weekly_test');
  const client = { query: async (sql, params) => {
    const result = await db.query(sql, params);
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
  } };
  try { const result = await callback(client); await db.exec('RELEASE SAVEPOINT weekly_test'); return result; }
  catch (error) { await db.exec('ROLLBACK TO SAVEPOINT weekly_test; RELEASE SAVEPOINT weekly_test'); throw error; }
}
async function book(overrides = {}, options = {}) {
  return commitWeeklyBooking({ schoolId: 1, learnerId: 41, input: parseWeeklyBooking(body(overrides)),
    clientRequestId: crypto.randomUUID(), validateSlots, transaction, ...options });
}
async function seedPurchase(overrides = {}) {
  const client = { query: async (sql, params) => {
    const result = await db.query(sql, params);
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
  } };
  await recordBankPurchase(client, { schoolId: 1, admin: { id: 1, role: 'admin' }, req: {},
    input: validateBankPurchase({ client_request_id: crypto.randomUUID(), learner_id: 41,
      product_version_id: 30, amount_pence: 81000, received_on: new Date().toISOString().slice(0, 10),
      bank_reference: crypto.randomUUID(), consent_evidence_reference: 'Test agreement', reason: 'Test receipt',
      funds_received_confirmed: true, adult_age_confirmed: true, consumer_terms_accepted: true,
      immediate_access_requested: true, disclosure_version: 'flexible-hours-consumer-rights-v1', ...overrides }) });
}

test.describe('Flexible Hours weekly booking on PostgreSQL', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async () => {
    db = await createBankDatabase();
    await db.exec(`
      ALTER TABLE learner_users ADD COLUMN last_activity_at TIMESTAMPTZ;
      ALTER TABLE instructors ADD COLUMN email TEXT, ADD COLUMN active BOOLEAN DEFAULT TRUE,
        ADD COLUMN request_to_book BOOLEAN DEFAULT FALSE, ADD COLUMN offered_lesson_types TEXT[],
        ADD COLUMN transmission_type TEXT DEFAULT 'manual', ADD COLUMN min_booking_notice_hours INTEGER DEFAULT 24,
        ADD COLUMN max_booking_days_ahead INTEGER DEFAULT 84;
      CREATE SEQUENCE weekly_booking_ids START 1000;
      ALTER TABLE lesson_bookings ALTER COLUMN id SET DEFAULT nextval('weekly_booking_ids');
      ALTER TABLE lesson_bookings ADD COLUMN learner_id INTEGER, ADD COLUMN instructor_id INTEGER,
        ADD COLUMN scheduled_date DATE, ADD COLUMN start_time TIME, ADD COLUMN end_time TIME,
        ADD COLUMN status TEXT, ADD COLUMN pickup_address TEXT, ADD COLUMN dropoff_address TEXT,
        ADD COLUMN lesson_type_id INTEGER, ADD COLUMN transmission_type TEXT, ADD COLUMN minutes_deducted INTEGER,
        ADD COLUMN payment_method TEXT, ADD COLUMN stripe_fee_pence INTEGER, ADD COLUMN stripe_fee_source TEXT,
        ADD COLUMN list_price_pence INTEGER, ADD COLUMN list_price_source TEXT, ADD COLUMN created_by TEXT,
        ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW(), ADD COLUMN series_id UUID,
        ADD COLUMN flexible_package_booking_request_id UUID, ADD COLUMN rescheduled_from INTEGER,
        ADD COLUMN cancelled_at TIMESTAMPTZ, ADD COLUMN credit_returned BOOLEAN DEFAULT FALSE,
        ADD COLUMN credit_forfeited BOOLEAN DEFAULT FALSE, ADD COLUMN instructor_notes TEXT;
      CREATE TABLE booking_credit_sources(booking_id INTEGER,school_id INTEGER,refunded_at TIMESTAMPTZ);
      CREATE TABLE lesson_types(id INTEGER, school_id INTEGER, active BOOLEAN, slug TEXT, duration_minutes INTEGER);
      INSERT INTO lesson_types VALUES(1,1,TRUE,'standard',90);
      CREATE TABLE slot_reservations(id SERIAL PRIMARY KEY,school_id INTEGER,instructor_id INTEGER,scheduled_date DATE,start_time TIME,end_time TIME,expires_at TIMESTAMPTZ);
      CREATE TABLE lesson_offers(LIKE slot_reservations INCLUDING ALL, status TEXT);
      CREATE TABLE lesson_requests(LIKE slot_reservations INCLUDING ALL, status TEXT);
      CREATE TABLE recurring_slot_blocks(id INTEGER,school_id INTEGER,status TEXT,expires_at TIMESTAMPTZ);
      CREATE TABLE recurring_slot_block_items(id SERIAL,block_id INTEGER,school_id INTEGER,instructor_id INTEGER,scheduled_date DATE,start_time TIME,end_time TIME,status TEXT);
      CREATE TABLE instructor_availability(instructor_id INTEGER,school_id INTEGER,day_of_week INTEGER,start_time TIME,end_time TIME,active BOOLEAN);
      CREATE TABLE instructor_availability_overrides(instructor_id INTEGER,school_id INTEGER,override_date DATE,start_time TIME,end_time TIME,active BOOLEAN,transmission_type TEXT);
      CREATE TABLE instructor_blackout_dates(instructor_id INTEGER,school_id INTEGER,blackout_date DATE,end_date DATE);
      CREATE TABLE instructor_external_events(instructor_id INTEGER,school_id INTEGER,event_date DATE,start_time TIME,end_time TIME,is_all_day BOOLEAN);
      CREATE TABLE instructor_busy_blocks(id SERIAL,instructor_id INTEGER,school_id INTEGER,block_date DATE,start_time TIME,end_time TIME);
      INSERT INTO instructor_availability SELECT 1,1,day,'08:00','18:00',TRUE FROM generate_series(0,6) day;
      UPDATE schools SET config=config || '{"payments_enabled":true,"features":{"learner_flexible_package_purchasing_live_enabled":true,"retire_incompatible_products":true}}'::jsonb WHERE id=1;
    `);
    await db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations/074_flexible_weekly_bookings.sql'), 'utf8'));
  });
  test.afterAll(async () => { await db?.close(); });
  test.beforeEach(async () => { await db.exec('BEGIN'); await seedPurchase(); });
  test.afterEach(async () => { await db.exec('ROLLBACK'); });

  test('books four individual lessons atomically with frozen package allocations and no Lesson Credit', async () => {
    expect(await weeklySchemaReady(taggedClient(db))).toBe(true);
    const result = await book();
    expect(result.booking_ids).toHaveLength(4);
    expect(result.flexible_package_remaining_minutes).toBe(540);
    const bookings = (await db.query('SELECT * FROM lesson_bookings WHERE learner_id=41 ORDER BY scheduled_date')).rows;
    expect(bookings.every(b => b.series_id === null && b.payment_method === 'flexible_package' && b.list_price_pence === 8100 && b.minutes_deducted === 90)).toBe(true);
    expect((await db.query('SELECT * FROM flexible_package_booking_allocations')).rows).toHaveLength(4);
    expect((await db.query('SELECT balance_minutes FROM learner_users WHERE id=41')).rows[0].balance_minutes).toBe(0);
  });

  test('retries return original IDs before checking balance, date availability or changed lesson status', async () => {
    const clientRequestId = crypto.randomUUID();
    const first = await book({}, { clientRequestId });
    await db.query("UPDATE lesson_bookings SET status='refunded' WHERE id=$1", [first.booking_id]);
    const second = await book({}, { clientRequestId, validateSlots: async () => { throw new Error('Replay must not revalidate'); } });
    expect(second).toMatchObject({ reused: true, booking_ids: first.booking_ids, flexible_package_remaining_minutes: 540 });
    await expect(book({ repeat_weeks: 3 }, { clientRequestId })).rejects.toMatchObject({ code: 'FLEXIBLE_BOOKING_REQUEST_MISMATCH' });
    expect((await db.query('SELECT * FROM flexible_package_booking_allocations')).rows).toHaveLength(4);
  });

  test('a conflict on the final date creates no bookings and consumes no units', async () => {
    await db.query("INSERT INTO lesson_bookings(school_id,instructor_id,scheduled_date,start_time,end_time,status) VALUES(1,1,$1,'11:00','12:00','scheduled')", [futureDate(28)]);
    await expect(book()).rejects.toMatchObject({ code: 'SLOTS_UNAVAILABLE' });
    expect((await db.query('SELECT * FROM flexible_package_booking_allocations')).rows).toHaveLength(0);
    expect((await db.query('SELECT remaining_minutes FROM flexible_package_balances WHERE learner_id=41')).rows[0].remaining_minutes).toBe(900);
  });

  test('a failure after earlier inserts rolls back the entire batch', async () => {
    const failingTransaction = (_connection, callback) => transaction(null, client => callback({ query: (sql, params) => {
      if (sql.includes('INSERT INTO lesson_bookings') && params[2] === futureDate(28)) throw new Error('Injected final insert failure');
      return client.query(sql, params);
    } }));
    await expect(book({}, { transaction: failingTransaction })).rejects.toThrow('Injected final insert failure');
    expect((await db.query('SELECT * FROM lesson_bookings WHERE learner_id=41')).rows).toHaveLength(0);
    expect((await db.query('SELECT * FROM flexible_package_booking_allocations')).rows).toHaveLength(0);
  });

  test('overlap guard protects against later ordinary booking and checkout/offer/request writers', async () => {
    await book();
    for (const table of ['lesson_bookings', 'slot_reservations', 'lesson_offers', 'lesson_requests']) {
      await db.exec('SAVEPOINT overlap');
      const extra = table === 'lesson_bookings' ? ',status' : table === 'slot_reservations' ? ',expires_at' : ',status,expires_at';
      const value = table === 'lesson_bookings' ? ",'scheduled'" : table === 'slot_reservations' ? ",NOW()+INTERVAL '10 minutes'" : ",'pending',NOW()+INTERVAL '10 minutes'";
      await expect(db.query(`INSERT INTO ${table}(school_id,instructor_id,scheduled_date,start_time,end_time${extra}) VALUES(1,1,$1,'10:30','12:00'${value})`, [futureDate()])).rejects.toMatchObject({ code: '23P01' });
      await db.exec('ROLLBACK TO SAVEPOINT overlap; RELEASE SAVEPOINT overlap');
    }
  });

  test('rejects insufficient balance, wrong learner/school and request-only instructors', async () => {
    await expect(book({}, { learnerId: 42 })).rejects.toMatchObject({ code: 'INSUFFICIENT_FLEXIBLE_UNITS' });
    await expect(book({}, { schoolId: 2 })).rejects.toMatchObject({ code: 'LEARNER_NOT_FOUND' });
    await db.exec('UPDATE instructors SET request_to_book=TRUE WHERE id=1');
    await expect(book()).rejects.toMatchObject({ code: 'INSTRUCTOR_NOT_ELIGIBLE' });
  });

  test('rechecks blackout, external calendar, holds and instructor booking horizon', async () => {
    await db.query('INSERT INTO instructor_external_events VALUES(1,1,$1,\'10:30\',\'11:00\',FALSE)', [futureDate(14)]);
    await expect(book()).rejects.toMatchObject({ code: 'SLOTS_UNAVAILABLE' });
    await db.exec('DELETE FROM instructor_external_events; UPDATE instructors SET max_booking_days_ahead=14');
    await expect(book()).rejects.toMatchObject({ code: 'SLOTS_UNAVAILABLE' });
  });

  test('API preview is read-only and committed response reuses the same receipt', async () => {
    const input = { ...body(), client_request_id: crypto.randomUUID() };
    const call = async action => {
      const res = { statusCode: 200, status(code) { this.statusCode=code;return this; }, json(value) { this.body=value;return this; } };
      await handleWeekly({ method:'POST',query:{action},body:input }, res, {
        verifyAuth:()=>({id:41,school_id:1}),sql:taggedClient(db),transaction,notify:async()=>{},
      });
      return res;
    };
    expect((await call('flexible-weekly-preview')).body).toMatchObject({ can_commit:true,required_minutes:360,balance_minutes:900 });
    expect((await db.query('SELECT * FROM flexible_package_booking_allocations')).rows).toHaveLength(0);
    expect((await call('flexible-weekly-commit')).statusCode).toBe(201);
    expect((await call('flexible-weekly-commit')).body.reused).toBe(true);
  });

  test('individual eligible cancellation returns exact units once; late cancellation keeps the lesson payable', async () => {
    const result=await book();
    const cancel=(bookingId,eligibleReturn)=>transaction(null,client=>cancelFlexiblePackageBookingWithClient(client,{
      schoolId:1,learnerId:41,bookingId,eligibleReturn,
    }));
    expect(await cancel(result.booking_ids[0],true)).toMatchObject({minutesReturned:90,remainingUnits:21});
    expect(await cancel(result.booking_ids[0],true)).toMatchObject({idempotent:true,remainingUnits:21});
    expect(await cancel(result.booking_ids[1],false)).toMatchObject({minutesReturned:0,remainingUnits:21});
    const late=(await db.query('SELECT status,credit_forfeited FROM lesson_bookings WHERE id=$1',[result.booking_ids[1]])).rows[0];
    expect(late).toEqual({status:'scheduled',credit_forfeited:true});
    expect((await db.query('SELECT * FROM flexible_package_allocation_returns')).rows).toHaveLength(1);
  });

  test('overlapping reschedule preserves value and the weekly overlap guard on the replacement', async () => {
    const result=await book();
    await transaction(null,async client=>{
      const replacement=(await client.query(`INSERT INTO lesson_bookings(school_id,learner_id,instructor_id,scheduled_date,
        start_time,end_time,status,payment_method,minutes_deducted,rescheduled_from)
        VALUES(1,41,1,$1,'10:30','12:00','scheduled','flexible_package',90,$2) RETURNING id`,[futureDate(),result.booking_id])).rows[0];
      const moved=await moveFlexiblePackageBookingAllocations(client,{
        schoolId:1,learnerId:41,oldBookingId:result.booking_id,newBookingId:replacement.id,newInstructorId:1,
      });
      expect(moved).toMatchObject({units:3,minutes:90,contributionPence:8100});
      await client.query("UPDATE lesson_bookings SET status='refunded' WHERE id=$1 AND school_id=1",[result.booking_id]);
      await client.query('SET CONSTRAINTS check_flexible_weekly_replacement IMMEDIATE');
      await client.query('SET CONSTRAINTS check_flexible_weekly_replacement DEFERRED');
      const row=(await client.query('SELECT flexible_package_weekly_request_id FROM lesson_bookings WHERE id=$1',[replacement.id])).rows[0];
      expect(row.flexible_package_weekly_request_id).toBeTruthy();
    });
    expect((await db.query('SELECT remaining_minutes FROM flexible_package_balances WHERE learner_id=41')).rows[0].remaining_minutes).toBe(540);
  });

  test('a replacement cannot commit while the original weekly lesson remains payable',async()=>{
    const result=await book();
    await expect(transaction(null,async client=>{
      await client.query(`INSERT INTO lesson_bookings(school_id,learner_id,instructor_id,scheduled_date,start_time,end_time,
        status,payment_method,minutes_deducted,rescheduled_from)
        VALUES(1,41,1,$1,'10:30','12:00','scheduled','flexible_package',90,$2)`,[futureDate(),result.booking_id]);
      await client.query('SET CONSTRAINTS check_flexible_weekly_replacement IMMEDIATE');
    })).rejects.toMatchObject({code:'23P01'});
  });

  test('splits a lesson across differently priced sources and carries residual value through the batch',async()=>{
    const source=(await db.query('SELECT id FROM flexible_package_sources WHERE learner_id=41')).rows[0];
    await db.query(`INSERT INTO flexible_package_booking_allocations(school_id,learner_id,source_id,booking_id,instructor_id,
      units_allocated,unit_minutes,rate_pence_per_unit,contribution_pence) VALUES(1,41,$1,501,1,28,30,2700,75600)`,[source.id]);
    await db.exec("INSERT INTO package_products(id,school_id,slug,product_type) VALUES(22,1,'flexible-30-hours','flexible_hours')");
    await db.query(`INSERT INTO package_product_versions(id,school_id,product_id,price_pence,currency,content,customer_terms_version)
      VALUES(32,1,22,159000,'GBP',$1::jsonb,'flexible-hours-v1')`,[JSON.stringify({...content,entitlement:{units:60,hours:30,unit_minutes:30,scope:'school'}})]);
    await seedPurchase({product_version_id:32,amount_pence:159000});
    const result=await book();
    const bookings=(await db.query('SELECT list_price_pence FROM lesson_bookings WHERE learner_id=41 ORDER BY scheduled_date')).rows;
    expect(bookings.map(b=>b.list_price_pence)).toEqual([8050,7950,7950,7950]);
    expect(result.flexible_package_remaining_minutes).toBe(1500);
    const allocated=(await db.query('SELECT SUM(contribution_pence)::int AS pence FROM flexible_package_booking_allocations WHERE booking_id=ANY($1::integer[])',[result.booking_ids])).rows[0];
    expect(allocated.pence).toBe(31900);
  });

  test('exact package balance reaches zero without creating instructor credit',async()=>{
    const source=(await db.query('SELECT id FROM flexible_package_sources WHERE learner_id=41')).rows[0];
    await db.query(`INSERT INTO flexible_package_booking_allocations(school_id,learner_id,source_id,booking_id,instructor_id,
      units_allocated,unit_minutes,rate_pence_per_unit,contribution_pence) VALUES(1,41,$1,501,1,18,30,2700,48600)`,[source.id]);
    expect((await book()).flexible_package_remaining_minutes).toBe(0);
    expect((await db.query('SELECT balance_minutes FROM learner_users WHERE id=41')).rows[0].balance_minutes).toBe(0);
  });
});

test('weekly input validates count, units and calendar dates, preserving local clock time across DST', () => {
  for (const overrides of [{repeat_weeks:5},{repeat_weeks:2.5},{date:'2026-02-30'},{end_time:'11:15'},{funding_method:'lesson_credit'}]) {
    expect(() => parseWeeklyBooking(body(overrides))).toThrow();
  }
  const input=parseWeeklyBooking(body({date:'2026-10-18',repeat_weeks:3}));
  expect(input.dates).toEqual(['2026-10-18','2026-10-25','2026-11-01']);
  expect(input.startTime).toBe('10:00');
});

test('weekly endpoints require learner cookies and CSRF before reading package data',async()=>{
  const previous=process.env.JWT_SECRET;
  process.env.JWT_SECRET='weekly-auth-test';
  try {
    const jwt=require('jsonwebtoken');
    for(const [role,csrf] of [['learner',false],['instructor',true],['admin',true]]) {
      const token=jwt.sign({id:41,school_id:1,role},process.env.JWT_SECRET);
      const headers={cookie:`cc_${role}=${token}; cc_csrf=test-weekly`};
      if(csrf)headers['x-csrf-token']='test-weekly';
      const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
      await handleWeekly({method:'POST',query:{action:'flexible-weekly-commit'},body:body(),headers},res,
        {sql:async()=>{throw new Error('Unauthorised request must not query data');}});
      expect(res.statusCode).toBe(401);
    }
  } finally {if(previous===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous;}
});
