'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
process.env.STRIPE_SECRET_KEY = 'sk_test_local_fee_regression';
process.env.ERROR_ALERT_EMAIL = '';
const { _fulfilPencilledOffer: fulfil } = require('../api/webhook');
const { payoutEvidenceBlockers } = require('../api/_payout-helpers');

// Real PostgreSQL execution, entirely in memory. Keep the production NOT NULL
// constraint: the older concurrency fixture omitted it and missed this failure.
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE lesson_bookings(id serial primary key,learner_id int,school_id int,instructor_id int,scheduled_date date,start_time time,end_time time,status text,created_by text,payment_method text,lesson_type_id int,minutes_deducted int,pickup_address text,list_price_pence int,list_price_source text,stripe_fee_pence int,stripe_fee_source text);
    CREATE TABLE lesson_requests(id serial primary key,school_id int,instructor_id int,scheduled_date date,start_time time,end_time time,status text,expires_at timestamptz);
    CREATE TABLE slot_reservations(id serial primary key,school_id int,instructor_id int,scheduled_date date,start_time time,end_time time,expires_at timestamptz);
    CREATE TABLE recurring_slot_block_items(id serial primary key,school_id int,instructor_id int,scheduled_date date,start_time time,end_time time,status text);
    CREATE TABLE instructor_busy_blocks(id serial primary key,school_id int,instructor_id int,block_date date,start_time time,end_time time);
    CREATE TABLE lesson_offers(id serial primary key,school_id int,instructor_id int,learner_id int,scheduled_date date,start_time time,end_time time,kind text,status text,expires_at timestamptz,extension_booking_id int,max_repeat_weeks int,offer_price_pence int,lesson_type_id int,stripe_session_id text,booking_id int,accepted_at timestamptz);
    CREATE TABLE refund_events(id serial primary key,refund_type text,status text,school_id int,learner_id int,gross_refund_pence int,processing_fee_withheld_pence int,net_refund_pence int,stripe_payment_intent_id text,idempotency_key text,reason text,metadata jsonb);
    CREATE UNIQUE INDEX refund_idempotency ON refund_events(idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE credit_transactions(id serial primary key,learner_id int,type text,credits int,amount_pence int,payment_method text,stripe_session_id text UNIQUE,minutes int,school_id int,stripe_fee_pence int,instructor_id int,effective_rate_pence_per_minute int,stripe_payment_intent_id text,source text);
    CREATE TABLE booking_credit_sources(id serial primary key,school_id int,booking_id int,credit_transaction_id int,minutes_drawn int,rate_pence_per_minute int,contribution_pence int,stripe_fee_pence int NOT NULL DEFAULT 0,absorbed_by text);
  `);
  for (const file of ['066_pencilled_offers.sql', '075_instructor_busy_block_overrides.sql', '079_booking_source_unknown_fee.sql']) {
    await db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations', file), 'utf8'));
  }
  const offer = (await db.query(`INSERT INTO lesson_offers
    (school_id,instructor_id,learner_id,lesson_type_id,scheduled_date,start_time,end_time,kind,status,expires_at,max_repeat_weeks,offer_price_pence,pencilled,stripe_session_id)
    VALUES(1,2,3,5,'2027-01-20','10:00','11:00','manual','pending','2027-01-18T10:00:00Z',1,5500,true,'cs_local_fee') RETURNING *`)).rows[0];
  const input = {
    session: { id: 'cs_local_fee', payment_intent: 'pi_local_fee', currency: 'gbp' },
    offer, learnerId: 3, schoolId: 1, instructorId: 2, lessonTypeId: 5,
    durationMins: 60, pickupAddress: '', amountPence: 5500,
    paymentSucceededAt: new Date('2027-01-18T09:00:00Z'), quoteValidation: { ok: true },
    connectionString: 'in-memory-only',
    transactionRunner: (_url, callback) => db.transaction(tx => callback(tx)),
  };
  return { db, input };
}

for (const fee of [null, undefined, 0, 103]) {
  test(`paid pencil fulfils once with Stripe fee ${fee}`, async () => {
    const { db, input } = await fixture();
    try {
      const result = await fulfil({ ...input, fundingEvidence: { feePence: fee } });
      assert.equal(result.applied, true);
      const rows = (await db.query(`SELECT ct.stripe_fee_pence AS source_fee,
        b.stripe_fee_pence AS booking_fee,b.stripe_fee_source,
        s.stripe_fee_pence AS allocated_fee,s.contribution_pence,s.minutes_drawn,
        o.status,o.booking_id FROM lesson_offers o
        JOIN lesson_bookings b ON b.id=o.booking_id AND b.school_id=o.school_id
        JOIN booking_credit_sources s ON s.booking_id=b.id AND s.school_id=b.school_id
        JOIN credit_transactions ct ON ct.id=s.credit_transaction_id AND ct.school_id=s.school_id`)).rows;
      assert.equal(rows.length, 1);
      assert.deepEqual(payoutEvidenceBlockers([{
        booking_id: result.bookingId, price_pence: rows[0].contribution_pence,
        stripe_fee_pence: rows[0].allocated_fee,
      }]), fee == null ? [{ booking_id: result.bookingId, reason: 'ACTUAL_PROCESSING_FEE_EVIDENCE_MISSING' }] : []);
      assert.deepEqual(rows[0], { source_fee: fee ?? null, booking_fee: fee ?? null,
        stripe_fee_source: fee == null ? null : 'balance_transaction', allocated_fee: fee ?? null,
        contribution_pence: 5500, minutes_drawn: 60, status: 'accepted', booking_id: result.bookingId });
      const retry = await fulfil({ ...input, fundingEvidence: { feePence: 103 } });
      assert.equal(retry.idempotent, true);
      assert.equal(retry.bookingId, result.bookingId);
      for (const table of ['lesson_bookings','credit_transactions','booking_credit_sources']) {
        assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 1);
      }
      // An absent source fee remains unknown for the existing fee backfill and
      // payout-evidence gate; the allocation must not invent a zero fee.
      assert.equal((await db.query('SELECT stripe_fee_pence FROM credit_transactions')).rows[0].stripe_fee_pence, fee ?? null);
    } finally { await db.close(); }
  });
}

test('wrong school cannot fulfil the pencil or create booking funding', async () => {
  const { db, input } = await fixture();
  try {
    const result = await fulfil({ ...input, schoolId: 2, fundingEvidence: { feePence: null } });
    assert.equal(result.applied, false);
    for (const table of ['lesson_bookings','credit_transactions','booking_credit_sources']) {
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
    }
    assert.equal((await db.query('SELECT status FROM lesson_offers WHERE school_id=1')).rows[0].status, 'pending');
  } finally { await db.close(); }
});
