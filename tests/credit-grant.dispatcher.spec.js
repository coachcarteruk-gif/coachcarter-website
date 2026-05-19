// @ts-check
// Dispatcher-routing tests for api/_credit-grant.js grantCredits().
//
// Why this file is separate from credit-grant.integration.spec.js:
//   The integration spec tests SQL semantics against a real Neon test
//   branch (gated on POSTGRES_URL_TEST + CC_TEST_DB=1). These tests test
//   the dispatcher's routing logic — which variant gets called given a
//   combination of PHASE_2A_IMPLEMENTED, env var, and schema state. No
//   real database needed; we mock the sql client.
//
// This was the gap caught in PR #166 code review:
//   "[P1] api/_credit-grant.js:218 auto-enables Phase 2A as soon as
//    credit_transactions.instructor_id exists, but grantCreditsPhase2A()
//    is still a throwing stub at :333. That means the additive Step 2 DDL
//    would immediately break all credit purchases/verify/webhook grants
//    before the Step 4 implementation lands."
//
// The fix: a PHASE_2A_IMPLEMENTED constant in the helper that gates the
// dispatcher. Until Step 4 ships, the constant is false and the dispatcher
// short-circuits to Pre-2A regardless of schema state or env-var override.
//
// The previous integration tests call grantCreditsPre2A() directly, which
// bypasses the dispatcher entirely — so they didn't catch the bug. These
// tests exercise grantCredits() (the dispatcher) explicitly.

const { test, expect } = require('@playwright/test');
const {
  grantCredits,
  _resetPhaseDetectionForTests,
  _setPhase2AImplementedForTests,
} = require('../api/_credit-grant');

// Mock sql client. The mock returns canned responses for the two query
// shapes the dispatcher might issue:
//   - information_schema check (for hasPhase2ASchema). Returns either [{}]
//     (column exists) or [] (column missing) depending on the test.
//   - The actual grant CTE. Returns a synthetic row so grantCreditsPre2A
//     returns ok=true. The exact values aren't important — what we're
//     testing is which variant got called.
//
// We track every call's SQL text so a test can assert "the dispatcher
// reached the Pre-2A CTE" vs "the dispatcher reached information_schema
// only" vs "the dispatcher tried Phase 2A and threw".
function makeMockSql({ phase2aSchemaExists }) {
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    // Match the information_schema check.
    if (text.includes('information_schema.columns')) {
      return Promise.resolve(phase2aSchemaExists ? [{ '?column?': 1 }] : []);
    }
    // Match the Pre-2A CTE (or anything else — synthetic row for the grant).
    if (text.includes('WITH locked AS') && text.includes('INSERT INTO credit_transactions')) {
      return Promise.resolve([{
        credit_balance: 1,
        balance_minutes: 90,
        transaction_id: 42,
        already_processed: false,
      }]);
    }
    return Promise.resolve([]);
  };
  return { sql, calls };
}

const baseArgs = {
  learnerId: 1,
  schoolId: 1,
  credits: 1,
  minutes: 90,
  amountPence: 4950,
  paymentMethod: 'card',
  sessionId: 'cs_test_dispatcher',
  stripeFeePence: 250,
};

