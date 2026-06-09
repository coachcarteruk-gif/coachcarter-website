// Smoke coverage for the Reserved Weekly Slot bank-payment hold path.
//
// Requires an isolated Neon test branch:
//   CC_TEST_DB=1 POSTGRES_URL_TEST="..." npm.cmd test -- tests/recurring-block-bank-smoke.integration.spec.js
//
// This deliberately stops before Stripe Checkout creation. It verifies the
// database side of the safe local smoke: pending block, held items, expiry
// cleanup, and no credit/refund/payout mutation.

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';

const {
  _createRecurringBlockBankHoldTransaction: createRecurringBlockBankHoldTransaction,
  _expireStaleRecurringBlockBankHoldForLearner: expireStaleRecurringBlockBankHoldForLearner,
} = require('../api/slots');

const { SCHEDULED } = require('../api/_booking-status');

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
const SCHOOL_ID = 1;

test.describe.configure({ mode: 'serial' });

let sql;
let learnerId;
let instructorId;
let lessonTypeId;
let anchorBookingId;
let hasRecurringBlockTables = false;
const createdBlockIds = new Set();
const createdBookingIds = new Set();

function unique(label) {
  return `${label}_${crypto.randomBytes(6).toString('hex')}`;
}

function futureDate(daysAhead) {
  const d = new Date(Date.UTC(2032, 0, 1 + daysAhead));
  return d.toISOString().slice(0, 10);
}

async function resetState() {
  if (hasRecurringBlockTables) {
    if (createdBlockIds.size) {
      await sql`DELETE FROM recurring_slot_block_items WHERE block_id = ANY(${[...createdBlockIds]})`;
      await sql`DELETE FROM recurring_slot_blocks WHERE id = ANY(${[...createdBlockIds]})`;
      createdBlockIds.clear();
    }
    await sql`DELETE FROM recurring_slot_blocks WHERE learner_id = ${learnerId}`;
  }
  if (createdBookingIds.size) {
    await sql`DELETE FROM lesson_bookings WHERE id = ANY(${[...createdBookingIds]})`;
    createdBookingIds.clear();
  }
  await sql`DELETE FROM booking_credit_sources WHERE booking_id IN (SELECT id FROM lesson_bookings WHERE learner_id = ${learnerId})`;
  await sql`DELETE FROM lesson_bookings WHERE learner_id = ${learnerId}`;
  await sql`DELETE FROM credit_transactions WHERE learner_id = ${learnerId}`;
  await sql`DELETE FROM learner_credit_balances WHERE learner_id = ${learnerId}`;
  await sql`UPDATE learner_users SET balance_minutes = 0, credit_balance = 0 WHERE id = ${learnerId}`;
}

async function createAnchorBooking() {
  const [anchor] = await sql`
    INSERT INTO lesson_bookings
      (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
       lesson_type_id, minutes_deducted, school_id, list_price_pence, list_price_source)
    VALUES
      (${learnerId}, ${instructorId}, ${futureDate(30)}, '09:00', '10:30', ${SCHEDULED},
       ${lessonTypeId}, 90, ${SCHOOL_ID}, 8250, 'live_compute_insert')
    RETURNING id
  `;
  createdBookingIds.add(anchor.id);
  anchorBookingId = anchor.id;
}

function previewFor({ startOffset = 37 } = {}) {
  const selectedSlots = [0, 7, 14, 21].map(offset => ({
    date: futureDate(startOffset + offset),
    start_time: '09:00',
    end_time: '10:30',
  }));

  return {
    ok: true,
    requested_lessons: 4,
    selected_lessons: 4,
    can_commit: true,
    selected_slots: selectedSlots,
    anchor: {
      booking_id: anchorBookingId,
      instructor_id: instructorId,
      instructor_name: 'Bank Smoke Instructor',
      lesson_type_id: lessonTypeId,
      lesson_type_name: 'Standard lesson',
      duration_minutes: 90,
      start_time: '09:00',
      end_time: '10:30',
    },
    credit: {
      has_sufficient_credit: false,
      required_minutes: 360,
      balance_minutes: 0,
    },
    pricing: {
      price_per_lesson_pence: 8250,
      requested_total_price_pence: 33000,
      price_source: 'test_smoke',
    },
  };
}

