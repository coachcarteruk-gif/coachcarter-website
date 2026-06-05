// @ts-check
// Integration tests for chip #3: reschedule paths set credit_returned=TRUE
// on the old booking. Covers:
//
//   Writer paths (both reschedule endpoints):
//     C1. api/instructor.js handleRescheduleBooking — forward path flips
//         credit_returned=TRUE on the old booking.
//     C2. api/instructor.js handleRescheduleBooking — INSERT-failure
//         rollback flips credit_returned BACK to FALSE in lockstep.
//     C3. api/slots.js handleReschedule — forward path flips
//         credit_returned=TRUE on the old booking.
//     C4. api/slots.js handleReschedule — rollback flips credit_returned
//         back to FALSE in lockstep.
//
//   Retro-fix migration (api/migrate-credit-returned-retro-fix.js):
//     M1. Refuses to rerun once the marker is present.
//     M2. Dry-run reports current state of each target booking without
//         writing.
//     M3. POST flips credit_returned=TRUE on rows where
//         status=REFUNDED AND credit_returned=FALSE AND
//         credit_forfeited=FALSE AND minutes_deducted>0 — and ONLY
//         those rows.
//     M4. Rows that don't match the predicate (e.g. status=scheduled,
//         credit_returned already TRUE, credit_forfeited=TRUE) are
//         left alone.
//     M5. Production-output assertion: cron drift drops by exactly the
//         number of flipped rows.
//
// The writer-path tests directly invoke the exported handler functions —
// they don't go through HTTP — so we can run against a Neon test branch
// without spinning up a server.
//
// How to run:
//   CC_TEST_DB=1 npx playwright test reschedule-credit-returned.integration

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

(function loadEnvLocal() {
  try {
    const envPath = path.resolve(__dirname, '..', '.env.local');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      if (key.startsWith('#')) continue;
      if (process.env[key] !== undefined) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch (err) {
    console.warn('[reschedule-credit-returned.integration] .env.local load failed:', err.message);
  }
})();

if (!process.env.MIGRATION_SECRET) {
  process.env.MIGRATION_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
}
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-' + crypto.randomBytes(8).toString('hex');
}

let _originalPostgresUrl;
const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
test.describe.configure({ mode: 'serial' });

const SCHOOL_ID = 1;
const TARGET_INSTRUCTOR_ID = 4;

let sql;
let retroHandler;
let runCron;
let RETRO_MARKER_KEY;
let createdLearnerIds = [];
let createdBookingIds = [];
let createdCreditTxIds = [];

// CSRF double-submit value. Used in both the JWT-bearing cookie string
// (cc_csrf=...) AND the matching `x-csrf-token` header so api/_csrf.js's
// verifyCsrf passes on POST.
const CSRF_TOKEN = 'test-csrf-' + crypto.randomBytes(8).toString('hex');

function fakeReq({ method = 'GET', query = {}, headers = {}, body = {}, cookies = {}, cookie } = {}) {
  // If a `cookie` string was supplied, merge in the CSRF cookie so
  // verifyCsrf passes on mutating requests.
  const callerCookie = cookie != null ? cookie : headers.cookie;
  const cookieStr = callerCookie != null
    ? `${callerCookie}; cc_csrf=${CSRF_TOKEN}`
    : `cc_csrf=${CSRF_TOKEN}`;
  const mergedHeaders = {
    'x-csrf-token': CSRF_TOKEN,
    ...headers,
    cookie: cookieStr,
  };
  return { method, query, headers: mergedHeaders, body, cookies };
}
function fakeRes() {
  // api/slots.js's top-level dispatcher attaches a `res.on('finish', ...)`
  // listener for POST/PUT/DELETE logging. Stub `on` so the dispatcher
  // doesn't throw before reaching the handler. Also stub setHeader /
  // getHeader since some downstream paths (CORS, Set-Cookie writers)
  // may call them.
  const r = {
    statusCode: 200,
    body: null,
    _headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    on(/* event, cb */) { /* no-op */ return this; },
    setHeader(name, value) { this._headers[String(name).toLowerCase()] = value; return this; },
    getHeader(name) { return this._headers[String(name).toLowerCase()]; },
  };
  return r;
}

async function makeLearner(label) {
  const email = `c3-${label}-${crypto.randomBytes(5).toString('hex')}@coachcarter.test`;
  const [row] = await sql`
    INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
    VALUES (${`Chip3 ${label}`}, ${email}, ${SCHOOL_ID}, 0, 0)
    RETURNING id
  `;
  createdLearnerIds.push(row.id);
  return row.id;
}