test.describe('grantCredits dispatcher — PHASE_2A_IMPLEMENTED gate', () => {

  test.beforeEach(() => {
    // Each test starts with a clean phase-detection cache and the master
    // switch in its production default (false). Tests that need to flip
    // the switch do so explicitly.
    _resetPhaseDetectionForTests();
    _setPhase2AImplementedForTests(false);
    delete process.env.PER_INSTRUCTOR_CREDITS_PHASE_2A;
  });

  test.afterAll(() => {
    // Belt-and-braces — restore module state for any later tests in the
    // same Node process.
    _resetPhaseDetectionForTests();
    _setPhase2AImplementedForTests(false);
    delete process.env.PER_INSTRUCTOR_CREDITS_PHASE_2A;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The bug being fixed.
  // ───────────────────────────────────────────────────────────────────────────
  //
  // Before the fix: schema has instructor_id column → hasPhase2ASchema()
  // returns true → dispatcher calls grantCreditsPhase2A() → stub throws.
  //
  // After the fix: PHASE_2A_IMPLEMENTED is false → dispatcher short-circuits
  // to Pre-2A regardless. Schema state is irrelevant until Step 4 ships.
  test('PHASE_2A_IMPLEMENTED=false + schema has Phase-2A columns → routes to Pre-2A (the fix)', async () => {
    const { sql, calls } = makeMockSql({ phase2aSchemaExists: true });

    // Even with the schema looking Phase-2A-ready, the dispatcher must NOT
    // call grantCreditsPhase2A (which would throw because the stub).
    const result = await grantCredits({ sql, ...baseArgs });

    expect(result.ok).toBe(true);
    // The dispatcher reached the Pre-2A CTE. The information_schema check
    // should NOT have been issued — it's gated behind PHASE_2A_IMPLEMENTED
    // and short-circuited before reaching schema detection.
    expect(calls.some(c => c.text.includes('information_schema.columns'))).toBe(false);
    expect(calls.some(c => c.text.includes('WITH locked AS'))).toBe(true);
  });

  test('PHASE_2A_IMPLEMENTED=false + env var set → still routes to Pre-2A', async () => {
    process.env.PER_INSTRUCTOR_CREDITS_PHASE_2A = '1';
    const { sql, calls } = makeMockSql({ phase2aSchemaExists: true });

    // The env-var override is a *secondary* signal — it can only have
    // effect when the master switch allows Phase 2A. With the switch off,
    // env var is ignored.
    const result = await grantCredits({ sql, ...baseArgs });

    expect(result.ok).toBe(true);
    expect(calls.some(c => c.text.includes('WITH locked AS'))).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The future state: Step 4 has shipped, PHASE_2A_IMPLEMENTED=true.
  // ───────────────────────────────────────────────────────────────────────────
  //
  // These tests use _setPhase2AImplementedForTests(true) to simulate
  // post-Step-4 behaviour. The Phase 2A function is still a stub at this
  // point in the codebase, so calls SHOULD throw — which is the correct
  // signal that the dispatcher routed to it.
  test('PHASE_2A_IMPLEMENTED=true + schema has Phase-2A columns → routes to Phase 2A (which currently throws)', async () => {
    _setPhase2AImplementedForTests(true);
    const { sql } = makeMockSql({ phase2aSchemaExists: true });

    await expect(grantCredits({ sql, ...baseArgs }))
      .rejects.toThrow(/grantCreditsPhase2A is a stub/);
  });

  test('PHASE_2A_IMPLEMENTED=true + env var set, schema lacks columns → routes to Phase 2A (env-var override)', async () => {
    _setPhase2AImplementedForTests(true);
    process.env.PER_INSTRUCTOR_CREDITS_PHASE_2A = '1';
    const { sql } = makeMockSql({ phase2aSchemaExists: false });

    // Env var alone is enough to flip the secondary check, once the master
    // switch allows it. This is the "eager override" path the plan calls
    // for (PER-INSTRUCTOR-CREDITS-PLAN.md L225).
    await expect(grantCredits({ sql, ...baseArgs }))
      .rejects.toThrow(/grantCreditsPhase2A is a stub/);
  });

  test('PHASE_2A_IMPLEMENTED=true + neither env var nor schema → routes to Pre-2A', async () => {
    _setPhase2AImplementedForTests(true);
    const { sql, calls } = makeMockSql({ phase2aSchemaExists: false });

    // Switch is on, but neither secondary signal says Phase 2A is wanted.
    // Pre-2A is the default landing.
    const result = await grantCredits({ sql, ...baseArgs });

    expect(result.ok).toBe(true);
    // The dispatcher DID query information_schema this time (because the
    // master switch let it through). It found no column. So it routed to
    // Pre-2A.
    expect(calls.some(c => c.text.includes('information_schema.columns'))).toBe(true);
    expect(calls.some(c => c.text.includes('WITH locked AS'))).toBe(true);
  });
});
