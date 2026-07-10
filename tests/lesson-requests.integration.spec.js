// @ts-check
// Integration tests for the lesson-request ("request to book") credit-hold
// lifecycle against a real Neon test branch.
//
// Why this file exists:
//   The money-correctness claims in LESSON-REQUEST-PLAN.md are database
//   properties, not JS properties: the guarded request_hold deduct, the
//   exactly-once release keyed on released_at, the uq_request_slot partial
//   unique index acting as the slot lock, and the invariant that the
//   hold/refund ledger pair nets to zero (what keeps the divergence cron
//   silent). Mocks can't prove any of that.
//
// What this proves:
//   1. request_hold deducts the scoped LCB balance and writes a matching
//      negative credit_transactions row atomically.
//   2. An over-balance hold is refused with no ledger row and no balance
//      change (guarded deduct).
//   3. releaseRequestHold refunds in full, exactly once — a second call is a
//      no-op (released_at claim), no double ledger row.
//   4. After hold + release, ΣCT minutes for the pair nets to zero and the
//      balance is back to its starting value (divergence-cron shape).
//   5. uq_request_slot blocks a second pending request for the same slot and
//      frees it once the first row leaves 'pending'.
//   6. expirePendingRequest atomically claims + releases; a repeat call skips.
//   7. A crashed decision (decided, released_at NULL) is recoverable by
//      calling releaseRequestHold again — the cron sweep contract.
//
// How to run:
//   1. Create a Neon test branch (one click in the Neon dashboard).
//   2. Add POSTGRES_URL_TEST="<branch connection string>" to .env.local.
//   3. CC_TEST_DB=1 npx playwright test lesson-requests.integration
//
// Cleanup discipline:
//   beforeAll creates one test learner + one test instructor with unique
//   emails and seeds an LCB row. afterAll deletes requests, ledger rows,
//   notification_log rows, the LCB row, then the learner and instructor.

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Lightweight .env.local loader (same as credit-grant.integration) ────────
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
    console.warn('[lesson-requests.integration] .env.local load failed:', err.message);
  }
})();

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
test.describe.configure({ mode: 'serial' }); // Tests share fixture rows.

// api/_lesson-requests.js constructs a Stripe client at require time, so the
// module is loaded lazily inside beforeAll — after the ENABLED gate — and only
// its non-Stripe (credit-path) surface is exercised here.
let lockBalanceAndMutate;
let releaseRequestHold;
let expirePendingRequest;
let computeRequestExpiresAt;

let sql;
let learnerId;
let instructorId;
let learnerEmail;
let instructorEmail;

const SCHOOL_ID = 1;
const HOLD_MINUTES = 90;
const START_BALANCE = 300;

function futureSlot(daysAhead, startTime) {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return { date: d.toISOString().slice(0, 10), start: startTime };
}

// Insert a pending request row the way slots.js handleRequestSlot does
// (insert first, then hold, then link hold_transaction_id).
async function insertPendingRequest({ date, start, end = null, expiresAt = null, status = 'pending' }) {
  const endTime = end || (String(Number(start.slice(0, 2)) + 1).padStart(2, '0') + ':' + start.slice(3, 5));
  const expiry = expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const [row] = await sql`
    INSERT INTO lesson_requests
      (school_id, instructor_id, learner_id, scheduled_date, start_time, end_time,
       payment_method, credits_minutes, status, expires_at)
    VALUES
      (${SCHOOL_ID}, ${instructorId}, ${learnerId}, ${date}, ${start}, ${endTime},
       'credit', ${HOLD_MINUTES}, ${status}, ${expiry})
    RETURNING *
  `;
  return row;
}

async function takeHold(requestId) {
  const hold = await lockBalanceAndMutate(sql, {
    learnerId,
    instructorId,
    schoolId: SCHOOL_ID,
    delta: -HOLD_MINUTES,
    creditsDelta: -Math.ceil(HOLD_MINUTES / 60),
    ledgerType: 'request_hold',
    reason: 'lesson request hold (test)',
  });
  if (hold.ok && requestId) {
    await sql`
      UPDATE lesson_requests SET hold_transaction_id = ${hold.transactionId}
      WHERE id = ${requestId} AND school_id = ${SCHOOL_ID}
    `;
  }
  return hold;
}

async function lcbBalance() {
  const [row] = await sql`
    SELECT balance_minutes FROM learner_credit_balances
    WHERE learner_id = ${learnerId} AND instructor_id = ${instructorId} AND school_id = ${SCHOOL_ID}
  `;
  return row ? Number(row.balance_minutes) : null;
}

async function ledgerSumMinutes() {
  const [row] = await sql`
    SELECT COALESCE(SUM(minutes), 0)::int AS total
    FROM credit_transactions
    WHERE learner_id = ${learnerId} AND instructor_id = ${instructorId} AND school_id = ${SCHOOL_ID}
  `;
  return Number(row.total);
}

