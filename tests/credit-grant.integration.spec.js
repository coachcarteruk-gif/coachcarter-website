// @ts-check
// Integration tests for api/_credit-grant.js against a real Neon test branch.
//
// Why this file exists:
//   The money-correctness properties of grantCredits() can't be honestly
//   exercised against an in-memory mock. The load-bearing claim — "the INSERT
//   into credit_transactions and the balance UPDATE happen atomically in one
//   PostgreSQL statement" — is a property of the database, not the JS.
//   Likewise the duplicate-detection (partial unique index + ON CONFLICT
//   inference) and the concurrency-serialisation (FOR UPDATE row lock) only
//   exist as real things on a real database server.
//
//   These tests run against an isolated Neon test branch via POSTGRES_URL_TEST.
//   They never touch prod. If POSTGRES_URL_TEST is unset or CC_TEST_DB is not
//   1, the whole suite skips.
//
// What this proves:
//   1. Happy path — single grant inserts ledger row + increments balance.
//   2. Duplicate Stripe-session retry does not double-credit.
//   3. SQL-level failure inside the CTE rolls the whole statement back.
//   4. Concurrent grant + deduct serialise on the learner row lock.
//   5. Concurrent webhook + verify-session for the same session don't
//      double-credit and don't lose either grant.
//
// How to run:
//   1. Create a Neon test branch (one click in the Neon dashboard).
//   2. Add POSTGRES_URL_TEST="<branch connection string>" to .env.local.
//   3. CC_TEST_DB=1 npx playwright test credit-grant.integration
//
// Cleanup discipline:
//   beforeAll creates one test learner with a unique email. afterAll deletes
//   that learner and its credit_transactions cascade. Each test calls
//   resetLearner() to zero the balance and clear ledger rows. If a test
//   crashes mid-flight the afterAll still runs.

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight .env.local loader.
// ─────────────────────────────────────────────────────────────────────────────
// vercel dev loads .env.local server-side; running Playwright directly does
// not get that behaviour. Rather than add a dotenv dependency, parse the
// file inline. Only reads KEY="value" / KEY=value lines; ignores comments,
// blank lines, and anything malformed. Existing process.env values win — so
// CI can still override by setting them in the workflow.
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
      if (process.env[key] !== undefined) continue; // existing env wins
      let val = m[2];
      // Strip surrounding quotes if present.
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch (err) {
    console.warn('[credit-grant.integration] .env.local load failed:', err.message);
  }
})();

const {
  grantCreditsPre2A,
  _resetPhaseDetectionForTests,
} = require('../api/_credit-grant');

// ─────────────────────────────────────────────────────────────────────────────
// Gating — skip the whole file unless explicitly opted in.
// ─────────────────────────────────────────────────────────────────────────────
const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
test.describe.configure({ mode: 'serial' }); // Tests share a learner row.

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────
let sql;            // primary client
let sql2;           // second independent client for concurrency tests
let testLearnerId;
let testEmail;

const SCHOOL_ID = 1; // CoachCarter — always exists in any Neon branch off main.

// Generate a session id that looks like a real Stripe Checkout Session id so
// it passes any future startsWith('cs_') guard. Random suffix keeps tests
// independent across runs (a previous run's cruft can't collide).
function freshSessionId(label) {
  return `cs_test_${label}_${crypto.randomBytes(8).toString('hex')}`;
}

// Reset the test learner to a known zero-balance, no-ledger state. Called at
// the start of each test for isolation. Order: delete ledger first (FK
// references learner), then zero balance.
async function resetLearner() {
  await sql`DELETE FROM credit_transactions WHERE learner_id = ${testLearnerId}`;
  await sql`
    UPDATE learner_users
       SET balance_minutes = 0, credit_balance = 0
     WHERE id = ${testLearnerId}
  `;
}

// Sleep helper for staging concurrent calls. Not used for synchronisation
// (the race tests just Promise.all), only for diagnostic pauses if needed.
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); } // eslint-disable-line no-unused-vars