test.describe('Reserved Weekly Slot bank checkout smoke - database side', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run against an isolated Neon branch.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST is the same as POSTGRES_URL. Point POSTGRES_URL_TEST at an isolated Neon branch.');
    }

    sql = neon(process.env.POSTGRES_URL_TEST);

    const [hasRecurringBlocks] = await sql`
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'recurring_slot_blocks'
    `;
    hasRecurringBlockTables = !!hasRecurringBlocks;

    const email = `${unique('bank-smoke')}@coachcarter.test`;
    const [learner] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES ('Bank Smoke Learner', ${email}, ${SCHOOL_ID}, 0, 0)
      RETURNING id
    `;
    learnerId = learner.id;

    const instructorEmail = `${unique('bank-smoke-instructor')}@coachcarter.test`;
    const [instructor] = await sql`
      INSERT INTO instructors (name, email, phone, active, school_id)
      VALUES ('Bank Smoke Instructor', ${instructorEmail}, '07111111111', true, ${SCHOOL_ID})
      RETURNING id
    `;
    instructorId = instructor.id;

    const [lessonType] = await sql`
      SELECT id
      FROM lesson_types
      WHERE school_id = ${SCHOOL_ID}
        AND duration_minutes = 90
        AND active = true
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
    if (hasRecurringBlockTables) await createAnchorBooking();
  });

  test('creates a pending bank block and held items without bookings or credit ledger mutation', async () => {
    test.skip(!hasRecurringBlockTables, 'Test branch has not run the recurring_slot_blocks migration yet.');

    const hold = await createRecurringBlockBankHoldTransaction({
      connectionString: process.env.POSTGRES_URL_TEST,
      learnerId,
      schoolId: SCHOOL_ID,
      preview: previewFor(),
      holdMinutes: 10,
    });

    expect(hold.ok).toBe(true);
    createdBlockIds.add(hold.block.id);

    const [block] = await sql`
      SELECT learner_id, instructor_id, school_id, anchor_booking_id,
             status, funding_method, selected_lessons, total_price_pence,
             expires_at > NOW() AS expires_in_future
      FROM recurring_slot_blocks
      WHERE id = ${hold.block.id}
    `;
    expect(block.learner_id).toBe(learnerId);
    expect(block.instructor_id).toBe(instructorId);
    expect(block.school_id).toBe(SCHOOL_ID);
    expect(block.anchor_booking_id).toBe(anchorBookingId);
    expect(block.status).toBe('pending_payment');
    expect(block.funding_method).toBe('bank_payment');
    expect(block.selected_lessons).toBe(4);
    expect(block.total_price_pence).toBe(33000);
    expect(block.expires_in_future).toBe(true);

    const items = await sql`
      SELECT status, price_pence
      FROM recurring_slot_block_items
      WHERE block_id = ${hold.block.id}
      ORDER BY scheduled_date
    `;
    expect(items).toHaveLength(4);
    expect(items.map(item => item.status)).toEqual(['held', 'held', 'held', 'held']);
    expect(items.map(item => item.price_pence)).toEqual([8250, 8250, 8250, 8250]);

    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM lesson_bookings WHERE learner_id = ${learnerId} AND created_by = 'recurring_block_bank_checkout') AS bank_bookings,
        (SELECT COUNT(*)::int FROM booking_credit_sources bcs
          JOIN lesson_bookings lb ON lb.id = bcs.booking_id
         WHERE lb.learner_id = ${learnerId}) AS bcs_rows,
        (SELECT COUNT(*)::int FROM credit_transactions WHERE learner_id = ${learnerId}) AS credit_rows,
        (SELECT COUNT(*)::int FROM learner_credit_balances WHERE learner_id = ${learnerId}) AS lcb_rows
    `;
    expect(counts.bank_bookings).toBe(0);
    expect(counts.bcs_rows).toBe(0);
    expect(counts.credit_rows).toBe(0);
    expect(counts.lcb_rows).toBe(0);
  });

  test('status-style stale cleanup expires only pending bank holds and is idempotent', async () => {
    test.skip(!hasRecurringBlockTables, 'Test branch has not run the recurring_slot_blocks migration yet.');

    const hold = await createRecurringBlockBankHoldTransaction({
      connectionString: process.env.POSTGRES_URL_TEST,
      learnerId,
      schoolId: SCHOOL_ID,
      preview: previewFor({ startOffset: 67 }),
      holdMinutes: 10,
    });

    expect(hold.ok).toBe(true);
    createdBlockIds.add(hold.block.id);

    await sql`
      UPDATE recurring_slot_blocks
      SET expires_at = NOW() - INTERVAL '1 minute'
      WHERE id = ${hold.block.id}
    `;

    const first = await expireStaleRecurringBlockBankHoldForLearner({
      connectionString: process.env.POSTGRES_URL_TEST,
      blockId: hold.block.id,
      learnerId,
      schoolId: SCHOOL_ID,
    });
    const second = await expireStaleRecurringBlockBankHoldForLearner({
      connectionString: process.env.POSTGRES_URL_TEST,
      blockId: hold.block.id,
      learnerId,
      schoolId: SCHOOL_ID,
    });

    expect(first).toMatchObject({ ok: true, code: 'EXPIRED' });
    expect(second).toMatchObject({ ok: true, code: 'BLOCK_NOT_PENDING', status: 'expired' });

    const [block] = await sql`
      SELECT status, released_at IS NOT NULL AS has_released_at, metadata
      FROM recurring_slot_blocks
      WHERE id = ${hold.block.id}
    `;
    expect(block.status).toBe('expired');
    expect(block.has_released_at).toBe(true);
    expect(block.metadata.release_reason).toBe('status_read_stale_pending_hold');

    const items = await sql`
      SELECT status
      FROM recurring_slot_block_items
      WHERE block_id = ${hold.block.id}
      ORDER BY scheduled_date
    `;
    expect(items.map(item => item.status)).toEqual(['released', 'released', 'released', 'released']);

    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM lesson_bookings WHERE learner_id = ${learnerId} AND created_by = 'recurring_block_bank_checkout') AS bank_bookings,
        (SELECT COUNT(*)::int FROM booking_credit_sources bcs
          JOIN lesson_bookings lb ON lb.id = bcs.booking_id
         WHERE lb.learner_id = ${learnerId}) AS bcs_rows,
        (SELECT COUNT(*)::int FROM credit_transactions WHERE learner_id = ${learnerId}) AS credit_rows,
        (SELECT COUNT(*)::int FROM learner_credit_balances WHERE learner_id = ${learnerId}) AS lcb_rows
    `;
    expect(counts.bank_bookings).toBe(0);
    expect(counts.bcs_rows).toBe(0);
    expect(counts.credit_rows).toBe(0);
    expect(counts.lcb_rows).toBe(0);
  });
});