async function makeBooking(learnerId, instructorId, opts = {}) {
  const {
    status = 'scheduled',
    creditReturned = false,
    creditForfeited = false,
    minutesDeducted = 90,
    rescheduleCount = 0,
    dateOffset = 0, // days from today
  } = opts;
  for (let attempt = 0; attempt < 30; attempt++) {
    const baseDate = new Date(Date.now() + (dateOffset + attempt) * 86400000);
    const futureDate = baseDate.toISOString().slice(0, 10);
    const hour = String(8 + ((crypto.randomBytes(1)[0] + attempt) % 9)).padStart(2, '0');
    const startTime = `${hour}:00`;
    const endTime = `${String(Number(hour) + 1).padStart(2, '0')}:30`;
    try {
      const [booking] = await sql`
        INSERT INTO lesson_bookings
          (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
           credit_returned, credit_forfeited, minutes_deducted, reschedule_count,
           school_id, created_by, payment_method)
        VALUES
          (${learnerId}, ${instructorId}, ${futureDate}::date,
           ${startTime}::time, ${endTime}::time, ${status},
           ${creditReturned}, ${creditForfeited}, ${minutesDeducted},
           ${rescheduleCount}, ${SCHOOL_ID}, 'learner', 'credit')
        RETURNING id, scheduled_date::text AS scheduled_date,
                  start_time::text AS start_time, end_time::text AS end_time
      `;
      createdBookingIds.push(booking.id);
      return booking;
    } catch (err) {
      if (err.code === '23505' || err.message?.includes('uq_instructor_slot')) continue;
      throw err;
    }
  }
  throw new Error('makeBooking could not find a unique future slot after 30 attempts');
}

async function makeCreditSource(learnerId, instructorId, minutes = 180) {
  const [row] = await sql`
    INSERT INTO credit_transactions
      (learner_id, instructor_id, school_id, type, credits, minutes,
       amount_pence, payment_method, source)
    VALUES
      (${learnerId}, ${instructorId}, ${SCHOOL_ID}, 'legacy_grandfather', 0, ${minutes},
       0, 'test', 'reconciliation')
    RETURNING id
  `;
  createdCreditTxIds.push(row.id);
  return row.id;
}

async function insertClashBookingWithRetry(learnerId, instructorId, dateOffset) {
  const booking = await makeBooking(learnerId, instructorId, { dateOffset });
  return {
    id: booking.id,
    newDate: String(booking.scheduled_date).slice(0, 10),
    newStartTime: String(booking.start_time).slice(0, 5),
  };
}

async function findFreeRescheduleSlot(instructorId, dateOffset) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const baseDate = new Date(Date.now() + (dateOffset + attempt) * 86400000);
    const newDate = baseDate.toISOString().slice(0, 10);
    for (let hour = 15; hour <= 18; hour++) {
      const newStartTime = `${String(hour).padStart(2, '0')}:00`;
      const [existing] = await sql`
        SELECT id
          FROM lesson_bookings
         WHERE instructor_id = ${instructorId}
           AND school_id = ${SCHOOL_ID}
           AND scheduled_date = ${newDate}
           AND start_time = ${newStartTime}::time
           AND status IN ('scheduled', 'chargeable')
         LIMIT 1
      `;
      if (!existing) return { newDate, newStartTime };
    }
  }
  throw new Error('findFreeRescheduleSlot could not find a free slot');
}

async function seedLcb(learnerId, instructorId, minutes) {
  await sql`
    INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
    VALUES (${learnerId}, ${instructorId}, ${SCHOOL_ID}, ${minutes})
    ON CONFLICT (learner_id, instructor_id) DO UPDATE
      SET balance_minutes = EXCLUDED.balance_minutes,
          school_id = EXCLUDED.school_id,
          updated_at = NOW()
  `;
}

async function attachBcs(bookingId, creditTransactionId, minutes = 90, opts = {}) {
  const {
    ratePencePerMinute = 92,
    contributionPence = 8280,
    stripeFeePence = 144,
    absorbedBy = null,
  } = opts;
  const [row] = await sql`
    INSERT INTO booking_credit_sources
      (school_id, booking_id, credit_transaction_id, minutes_drawn,
       rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by)
    VALUES
      (${SCHOOL_ID}, ${bookingId}, ${creditTransactionId}, ${minutes},
       ${ratePencePerMinute}, ${contributionPence}, ${stripeFeePence}, ${absorbedBy})
    RETURNING id
  `;
  return row.id;
}

async function getBcsRowsForBooking(bookingId) {
  return sql`
    SELECT id, booking_id, credit_transaction_id, minutes_drawn,
           rate_pence_per_minute, contribution_pence, stripe_fee_pence,
           absorbed_by, refunded_at
      FROM booking_credit_sources
     WHERE booking_id = ${bookingId}
       AND school_id = ${SCHOOL_ID}
     ORDER BY id
  `;
}

