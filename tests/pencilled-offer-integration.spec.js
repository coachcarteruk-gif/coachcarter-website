const { test, expect } = require('@playwright/test');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
process.env.STRIPE_SECRET_KEY ||= 'sk_test_pencilled_transaction_only';
const { _fulfilPencilledOffer: fulfilPencilledOffer } = require('../api/webhook');

const url = process.env.PENCILLED_TEST_DATABASE_URL;
const localOnly = url && /^postgresql:\/\/[^@/]+@(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(url);

test.describe('pencilled offer database concurrency', () => {
  test.skip(!localOnly, 'Set PENCILLED_TEST_DATABASE_URL to an explicit loopback-only disposable PostgreSQL database.');

  test('an active pencil wins overlap races while adjacency and expired pencils remain available', async () => {
    const schema = `pencil_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const admin = new Client({ connectionString: url });
    await admin.connect();
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await admin.query(`SET search_path TO ${schema}`);
      await admin.query(`
        CREATE TABLE lesson_bookings(id serial primary key,learner_id int,school_id int,instructor_id int,scheduled_date date,start_time time,end_time time,status text,created_by text,payment_method text,lesson_type_id int,minutes_deducted int,pickup_address text,list_price_pence int,list_price_source text CHECK(list_price_source IS NULL OR list_price_source IN ('stripe_metadata','live_compute_insert','live_compute_backfill','unknown','flexible_package_frozen_rate')),stripe_fee_pence int,stripe_fee_source text);
        CREATE TABLE lesson_requests(id serial primary key,school_id int,instructor_id int,scheduled_date date,start_time time,end_time time,status text,expires_at timestamptz);
        CREATE TABLE slot_reservations(id serial primary key,school_id int,instructor_id int,scheduled_date date,start_time time,end_time time,expires_at timestamptz);
        CREATE TABLE recurring_slot_block_items(id serial primary key,school_id int,instructor_id int,scheduled_date date,start_time time,end_time time,status text);
        CREATE TABLE lesson_offers(id serial primary key,school_id int,instructor_id int,learner_id int,learner_email text,learner_name text,scheduled_date date,start_time time,end_time time,kind text,status text,expires_at timestamptz,extension_booking_id int,extension_minutes int,extension_base_list_price_pence int,max_repeat_weeks int,offer_price_pence int,token text,lesson_type_id int,discount_pct int,stripe_session_id text,booking_id int,accepted_at timestamptz);
        CREATE TABLE refund_events(id serial primary key,refund_type text,status text CHECK(status IN ('previewed','processing','manual_review','blocked','executed')),school_id int,learner_id int,gross_refund_pence int,processing_fee_withheld_pence int,net_refund_pence int,stripe_payment_intent_id text,idempotency_key text,reason text,metadata jsonb,stripe_refund_id text);
        CREATE UNIQUE INDEX refund_events_idempotency_idx ON refund_events(idempotency_key) WHERE idempotency_key IS NOT NULL;
        ALTER TABLE refund_events ADD CONSTRAINT refund_events_refund_type_check CHECK(refund_type IN ('direct_offer'));
        CREATE TABLE credit_transactions(id serial primary key,learner_id int,type text,credits int,amount_pence int,payment_method text,stripe_session_id text UNIQUE,minutes int,school_id int,stripe_fee_pence int,instructor_id int,effective_rate_pence_per_minute int,stripe_payment_intent_id text,source text);
        CREATE TABLE booking_credit_sources(id serial primary key,school_id int,booking_id int,credit_transaction_id int,minutes_drawn int,rate_pence_per_minute int,contribution_pence int,stripe_fee_pence int,absorbed_by text);
      `);
      const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '066_pencilled_offers.sql'), 'utf8');
      await admin.query(migration);
      await expect(admin.query(`INSERT INTO lesson_offers(school_id,instructor_id,scheduled_date,start_time,end_time,kind,status,expires_at,max_repeat_weeks,offer_price_pence,pencilled) VALUES(1,2,'2026-12-01','08:00','09:00','manual','pending',clock_timestamp()+interval '1 day',1,9000,true)`)).rejects.toMatchObject({ code: '23514' });
      await admin.query(`INSERT INTO lesson_offers(school_id,instructor_id,learner_id,scheduled_date,start_time,end_time,kind,status,expires_at,max_repeat_weeks,offer_price_pence,pencilled) VALUES(1,2,3,'2026-12-01','10:00','11:00','manual','pending',clock_timestamp()+interval '1 day',1,9000,true)`);
      await expect(admin.query(`INSERT INTO lesson_bookings(school_id,instructor_id,scheduled_date,start_time,end_time,status) VALUES(1,2,'2026-12-01','10:30','11:30','scheduled')`)).rejects.toMatchObject({ code: '23P01' });
      await admin.query(`INSERT INTO lesson_bookings(school_id,instructor_id,scheduled_date,start_time,end_time,status) VALUES(1,2,'2026-12-01','11:00','12:00','scheduled')`);
      await admin.query(`INSERT INTO lesson_bookings(school_id,instructor_id,scheduled_date,start_time,end_time,status) VALUES(1,2,'2026-12-01','13:00','14:00','scheduled')`);
      await expect(admin.query(`INSERT INTO lesson_offers(school_id,instructor_id,learner_id,scheduled_date,start_time,end_time,kind,status,expires_at,max_repeat_weeks,offer_price_pence,pencilled) VALUES(1,2,4,'2026-12-01','13:30','14:30','manual','pending',clock_timestamp()+interval '1 day',1,9000,true)`)).rejects.toMatchObject({ code: '23P01' });
      await admin.query(`UPDATE lesson_offers SET expires_at=clock_timestamp()-interval '1 second' WHERE pencilled=true`);
      await admin.query(`INSERT INTO lesson_requests(school_id,instructor_id,scheduled_date,start_time,end_time,status,expires_at) VALUES(1,2,'2026-12-01','10:30','11:30','pending',clock_timestamp()+interval '1 day')`);
      expect((await admin.query(`SELECT count(*)::int AS count FROM lesson_requests`)).rows[0].count).toBe(1);

      await admin.query(`DELETE FROM lesson_requests`);
      await admin.query(`UPDATE lesson_offers SET expires_at=clock_timestamp()+interval '1 day' WHERE pencilled=true`);
      await admin.query('BEGIN');
      try {
        await admin.query(`UPDATE lesson_offers SET status='accepted' WHERE pencilled=true`);
        await admin.query(`INSERT INTO lesson_bookings(school_id,instructor_id,scheduled_date,start_time,end_time,status) VALUES(1,2,'2026-12-01','10:00','11:00','scheduled')`);
        throw new Error('force fulfilment rollback');
      } catch (_) {
        await admin.query('ROLLBACK');
      }
      expect((await admin.query(`SELECT status FROM lesson_offers WHERE pencilled=true`)).rows[0].status).toBe('pending');

      const first = new Client({ connectionString: url });
      const second = new Client({ connectionString: url });
      await first.connect();
      await second.connect();
      const waitUntilBlocked = async pid => {
        for (let attempt = 0; attempt < 200; attempt += 1) {
          const state = await admin.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1`, [pid]);
          if (state.rows[0]?.wait_event_type === 'Lock') return;
          await new Promise(resolve => setImmediate(resolve));
        }
        throw new Error(`backend ${pid} never reached the deterministic lock barrier`);
      };
      try {
        await first.query(`SET search_path TO ${schema}`);
        await second.query(`SET search_path TO ${schema}`);
        const secondPid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

        // Pencil transaction wins; a differently-started overlapping booking
        // waits on the shared day lock, then observes the committed pencil.
        await first.query('BEGIN');
        await first.query(`INSERT INTO lesson_offers(school_id,instructor_id,learner_id,scheduled_date,start_time,end_time,kind,status,expires_at,max_repeat_weeks,offer_price_pence,pencilled) VALUES(1,9,3,'2026-12-02','15:00','16:00','manual','pending',clock_timestamp()+interval '1 day',1,9000,true)`);
        await second.query('BEGIN');
        const bookingAttempt = second.query(`INSERT INTO lesson_bookings(school_id,instructor_id,scheduled_date,start_time,end_time,status) VALUES(1,9,'2026-12-02','15:30','16:30','scheduled')`);
        await waitUntilBlocked(secondPid);
        await first.query('COMMIT');
        await expect(bookingAttempt).rejects.toMatchObject({ code: '23P01' });
        await second.query('ROLLBACK');

        // Ordinary booking transaction wins in the inverse ordering.
        await first.query('BEGIN');
        await first.query(`INSERT INTO lesson_bookings(school_id,instructor_id,scheduled_date,start_time,end_time,status) VALUES(1,10,'2026-12-02','16:00','17:00','scheduled')`);
        await second.query('BEGIN');
        const pencilAttempt = second.query(`INSERT INTO lesson_offers(school_id,instructor_id,learner_id,scheduled_date,start_time,end_time,kind,status,expires_at,max_repeat_weeks,offer_price_pence,pencilled) VALUES(1,10,3,'2026-12-02','16:30','17:30','manual','pending',clock_timestamp()+interval '1 day',1,9000,true)`);
        await waitUntilBlocked(secondPid);
        await first.query('COMMIT');
        await expect(pencilAttempt).rejects.toMatchObject({ code: '23P01' });
        await second.query('ROLLBACK');

        // Moving an ordinary row into an active pencil, plus request and
        // reservation collisions, all use interval overlap rather than exact start.
        await admin.query(`INSERT INTO lesson_offers(school_id,instructor_id,learner_id,scheduled_date,start_time,end_time,kind,status,expires_at,max_repeat_weeks,offer_price_pence,pencilled) VALUES(1,11,3,'2026-12-03','09:00','10:00','manual','pending',clock_timestamp()+interval '1 day',1,9000,true)`);
        const movable = (await admin.query(`INSERT INTO lesson_bookings(school_id,instructor_id,scheduled_date,start_time,end_time,status) VALUES(1,11,'2026-12-04','09:30','10:30','scheduled') RETURNING id`)).rows[0];
        await expect(admin.query(`UPDATE lesson_bookings SET scheduled_date='2026-12-03' WHERE id=$1`, [movable.id])).rejects.toMatchObject({ code: '23P01' });
        await expect(admin.query(`INSERT INTO lesson_requests(school_id,instructor_id,scheduled_date,start_time,end_time,status,expires_at) VALUES(1,11,'2026-12-03','09:45','10:15','pending',clock_timestamp()+interval '1 day')`)).rejects.toMatchObject({ code: '23P01' });
        await expect(admin.query(`INSERT INTO slot_reservations(school_id,instructor_id,scheduled_date,start_time,end_time,expires_at) VALUES(1,11,'2026-12-03','08:45','09:15',clock_timestamp()+interval '10 minutes')`)).rejects.toMatchObject({ code: '23P01' });

        const transactionRunner = async (_connectionString, callback) => {
          const client = new Client({ connectionString: url });
          await client.connect();
          try {
            await client.query(`SET search_path TO ${schema}`);
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            await client.end();
          }
        };
        const insertPencil = async (instructorId, sessionId) => (await admin.query(
          `INSERT INTO lesson_offers(school_id,instructor_id,learner_id,lesson_type_id,scheduled_date,start_time,end_time,kind,status,expires_at,max_repeat_weeks,offer_price_pence,pencilled,stripe_session_id)
           VALUES(1,$1,3,5,'2026-12-20','10:00','11:00','manual','pending','2026-12-18T10:00:00Z',1,9000,true,$2) RETURNING *`,
          [instructorId, sessionId]
        )).rows[0];
        const fulfil = (offer, sessionId) => fulfilPencilledOffer({
          session: { id: sessionId, payment_intent: `pi_${sessionId}`, currency: 'gbp', total_details: { amount_discount: 0 } },
          offer, learnerId: 3, schoolId: 1, instructorId: offer.instructor_id, lessonTypeId: 5,
          durationMins: 60, pickupAddress: '1 Test Road', amountPence: 9000,
          fundingEvidence: { feePence: 300 }, paymentSucceededAt: new Date('2026-12-18T09:59:59Z'),
          quoteValidation: { ok: true }, transactionRunner, connectionString: url,
        });

        // Two simultaneous deliveries for the same paid session serialize on
        // the day/offer locks and produce exactly one booking and one ledger row.
        const duplicate = await insertPencil(20, 'cs_same');
        const duplicateResults = await Promise.all([fulfil(duplicate, 'cs_same'), fulfil(duplicate, 'cs_same')]);
        expect(duplicateResults.filter(result => result.applied)).toHaveLength(1);
        expect(duplicateResults.filter(result => result.idempotent)).toHaveLength(1);
        expect((await admin.query(`SELECT count(*)::int count FROM lesson_bookings WHERE instructor_id=20`)).rows[0].count).toBe(1);
        expect((await admin.query(`SELECT count(*)::int count FROM credit_transactions WHERE instructor_id=20`)).rows[0].count).toBe(1);

        // A separately paid session cannot replay an accepted pencil and is
        // retained as one idempotent compensation record.
        const replay = await fulfil(duplicate, 'cs_other');
        expect(replay.refundRequired).toBe(true);
        expect((await admin.query(`SELECT status FROM refund_events WHERE id=$1`, [replay.refundEventId])).rows[0].status).toBe('previewed');

        // Cancellation winning before fulfilment never creates a booking or
        // earnings; the paid callback is routed to compensation.
        const cancelled = await insertPencil(21, 'cs_cancelled');
        await admin.query(`UPDATE lesson_offers SET status='cancelled' WHERE id=$1`, [cancelled.id]);
        const cancelledResult = await fulfil(cancelled, 'cs_cancelled');
        expect(cancelledResult.refundRequired).toBe(true);
        expect((await admin.query(`SELECT count(*)::int count FROM lesson_bookings WHERE instructor_id=21`)).rows[0].count).toBe(0);
        expect((await admin.query(`SELECT count(*)::int count FROM credit_transactions WHERE instructor_id=21`)).rows[0].count).toBe(0);
      } finally {
        await first.end();
        await second.end();
      }
    } finally {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
});
