// Integration coverage for instructor-created credit bookings with Step 5 BCS attribution.
//
// Requires an isolated Neon test branch:
//   CC_TEST_DB=1 POSTGRES_URL_TEST="..." npx playwright test tests/instructor-create-booking-bcs.integration.spec.js

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';

const {
  _createInstructorCreditBookingTransaction: createInstructorCreditBookingTransaction,
  _CREDIT_BOOKING_SOURCE_TYPES: INSTRUCTOR_CREDIT_BOOKING_SOURCE_TYPES,
} = require('../api/instructor');
const {
  _CREDIT_BOOKING_SOURCE_TYPES: LEARNER_CREDIT_BOOKING_SOURCE_TYPES,
} = require('../api/slots');
const { SCHEDULED } = require('../api/_booking-status');

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
  const d = new Date(Date.UTC(2033, 0, 1 + daysAhead));
  return d.toISOString().slice(0, 10);
}

async function resetState() {
  if (createdBookingIds.size) {
    await sql`DELETE FROM booking_credit_sources WHERE booking_id = ANY(${[...createdBookingIds]})`;
    await sql`DELETE FROM lesson_bookings WHERE id = ANY(${[...createdBookingIds]})`;
    createdBookingIds.clear();
  }
  if (createdCreditTxIds.size) {
    await sql`DELETE FROM credit_source_adjustments WHERE credit_transaction_id = ANY(${[...createdCreditTxIds]})`;
    await sql`DELETE FROM booking_credit_sources WHERE credit_transaction_id = ANY(${[...createdCreditTxIds]})`;
    await sql`DELETE FROM credit_transactions WHERE id = ANY(${[...createdCreditTxIds]})`;
    createdCreditTxIds.clear();
  }
  await sql`DELETE FROM booking_credit_sources WHERE booking_id IN (SELECT id FROM lesson_bookings WHERE learner_id = ${learnerId})`;
  await sql`DELETE FROM lesson_bookings WHERE learner_id = ${learnerId}`;
  await sql`DELETE FROM credit_source_adjustments WHERE credit_transaction_id IN (SELECT id FROM credit_transactions WHERE learner_id = ${learnerId})`;
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
  minutes = 90,
  amountPence = 8250,
  stripeFeePence = 144,
  type = 'purchase',
  source = 'stripe',
  absorbedBy = null,
}) {
  const [row] = await sql`
    INSERT INTO credit_transactions
      (learner_id, instructor_id, school_id, type, credits, minutes,
       amount_pence, payment_method, stripe_session_id, stripe_fee_pence,
       effective_rate_pence_per_minute, source, absorbed_by)
    VALUES
      (${learnerId}, ${instructorId}, ${SCHOOL_ID}, ${type}, ${Math.ceil(minutes / 60)}, ${minutes},
       ${amountPence}, 'test', ${unique('cs_inst_bcs')}, ${stripeFeePence},
       ${Math.round(amountPence / minutes)}, ${source}, ${absorbedBy})
    RETURNING id
  `;
  createdCreditTxIds.add(row.id);
  return row.id;
}

async function createCreditBooking({ date, startTime = '09:00', endTime = '10:30', durationMins = 90 }) {
  const result = await createInstructorCreditBookingTransaction({
    connectionString: process.env.POSTGRES_URL_TEST,
    learnerId,
    instructorId,
    schoolId: SCHOOL_ID,
    scheduledDate: futureDate(date),
    startTime,
    endTime,
    lessonTypeId,
    durationMins,
    notes: 'integration test',
    pickupAddress: '1 Test Street, London SW1A 1AA',
    dropoffAddress: null,
  });
  if (result.booking) createdBookingIds.add(result.booking.id);
  return result;
}

async function getActiveBcs(bookingId) {
  const rows = await sql`
    SELECT school_id, booking_id, credit_transaction_id, minutes_drawn,
           contribution_pence, stripe_fee_pence, absorbed_by, refunded_at
      FROM booking_credit_sources
     WHERE booking_id = ${bookingId}
     ORDER BY id
  `;
  return rows;
}