async function recomputePair(learnerId, instructorId) {
  const [row] = await sql`
    WITH purchases AS (
      SELECT COALESCE(SUM(ct.minutes), 0)::int AS granted_minutes
        FROM credit_transactions ct
       WHERE ct.school_id = ${SCHOOL_ID}
         AND ct.learner_id = ${learnerId}
         AND ct.instructor_id = ${instructorId}
    ),
    unattributed_booking_draws AS (
      SELECT COALESCE(SUM(lb.minutes_deducted), 0)::int AS unattributed_booking_draw_minutes
        FROM lesson_bookings lb
       WHERE lb.school_id = ${SCHOOL_ID}
         AND lb.learner_id = ${learnerId}
         AND lb.instructor_id = ${instructorId}
         AND lb.credit_returned = FALSE
         AND lb.minutes_deducted IS NOT NULL
         AND lb.minutes_deducted > 0
         AND NOT EXISTS (
           SELECT 1 FROM booking_credit_sources bcs
            WHERE bcs.booking_id = lb.id
              AND bcs.school_id = ${SCHOOL_ID}
         )
    ),
    active_bcs_draws AS (
      SELECT COALESCE(SUM(bcs.minutes_drawn), 0)::int AS active_bcs_draw_minutes
        FROM booking_credit_sources bcs
        JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
       WHERE bcs.refunded_at IS NULL
         AND bcs.school_id = ${SCHOOL_ID}
         AND ct.school_id = ${SCHOOL_ID}
         AND ct.learner_id = ${learnerId}
         AND ct.instructor_id = ${instructorId}
    ),
    csa_draws AS (
      SELECT COALESCE(SUM(csa.minutes_adjusted), 0)::int AS csa_adjusted_minutes
        FROM credit_source_adjustments csa
        JOIN credit_transactions ct ON ct.id = csa.credit_transaction_id
       WHERE ct.school_id = ${SCHOOL_ID}
         AND ct.learner_id = ${learnerId}
         AND ct.instructor_id = ${instructorId}
    ),
    lcb AS (
      SELECT COALESCE(MAX(balance_minutes), 0)::int AS lcb_balance_minutes
        FROM learner_credit_balances
       WHERE school_id = ${SCHOOL_ID}
         AND learner_id = ${learnerId}
         AND instructor_id = ${instructorId}
    )
    SELECT
      p.granted_minutes,
      u.unattributed_booking_draw_minutes,
      b.active_bcs_draw_minutes,
      c.csa_adjusted_minutes,
      (p.granted_minutes - u.unattributed_booking_draw_minutes - b.active_bcs_draw_minutes - c.csa_adjusted_minutes)::int AS computed_ledger_minutes,
      l.lcb_balance_minutes,
      (l.lcb_balance_minutes - (p.granted_minutes - u.unattributed_booking_draw_minutes - b.active_bcs_draw_minutes - c.csa_adjusted_minutes))::int AS drift_minutes
      FROM purchases p, unattributed_booking_draws u, active_bcs_draws b, csa_draws c, lcb l
  `;
  return row;
}

async function getBooking(id) {
  const [row] = await sql`
      SELECT id, status, credit_returned, credit_forfeited, cancelled_at::text AS cancelled_at,
           minutes_deducted, scheduled_date::text AS scheduled_date,
           start_time::text AS start_time
      FROM lesson_bookings
     WHERE id = ${id}
       AND school_id = ${SCHOOL_ID}
  `;
  return row;
}

