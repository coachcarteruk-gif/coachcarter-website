// Integration coverage for Step 5 credit-funded booking BCS writer.
//
// Requires an isolated Neon test branch:
//   CC_TEST_DB=1 POSTGRES_URL_TEST="..." npx playwright test slots-credit-bcs.integration

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';

const {
  _bookCreditFundedSlotsTransaction: bookCreditFundedSlotsTransaction,
  _CREDIT_BOOKING_SOURCE_TYPES: CREDIT_BOOKING_SOURCE_TYPES,
} = require('../api/slots');

const { SCHEDULED, CHARGEABLE, BLOCKING_STATUSES } = require('../api/_booking-status');

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
const SCHOOL_ID = 1;

test.describe.configure({ mode: 'serial' });

let sql;
let learnerId;
let instructorId;
let lessonTypeId;
const createdBookingIds = new Set();
const createdCreditTxIds = new Set();

function unique(label) {
  return `${label}_${crypto.randomBytes(6).toString('hex')}`;
}

function futureDate(daysAhead) {
  const d = new Date(Date.UTC(2032, 0, 1 + daysAhead));
  return d.toISOString().slice(0, 10);
}

async function resetState() {
  if (createdBookingIds.size) {
    await sql`DELETE FROM lesson_bookings WHERE id = ANY(${[...createdBookingIds]})`;
    createdBookingIds.clear();
  }
  if (createdCreditTxIds.size) {
    await sql`DELETE FROM credit_transactions WHERE id = ANY(${[...createdCreditTxIds]})`;
    createdCreditTxIds.clear();
  }
  await sql`DELETE FROM booking_credit_sources WHERE booking_id IN (SELECT id FROM lesson_bookings WHERE learner_id = ${learnerId})`;
  await sql`DELETE FROM lesson_bookings WHERE learner_id = ${learnerId}`;
  await sql`DELETE FROM credit_transactions WHERE learner_id = ${learnerId}`;
  await sql`DELETE FROM learner_credit_balances WHERE learner_id = ${learnerId}`;
  await sql`UPDATE learner_users SET balance_minutes = 0, credit_balance = 0 WHERE id = ${learnerId}`;
}

async function seedLcb(minutes) {
  await sql`
    INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
    VALUES (${learnerId}, ${instructorId}, ${SCHOOL_ID}, ${minutes})
    ON CONFLICT (learner_id, instructor_id) DO UPDATE
      SET balance_minutes = EXCLUDED.balance_minutes,
          school_id = EXCLUDED.school_id,
          updated_at = NOW()
  `;
}

async function seedCreditSource({
  minutes,
  amountPence,
  type = 'purchase',
  source = 'stripe',
  absorbedBy = null,
  stripeFeePence = 0,
}) {
  const [row] = await sql`
    INSERT INTO credit_transactions
      (learner_id, instructor_id, school_id, type, credits, minutes,
       amount_pence, payment_method, stripe_session_id, stripe_fee_pence,
       effective_rate_pence_per_minute, source, absorbed_by)
    VALUES
      (${learnerId}, ${instructorId}, ${SCHOOL_ID}, ${type}, ${Math.ceil(minutes / 60)}, ${minutes},
       ${amountPence}, 'test', ${unique('cs_slots_bcs')}, ${stripeFeePence},
       ${Math.round(amountPence / minutes)}, ${source}, ${absorbedBy})
    RETURNING id
  `;
  createdCreditTxIds.add(row.id);
  return row.id;
}

async function book({ date, weeks = 1, startTime = '09:00', durationMins = 90 }) {
  const bookingDates = Array.from({ length: weeks }, (_, index) => ({
    date: futureDate(date + index * 7),
  }));
  const result = await bookCreditFundedSlotsTransaction({
    connectionString: process.env.POSTGRES_URL_TEST,
    learnerId,
    instructorId,
    schoolId: SCHOOL_ID,
    bookingDates,
    startTime,
    endTime: durationMins === 90 ? '10:30' : '11:00',
    lessonTypeId,
    durationMins,
    pickupAddress: '1 Test Street, London SW1A 1AA',
    dropoffAddress: null,
    seriesId: weeks > 1 ? crypto.randomUUID() : null,
  });
  if (result.createdBookings) {
    result.createdBookings.forEach(b => createdBookingIds.add(b.id));
  }
  return result;
}