async function resetFixtures() {
  await sql`DELETE FROM lesson_requests WHERE learner_id = ${learnerId} OR instructor_id = ${instructorId}`;
  await sql`DELETE FROM credit_transactions WHERE learner_id = ${learnerId}`;
  await sql`
    INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
    VALUES (${learnerId}, ${instructorId}, ${SCHOOL_ID}, ${START_BALANCE})
    ON CONFLICT (learner_id, instructor_id) DO UPDATE
      SET balance_minutes = ${START_BALANCE}, updated_at = NOW()
  `;
}

test.describe('lesson requests — credit hold lifecycle (integration)', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run these tests against a Neon test branch.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('POSTGRES_URL_TEST equals POSTGRES_URL — refusing to run against prod.');
    }
    sql = neon(process.env.POSTGRES_URL_TEST);

    ({ lockBalanceAndMutate } = require('../api/_credit-grant'));
    ({ releaseRequestHold, expirePendingRequest, computeRequestExpiresAt } = require('../api/_lesson-requests'));

    const suffix = crypto.randomBytes(6).toString('hex');
    learnerEmail = `lesson-request-test-learner-${suffix}@test.invalid`;
    instructorEmail = `lesson-request-test-instructor-${suffix}@test.invalid`;

    const [learner] = await sql`
      INSERT INTO learner_users (name, email, balance_minutes, credit_balance, school_id)
      VALUES ('Request Test Learner', ${learnerEmail}, 0, 0, ${SCHOOL_ID})
      RETURNING id
    `;
    learnerId = learner.id;

    const [instructor] = await sql`
      INSERT INTO instructors (name, email, active, school_id, request_to_book)
      VALUES ('Request Test Instructor', ${instructorEmail}, true, ${SCHOOL_ID}, true)
      RETURNING id
    `;
    instructorId = instructor.id;

    await resetFixtures();
  });

  test.afterAll(async () => {
    if (!ENABLED || !sql) return;
    try { await sql`DELETE FROM lesson_requests WHERE learner_id = ${learnerId} OR instructor_id = ${instructorId}`; } catch (e) {}
    try { await sql`DELETE FROM notification_log WHERE learner_id = ${learnerId} OR instructor_id = ${instructorId}`; } catch (e) {}
    try { await sql`DELETE FROM learner_credit_balances WHERE learner_id = ${learnerId}`; } catch (e) {}
    try { await sql`DELETE FROM credit_transactions WHERE learner_id = ${learnerId}`; } catch (e) {}
    try { await sql`DELETE FROM learner_users WHERE id = ${learnerId}`; } catch (e) {}
    try { await sql`DELETE FROM instructors WHERE id = ${instructorId}`; } catch (e) {}
  });

  test('1. request_hold deducts the scoped balance and writes a matching ledger row', async () => {
    await resetFixtures();
    const slot = futureSlot(7, '10:00');
    const request = await insertPendingRequest({ date: slot.date, start: slot.start });

    const hold = await takeHold(request.id);
    expect(hold.ok).toBe(true);
    expect(hold.transactionId).toBeTruthy();
    expect(await lcbBalance()).toBe(START_BALANCE - HOLD_MINUTES);

    const [ct] = await sql`
      SELECT type, minutes, instructor_id FROM credit_transactions WHERE id = ${hold.transactionId}
    `;
    expect(ct.type).toBe('request_hold');
    expect(Number(ct.minutes)).toBe(-HOLD_MINUTES);
    expect(Number(ct.instructor_id)).toBe(instructorId);
  });

  test('2. over-balance hold is refused with no ledger row and no balance change', async () => {
    await resetFixtures();
    // Drain most of the balance so the hold can't fit.
    await sql`
      UPDATE learner_credit_balances SET balance_minutes = ${HOLD_MINUTES - 1}
      WHERE learner_id = ${learnerId} AND instructor_id = ${instructorId} AND school_id = ${SCHOOL_ID}
    `;
    const hold = await takeHold(null);
    expect(hold.ok).toBe(false);
    expect(hold.code).toBe('INSUFFICIENT_BALANCE');
    expect(await lcbBalance()).toBe(HOLD_MINUTES - 1);
    const [count] = await sql`
      SELECT COUNT(*)::int AS n FROM credit_transactions
      WHERE learner_id = ${learnerId} AND type = 'request_hold'
    `;
    expect(Number(count.n)).toBe(0);
  });

  test('3. releaseRequestHold refunds in full, exactly once', async () => {
    await resetFixtures();
    const slot = futureSlot(8, '11:00');
    let request = await insertPendingRequest({ date: slot.date, start: slot.start });
    const hold = await takeHold(request.id);
    expect(hold.ok).toBe(true);

    // Decision claim (as decline does), then release.
    [request] = await sql`
      UPDATE lesson_requests SET status = 'declined', decided_at = NOW()
      WHERE id = ${request.id} AND status = 'pending' RETURNING *
    `;
    const release1 = await releaseRequestHold(sql, request);
    expect(release1.ok).toBe(true);
    expect(await lcbBalance()).toBe(START_BALANCE);

    const [released] = await sql`SELECT released_at FROM lesson_requests WHERE id = ${request.id}`;
    expect(released.released_at).toBeTruthy();

    // Second release must be a no-op — no second refund row.
    const release2 = await releaseRequestHold(sql, request);
    expect(release2.ok).toBe(true);
    expect(release2.alreadyReleased).toBe(true);
    expect(await lcbBalance()).toBe(START_BALANCE);
    const [refunds] = await sql`
      SELECT COUNT(*)::int AS n FROM credit_transactions
      WHERE learner_id = ${learnerId} AND type = 'request_refund'
    `;
    expect(Number(refunds.n)).toBe(1);
  });

  test('4. hold + release nets to zero in the ledger (divergence-cron shape)', async () => {
    // Continues from test 3's final state: one hold + one refund.
    expect(await ledgerSumMinutes()).toBe(0);
    expect(await lcbBalance()).toBe(START_BALANCE);
  });

  test('5. uq_request_slot: one pending request per slot, freed when it leaves pending', async () => {
    await resetFixtures();
    const slot = futureSlot(9, '14:00');
    const first = await insertPendingRequest({ date: slot.date, start: slot.start });

    let duplicateError = null;
    try {
      await insertPendingRequest({ date: slot.date, start: slot.start });
    } catch (err) {
      duplicateError = err;
    }
    expect(duplicateError).toBeTruthy();
    expect(
      duplicateError.code === '23505' || /uq_request_slot/.test(duplicateError.message || '')
    ).toBe(true);

    // Flip the first row out of pending — the slot lock releases.
    await sql`UPDATE lesson_requests SET status = 'withdrawn', decided_at = NOW(), released_at = NOW() WHERE id = ${first.id}`;
    const second = await insertPendingRequest({ date: slot.date, start: slot.start });
    expect(second.id).toBeTruthy();
  });

  test('6. expirePendingRequest claims, releases the hold, and is idempotent', async () => {
    await resetFixtures();
    const slot = futureSlot(10, '09:00');
    const request = await insertPendingRequest({
      date: slot.date,
      start: slot.start,
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(), // already stale
    });
    const hold = await takeHold(request.id);
    expect(hold.ok).toBe(true);
    expect(await lcbBalance()).toBe(START_BALANCE - HOLD_MINUTES);

    const result1 = await expirePendingRequest(sql, request);
    expect(result1.ok).toBe(true);
    expect(result1.skipped).toBeFalsy();
    expect(await lcbBalance()).toBe(START_BALANCE);

    const [row] = await sql`SELECT status, released_at FROM lesson_requests WHERE id = ${request.id}`;
    expect(row.status).toBe('expired');
    expect(row.released_at).toBeTruthy();

    const result2 = await expirePendingRequest(sql, request);
    expect(result2.skipped).toBe(true);
    expect(await lcbBalance()).toBe(START_BALANCE);
    expect(await ledgerSumMinutes()).toBe(0);
  });

  test('7. crashed decision (decided, unreleased) is recoverable — the cron sweep contract', async () => {
    await resetFixtures();
    const slot = futureSlot(11, '15:00');
    let request = await insertPendingRequest({ date: slot.date, start: slot.start });
    const hold = await takeHold(request.id);
    expect(hold.ok).toBe(true);

    // Simulate a crash after the claim but before the release.
    [request] = await sql`
      UPDATE lesson_requests SET status = 'declined', decided_at = NOW() - INTERVAL '20 minutes'
      WHERE id = ${request.id} RETURNING *
    `;
    expect(request.released_at).toBeNull();

    // The sweep query shape from api/requests.js finds it…
    const [sweepRow] = await sql`
      SELECT id FROM lesson_requests
      WHERE status IN ('declined', 'expired', 'withdrawn')
        AND released_at IS NULL
        AND decided_at < NOW() - INTERVAL '10 minutes'
        AND id = ${request.id}
    `;
    expect(sweepRow).toBeTruthy();

    // …and the retry release makes the learner whole.
    const release = await releaseRequestHold(sql, request);
    expect(release.ok).toBe(true);
    expect(await lcbBalance()).toBe(START_BALANCE);
    expect(await ledgerSumMinutes()).toBe(0);
  });

  test('8. computeRequestExpiresAt honours the 48h / 2h-lead bounds', async () => {
    // Far-future slot → standard 48h expiry (within a minute of now+48h).
    const far = futureSlot(14, '10:00');
    const farExpiry = computeRequestExpiresAt(far.date, far.start);
    expect(farExpiry).toBeTruthy();
    const fortyEightHrs = Date.now() + 48 * 60 * 60 * 1000;
    expect(Math.abs(farExpiry.getTime() - fortyEightHrs)).toBeLessThan(60 * 1000);

    // Slot starting within the 2h lead window → refused outright.
    const soon = new Date(Date.now() + 90 * 60 * 1000); // 90 min from now
    const soonExpiry = computeRequestExpiresAt(
      soon.toISOString().slice(0, 10),
      soon.toISOString().slice(11, 16)
    );
    expect(soonExpiry).toBeNull();
  });
});