async function pairDrift() {
  const [row] = await sql`
    WITH purchases AS (
      SELECT COALESCE(SUM(minutes), 0)::int AS minutes
        FROM credit_transactions
       WHERE learner_id = ${learnerId}
         AND instructor_id = ${instructorId}
         AND school_id = ${SCHOOL_ID}
    ),
    booking_draws AS (
      SELECT COALESCE(SUM(minutes_deducted), 0)::int AS minutes
        FROM lesson_bookings lb
       WHERE lb.learner_id = ${learnerId}
         AND lb.instructor_id = ${instructorId}
         AND lb.school_id = ${SCHOOL_ID}
         AND lb.credit_returned = FALSE
         AND lb.minutes_deducted IS NOT NULL
         AND lb.minutes_deducted > 0
         AND NOT EXISTS (
           SELECT 1 FROM booking_credit_sources bcs WHERE bcs.booking_id = lb.id
         )
    ),
    bcs_draws AS (
      SELECT COALESCE(SUM(bcs.minutes_drawn), 0)::int AS minutes
        FROM booking_credit_sources bcs
        JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
       WHERE ct.learner_id = ${learnerId}
         AND ct.instructor_id = ${instructorId}
         AND ct.school_id = ${SCHOOL_ID}
         AND bcs.refunded_at IS NULL
    ),
    csa AS (
      SELECT COALESCE(SUM(csa.minutes_adjusted), 0)::int AS minutes
        FROM credit_source_adjustments csa
        JOIN credit_transactions ct ON ct.id = csa.credit_transaction_id
       WHERE ct.learner_id = ${learnerId}
         AND ct.instructor_id = ${instructorId}
         AND ct.school_id = ${SCHOOL_ID}
    ),
    actual AS (
      SELECT COALESCE(balance_minutes, 0)::int AS minutes
        FROM learner_credit_balances
       WHERE learner_id = ${learnerId}
         AND instructor_id = ${instructorId}
         AND school_id = ${SCHOOL_ID}
    )
    SELECT
      COALESCE((SELECT minutes FROM actual), 0)::int AS actual_minutes,
      ((SELECT minutes FROM purchases)
       - (SELECT minutes FROM booking_draws)
       - (SELECT minutes FROM bcs_draws)
       - (SELECT minutes FROM csa))::int AS expected_minutes
  `;
  return row.actual_minutes - row.expected_minutes;
}

