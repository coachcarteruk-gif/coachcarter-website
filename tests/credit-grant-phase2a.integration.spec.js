// @ts-check
// Integration tests for the Phase 2A SQL shape in api/_credit-grant.js
// against a real Neon test branch.
//
// Why this file exists:
//   The PR #174 incident proved that the Phase 2A SQL's first-write
//   semantics can't be validated against an in-memory mock — the bug
//   was PostgreSQL §7.8.4 snapshot visibility on data-modifying CTEs,
//   which only exists as a real thing on a real database server.
//
//   These tests exercise the load-bearing properties of the new
//   INSERT...ON CONFLICT DO UPDATE shape:
//     T1. First-ever LCB write materialises the row + balance.
//     T2. Existing LCB write increments correctly.
//     T3. Duplicate Stripe retry is idempotent (one ledger row, balance
//         unchanged on retry).
//     T4. Concurrent first-write race for a fresh (learner, instructor)
//         pair — both grants succeed, balance = sum.
//     T5. Deduct against insufficient existing LCB row returns
//         INSUFFICIENT_BALANCE; balance unchanged; no ledger row.
//     T6. Deduct against missing LCB row returns INSUFFICIENT_BALANCE;
//         row stays absent; no ledger row.
//
// How to run:
//   1. Create a Neon test branch (one click in the Neon dashboard).
//   2. Add POSTGRES_URL_TEST="<branch connection string>" to .env.local.
//   3. CC_TEST_DB=1 npx playwright test credit-grant-phase2a.integration
//
// Cleanup discipline:
//   beforeAll creates one test learner. afterAll deletes the learner +
//   all credit_transactions + LCB rows for the test instructors. Each
//   test calls resetState() to clear LCB + ledger for the test pair.

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight .env.local loader (mirrors credit-grant.integration.spec.js).
// ─────────────────────────────────────────────────────────────────────────────
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
    console.warn('[credit-grant-phase2a.integration] .env.local load failed:', err.message);
  }
})();

const {
  grantCredits,
  lockBalanceAndMutate,
  _resetPhaseDetectionForTests,
  _setPhase2AImplementedForTests,
} = require('../api/_credit-grant');

// ─────────────────────────────────────────────────────────────────────────────
// Gating
// ─────────────────────────────────────────────────────────────────────────────
const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
test.describe.configure({ mode: 'serial' });

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────
let sql;            // primary client
let sql2;           // second independent client for the concurrency test
let testLearnerId;
let testEmail;

const SCHOOL_ID = 1;        // CoachCarter — always exists in any Neon branch off main.
const INSTRUCTOR_ID = 1;    // Fraser — always exists in any Neon branch off main.
// A second instructor id for tests that need a fresh (learner, instructor)
// pair every run. We use 999 as a sentinel — must NOT exist in instructors.
// If it does, the test branch isn't clean enough.
const FRESH_INSTRUCTOR_ID_SENTINEL = 999;

function freshSessionId(label) {
  return `cs_test_${label}_${crypto.randomBytes(8).toString('hex')}`;
}

// Reset LCB + ledger for the test learner across all instructors. Called at
// the start of each test for isolation.
async function resetState() {
  await sql`DELETE FROM credit_transactions WHERE learner_id = ${testLearnerId}`;
  await sql`DELETE FROM learner_credit_balances WHERE learner_id = ${testLearnerId}`;
  await sql`
    UPDATE learner_users
       SET balance_minutes = 0, credit_balance = 0
     WHERE id = ${testLearnerId}
  `;
}

