// Integration coverage for cancellation-time BCS refund marking.
//
// Requires an isolated Neon test branch:
//   CC_TEST_DB=1 POSTGRES_URL_TEST="..." npx playwright test cancel-bcs-refund.integration

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.JWT_SECRET = process.env.JWT_SECRET || `test-jwt-${crypto.randomBytes(8).toString('hex')}`;

const { SCHEDULED, REFUNDED } = require('../api/_booking-status');

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
const SCHOOL_ID = 1;
const CSRF_TOKEN = `test-csrf-${crypto.randomBytes(8).toString('hex')}`;

test.describe.configure({ mode: 'serial' });

let sql;
let slotsHandler;
let instructorHandler;
let originalPostgresUrl;
let learnerId;
let instructorId;
const createdBookingIds = new Set();
const createdCreditTxIds = new Set();

function installNotificationMocks() {
  const authHelpersPath = require.resolve('../api/_auth-helpers');
  require.cache[authHelpersPath] = {
    id: authHelpersPath,
    filename: authHelpersPath,
    loaded: true,
    exports: {
      createTransporter: () => ({ sendMail: async () => ({ accepted: [] }) }),
      generateToken: () => 'test-token',
    },
  };

  const whatsappPath = require.resolve('../api/_whatsapp');
  require.cache[whatsappPath] = {
    id: whatsappPath,
    filename: whatsappPath,
    loaded: true,
    exports: { sendWhatsApp: async () => ({ ok: true }) },
  };

  const availabilityPath = require.resolve('../api/_notify-availability');
  require.cache[availabilityPath] = {
    id: availabilityPath,
    filename: availabilityPath,
    loaded: true,
    exports: {
      notifyAvailableLearners: async () => ({ notified: 0 }),
      supersedeBroadcastSiblings: async () => ({ superseded: 0 }),
    },
  };
}

function unique(label) {
  return `${label}_${crypto.randomBytes(6).toString('hex')}`;
}

function futureDate(daysAhead) {
  const d = new Date(Date.now() + daysAhead * 86400000);
  return d.toISOString().slice(0, 10);
}