test.describe('instructor create-booking credit BCS attribution - integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run against an isolated Neon branch.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST is the same as POSTGRES_URL. Point POSTGRES_URL_TEST at an isolated Neon branch.');
    }

    sql = neon(process.env.POSTGRES_URL_TEST);

    expect(INSTRUCTOR_CREDIT_BOOKING_SOURCE_TYPES).toEqual(LEARNER_CREDIT_BOOKING_SOURCE_TYPES);
    expect(INSTRUCTOR_CREDIT_BOOKING_SOURCE_TYPES).toContain('slot_purchase');
    expect(INSTRUCTOR_CREDIT_BOOKING_SOURCE_TYPES).not.toContain('admin_remove');
    expect(INSTRUCTOR_CREDIT_BOOKING_SOURCE_TYPES).not.toContain('free_trial');

    const [hasBcsSchoolId] = await sql`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'booking_credit_sources'
        AND column_name = 'school_id'
    `;
    if (!hasBcsSchoolId) {
      throw new Error('Test branch is missing booking_credit_sources.school_id. Apply latest main migrations first.');
    }

    const learnerEmail = `${unique('inst-bcs-learner')}@coachcarter.test`;
    const [learner] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES ('Instructor BCS Learner', ${learnerEmail}, ${SCHOOL_ID}, 0, 0)
      RETURNING id
    `;
    learnerId = learner.id;

    const instructorEmail = `${unique('inst-bcs-instructor')}@coachcarter.test`;
    const [instructor] = await sql`
      INSERT INTO instructors (name, email, phone, active, school_id)
      VALUES ('Instructor BCS Instructor', ${instructorEmail}, ${`073${crypto.randomInt(10000000, 99999999)}`}, TRUE, ${SCHOOL_ID})
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
    if (!ENABLED) return;
    await resetState();
  });

  test('single credit booking writes active BCS, decrements LCB, and stays drift-clean', async () => {
    await seedLcb(90);
    const creditTxId = await seedCreditSource({
      type: 'slot_purchase',
      minutes: 90,
      amountPence: 8250,
      stripeFeePence: 144,
    });

    const result = await createCreditBooking({ date: 1 });
    expect(result.ok).toBe(true);
    expect(result.balanceMinutes).toBe(0);

    const [booking] = await sql`
      SELECT id, minutes_deducted, list_price_pence, payment_method, created_by
      FROM lesson_bookings
      WHERE id = ${result.booking.id}
    `;
    expect(booking.minutes_deducted).toBe(90);
    expect(booking.list_price_pence).toBe(8250);
    expect(booking.payment_method).toBe('credit');
    expect(booking.created_by).toBe('instructor');

    const bcsRows = await getActiveBcs(result.booking.id);
    expect(bcsRows).toHaveLength(1);
    expect(bcsRows[0]).toMatchObject({
      school_id: SCHOOL_ID,
      booking_id: result.booking.id,
      credit_transaction_id: creditTxId,
      minutes_drawn: 90,
      contribution_pence: 8250,
      stripe_fee_pence: 144,
      absorbed_by: null,
      refunded_at: null,
    });

    const [lcb] = await sql`
      SELECT balance_minutes FROM learner_credit_balances
      WHERE learner_id = ${learnerId} AND instructor_id = ${instructorId}
    `;
    expect(lcb.balance_minutes).toBe(0);
    expect(await pairDrift()).toBe(0);
  });

  test('insufficient balance creates no booking and no BCS', async () => {
    await seedLcb(30);
    await seedCreditSource({ minutes: 30, amountPence: 2750, stripeFeePence: 61 });

    const result = await createCreditBooking({ date: 2 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INSUFFICIENT_BALANCE');

    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM lesson_bookings WHERE learner_id = ${learnerId}) AS bookings,
        (SELECT COUNT(*)::int
           FROM booking_credit_sources bcs
           JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
          WHERE ct.learner_id = ${learnerId}) AS bcs_rows,
        (SELECT balance_minutes::int FROM learner_credit_balances
          WHERE learner_id = ${learnerId} AND instructor_id = ${instructorId}) AS balance_minutes
    `;
    expect(counts.bookings).toBe(0);
    expect(counts.bcs_rows).toBe(0);
    expect(counts.balance_minutes).toBe(30);
  });

  test('slot conflict creates no new booking and no BCS', async () => {
    await seedLcb(90);
    await seedCreditSource({ minutes: 90, amountPence: 8250, stripeFeePence: 144 });

    const conflictDate = futureDate(3);
    const [conflict] = await sql`
      INSERT INTO lesson_bookings
        (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
         lesson_type_id, minutes_deducted, school_id, list_price_pence, list_price_source)
      VALUES
        (${learnerId}, ${instructorId}, ${conflictDate}, '09:00', '10:30', ${SCHEDULED},
         ${lessonTypeId}, 0, ${SCHOOL_ID}, 0, 'live_compute_insert')
      RETURNING id
    `;
    createdBookingIds.add(conflict.id);

    const result = await createInstructorCreditBookingTransaction({
      connectionString: process.env.POSTGRES_URL_TEST,
      learnerId,
      instructorId,
      schoolId: SCHOOL_ID,
      scheduledDate: conflictDate,
      startTime: '09:00',
      endTime: '10:30',
      lessonTypeId,
      durationMins: 90,
      notes: 'conflict',
      pickupAddress: '1 Test Street, London SW1A 1AA',
      dropoffAddress: null,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('SLOT_UNAVAILABLE');

    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM lesson_bookings WHERE learner_id = ${learnerId}) AS bookings,
        (SELECT COUNT(*)::int
           FROM booking_credit_sources bcs
           JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
          WHERE ct.learner_id = ${learnerId}) AS bcs_rows,
        (SELECT balance_minutes::int FROM learner_credit_balances
          WHERE learner_id = ${learnerId} AND instructor_id = ${instructorId}) AS balance_minutes
    `;
    expect(counts.bookings).toBe(1);
    expect(counts.bcs_rows).toBe(0);
    expect(counts.balance_minutes).toBe(90);
  });

  test('instructor-absorbed source creates BCS but zero payable list price', async () => {
    await seedLcb(90);
    const creditTxId = await seedCreditSource({
      minutes: 90,
      amountPence: 8250,
      stripeFeePence: 0,
      source: 'goodwill',
      absorbedBy: 'instructor',
      type: 'admin_add',
    });

    const result = await createCreditBooking({ date: 4 });
    expect(result.ok).toBe(true);

    const [booking] = await sql`
      SELECT list_price_pence FROM lesson_bookings
      WHERE id = ${result.booking.id}
    `;
    expect(booking.list_price_pence).toBe(0);

    const bcsRows = await getActiveBcs(result.booking.id);
    expect(bcsRows).toHaveLength(1);
    expect(bcsRows[0]).toMatchObject({
      credit_transaction_id: creditTxId,
      minutes_drawn: 90,
      contribution_pence: 8250,
      stripe_fee_pence: 0,
      absorbed_by: 'instructor',
    });
    expect(await pairDrift()).toBe(0);
  });
});