test.describe('grantCreditsPre2A — integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run these tests against a Neon test branch.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    sql  = neon(process.env.POSTGRES_URL_TEST);
    sql2 = neon(process.env.POSTGRES_URL_TEST);

    // Defensive: confirm we're not pointing at prod. The Neon test-branch
    // host typically differs from the prod host by the branch suffix in the
    // hostname, but the safest check is that the URL is not literally equal
    // to POSTGRES_URL. If you really did point them at the same DB this
    // throws loudly before any mutation.
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST is the same as POSTGRES_URL. Point POSTGRES_URL_TEST at an isolated Neon branch.');
    }

    // Reset the phase-detection cache so the dispatcher re-checks against
    // the test branch (which may be at a different schema version than the
    // last process this module was loaded into).
    _resetPhaseDetectionForTests();

    // Create the test learner. Email is unique per run.
    testEmail = `test+credit-grant-${crypto.randomBytes(6).toString('hex')}@coachcarter.test`;
    const [row] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES ('Credit Grant Test', ${testEmail}, ${SCHOOL_ID}, 0, 0)
      RETURNING id
    `;
    testLearnerId = row.id;
  });

  test.afterAll(async () => {
    if (!ENABLED || !testLearnerId) return;
    // FK is ON DELETE CASCADE for credit_transactions, but we delete
    // explicitly so a future schema change can't silently leave cruft.
    await sql`DELETE FROM credit_transactions WHERE learner_id = ${testLearnerId}`;
    await sql`DELETE FROM learner_users WHERE id = ${testLearnerId}`;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 1: Happy path.
  // ───────────────────────────────────────────────────────────────────────────
  test('happy path: single grant inserts ledger row and increments balance atomically', async () => {
    await resetLearner();
    const sessionId = freshSessionId('happy');

    const result = await grantCreditsPre2A({
      sql,
      learnerId: testLearnerId,
      schoolId: SCHOOL_ID,
      credits: 1,
      minutes: 90,
      amountPence: 4950,
      paymentMethod: 'card',
      sessionId,
      stripeFeePence: 250,
    });

    expect(result.ok).toBe(true);
    expect(result.alreadyProcessed).toBe(false);
    expect(result.transactionId).toBeTruthy();
    expect(result.balanceMinutes).toBe(90);
    expect(result.creditBalance).toBe(1);

    // Cross-check via independent SELECT.
    const [tx] = await sql`
      SELECT id, learner_id, type, credits, minutes, amount_pence, stripe_session_id, school_id, stripe_fee_pence
        FROM credit_transactions WHERE stripe_session_id = ${sessionId}
    `;
    expect(tx).toBeTruthy();
    expect(tx.learner_id).toBe(testLearnerId);
    expect(tx.type).toBe('purchase');
    expect(tx.credits).toBe(1);
    expect(tx.minutes).toBe(90);
    expect(tx.amount_pence).toBe(4950);
    expect(tx.stripe_fee_pence).toBe(250);
    expect(tx.school_id).toBe(SCHOOL_ID);

    const [bal] = await sql`SELECT balance_minutes, credit_balance FROM learner_users WHERE id = ${testLearnerId}`;
    expect(bal.balance_minutes).toBe(90);
    expect(bal.credit_balance).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 2: Duplicate Stripe session retry does not double-credit.
  // ───────────────────────────────────────────────────────────────────────────
  test('duplicate Stripe-session retry returns alreadyProcessed and does not double-credit', async () => {
    await resetLearner();
    const sessionId = freshSessionId('duplicate');

    const first = await grantCreditsPre2A({
      sql, learnerId: testLearnerId, schoolId: SCHOOL_ID,
      credits: 1, minutes: 90, amountPence: 4950, paymentMethod: 'card',
      sessionId, stripeFeePence: 250,
    });
    expect(first.alreadyProcessed).toBe(false);
    expect(first.balanceMinutes).toBe(90);

    // Replay the same session id — Stripe's retry mechanism does this on 5xx.
    const second = await grantCreditsPre2A({
      sql, learnerId: testLearnerId, schoolId: SCHOOL_ID,
      credits: 1, minutes: 90, amountPence: 4950, paymentMethod: 'card',
      sessionId, stripeFeePence: 250,
    });
    expect(second.ok).toBe(true);
    expect(second.alreadyProcessed).toBe(true);
    expect(second.transactionId).toBeNull();
    // Balance unchanged from the first grant.
    expect(second.balanceMinutes).toBe(90);
    expect(second.creditBalance).toBe(1);

    // Only one ledger row exists for this session.
    const ledger = await sql`SELECT id FROM credit_transactions WHERE stripe_session_id = ${sessionId}`;
    expect(ledger).toHaveLength(1);

    // Independent SELECT confirms the balance.
    const [bal] = await sql`SELECT balance_minutes FROM learner_users WHERE id = ${testLearnerId}`;
    expect(bal.balance_minutes).toBe(90);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 3: SQL-level failure rolls back the entire CTE statement atomically.
  // ───────────────────────────────────────────────────────────────────────────
  //
  // This is the property the plan's three "named injection points" actually
  // tested — it just collapsed to one observable property on the Neon HTTP
  // driver, because the whole CTE is one server-side statement. We force a
  // mid-statement failure by violating the credit_transactions_type_check
  // CHECK constraint (allowed values: purchase, refund, slot_purchase,
  // edit_adjustment, admin_add, admin_remove, referral_bonus, referral_reward).
  // 'INVALID_TYPE_FOR_TEST' is not in that set → 23514 mid-INSERT → whole
  // statement rolls back. We assert: zero ledger row persisted AND learner
  // balance unchanged. That proves the INSERT and the UPDATE are inside the
  // same atomic boundary.
  //
  // We can't trigger this through grantCreditsPre2A directly because it
  // hardcodes type='purchase'. So we hand-craft a CTE that mirrors its shape
  // with the bad type. If a future refactor changes the helper's shape this
  // test catches the drift — but the property under test is "the helper's
  // SQL shape is atomic", not "the helper specifically rolls back".
  test('SQL-level failure inside the CTE rolls back ledger insert AND balance update', async () => {
    await resetLearner();
    const sessionId = freshSessionId('rollback');

    // Verify starting state.
    const [pre] = await sql`SELECT balance_minutes FROM learner_users WHERE id = ${testLearnerId}`;
    expect(pre.balance_minutes).toBe(0);

    // Hand-crafted CTE statement that mirrors grantCreditsPre2A's shape,
    // but uses an invalid `type` value to trigger 23514 mid-statement.
    let threw = null;
    try {
      await sql`
        WITH locked AS (
          SELECT id FROM learner_users WHERE id = ${testLearnerId} AND school_id = ${SCHOOL_ID} FOR UPDATE
        ),
        inserted AS (
          INSERT INTO credit_transactions
            (learner_id, type, credits, amount_pence, payment_method,
             stripe_session_id, minutes, school_id, stripe_fee_pence)
          SELECT ${testLearnerId}, 'INVALID_TYPE_FOR_TEST', 1, 4950, 'card',
                 ${sessionId}, 90, ${SCHOOL_ID}, 250
          FROM locked
          ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL DO NOTHING
          RETURNING id, credits, minutes
        ),
        applied AS (
          SELECT COALESCE(SUM(credits), 0)::int AS credits,
                 COALESCE(SUM(minutes), 0)::int AS minutes
            FROM inserted
        )
        UPDATE learner_users lu
           SET credit_balance  = lu.credit_balance  + (SELECT credits FROM applied),
               balance_minutes = lu.balance_minutes + (SELECT minutes FROM applied)
         WHERE lu.id = ${testLearnerId} AND lu.school_id = ${SCHOOL_ID}
         RETURNING lu.balance_minutes
      `;
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    // Postgres reports CHECK violation as 23514.
    expect(String(threw.code || threw.message)).toMatch(/23514|check constraint|credit_transactions_type_check/i);

    // Property under test: NEITHER side effect of the CTE persisted.
    const ledger = await sql`SELECT id FROM credit_transactions WHERE stripe_session_id = ${sessionId}`;
    expect(ledger).toHaveLength(0);

    const [post] = await sql`SELECT balance_minutes, credit_balance FROM learner_users WHERE id = ${testLearnerId}`;
    expect(post.balance_minutes).toBe(0);
    expect(post.credit_balance).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 4: Concurrent grant + deduct serialise on the learner row lock.
  // ───────────────────────────────────────────────────────────────────────────
  //
  // Two independent neon() clients fire two writes concurrently:
  //   client A: grantCreditsPre2A for +90 minutes
  //   client B: LCB-lock CTE deduct for -90 minutes (mirroring slots.js)
  //
  // Starting balance = 0. Either ordering is acceptable:
  //   - A wins → balance 90 → B deducts → 0   (booking succeeded)
  //   - B wins → insufficient_credit, no-op → A grants → 90  (booking refused)
  //
  // What's NOT acceptable: balance ever observed at -90, or both A and B
  // succeeding without the LCB lock having serialised them (which would
  // require violating Postgres row-locking semantics). We run the race 20×
  // to flush timing windows.
  test('concurrent grant + deduct serialise on the learner_users row lock', async () => {
    const totalMins = 90;
    const RUNS = 20;

    for (let i = 0; i < RUNS; i++) {
      await resetLearner();
      const sessionId = freshSessionId(`race-${i}`);

      // Pre-condition: balance is 0.
      const [pre] = await sql`SELECT balance_minutes FROM learner_users WHERE id = ${testLearnerId}`;
      expect(pre.balance_minutes).toBe(0);

      // Race them.
      const grantPromise = grantCreditsPre2A({
        sql, learnerId: testLearnerId, schoolId: SCHOOL_ID,
        credits: 1, minutes: totalMins, amountPence: 4950, paymentMethod: 'card',
        sessionId, stripeFeePence: 250,
      });

      // Mirrors api/slots.js handleBook deduct (LCB-lock CTE shape).
      const deductPromise = sql2`
        WITH locked AS (
          SELECT id FROM learner_users WHERE id = ${testLearnerId} AND school_id = ${SCHOOL_ID} FOR UPDATE
        )
        UPDATE learner_users lu
           SET balance_minutes = lu.balance_minutes - ${totalMins},
               credit_balance  = GREATEST(lu.credit_balance - 1, 0)
          FROM locked
         WHERE lu.id = locked.id AND lu.balance_minutes >= ${totalMins}
         RETURNING lu.balance_minutes
      `;

      const [grantResult, deductResult] = await Promise.all([grantPromise, deductPromise]);

      // Post-condition: balance is either 0 (grant landed first, deduct
      // succeeded) or 90 (deduct found insufficient, then grant landed).
      const [post] = await sql`SELECT balance_minutes FROM learner_users WHERE id = ${testLearnerId}`;
      expect(post.balance_minutes,
             `race ${i}: balance must be 0 or 90, never negative or 180; got ${post.balance_minutes}`).toBeGreaterThanOrEqual(0);
      expect([0, 90]).toContain(post.balance_minutes);

      // Grant always succeeds (no constraint on it from the deduct).
      expect(grantResult.ok).toBe(true);
      expect(grantResult.alreadyProcessed).toBe(false);

      // Deduct returns either a row (balance after deduct) or empty (insufficient).
      if (deductResult.length > 0) {
        // Deduct succeeded → balance after must be 0.
        expect(post.balance_minutes).toBe(0);
      } else {
        // Deduct rejected → balance is 90 (grant landed alone).
        expect(post.balance_minutes).toBe(90);
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 5: Concurrent webhook + verify-session for the same session.
  // ───────────────────────────────────────────────────────────────────────────
  //
  // Two callers race to apply the SAME Stripe session. Exactly one must land
  // the grant; the other must observe alreadyProcessed=true. Final balance is
  // a single grant's worth — never double-credited. Run 20× to flush.
  test('webhook + verify-session race for the same session does not double-credit', async () => {
    const RUNS = 20;

    for (let i = 0; i < RUNS; i++) {
      await resetLearner();
      const sessionId = freshSessionId(`webhook-verify-${i}`);

      const args = {
        learnerId: testLearnerId, schoolId: SCHOOL_ID,
        credits: 1, minutes: 90, amountPence: 4950, paymentMethod: 'card',
        sessionId, stripeFeePence: 250,
      };

      // Two independent clients fire the same grant concurrently.
      const [aRes, bRes] = await Promise.all([
        grantCreditsPre2A({ sql,  ...args }),
        grantCreditsPre2A({ sql: sql2, ...args }),
      ]);

      expect(aRes.ok).toBe(true);
      expect(bRes.ok).toBe(true);

      // Exactly one is alreadyProcessed=false, the other is true. Order
      // depends on which transaction won the row lock first; both are valid.
      const winners = [aRes, bRes].filter(r => r.alreadyProcessed === false);
      const losers  = [aRes, bRes].filter(r => r.alreadyProcessed === true);
      expect(winners,
             `race ${i}: exactly one caller must have alreadyProcessed=false; got winners=${winners.length}`).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(winners[0].transactionId).toBeTruthy();
      expect(losers[0].transactionId).toBeNull();

      // Only one ledger row exists for this session.
      const ledger = await sql`SELECT id FROM credit_transactions WHERE stripe_session_id = ${sessionId}`;
      expect(ledger).toHaveLength(1);

      // Balance reflects exactly one grant.
      const [bal] = await sql`SELECT balance_minutes, credit_balance FROM learner_users WHERE id = ${testLearnerId}`;
      expect(bal.balance_minutes).toBe(90);
      expect(bal.credit_balance).toBe(1);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 6 (bonus): LEARNER_NOT_FOUND is surfaced typed, not as a generic 500.
  // ───────────────────────────────────────────────────────────────────────────
  test('LEARNER_NOT_FOUND when the learner does not exist for the school', async () => {
    // Use an id we're certain doesn't exist. -1 is invalid for a SERIAL pk.
    const result = await grantCreditsPre2A({
      sql, learnerId: 2147483647, schoolId: SCHOOL_ID,
      credits: 1, minutes: 90, amountPence: 4950, paymentMethod: 'card',
      sessionId: freshSessionId('not-found'), stripeFeePence: 250,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('LEARNER_NOT_FOUND');
    expect(result.alreadyProcessed).toBe(false);
    expect(result.transactionId).toBeNull();
  });
});