// Build a learner JWT for handleReschedule (api/slots.js). The slots.js
// path uses verifyAuth from api/_auth.js which decodes cc_learner cookie
// and reads payload.id (NOT payload.user_id / payload.learner_id) — the
// handler filters bookings on `lb.learner_id = ${user.id}`.
function makeLearnerJwt(learnerId) {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { id: learnerId, school_id: SCHOOL_ID, role: 'learner' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// Build an instructor JWT for handleRescheduleBooking (api/instructor.js).
// Same id-field semantics as the learner JWT — handler reads
// `instructor.id` and filters on `lb.instructor_id = ${instructor.id}`.
function makeInstructorJwt(instructorId) {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { id: instructorId, school_id: SCHOOL_ID, role: 'instructor' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

test.describe('chip #3: reschedule credit_returned + retro-fix', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL. Point at an isolated branch.');
    }
    _originalPostgresUrl = process.env.POSTGRES_URL;
    process.env.POSTGRES_URL = process.env.POSTGRES_URL_TEST;

    retroHandler = require('../api/migrate-credit-returned-retro-fix');
    RETRO_MARKER_KEY = retroHandler.MARKER_KEY;
    runCron = require('../api/cron-credit-reconcile').runDivergenceCheck;

    sql = neon(process.env.POSTGRES_URL_TEST);

    // Marker table existence sanity.
    await sql`
      CREATE TABLE IF NOT EXISTS migration_markers (
        key TEXT PRIMARY KEY, completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), notes TEXT
      )
    `;
    await sql`DELETE FROM migration_markers WHERE key = ${RETRO_MARKER_KEY}`;

    const [target] = await sql`
      SELECT id FROM instructors
       WHERE id = ${TARGET_INSTRUCTOR_ID}
         AND school_id = ${SCHOOL_ID}
    `;
    if (!target) {
      throw new Error(`Test branch lacks instructors.id = ${TARGET_INSTRUCTOR_ID} — required.`);
    }
    const [hasBcsSchoolId] = await sql`
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'booking_credit_sources'
         AND column_name = 'school_id'
    `;
    if (!hasBcsSchoolId) {
      throw new Error('Test branch lacks booking_credit_sources.school_id - apply latest main migrations to the isolated branch first.');
    }
  });

  test.afterAll(async () => {
    if (!ENABLED) return;
    try {
      if (createdBookingIds.length) {
        await sql`
          DELETE FROM booking_credit_sources
           WHERE booking_id = ANY(${createdBookingIds})
             AND school_id = ${SCHOOL_ID}
        `;
        await sql`
          DELETE FROM lesson_bookings
           WHERE id = ANY(${createdBookingIds})
             AND school_id = ${SCHOOL_ID}
        `;
      }
      if (createdCreditTxIds.length) {
        await sql`
          DELETE FROM credit_transactions
           WHERE id = ANY(${createdCreditTxIds})
             AND school_id = ${SCHOOL_ID}
        `;
      }
      if (createdLearnerIds.length) {
        await sql`
          DELETE FROM credit_transactions
           WHERE learner_id = ANY(${createdLearnerIds})
             AND school_id = ${SCHOOL_ID}
        `;
        await sql`
          DELETE FROM learner_credit_balances
           WHERE learner_id = ANY(${createdLearnerIds})
             AND school_id = ${SCHOOL_ID}
        `;
        await sql`
          DELETE FROM learner_users
           WHERE id = ANY(${createdLearnerIds})
             AND school_id = ${SCHOOL_ID}
        `;
      }
      await sql`DELETE FROM migration_markers WHERE key = ${RETRO_MARKER_KEY}`;
    } catch (_) {}
    if (_originalPostgresUrl !== undefined) process.env.POSTGRES_URL = _originalPostgresUrl;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Writer-path tests: invoke the handler functions directly with fake
  // req/res, against the real test-branch DB.
  // ─────────────────────────────────────────────────────────────────────────

  test('C1: instructor reschedule flips credit_returned=TRUE on the old booking', async () => {
    const learnerId = await makeLearner('c1');
    const oldBooking = await makeBooking(learnerId, TARGET_INSTRUCTOR_ID, { dateOffset: 30 });

    // Reschedule to a slot far enough away to avoid uq_instructor_slot collision.
    const { newDate, newStartTime } = await findFreeRescheduleSlot(TARGET_INSTRUCTOR_ID, 60);

    const instructorHandler = require('../api/instructor');
    const jwt = makeInstructorJwt(TARGET_INSTRUCTOR_ID);

    const req = fakeReq({
      method: 'POST',
      query: { action: 'reschedule-booking' },
      headers: { cookie: `cc_instructor=${jwt}` },
      body: { booking_id: oldBooking.id, new_date: newDate, new_start_time: newStartTime },
    });
    const res = fakeRes();
    await instructorHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);

    const old = await getBooking(oldBooking.id);
    expect(old.status).toBe('refunded');
    expect(old.credit_returned).toBe(true);     // <-- the fix
    expect(old.cancelled_at).toBeTruthy();
    // minutes_deducted stays untouched (the carry-forward is to the new row)
    expect(old.minutes_deducted).toBe(90);

    if (res.body.new_booking_id) createdBookingIds.push(res.body.new_booking_id);
    const newB = await getBooking(res.body.new_booking_id);
    expect(newB.status).toBe('scheduled');
    expect(newB.credit_returned).toBe(false);
    expect(newB.minutes_deducted).toBe(90);
  });

  test('C1b: instructor reschedule refunds old BCS and copies allocation to replacement booking', async () => {
    const learnerId = await makeLearner('c1b');
    await seedLcb(learnerId, TARGET_INSTRUCTOR_ID, 90);
    const creditTxId = await makeCreditSource(learnerId, TARGET_INSTRUCTOR_ID, 180);
    const oldBooking = await makeBooking(learnerId, TARGET_INSTRUCTOR_ID, { dateOffset: 32 });
    const oldBcsId = await attachBcs(oldBooking.id, creditTxId, 90, {
      ratePencePerMinute: 91,
      contributionPence: 8190,
      stripeFeePence: 143,
      absorbedBy: 'platform',
    });

    const { newDate, newStartTime } = await findFreeRescheduleSlot(TARGET_INSTRUCTOR_ID, 64);

    const instructorHandler = require('../api/instructor');
    const jwt = makeInstructorJwt(TARGET_INSTRUCTOR_ID);

    const req = fakeReq({
      method: 'POST',
      query: { action: 'reschedule-booking' },
      headers: { cookie: `cc_instructor=${jwt}` },
      body: { booking_id: oldBooking.id, new_date: newDate, new_start_time: newStartTime },
    });
    const res = fakeRes();
    await instructorHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    if (res.body.new_booking_id) createdBookingIds.push(res.body.new_booking_id);

    const oldBcsRows = await getBcsRowsForBooking(oldBooking.id);
    expect(oldBcsRows).toHaveLength(1);
    expect(oldBcsRows[0].id).toBe(oldBcsId);
    expect(oldBcsRows[0].refunded_at).toBeTruthy();

    const newBcsRows = await getBcsRowsForBooking(res.body.new_booking_id);
    expect(newBcsRows).toHaveLength(1);
    expect(newBcsRows[0].id).not.toBe(oldBcsId);
    expect(newBcsRows[0].refunded_at).toBeNull();
    expect(newBcsRows[0].credit_transaction_id).toBe(creditTxId);
    expect(newBcsRows[0].minutes_drawn).toBe(90);
    expect(newBcsRows[0].rate_pence_per_minute).toBe(91);
    expect(newBcsRows[0].contribution_pence).toBe(8190);
    expect(newBcsRows[0].stripe_fee_pence).toBe(143);
    expect(newBcsRows[0].absorbed_by).toBe('platform');

    const recomputed = await recomputePair(learnerId, TARGET_INSTRUCTOR_ID);
    expect(recomputed.granted_minutes).toBe(180);
    expect(recomputed.unattributed_booking_draw_minutes).toBe(0);
    expect(recomputed.active_bcs_draw_minutes).toBe(90);
    expect(recomputed.computed_ledger_minutes).toBe(90);
    expect(recomputed.lcb_balance_minutes).toBe(90);
    expect(recomputed.drift_minutes).toBe(0);

    const cron = await runCron(sql, { sendAlerts: false });
    const row = cron.drift_summary.find(r => r.learner_id === learnerId && r.instructor_id === TARGET_INSTRUCTOR_ID);
    expect(row).toBeUndefined();
  });

  test('C2: instructor reschedule INSERT-failure rollback flips credit_returned BACK to FALSE', async () => {
    const learnerId = await makeLearner('c2');
    const creditTxId = await makeCreditSource(learnerId, TARGET_INSTRUCTOR_ID, 180);
    const oldBooking = await makeBooking(learnerId, TARGET_INSTRUCTOR_ID, { dateOffset: 31 });
    const oldBcsId = await attachBcs(oldBooking.id, creditTxId, 90);

    // Pre-seed a CLASH at the target slot to force the INSERT to 23505.
    const clashLearnerId = await makeLearner('c2-clash');
    const { newDate, newStartTime } = await insertClashBookingWithRetry(
      clashLearnerId,
      TARGET_INSTRUCTOR_ID,
      62
    );

    const instructorHandler = require('../api/instructor');
    const jwt = makeInstructorJwt(TARGET_INSTRUCTOR_ID);

    const req = fakeReq({
      method: 'POST',
      query: { action: 'reschedule-booking' },
      headers: { cookie: `cc_instructor=${jwt}` },
      body: { booking_id: oldBooking.id, new_date: newDate, new_start_time: newStartTime },
    });
    const res = fakeRes();
    await instructorHandler(req, res);

    // Could 409 (preflight clash check) OR 409 (INSERT race) — both surface as 409.
    expect(res.statusCode).toBe(409);

    // Critical invariant: regardless of which path hit, old booking must
    // be back to original state if a rollback ran. If preflight returned
    // 409 BEFORE the UPDATE, old booking should also be unchanged.
    const old = await getBooking(oldBooking.id);
    expect(old.status).toBe('scheduled');
    expect(old.credit_returned).toBe(false);    // <-- the rollback fix
    expect(old.cancelled_at).toBeNull();

    const oldBcsRows = await getBcsRowsForBooking(oldBooking.id);
    expect(oldBcsRows).toHaveLength(1);
    expect(oldBcsRows[0].id).toBe(oldBcsId);
    expect(oldBcsRows[0].refunded_at).toBeNull();

    const copiedRows = await sql`
      SELECT id FROM booking_credit_sources
       WHERE school_id = ${SCHOOL_ID}
         AND credit_transaction_id = ${creditTxId}
         AND booking_id <> ${oldBooking.id}
    `;
    expect(copiedRows).toHaveLength(0);
  });

  test('C3: learner reschedule flips credit_returned=TRUE on the old booking', async () => {
    const learnerId = await makeLearner('c3');
    // Learner reschedule needs ≥48h notice — schedule the OLD booking
    // 5 days out so the policy check passes.
    const oldBooking = await makeBooking(learnerId, TARGET_INSTRUCTOR_ID, { dateOffset: 35 });

    const { newDate, newStartTime } = await findFreeRescheduleSlot(TARGET_INSTRUCTOR_ID, 20);

    const slotsHandler = require('../api/slots');
    const jwt = makeLearnerJwt(learnerId);

    const req = fakeReq({
      method: 'POST',
      query: { action: 'reschedule' },
      headers: { cookie: `cc_learner=${jwt}` },
      body: { booking_id: oldBooking.id, new_date: newDate, new_start_time: newStartTime },
    });
    const res = fakeRes();
    await slotsHandler(req, res);

    if (res.statusCode !== 200) {
      console.error('C3 unexpected response:', res.statusCode, res.body);
    }
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);

    const old = await getBooking(oldBooking.id);
    expect(old.status).toBe('refunded');
    expect(old.credit_returned).toBe(true);     // <-- the fix
    expect(old.cancelled_at).toBeTruthy();

    if (res.body.new_booking_id) createdBookingIds.push(res.body.new_booking_id);
    const newB = await getBooking(res.body.new_booking_id);
    expect(newB.status).toBe('scheduled');
    expect(newB.credit_returned).toBe(false);
  });

  test('C3b: learner reschedule refunds old BCS and copies allocation to replacement booking', async () => {
    const learnerId = await makeLearner('c3b');
    await seedLcb(learnerId, TARGET_INSTRUCTOR_ID, 90);
    const creditTxId = await makeCreditSource(learnerId, TARGET_INSTRUCTOR_ID, 180);
    const oldBooking = await makeBooking(learnerId, TARGET_INSTRUCTOR_ID, { dateOffset: 37 });
    const oldBcsId = await attachBcs(oldBooking.id, creditTxId, 90, {
      ratePencePerMinute: 92,
      contributionPence: 8280,
      stripeFeePence: 144,
      absorbedBy: 'platform',
    });

    const { newDate, newStartTime } = await findFreeRescheduleSlot(TARGET_INSTRUCTOR_ID, 21);

    const slotsHandler = require('../api/slots');
    const jwt = makeLearnerJwt(learnerId);

    const req = fakeReq({
      method: 'POST',
      query: { action: 'reschedule' },
      headers: { cookie: `cc_learner=${jwt}` },
      body: { booking_id: oldBooking.id, new_date: newDate, new_start_time: newStartTime },
    });
    const res = fakeRes();
    await slotsHandler(req, res);

    if (res.statusCode !== 200) {
      console.error('C3b unexpected response:', res.statusCode, res.body);
    }
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);

    if (res.body.new_booking_id) createdBookingIds.push(res.body.new_booking_id);

    const oldBcsRows = await getBcsRowsForBooking(oldBooking.id);
    expect(oldBcsRows).toHaveLength(1);
    expect(oldBcsRows[0].id).toBe(oldBcsId);
    expect(oldBcsRows[0].refunded_at).toBeTruthy();

    const newBcsRows = await getBcsRowsForBooking(res.body.new_booking_id);
    expect(newBcsRows).toHaveLength(1);
    expect(newBcsRows[0].id).not.toBe(oldBcsId);
    expect(newBcsRows[0].refunded_at).toBeNull();
    expect(newBcsRows[0].credit_transaction_id).toBe(creditTxId);
    expect(newBcsRows[0].minutes_drawn).toBe(90);
    expect(newBcsRows[0].rate_pence_per_minute).toBe(92);
    expect(newBcsRows[0].contribution_pence).toBe(8280);
    expect(newBcsRows[0].stripe_fee_pence).toBe(144);
    expect(newBcsRows[0].absorbed_by).toBe('platform');

    const recomputed = await recomputePair(learnerId, TARGET_INSTRUCTOR_ID);
    expect(recomputed.granted_minutes).toBe(180);
    expect(recomputed.unattributed_booking_draw_minutes).toBe(0);
    expect(recomputed.active_bcs_draw_minutes).toBe(90);
    expect(recomputed.computed_ledger_minutes).toBe(90);
    expect(recomputed.lcb_balance_minutes).toBe(90);
    expect(recomputed.drift_minutes).toBe(0);

    const cron = await runCron(sql, { sendAlerts: false });
    const row = cron.drift_summary.find(r => r.learner_id === learnerId && r.instructor_id === TARGET_INSTRUCTOR_ID);
    expect(row).toBeUndefined();
  });

  test('C4: learner reschedule INSERT-failure rollback flips credit_returned BACK to FALSE', async () => {
    const learnerId = await makeLearner('c4');
    const creditTxId = await makeCreditSource(learnerId, TARGET_INSTRUCTOR_ID, 180);
    const oldBooking = await makeBooking(learnerId, TARGET_INSTRUCTOR_ID, { dateOffset: 36 });
    const oldBcsId = await attachBcs(oldBooking.id, creditTxId, 90);

    // Pre-seed a clash to force INSERT failure.
    const clashLearnerId = await makeLearner('c4-clash');
    const { newDate, newStartTime } = await insertClashBookingWithRetry(
      clashLearnerId,
      TARGET_INSTRUCTOR_ID,
      22
    );

    const slotsHandler = require('../api/slots');
    const jwt = makeLearnerJwt(learnerId);

    const req = fakeReq({
      method: 'POST',
      query: { action: 'reschedule' },
      headers: { cookie: `cc_learner=${jwt}` },
      body: { booking_id: oldBooking.id, new_date: newDate, new_start_time: newStartTime },
    });
    const res = fakeRes();
    await slotsHandler(req, res);

    expect(res.statusCode).toBe(409);

    const old = await getBooking(oldBooking.id);
    expect(old.status).toBe('scheduled');
    expect(old.credit_returned).toBe(false);    // <-- the rollback fix
    expect(old.cancelled_at).toBeNull();

    const oldBcsRows = await getBcsRowsForBooking(oldBooking.id);
    expect(oldBcsRows).toHaveLength(1);
    expect(oldBcsRows[0].id).toBe(oldBcsId);
    expect(oldBcsRows[0].refunded_at).toBeNull();

    const copiedRows = await sql`
      SELECT id FROM booking_credit_sources
       WHERE school_id = ${SCHOOL_ID}
         AND credit_transaction_id = ${creditTxId}
         AND booking_id <> ${oldBooking.id}
    `;
    expect(copiedRows).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Retro-fix migration tests.
  // ─────────────────────────────────────────────────────────────────────────

  let m_targetBooking;            // status=refunded, credit_returned=FALSE — WILL flip
  let m_alreadyFlippedBooking;    // status=refunded, credit_returned=TRUE — left alone
  let m_forfeitedBooking;         // status=refunded, credit_forfeited=TRUE — left alone
  let m_scheduledBooking;         // status=scheduled — left alone
  let m_zeroMinutesBooking;       // status=refunded, minutes_deducted=0 — left alone

  test('M-setup: build fixture rows that exercise each predicate branch', async () => {
    const learnerId = await makeLearner('m-setup');

    // Will flip.
    const wf = await makeBooking(learnerId, TARGET_INSTRUCTOR_ID, {
      dateOffset: 100, status: 'refunded', creditReturned: false, minutesDeducted: 90,
    });
    m_targetBooking = wf.id;

    // Already TRUE — left alone.
    const af = await makeBooking(learnerId, TARGET_INSTRUCTOR_ID, {
      dateOffset: 101, status: 'refunded', creditReturned: true, minutesDeducted: 90,
    });
    m_alreadyFlippedBooking = af.id;

    // Forfeited late-cancel — left alone.
    const ff = await makeBooking(learnerId, TARGET_INSTRUCTOR_ID, {
      dateOffset: 102, status: 'refunded', creditReturned: false, creditForfeited: true, minutesDeducted: 90,
    });
    m_forfeitedBooking = ff.id;

    // Status=scheduled — left alone.
    const sc = await makeBooking(learnerId, TARGET_INSTRUCTOR_ID, {
      dateOffset: 103, status: 'scheduled', creditReturned: false, minutesDeducted: 90,
    });
    m_scheduledBooking = sc.id;

    // Zero minutes — left alone.
    const zm = await makeBooking(learnerId, TARGET_INSTRUCTOR_ID, {
      dateOffset: 104, status: 'refunded', creditReturned: false, minutesDeducted: 0,
    });
    m_zeroMinutesBooking = zm.id;

    // Override the BOOKING_IDS allowlist for the handler under test —
    // we want to point the migration at OUR fixture rows, not the prod
    // IDs (which don't exist on the test branch). We hack this in-place
    // by reaching into the module export. Safe per-test because
    // afterAll resets process.env.POSTGRES_URL.
    retroHandler.BOOKING_IDS.length = 0;
    retroHandler.BOOKING_IDS.push(
      m_targetBooking,
      m_alreadyFlippedBooking,
      m_forfeitedBooking,
      m_scheduledBooking,
      m_zeroMinutesBooking,
    );
  });

  test('M2: dry-run reports per-target state without writing', async () => {
    const req = fakeReq({ method: 'GET', query: { secret: process.env.MIGRATION_SECRET } });
    const res = fakeRes();
    await retroHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dry_run).toBe(true);
    expect(res.body.rows_flipped).toBe(0);
    expect(res.body.marker_written).toBe(false);

    const will = res.body.inspect_rows.filter(r => r.will_flip).map(r => r.id);
    const wont = res.body.inspect_rows.filter(r => !r.will_flip).map(r => r.id);
    expect(will).toEqual([m_targetBooking]);
    expect(wont.sort()).toEqual([
      m_alreadyFlippedBooking, m_forfeitedBooking,
      m_scheduledBooking, m_zeroMinutesBooking,
    ].sort());

    // DB unchanged.
    const target = await getBooking(m_targetBooking);
    expect(target.credit_returned).toBe(false);
  });

  test('M3: POST flips only the target booking', async () => {
    const req = fakeReq({ method: 'POST', query: { secret: process.env.MIGRATION_SECRET } });
    const res = fakeRes();
    await retroHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.rows_flipped).toBe(1);
    expect(res.body.total_minutes_flipped).toBe(90);
    expect(res.body.marker_written).toBe(true);

    const target = await getBooking(m_targetBooking);
    expect(target.status).toBe('refunded');
    expect(target.credit_returned).toBe(true);
  });

  test('M4: non-matching predicates left alone', async () => {
    const already = await getBooking(m_alreadyFlippedBooking);
    expect(already.credit_returned).toBe(true); // unchanged from fixture

    const forf = await getBooking(m_forfeitedBooking);
    expect(forf.credit_returned).toBe(false);   // unchanged — forfeited rows protected
    expect(forf.credit_forfeited).toBe(true);

    const sch = await getBooking(m_scheduledBooking);
    expect(sch.status).toBe('scheduled');
    expect(sch.credit_returned).toBe(false);

    const zm = await getBooking(m_zeroMinutesBooking);
    expect(zm.credit_returned).toBe(false);     // minutes_deducted=0 protected
    expect(zm.minutes_deducted).toBe(0);
  });

  test('M1: rerun is refused with 409', async () => {
    const req = fakeReq({ method: 'POST', query: { secret: process.env.MIGRATION_SECRET } });
    const res = fakeRes();
    await retroHandler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.self_marker).toBeTruthy();
    expect(res.body.self_marker.key).toBe(RETRO_MARKER_KEY);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // M5: production-output assertion. Set up a fresh refund-bug fixture
  // and confirm runDivergenceCheck.drift_count drops by exactly 1 after
  // the marker-deleted rerun.
  // ─────────────────────────────────────────────────────────────────────────
  test('M5: cron drift_count drops by exactly 1 after fresh fixture + rerun', async () => {
    const learnerId = await makeLearner('m5');
    const bug = await makeBooking(learnerId, TARGET_INSTRUCTOR_ID, {
      dateOffset: 200, status: 'refunded', creditReturned: false, minutesDeducted: 90,
    });

    // Pre-state: this pair drifts +90 (no LCB row at the learner, no per-pair CT,
    // refunded-but-credit-not-returned booking is an "active draw" per cron).
    const pre = await runCron(sql, { sendAlerts: false });
    const preCount = pre.drift_count;

    // Override the allowlist to point only at the fresh fixture.
    retroHandler.BOOKING_IDS.length = 0;
    retroHandler.BOOKING_IDS.push(bug.id);

    // Delete the marker so the second POST can run.
    await sql`DELETE FROM migration_markers WHERE key = ${RETRO_MARKER_KEY}`;

    const req = fakeReq({ method: 'POST', query: { secret: process.env.MIGRATION_SECRET } });
    const res = fakeRes();
    await retroHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.rows_flipped).toBe(1);

    const post = await runCron(sql, { sendAlerts: false });
    expect(post.drift_count).toBe(preCount - 1);
  });
});
