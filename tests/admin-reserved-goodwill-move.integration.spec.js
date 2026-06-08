// Integration coverage for the Stage 5 admin goodwill move mutation.
//
// Run with:
//   CC_TEST_DB=1 npm.cmd test -- tests/admin-reserved-goodwill-move.integration.spec.js

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();

process.env.JWT_SECRET = process.env.JWT_SECRET || 'admin-reserved-goodwill-test-secret';
if (process.env.POSTGRES_URL_TEST) {
  process.env.POSTGRES_URL = process.env.POSTGRES_URL_TEST;
}

const shouldRun = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
const sql = shouldRun ? neon(process.env.POSTGRES_URL_TEST) : null;
const adminHandler = require('../api/admin');

const SCHOOL_ID = 1;
const SCHEDULED = 'scheduled';

let hasSchema = false;
let instructorId;
let createdLearnerIds = [];
let createdBookingIds = [];
let createdBlockIds = [];
let createdCreditTxIds = [];

function csrfAuthedHeaders() {
  const csrf = 'b'.repeat(64);
  const token = jwt.sign(
    { id: 998, email: 'reserved-goodwill-admin@example.test', role: 'admin', isAdmin: true, school_id: SCHOOL_ID },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return {
    cookie: `cc_admin=${token}; cc_csrf=${csrf}`,
    'x-csrf-token': csrf,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
  };
}

async function callAdmin(action, body) {
  const req = {
    method: 'POST',
    query: { action },
    body,
    headers: csrfAuthedHeaders(),
    url: `/api/admin?action=${action}`,
  };
  const res = makeRes();
  await adminHandler(req, res);
  return res;
}

function isoDatePlus(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

async function createLearner() {
  const nonce = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const phone = `07${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;
  const [learner] = await sql`
    INSERT INTO learner_users (name, email, phone, school_id)
    VALUES (${`Reserved Goodwill ${nonce}`}, ${`reserved-goodwill-${nonce}@example.test`}, ${phone}, ${SCHOOL_ID})
    RETURNING id
  `;
  createdLearnerIds.push(learner.id);
  return learner.id;
}

async function findFreeSlot(daysAhead, startHour = 14) {
  for (let day = daysAhead; day < daysAhead + 30; day++) {
    const date = isoDatePlus(day);
    for (let hour = startHour; hour <= 18; hour++) {
      const startTime = `${String(hour).padStart(2, '0')}:00`;
      const [existing] = await sql`
        SELECT id
          FROM lesson_bookings
         WHERE instructor_id = ${instructorId}
           AND school_id = ${SCHOOL_ID}
           AND scheduled_date = ${date}::date
           AND start_time = ${startTime}::time
           AND status IN ('scheduled', 'chargeable')
         LIMIT 1
      `;
      const [held] = await sql`
        SELECT id
          FROM recurring_slot_block_items
         WHERE instructor_id = ${instructorId}
           AND school_id = ${SCHOOL_ID}
           AND scheduled_date = ${date}::date
           AND start_time = ${startTime}::time
           AND status IN ('held', 'booked')
         LIMIT 1
      `;
      if (!existing && !held) return { date, startTime };
    }
  }
  throw new Error('Could not find a free test slot');
}

async function createReservedOccurrence() {
  const learnerId = await createLearner();
  const original = await findFreeSlot(2, 9);
  const [booking] = await sql`
    INSERT INTO lesson_bookings
      (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
       lesson_type_id, minutes_deducted, school_id, created_by, payment_method,
       list_price_pence, list_price_source)
    VALUES
      (${learnerId}, ${instructorId}, ${original.date}::date, ${original.startTime}::time,
       (${original.startTime}::time + INTERVAL '90 minutes'), ${SCHEDULED},
       NULL, 90, ${SCHOOL_ID}, 'learner', 'credit',
       8250, 'live_compute_insert')
    RETURNING id, scheduled_date::text AS scheduled_date, start_time::text AS start_time
  `;
  createdBookingIds.push(booking.id);

  const [block] = await sql`
    INSERT INTO recurring_slot_blocks
      (school_id, learner_id, instructor_id, anchor_booking_id, lesson_type_id,
       status, funding_method, selected_lessons, duration_minutes, start_time, end_time,
       price_per_lesson_pence, total_price_pence, price_source, confirmed_at, metadata)
    VALUES
      (${SCHOOL_ID}, ${learnerId}, ${instructorId}, NULL, NULL,
       'confirmed', 'lesson_credit', 1, 90, ${original.startTime}::time,
       (${original.startTime}::time + INTERVAL '90 minutes'),
       8250, 8250, 'integration_test', NOW(), '{}'::jsonb)
    RETURNING id
  `;
  createdBlockIds.push(block.id);

  const [item] = await sql`
    INSERT INTO recurring_slot_block_items
      (block_id, school_id, instructor_id, lesson_booking_id,
       scheduled_date, start_time, end_time, status, price_pence)
    VALUES
      (${block.id}, ${SCHOOL_ID}, ${instructorId}, ${booking.id},
       ${original.date}::date, ${original.startTime}::time,
       (${original.startTime}::time + INTERVAL '90 minutes'), 'booked', 8250)
    RETURNING id
  `;

  const [creditTx] = await sql`
    INSERT INTO credit_transactions
      (learner_id, instructor_id, school_id, type, credits, minutes,
       amount_pence, payment_method, source, effective_rate_pence_per_minute)
    VALUES
      (${learnerId}, ${instructorId}, ${SCHOOL_ID}, 'legacy_grandfather', 0, 90,
       8250, 'test', 'reconciliation', 92)
    RETURNING id
  `;
  createdCreditTxIds.push(creditTx.id);

  const [bcs] = await sql`
    INSERT INTO booking_credit_sources
      (school_id, booking_id, credit_transaction_id, minutes_drawn,
       rate_pence_per_minute, contribution_pence, stripe_fee_pence)
    VALUES
      (${SCHOOL_ID}, ${booking.id}, ${creditTx.id}, 90, 92, 8250, 0)
    RETURNING id
  `;

  return { learnerId, bookingId: booking.id, blockId: block.id, itemId: item.id, bcsId: bcs.id };
}

test.beforeAll(async () => {
  test.skip(!shouldRun, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run Neon-gated integration tests');

  const schema = await sql`
    SELECT
      to_regclass('public.recurring_slot_blocks') IS NOT NULL AS has_blocks,
      to_regclass('public.recurring_slot_block_items') IS NOT NULL AS has_items,
      to_regclass('public.booking_credit_sources') IS NOT NULL AS has_bcs
  `;
  hasSchema = !!(schema[0].has_blocks && schema[0].has_items && schema[0].has_bcs);

  const [instructor] = await sql`
    SELECT id
      FROM instructors
     WHERE school_id = ${SCHOOL_ID}
       AND active = true
     ORDER BY id
     LIMIT 1
  `;
  instructorId = instructor?.id || null;
});

test.afterEach(async () => {
  if (!shouldRun || !sql) return;
  if (createdBlockIds.length) {
    await sql`DELETE FROM recurring_slot_block_items WHERE block_id = ANY(${createdBlockIds})`;
    await sql`DELETE FROM recurring_slot_blocks WHERE id = ANY(${createdBlockIds})`;
  }
  if (createdBookingIds.length) {
    await sql`DELETE FROM booking_credit_sources WHERE booking_id = ANY(${createdBookingIds})`;
    await sql`DELETE FROM lesson_bookings WHERE id = ANY(${createdBookingIds})`;
  }
  if (createdCreditTxIds.length) {
    await sql`DELETE FROM booking_credit_sources WHERE credit_transaction_id = ANY(${createdCreditTxIds})`;
    await sql`DELETE FROM credit_transactions WHERE id = ANY(${createdCreditTxIds})`;
  }
  if (createdLearnerIds.length) {
    await sql`DELETE FROM learner_users WHERE id = ANY(${createdLearnerIds})`;
  }
  createdLearnerIds = [];
  createdBookingIds = [];
  createdBlockIds = [];
  createdCreditTxIds = [];
});

test.describe('admin reserved goodwill move', () => {
  test.describe.configure({ mode: 'serial' });

  test('moves one under-48-hour reserved occurrence with replacement item and copied BCS attribution', async () => {
    test.skip(!hasSchema, 'Test database has not run recurring block / BCS migrations');
    test.skip(!instructorId, 'Test database needs an active instructor in school 1');

    const fixture = await createReservedOccurrence();
    const replacement = await findFreeSlot(9, 15);

    const res = await callAdmin('reserved-goodwill-move', {
      booking_id: fixture.bookingId,
      new_date: replacement.date,
      new_start_time: replacement.startTime,
      reason: 'Integration test goodwill move',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.movement_type).toBe('reserved_goodwill_admin_move');
    expect(res.body.old_booking_id).toBe(fixture.bookingId);
    expect(res.body.recurring_slot_block_id).toBe(fixture.blockId);
    expect(res.body.released_recurring_slot_block_item_id).toBe(fixture.itemId);
    createdBookingIds.push(res.body.new_booking_id);

    const [oldBooking] = await sql`
      SELECT status, credit_returned, cancelled_at IS NOT NULL AS has_cancelled_at
        FROM lesson_bookings
       WHERE id = ${fixture.bookingId}
    `;
    expect(oldBooking.status).toBe('refunded');
    expect(oldBooking.credit_returned).toBe(true);
    expect(oldBooking.has_cancelled_at).toBe(true);

    const [newBooking] = await sql`
      SELECT status, learner_id, instructor_id, school_id, scheduled_date::text AS scheduled_date,
             start_time::text AS start_time, end_time::text AS end_time,
             rescheduled_from, created_by, minutes_deducted, list_price_pence
        FROM lesson_bookings
       WHERE id = ${res.body.new_booking_id}
    `;
    expect(newBooking.status).toBe('scheduled');
    expect(newBooking.learner_id).toBe(fixture.learnerId);
    expect(newBooking.instructor_id).toBe(instructorId);
    expect(newBooking.school_id).toBe(SCHOOL_ID);
    expect(newBooking.scheduled_date.slice(0, 10)).toBe(replacement.date);
    expect(newBooking.start_time.slice(0, 5)).toBe(replacement.startTime);
    expect(newBooking.rescheduled_from).toBe(fixture.bookingId);
    expect(newBooking.created_by).toBe('admin');
    expect(newBooking.minutes_deducted).toBe(90);
    expect(newBooking.list_price_pence).toBe(8250);

    const items = await sql`
      SELECT id, lesson_booking_id, status, scheduled_date::text AS scheduled_date, start_time::text AS start_time
        FROM recurring_slot_block_items
       WHERE block_id = ${fixture.blockId}
       ORDER BY id
    `;
    expect(items).toHaveLength(2);
    const oldItem = items.find(row => row.id === fixture.itemId);
    const newItem = items.find(row => row.id === res.body.replacement_recurring_slot_block_item_id);
    expect(oldItem.status).toBe('released');
    expect(oldItem.lesson_booking_id).toBe(fixture.bookingId);
    expect(newItem.status).toBe('booked');
    expect(newItem.lesson_booking_id).toBe(res.body.new_booking_id);
    expect(newItem.scheduled_date.slice(0, 10)).toBe(replacement.date);

    const oldBcsRows = await sql`
      SELECT refunded_at
        FROM booking_credit_sources
       WHERE booking_id = ${fixture.bookingId}
         AND school_id = ${SCHOOL_ID}
    `;
    const newBcsRows = await sql`
      SELECT refunded_at, minutes_drawn, contribution_pence
        FROM booking_credit_sources
       WHERE booking_id = ${res.body.new_booking_id}
         AND school_id = ${SCHOOL_ID}
    `;
    expect(oldBcsRows).toHaveLength(1);
    expect(oldBcsRows[0].refunded_at).toBeTruthy();
    expect(newBcsRows).toHaveLength(1);
    expect(newBcsRows[0].refunded_at).toBeNull();
    expect(newBcsRows[0].minutes_drawn).toBe(90);
    expect(newBcsRows[0].contribution_pence).toBe(8250);
  });

  test('refuses a goodwill replacement that overlaps an existing booking', async () => {
    test.skip(!hasSchema, 'Test database has not run recurring block / BCS migrations');
    test.skip(!instructorId, 'Test database needs an active instructor in school 1');

    const fixture = await createReservedOccurrence();
    const replacement = await findFreeSlot(9, 12);
    const otherLearnerId = await createLearner();
    const [conflict] = await sql`
      INSERT INTO lesson_bookings
        (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
         lesson_type_id, minutes_deducted, school_id, created_by, payment_method)
      VALUES
        (${otherLearnerId}, ${instructorId}, ${replacement.date}::date,
         (${replacement.startTime}::time + INTERVAL '30 minutes'),
         (${replacement.startTime}::time + INTERVAL '120 minutes'),
         ${SCHEDULED}, NULL, 90, ${SCHOOL_ID}, 'admin', 'credit')
      RETURNING id
    `;
    createdBookingIds.push(conflict.id);

    const res = await callAdmin('reserved-goodwill-move', {
      booking_id: fixture.bookingId,
      new_date: replacement.date,
      new_start_time: replacement.startTime,
      reason: 'Integration test overlap refusal',
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('SLOT_UNAVAILABLE');

    const [oldBooking] = await sql`
      SELECT status, credit_returned
        FROM lesson_bookings
       WHERE id = ${fixture.bookingId}
    `;
    expect(oldBooking.status).toBe('scheduled');
    expect(oldBooking.credit_returned).toBe(false);
  });
});