test.describe('slots.js credit-funded BCS writer - integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run against an isolated Neon branch.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST is the same as POSTGRES_URL. Point POSTGRES_URL_TEST at an isolated Neon branch.');
    }

    sql = neon(process.env.POSTGRES_URL_TEST);

    expect(CREDIT_BOOKING_SOURCE_TYPES).toEqual(['purchase', 'admin_add', 'referral_reward', 'legacy_grandfather']);
    expect(CREDIT_BOOKING_SOURCE_TYPES).not.toContain('slot_purchase');
    expect(CREDIT_BOOKING_SOURCE_TYPES).not.toContain('admin_remove');
    expect(CREDIT_BOOKING_SOURCE_TYPES).not.toContain('free_trial');

    const email = `${unique('slots-bcs')}@coachcarter.test`;
    const [learner] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES ('Slots BCS Test', ${email}, ${SCHOOL_ID}, 0, 0)
      RETURNING id
    `;
    learnerId = learner.id;

    const instructorEmail = `${unique('slots-bcs-instructor')}@coachcarter.test`;
    const [instructor] = await sql`
      INSERT INTO instructors (name, email, phone, active, school_id)
      VALUES ('Slots BCS Instructor', ${instructorEmail}, '07111111111', true, ${SCHOOL_ID})
      RETURNING id
    `;
    instructorId = instructor.id;

    const [lessonType] = await sql`
      SELECT id FROM lesson_types
      WHERE school_id = ${SCHOOL_ID} AND duration_minutes = 90 AND active = true
      ORDER BY id
      LIMIT 1
    `;
    lessonTypeId = lessonType.id;
  });

  test.afterAll(async () => {
    if (!ENABLED) return;
    await resetState();
    await sql`DELETE FROM learner_users WHERE id = ${learnerId}`;
    await sql`DELETE FROM instructors WHERE id = ${instructorId}`;
  });

  test.beforeEach(async () => {
    await resetState();
  });

  test('single booking writes booking + BCS and decrements scoped LCB atomically', async () => {
    await seedLcb(120);
    const creditTxId = await seedCreditSource({ minutes: 120, amountPence: 11000, stripeFeePence: 240 });

    const result = await book({ date: 1 });

    expect(result.ok).toBe(true);
    expect(result.balanceMinutes).toBe(30);

    const [booking] = await sql`
      SELECT id, minutes_deducted, list_price_pence
      FROM lesson_bookings
      WHERE id = ${result.createdBookings[0].id}
    `;
    expect(booking.minutes_deducted).toBe(90);
    expect(booking.list_price_pence).toBe(8250);

    const [bcs] = await sql`
      SELECT booking_id, credit_transaction_id, minutes_drawn, contribution_pence, stripe_fee_pence
      FROM booking_credit_sources
      WHERE booking_id = ${booking.id}
    `;
    expect(bcs.credit_transaction_id).toBe(creditTxId);
    expect(bcs.minutes_drawn).toBe(90);
    expect(bcs.contribution_pence).toBe(8250);

    const [lcb] = await sql`
      SELECT balance_minutes FROM learner_credit_balances
      WHERE learner_id = ${learnerId} AND instructor_id = ${instructorId}
    `;
    expect(lcb.balance_minutes).toBe(30);
  });

  test('repeat bookings split FIFO sources across booking IDs', async () => {
    await seedLcb(180);
    const first = await seedCreditSource({ minutes: 90, amountPence: 9000 });
    const second = await seedCreditSource({ minutes: 90, amountPence: 12000 });

    const result = await book({ date: 20, weeks: 2 });

    expect(result.ok).toBe(true);
    expect(result.createdBookings).toHaveLength(2);
    expect(result.balanceMinutes).toBe(0);

    const rows = await sql`
      SELECT booking_id, credit_transaction_id, minutes_drawn, contribution_pence
      FROM booking_credit_sources
      WHERE booking_id = ANY(${result.createdBookings.map(b => b.id)})
      ORDER BY id
    `;
    expect(rows).toHaveLength(2);
    expect(rows[0].credit_transaction_id).toBe(first);
    expect(rows[0].booking_id).toBe(result.createdBookings[0].id);
    expect(rows[0].contribution_pence).toBe(9000);
    expect(rows[1].credit_transaction_id).toBe(second);
    expect(rows[1].booking_id).toBe(result.createdBookings[1].id);
    expect(rows[1].contribution_pence).toBe(12000);
  });

  test('insufficient locked LCB balance rolls back without booking or BCS rows', async () => {
    await seedLcb(60);
    await seedCreditSource({ minutes: 60, amountPence: 6000 });

    const result = await book({ date: 40 });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('INSUFFICIENT_BALANCE');

    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM lesson_bookings WHERE learner_id = ${learnerId}) AS bookings,
        (SELECT COUNT(*)::int FROM booking_credit_sources bcs
          JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
         WHERE ct.learner_id = ${learnerId}) AS bcs_rows,
        (SELECT balance_minutes::int FROM learner_credit_balances
         WHERE learner_id = ${learnerId} AND instructor_id = ${instructorId}) AS balance_minutes
    `;
    expect(counts.bookings).toBe(0);
    expect(counts.bcs_rows).toBe(0);
    expect(counts.balance_minutes).toBe(60);
  });

  test('blocking slot conflict inside transaction leaves LCB and BCS untouched', async () => {
    await seedLcb(90);
    await seedCreditSource({ minutes: 90, amountPence: 9000 });
    const conflictDate = futureDate(60);
    const [conflict] = await sql`
      INSERT INTO lesson_bookings
        (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
         lesson_type_id, minutes_deducted, school_id, list_price_pence, list_price_source)
      VALUES
        (${learnerId}, ${instructorId}, ${conflictDate}, '09:00', '10:30', ${CHARGEABLE},
         ${lessonTypeId}, 90, ${SCHOOL_ID}, 9000, 'live_compute_insert')
      RETURNING id
    `;
    createdBookingIds.add(conflict.id);

    const result = await book({ date: 60 });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('SLOTS_UNAVAILABLE');

    const [lcb] = await sql`
      SELECT balance_minutes FROM learner_credit_balances
      WHERE learner_id = ${learnerId} AND instructor_id = ${instructorId}
    `;
    expect(lcb.balance_minutes).toBe(90);

    const bcs = await sql`
      SELECT id FROM booking_credit_sources
      WHERE credit_transaction_id = ANY(${[...createdCreditTxIds]})
    `;
    expect(bcs).toHaveLength(0);
    expect(BLOCKING_STATUSES).toContain(CHARGEABLE);
    expect(BLOCKING_STATUSES).toContain(SCHEDULED);
  });

  test('second booking insert conflict rolls back the first booking, BCS, and LCB decrement', async () => {
    await seedLcb(180);
    await seedCreditSource({ minutes: 180, amountPence: 18000 });
    const duplicateDate = futureDate(70);

    const result = await bookCreditFundedSlotsTransaction({
      connectionString: process.env.POSTGRES_URL_TEST,
      learnerId,
      instructorId,
      schoolId: SCHOOL_ID,
      bookingDates: [{ date: duplicateDate }, { date: duplicateDate }],
      startTime: '09:00',
      endTime: '10:30',
      lessonTypeId,
      durationMins: 90,
      pickupAddress: '1 Test Street, London SW1A 1AA',
      dropoffAddress: null,
      seriesId: crypto.randomUUID(),
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('SLOTS_UNAVAILABLE');

    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*)::int
           FROM lesson_bookings
          WHERE learner_id = ${learnerId}
            AND instructor_id = ${instructorId}
            AND scheduled_date = ${duplicateDate}
            AND start_time = '09:00') AS bookings,
        (SELECT COUNT(*)::int
           FROM booking_credit_sources bcs
           JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
          WHERE ct.learner_id = ${learnerId}
            AND ct.instructor_id = ${instructorId}) AS bcs_rows,
        (SELECT balance_minutes::int
           FROM learner_credit_balances
          WHERE learner_id = ${learnerId}
            AND instructor_id = ${instructorId}) AS balance_minutes
    `;
    expect(counts.bookings).toBe(0);
    expect(counts.bcs_rows).toBe(0);
    expect(counts.balance_minutes).toBe(180);
  });

  test('instructor-absorbed sources create BCS but zero payable list_price_pence', async () => {
    await seedLcb(90);
    await seedCreditSource({
      minutes: 90,
      amountPence: 9000,
      type: 'admin_add',
      source: 'goodwill',
      absorbedBy: 'instructor',
    });

    const result = await book({ date: 80 });

    expect(result.ok).toBe(true);
    const [booking] = await sql`
      SELECT list_price_pence FROM lesson_bookings
      WHERE id = ${result.createdBookings[0].id}
    `;
    expect(booking.list_price_pence).toBe(0);

    const [bcs] = await sql`
      SELECT absorbed_by, contribution_pence
      FROM booking_credit_sources
      WHERE booking_id = ${result.createdBookings[0].id}
    `;
    expect(bcs.absorbed_by).toBe('instructor');
    expect(bcs.contribution_pence).toBe(9000);
  });
});