function fakeReq({ query, body, cookieName, token }) {
  return {
    method: 'POST',
    query,
    body,
    headers: {
      cookie: `${cookieName}=${token}; cc_csrf=${CSRF_TOKEN}`,
      'x-csrf-token': CSRF_TOKEN,
    },
    cookies: {},
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    on() { return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
  };
}

function learnerToken() {
  return jwt.sign(
    { id: learnerId, role: 'learner', school_id: SCHOOL_ID },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function instructorToken() {
  return jwt.sign(
    { id: instructorId, role: 'instructor', school_id: SCHOOL_ID },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function seedCreditSource(minutes = 90, {
  type = 'purchase',
  amountPence = minutes * 100,
  ratePencePerMinute = 100,
} = {}) {
  const [row] = await sql`
    INSERT INTO credit_transactions
      (learner_id, instructor_id, school_id, type, credits, minutes,
       amount_pence, payment_method, stripe_session_id, stripe_fee_pence,
       effective_rate_pence_per_minute, source)
    VALUES
      (${learnerId}, ${instructorId}, ${SCHOOL_ID}, ${type}, ${Math.ceil(minutes / 60)}, ${minutes},
       ${amountPence}, 'test', ${unique('cancel_bcs')}, 0,
       ${ratePencePerMinute}, 'stripe')
    RETURNING id
  `;
  createdCreditTxIds.add(row.id);
  return row.id;
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

async function makeBooking({
  daysAhead,
  seriesId = null,
  startTime = null,
  durationMinutes = 90,
}) {
  const date = futureDate(daysAhead);
  const start = startTime || `${String(8 + (crypto.randomBytes(1)[0] % 9)).padStart(2, '0')}:00`;
  const startMinutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
  const endMinutes = startMinutes + durationMinutes;
  const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  const [booking] = await sql`
    INSERT INTO lesson_bookings
      (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
       minutes_deducted, credit_returned, credit_forfeited, school_id,
       created_by, payment_method, series_id)
    VALUES
      (${learnerId}, ${instructorId}, ${date}, ${start}, ${end}, ${SCHEDULED},
       ${durationMinutes}, FALSE, FALSE, ${SCHOOL_ID},
       'learner', 'credit', ${seriesId})
    RETURNING id
  `;
  createdBookingIds.add(booking.id);
  return booking;
}

async function attachBcs({
  bookingId,
  creditTransactionId,
  minutes = 90,
  ratePencePerMinute = 100,
  contributionPence = minutes * ratePencePerMinute,
}) {
  const [row] = await sql`
    INSERT INTO booking_credit_sources
      (school_id, booking_id, credit_transaction_id, minutes_drawn,
       rate_pence_per_minute, contribution_pence, stripe_fee_pence)
    VALUES
      (${SCHOOL_ID}, ${bookingId}, ${creditTransactionId}, ${minutes},
       ${ratePencePerMinute}, ${contributionPence}, 0)
    RETURNING id
  `;
  return row.id;
}

async function getBcs(bookingId) {
  const [row] = await sql`
    SELECT id, refunded_at
      FROM booking_credit_sources
     WHERE booking_id = ${bookingId}
       AND school_id = ${SCHOOL_ID}
  `;
  return row;
}

async function getLcb() {
  const [row] = await sql`
    SELECT balance_minutes::int AS balance_minutes
      FROM learner_credit_balances
     WHERE learner_id = ${learnerId}
       AND instructor_id = ${instructorId}
       AND school_id = ${SCHOOL_ID}
  `;
  return row?.balance_minutes ?? 0;
}

async function recomputePairDrift() {
  const [row] = await sql`
    WITH purchases AS (
      SELECT COALESCE(SUM(minutes), 0)::int AS granted_minutes
        FROM credit_transactions
       WHERE learner_id = ${learnerId}
         AND instructor_id = ${instructorId}
         AND school_id = ${SCHOOL_ID}
    ),
    unattributed_booking_draws AS (
      SELECT COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
        FROM lesson_bookings lb
       WHERE lb.learner_id = ${learnerId}
         AND lb.instructor_id = ${instructorId}
         AND lb.school_id = ${SCHOOL_ID}
         AND lb.credit_returned = FALSE
         AND lb.minutes_deducted > 0
         AND NOT EXISTS (
           SELECT 1 FROM booking_credit_sources bcs
            WHERE bcs.booking_id = lb.id
              AND bcs.school_id = ${SCHOOL_ID}
         )
    ),
    active_bcs_draws AS (
      SELECT COALESCE(SUM(bcs.minutes_drawn), 0)::int AS minutes
        FROM booking_credit_sources bcs
        JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
       WHERE bcs.refunded_at IS NULL
         AND bcs.school_id = ${SCHOOL_ID}
         AND ct.learner_id = ${learnerId}
         AND ct.instructor_id = ${instructorId}
         AND ct.school_id = ${SCHOOL_ID}
    ),
    lcb AS (
      SELECT COALESCE(MAX(balance_minutes), 0)::int AS balance_minutes
        FROM learner_credit_balances
       WHERE learner_id = ${learnerId}
         AND instructor_id = ${instructorId}
         AND school_id = ${SCHOOL_ID}
    )
    SELECT
      (l.balance_minutes - (p.granted_minutes - u.minutes - b.minutes))::int AS drift_minutes
      FROM purchases p, unattributed_booking_draws u, active_bcs_draws b, lcb l
  `;
  return row.drift_minutes;
}

async function resetState() {
  if (createdBookingIds.size) {
    await sql`
      DELETE FROM booking_credit_sources
       WHERE booking_id = ANY(${[...createdBookingIds]})
         AND school_id = ${SCHOOL_ID}
    `;
    await sql`
      DELETE FROM lesson_bookings
       WHERE id = ANY(${[...createdBookingIds]})
         AND school_id = ${SCHOOL_ID}
    `;
    createdBookingIds.clear();
  }
  if (createdCreditTxIds.size) {
    await sql`
      DELETE FROM credit_transactions
       WHERE id = ANY(${[...createdCreditTxIds]})
         AND school_id = ${SCHOOL_ID}
    `;
    createdCreditTxIds.clear();
  }
  if (learnerId) {
    await sql`
      DELETE FROM learner_credit_balances
       WHERE learner_id = ${learnerId}
         AND school_id = ${SCHOOL_ID}
    `;
    await sql`
      UPDATE learner_users
         SET balance_minutes = 0,
             credit_balance = 0
       WHERE id = ${learnerId}
         AND school_id = ${SCHOOL_ID}
    `;
  }
}

test.describe('cancellation BCS refund marking', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run against an isolated Neon branch.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL. Point POSTGRES_URL_TEST at an isolated branch.');
    }

    originalPostgresUrl = process.env.POSTGRES_URL;
    process.env.POSTGRES_URL = process.env.POSTGRES_URL_TEST;
    installNotificationMocks();

    slotsHandler = require('../api/slots');
    instructorHandler = require('../api/instructor');
    sql = neon(process.env.POSTGRES_URL_TEST);

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

    const learnerEmail = `${unique('cancel-bcs-learner')}@coachcarter.test`;
    const [learner] = await sql`
      INSERT INTO learner_users (name, email, phone, school_id, balance_minutes, credit_balance)
      VALUES ('Cancel BCS Learner', ${learnerEmail}, ${`071${crypto.randomInt(10000000, 99999999)}`}, ${SCHOOL_ID}, 0, 0)
      RETURNING id
    `;
    learnerId = learner.id;

    const instructorEmail = `${unique('cancel-bcs-instructor')}@coachcarter.test`;
    const [instructor] = await sql`
      INSERT INTO instructors (name, email, phone, active, school_id)
      VALUES ('Cancel BCS Instructor', ${instructorEmail}, ${`072${crypto.randomInt(10000000, 99999999)}`}, TRUE, ${SCHOOL_ID})
      RETURNING id
    `;
    instructorId = instructor.id;
  });

  test.afterAll(async () => {
    if (!ENABLED) return;
    await resetState();
    await sql`DELETE FROM learner_users WHERE id = ${learnerId} AND school_id = ${SCHOOL_ID}`;
    await sql`DELETE FROM instructors WHERE id = ${instructorId} AND school_id = ${SCHOOL_ID}`;
    if (originalPostgresUrl !== undefined) process.env.POSTGRES_URL = originalPostgresUrl;
  });

  test.beforeEach(async () => {
    if (!ENABLED) return;
    await resetState();
  });

  test('learner eligible single cancel refunds BCS and restores LCB', async () => {
    await seedLcb(0);
    const creditTxId = await seedCreditSource(90);
    const booking = await makeBooking({ daysAhead: 14 });
    await attachBcs({ bookingId: booking.id, creditTransactionId: creditTxId });

    const req = fakeReq({
      query: { action: 'cancel' },
      body: { booking_id: booking.id },
      cookieName: 'cc_learner',
      token: learnerToken(),
    });
    const res = fakeRes();
    await slotsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.credit_returned).toBe(true);
    expect((await getBcs(booking.id)).refunded_at).toBeTruthy();
    expect(await getLcb()).toBe(90);
  });

  test('learner late cancel leaves BCS active', async () => {
    await seedLcb(0);
    const creditTxId = await seedCreditSource(90);
    const booking = await makeBooking({ daysAhead: 1 });
    await attachBcs({ bookingId: booking.id, creditTransactionId: creditTxId });

    const req = fakeReq({
      query: { action: 'cancel' },
      body: { booking_id: booking.id },
      cookieName: 'cc_learner',
      token: learnerToken(),
    });
    const res = fakeRes();
    await slotsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.credit_returned).toBe(false);
    expect((await getBcs(booking.id)).refunded_at).toBeNull();
    expect(await getLcb()).toBe(0);
  });

  test('learner series cancel refunds only eligible future bookings BCS rows', async () => {
    await seedLcb(0);
    const creditTxId = await seedCreditSource(180);
    const seriesId = crypto.randomUUID();
    const lateBooking = await makeBooking({ daysAhead: 1, seriesId, startTime: '08:00' });
    const eligibleBooking = await makeBooking({ daysAhead: 14, seriesId, startTime: '09:00' });
    await attachBcs({ bookingId: lateBooking.id, creditTransactionId: creditTxId });
    await attachBcs({ bookingId: eligibleBooking.id, creditTransactionId: creditTxId });

    const req = fakeReq({
      query: { action: 'cancel' },
      body: { booking_id: lateBooking.id, cancel_series: true },
      cookieName: 'cc_learner',
      token: learnerToken(),
    });
    const res = fakeRes();
    await slotsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.refunded).toContain(eligibleBooking.id);
    expect(res.body.no_refund).toContain(lateBooking.id);
    expect((await getBcs(eligibleBooking.id)).refunded_at).toBeTruthy();
    expect((await getBcs(lateBooking.id)).refunded_at).toBeNull();
    expect(await getLcb()).toBe(90);
  });

  test('instructor cancel refunds BCS and restores LCB', async () => {
    await seedLcb(0);
    const creditTxId = await seedCreditSource(90);
    const booking = await makeBooking({ daysAhead: 14 });
    await attachBcs({ bookingId: booking.id, creditTransactionId: creditTxId });

    const req = fakeReq({
      query: { action: 'cancel-booking' },
      body: { booking_id: booking.id, notify: false },
      cookieName: 'cc_instructor',
      token: instructorToken(),
    });
    const res = fakeRes();
    await instructorHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect((await getBcs(booking.id)).refunded_at).toBeTruthy();
    expect(await getLcb()).toBe(90);
  });

  test('instructor cancel returns the full 60 minutes for a 5%-discounted filmed hour', async () => {
    await seedLcb(0);
    const creditTxId = await seedCreditSource(60, {
      type: 'slot_purchase',
      amountPence: 5225,
      ratePencePerMinute: 87,
    });
    const booking = await makeBooking({
      daysAhead: 14,
      durationMinutes: 60,
    });
    await attachBcs({
      bookingId: booking.id,
      creditTransactionId: creditTxId,
      minutes: 60,
      ratePencePerMinute: 87,
      contributionPence: 5225,
    });

    const req = fakeReq({
      query: { action: 'cancel-booking' },
      body: { booking_id: booking.id, notify: false },
      cookieName: 'cc_instructor',
      token: instructorToken(),
    });
    const res = fakeRes();
    await instructorHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect((await getBcs(booking.id)).refunded_at).toBeTruthy();
    expect(await getLcb()).toBe(60);
    expect(await recomputePairDrift()).toBe(0);
  });

  test('eligible cancellation leaves pair recompute drift at zero', async () => {
    await seedLcb(0);
    const creditTxId = await seedCreditSource(90);
    const booking = await makeBooking({ daysAhead: 14 });
    await attachBcs({ bookingId: booking.id, creditTransactionId: creditTxId });

    const req = fakeReq({
      query: { action: 'cancel' },
      body: { booking_id: booking.id },
      cookieName: 'cc_learner',
      token: learnerToken(),
    });
    const res = fakeRes();
    await slotsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(await recomputePairDrift()).toBe(0);

    const [bookingRow] = await sql`
      SELECT status, credit_returned
        FROM lesson_bookings
       WHERE id = ${booking.id}
    `;
    expect(bookingRow.status).toBe(REFUNDED);
    expect(bookingRow.credit_returned).toBe(true);
  });
});