test.describe('Phase 2A SQL shape — integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run these tests against a Neon test branch.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    sql  = neon(process.env.POSTGRES_URL_TEST);
    sql2 = neon(process.env.POSTGRES_URL_TEST);

    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST is the same as POSTGRES_URL. Point POSTGRES_URL_TEST at an isolated Neon branch.');
    }

    // Sanity: the test branch must have the Phase 2A schema (LCB table +
    // credit_transactions.instructor_id). If not, the dispatcher will
    // silently route to Pre-2A and the tests would be testing the wrong
    // code path.
    const [hasInstructorCol] = await sql`
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'credit_transactions'
         AND column_name = 'instructor_id'
    `;
    if (!hasInstructorCol) {
      throw new Error('Phase 2A schema missing on test branch: credit_transactions.instructor_id not found. Run /api/migrate against the test branch first.');
    }
    const [hasLcb] = await sql`
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'learner_credit_balances'
    `;
    if (!hasLcb) {
      throw new Error('Phase 2A schema missing on test branch: learner_credit_balances table not found.');
    }

    // Force the dispatcher to take the Phase 2A path regardless of
    // PHASE_2A_IMPLEMENTED's current value in source. We're testing the
    // SQL shape, not the gate.
    _resetPhaseDetectionForTests();
    _setPhase2AImplementedForTests(true);
    process.env.PER_INSTRUCTOR_CREDITS_PHASE_2A = '1';

    // Create the test learner.
    testEmail = `test+phase2a-${crypto.randomBytes(6).toString('hex')}@coachcarter.test`;
    const [row] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES ('Phase 2A Test', ${testEmail}, ${SCHOOL_ID}, 0, 0)
      RETURNING id
    `;
    testLearnerId = row.id;
  });

  test.afterAll(async () => {
    if (!ENABLED || !testLearnerId) return;
    await sql`DELETE FROM credit_transactions WHERE learner_id = ${testLearnerId}`;
    await sql`DELETE FROM learner_credit_balances WHERE learner_id = ${testLearnerId}`;
    await sql`DELETE FROM learner_users WHERE id = ${testLearnerId}`;
    _resetPhaseDetectionForTests();
    _setPhase2AImplementedForTests(false);
    delete process.env.PER_INSTRUCTOR_CREDITS_PHASE_2A;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T1: First-ever LCB write materialises the row + balance.
  // ───────────────────────────────────────────────────────────────────────────
  // The PR #174 bug: outer UPDATE on LCB filtered by learner_id+instructor_id
  // couldn't see the just-INSERT'd row (PG §7.8.4), wrote nothing, returned
  // empty. credit_transactions row got inserted; LCB stayed at 0.
  test('T1: first-ever (learner, instructor) LCB write — row materialises with correct balance', async () => {
    await resetState();
    const sessionId = freshSessionId('t1-first-write');

    // Pre-condition: no LCB row exists for this pair.
    const preRows = await sql`
      SELECT 1 FROM learner_credit_balances
       WHERE learner_id = ${testLearnerId} AND instructor_id = ${INSTRUCTOR_ID}
    `;
    expect(preRows).toHaveLength(0);

    const result = await grantCredits({
      sql,
      learnerId: testLearnerId,
      instructorId: INSTRUCTOR_ID,
      schoolId: SCHOOL_ID,
      credits: 1,
      minutes: 90,
      amountPence: 4950,
      paymentMethod: 'card',
      sessionId,
      stripeFeePence: 250,
      effectiveRatePencePerMinute: 55,
    });

    expect(result.ok).toBe(true);
    expect(result.alreadyProcessed).toBe(false);
    expect(result.transactionId).toBeTruthy();
    // The load-bearing claim: balance is 90, NOT 0 (the bug).
    expect(result.balanceMinutes).toBe(90);

    // Cross-check via independent SELECT.
    const [lcb] = await sql`
      SELECT balance_minutes FROM learner_credit_balances
       WHERE learner_id = ${testLearnerId} AND instructor_id = ${INSTRUCTOR_ID}
    `;
    expect(lcb).toBeTruthy();
    expect(lcb.balance_minutes).toBe(90);

    // The ledger row exists.
    const [tx] = await sql`
      SELECT id, minutes, instructor_id FROM credit_transactions
       WHERE stripe_session_id = ${sessionId}
    `;
    expect(tx).toBeTruthy();
    expect(tx.minutes).toBe(90);
    expect(tx.instructor_id).toBe(INSTRUCTOR_ID);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T2: Existing LCB write increments correctly.
  // ───────────────────────────────────────────────────────────────────────────
  test('T2: existing LCB row + new grant = previous balance + new minutes', async () => {
    await resetState();
    // Seed an existing LCB row with 60 mins via a first grant.
    const seedSessionId = freshSessionId('t2-seed');
    const seedResult = await grantCredits({
      sql,
      learnerId: testLearnerId,
      instructorId: INSTRUCTOR_ID,
      schoolId: SCHOOL_ID,
      credits: 1, minutes: 60, amountPence: 3300, paymentMethod: 'card',
      sessionId: seedSessionId, stripeFeePence: 150,
      effectiveRatePencePerMinute: 55,
    });
    expect(seedResult.balanceMinutes).toBe(60);

    // Now grant another 30 mins.
    const sessionId = freshSessionId('t2-add');
    const result = await grantCredits({
      sql,
      learnerId: testLearnerId,
      instructorId: INSTRUCTOR_ID,
      schoolId: SCHOOL_ID,
      credits: 1, minutes: 30, amountPence: 1650, paymentMethod: 'card',
      sessionId, stripeFeePence: 75,
      effectiveRatePencePerMinute: 55,
    });

    expect(result.ok).toBe(true);
    expect(result.alreadyProcessed).toBe(false);
    expect(result.balanceMinutes).toBe(90);

    const [lcb] = await sql`
      SELECT balance_minutes FROM learner_credit_balances
       WHERE learner_id = ${testLearnerId} AND instructor_id = ${INSTRUCTOR_ID}
    `;
    expect(lcb.balance_minutes).toBe(90);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T3: Duplicate Stripe retry is idempotent.
  // ───────────────────────────────────────────────────────────────────────────
  // Replay the same session_id: second call must return alreadyProcessed,
  // balance must NOT double, exactly one ledger row exists.
  test('T3: duplicate Stripe retry — alreadyProcessed=true, balance unchanged, single ledger row', async () => {
    await resetState();
    const sessionId = freshSessionId('t3-duplicate');

    const first = await grantCredits({
      sql,
      learnerId: testLearnerId,
      instructorId: INSTRUCTOR_ID,
      schoolId: SCHOOL_ID,
      credits: 1, minutes: 90, amountPence: 4950, paymentMethod: 'card',
      sessionId, stripeFeePence: 250,
      effectiveRatePencePerMinute: 55,
    });
    expect(first.alreadyProcessed).toBe(false);
    expect(first.balanceMinutes).toBe(90);

    // Replay.
    const second = await grantCredits({
      sql,
      learnerId: testLearnerId,
      instructorId: INSTRUCTOR_ID,
      schoolId: SCHOOL_ID,
      credits: 1, minutes: 90, amountPence: 4950, paymentMethod: 'card',
      sessionId, stripeFeePence: 250,
      effectiveRatePencePerMinute: 55,
    });
    expect(second.ok).toBe(true);
    expect(second.alreadyProcessed).toBe(true);
    expect(second.transactionId).toBeNull();
    // Balance unchanged: still 90, NOT 180.
    expect(second.balanceMinutes).toBe(90);

    // Independent verification.
    const [lcb] = await sql`
      SELECT balance_minutes FROM learner_credit_balances
       WHERE learner_id = ${testLearnerId} AND instructor_id = ${INSTRUCTOR_ID}
    `;
    expect(lcb.balance_minutes).toBe(90);

    const ledger = await sql`
      SELECT id FROM credit_transactions WHERE stripe_session_id = ${sessionId}
    `;
    expect(ledger).toHaveLength(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T4: Concurrent first-write race — both grants succeed, balance = sum.
  // ───────────────────────────────────────────────────────────────────────────
  // Two parallel grants for the same (learner, instructor) pair with no LCB
  // row to start. Different session ids (so neither hits the idempotency
  // arbiter). Final LCB balance must = sum of both minute values. This
  // proves the row-level lock on ON CONFLICT DO UPDATE serialises concurrent
  // writers correctly — if §7.8.4's snapshot-visibility problem were back,
  // one writer would silently lose its delta.
  test('T4: concurrent first-writes serialise; final balance = sum of both minute counts', async () => {
    const RUNS = 20;

    for (let i = 0; i < RUNS; i++) {
      await resetState();
      const sessionIdA = freshSessionId(`t4-a-${i}`);
      const sessionIdB = freshSessionId(`t4-b-${i}`);

      const argsBase = {
        learnerId: testLearnerId,
        instructorId: INSTRUCTOR_ID,
        schoolId: SCHOOL_ID,
        credits: 1, amountPence: 4950, paymentMethod: 'card',
        stripeFeePence: 250,
        effectiveRatePencePerMinute: 55,
      };

      const [aRes, bRes] = await Promise.all([
        grantCredits({ sql,  ...argsBase, minutes: 60, sessionId: sessionIdA }),
        grantCredits({ sql: sql2, ...argsBase, minutes: 30, sessionId: sessionIdB }),
      ]);

      expect(aRes.ok).toBe(true);
      expect(bRes.ok).toBe(true);
      // Neither is alreadyProcessed (different session ids).
      expect(aRes.alreadyProcessed).toBe(false);
      expect(bRes.alreadyProcessed).toBe(false);

      // Final balance MUST equal 60 + 30 = 90. If either writer's delta
      // was lost (the bug), we'd see 60 or 30.
      const [lcb] = await sql`
        SELECT balance_minutes FROM learner_credit_balances
         WHERE learner_id = ${testLearnerId} AND instructor_id = ${INSTRUCTOR_ID}
      `;
      expect(lcb, `run ${i}: LCB row must exist`).toBeTruthy();
      expect(lcb.balance_minutes,
             `run ${i}: balance must be 90 (60+30); lost increment detected`).toBe(90);

      // Both ledger rows exist.
      const ledger = await sql`
        SELECT id FROM credit_transactions
         WHERE stripe_session_id IN (${sessionIdA}, ${sessionIdB})
      `;
      expect(ledger).toHaveLength(2);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T5: Deduct against insufficient existing LCB → INSUFFICIENT_BALANCE.
  // ───────────────────────────────────────────────────────────────────────────
  test('T5: deduct exceeds existing LCB balance → INSUFFICIENT_BALANCE, no side effects', async () => {
    await resetState();
    // Seed LCB with 30 minutes.
    const seedResult = await grantCredits({
      sql,
      learnerId: testLearnerId,
      instructorId: INSTRUCTOR_ID,
      schoolId: SCHOOL_ID,
      credits: 1, minutes: 30, amountPence: 1650, paymentMethod: 'card',
      sessionId: freshSessionId('t5-seed'), stripeFeePence: 75,
      effectiveRatePencePerMinute: 55,
    });
    expect(seedResult.balanceMinutes).toBe(30);

    const ledgerBefore = await sql`SELECT id FROM credit_transactions WHERE learner_id = ${testLearnerId}`;
    expect(ledgerBefore).toHaveLength(1);

    // Attempt to deduct 60 minutes (more than the 30 we have).
    const result = await lockBalanceAndMutate(sql, {
      learnerId: testLearnerId,
      instructorId: INSTRUCTOR_ID,
      schoolId: SCHOOL_ID,
      delta: -60,
      ledgerType: 'slot_purchase',
      reason: 't5 insufficient existing',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('INSUFFICIENT_BALANCE');
    expect(result.balanceMinutes).toBe(30);
    expect(result.transactionId).toBeNull();

    // No new ledger row.
    const ledgerAfter = await sql`SELECT id FROM credit_transactions WHERE learner_id = ${testLearnerId}`;
    expect(ledgerAfter).toHaveLength(1); // still just the seed

    // LCB unchanged.
    const [lcb] = await sql`
      SELECT balance_minutes FROM learner_credit_balances
       WHERE learner_id = ${testLearnerId} AND instructor_id = ${INSTRUCTOR_ID}
    `;
    expect(lcb.balance_minutes).toBe(30);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T6: Deduct against missing LCB row → INSUFFICIENT_BALANCE.
  // ───────────────────────────────────────────────────────────────────────────
  // Per the agreed contract (see commit 1): a deduct against a pair that
  // has never been credited is INSUFFICIENT_BALANCE, not LEARNER_NOT_FOUND.
  // The pair never having received credit is treated as "balance is 0".
  test('T6: deduct against missing LCB row → INSUFFICIENT_BALANCE, no row materialised, no ledger row', async () => {
    await resetState();

    // Pre-condition: no LCB row exists for this pair.
    const preRows = await sql`
      SELECT 1 FROM learner_credit_balances
       WHERE learner_id = ${testLearnerId} AND instructor_id = ${INSTRUCTOR_ID}
    `;
    expect(preRows).toHaveLength(0);

    const result = await lockBalanceAndMutate(sql, {
      learnerId: testLearnerId,
      instructorId: INSTRUCTOR_ID,
      schoolId: SCHOOL_ID,
      delta: -30,
      ledgerType: 'slot_purchase',
      reason: 't6 missing LCB row',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('INSUFFICIENT_BALANCE');
    expect(result.transactionId).toBeNull();
    // balanceMinutes is null because the LCB row never existed.
    expect(result.balanceMinutes).toBeNull();

    // No LCB row materialised.
    const postRows = await sql`
      SELECT 1 FROM learner_credit_balances
       WHERE learner_id = ${testLearnerId} AND instructor_id = ${INSTRUCTOR_ID}
    `;
    expect(postRows).toHaveLength(0);

    // No ledger row written.
    const ledger = await sql`SELECT id FROM credit_transactions WHERE learner_id = ${testLearnerId}`;
    expect(ledger).toHaveLength(0);
  });
});
