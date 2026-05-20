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
  lockBalanceAndMutate,
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
    // Match the Phase-2A CTE (ensured + locked + reconcile against LCB).
    if (text.includes('WITH ensured AS') && text.includes('learner_credit_balances')) {
      return Promise.resolve([{
        balance_minutes: 90,
        transaction_id: 42,
        already_processed: false,
      }]);
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
  // post-Step-4 behaviour. With Step 4 commit 1 in place, grantCreditsPhase2A
  // is real — it issues the LCB-locking CTE. The mock matches that CTE shape
  // and returns a canned row, so calls SHOULD succeed and the assertion is
  // "the dispatcher reached the Phase-2A CTE."
  test('PHASE_2A_IMPLEMENTED=true + schema has Phase-2A columns → routes to Phase 2A CTE', async () => {
    _setPhase2AImplementedForTests(true);
    const { sql, calls } = makeMockSql({ phase2aSchemaExists: true });

    const result = await grantCredits({ sql, ...baseArgs, instructorId: 1 });

    expect(result.ok).toBe(true);
    expect(calls.some(c => c.text.includes('WITH ensured AS') && c.text.includes('learner_credit_balances'))).toBe(true);
    // And NOT the Pre-2A CTE.
    expect(calls.some(c => c.text.includes('WITH locked AS') && c.text.includes('INSERT INTO credit_transactions'))).toBe(false);
  });

  test('PHASE_2A_IMPLEMENTED=true + env var set, schema lacks columns → routes to Phase 2A (env-var override)', async () => {
    _setPhase2AImplementedForTests(true);
    process.env.PER_INSTRUCTOR_CREDITS_PHASE_2A = '1';
    const { sql, calls } = makeMockSql({ phase2aSchemaExists: false });

    // Env var alone is enough to flip the secondary check, once the master
    // switch allows it. This is the "eager override" path the plan calls
    // for (PER-INSTRUCTOR-CREDITS-PLAN.md L225).
    const result = await grantCredits({ sql, ...baseArgs, instructorId: 1 });
    expect(result.ok).toBe(true);
    expect(calls.some(c => c.text.includes('WITH ensured AS'))).toBe(true);
  });

  test('PHASE_2A_IMPLEMENTED=true + schema present + missing instructorId → grandfather to id=1 (legacy_pre_cutover)', async () => {
    _setPhase2AImplementedForTests(true);
    const { sql, calls } = makeMockSql({ phase2aSchemaExists: true });

    // Capture console.warn so the test doesn't pollute output.
    const origWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => { warnings.push(args.join(' ')); };
    try {
      const result = await grantCredits({ sql, ...baseArgs }); // no instructorId
      expect(result.ok).toBe(true);
      expect(result.legacyPreCutover).toBe(true);
      expect(result.instructorId).toBe(1);
      // The CTE's bound values include instructorId=1.
      const phase2ACall = calls.find(c => c.text.includes('WITH ensured AS'));
      expect(phase2ACall).toBeTruthy();
      expect(phase2ACall.values).toContain(1);
      expect(warnings.some(w => w.includes('legacy_pre_cutover'))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // P1 regression (PR #174 review): the Phase 2A CTE must NOT use the
  // ensured + separate `locked AS (... FOR UPDATE)` pattern. That pattern
  // silently fails first-ever LCB writes because data-modifying CTEs share
  // one snapshot. The fix collapses them into a single
  // INSERT ... ON CONFLICT DO UPDATE ... RETURNING clause. This test asserts
  // the SQL text shape — if anyone reintroduces a separate locked CTE,
  // this fails.
  // ───────────────────────────────────────────────────────────────────────────
  test('P1 regression — Phase 2A CTE uses ON CONFLICT DO UPDATE, not separate locked CTE', async () => {
    _setPhase2AImplementedForTests(true);
    const { sql, calls } = makeMockSql({ phase2aSchemaExists: true });

    await grantCredits({ sql, ...baseArgs, instructorId: 1 });

    const phase2ACall = calls.find(c => c.text.includes('WITH ensured AS') && c.text.includes('learner_credit_balances'));
    expect(phase2ACall).toBeTruthy();
    // ON CONFLICT DO UPDATE is the new pattern.
    expect(phase2ACall.text).toContain('ON CONFLICT (learner_id, instructor_id) DO UPDATE');
    // No separate "locked AS (... FOR UPDATE)" CTE in the Phase 2A SQL —
    // ensured's RETURNING + the implicit row lock on DO UPDATE replaces it.
    // (We allow FOR UPDATE in the Pre-2A path's `WITH locked AS`, but the
    // Phase 2A call shouldn't contain that exact construct.)
    expect(phase2ACall.text).not.toMatch(/locked AS \(\s*SELECT[^)]*FROM learner_credit_balances[^)]*FOR UPDATE/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // P1 round-2 regression (PR #174 review): the Phase 2A reconcile CTE used
  // to scan credit_transactions in a sibling CTE after `inserted` had
  // already INSERTed into the same table. Data-modifying CTEs share one
  // snapshot, so sibling table scans don't see the new row — first-ever
  // grants/deducts/admin-adds would set balance_minutes to 0 (existing sum)
  // and lose the just-inserted minutes. Fix: split into granted_existing
  // (table scan, excludes new row) + granted_new (FROM inserted, sees new
  // row via the CTE alias).
  // ───────────────────────────────────────────────────────────────────────────
  test('P1 round-2 regression — Phase 2A reconcile splits granted_existing + granted_new', async () => {
    _setPhase2AImplementedForTests(true);
    const { sql, calls } = makeMockSql({ phase2aSchemaExists: true });

    await grantCredits({ sql, ...baseArgs, instructorId: 1 });

    const phase2ACall = calls.find(c => c.text.includes('WITH ensured AS') && c.text.includes('learner_credit_balances'));
    expect(phase2ACall).toBeTruthy();
    // The new shape has BOTH granted_existing AND granted_new CTEs.
    expect(phase2ACall.text).toMatch(/granted_existing AS \(/);
    expect(phase2ACall.text).toMatch(/granted_new AS \(\s*SELECT[\s\S]*?FROM inserted\s*\)/);
    // And the UPDATE uses both: SUM = granted_existing + granted_new - drawn - adjusted.
    expect(phase2ACall.text).toMatch(/granted_existing[\s\S]*\+[\s\S]*granted_new/);
    // The old `granted AS (SELECT SUM(minutes) FROM credit_transactions WHERE ...)`
    // monolithic CTE must NOT appear by itself (we still have the named CTEs
    // granted_existing and granted_new, but no bare "WITH granted AS" or
    // ", granted AS" pattern).
    expect(phase2ACall.text).not.toMatch(/,\s*granted AS \(/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // P2 regression (PR #174 review): verify-session must propagate
  // instructor_id + effective_rate_pence_per_minute + paymentIntentId to
  // grantCredits. We exercise the grantCredits args directly here; the
  // routing test confirms the bound values reach the SQL.
  // ───────────────────────────────────────────────────────────────────────────
  test('P2 regression — Phase 2A grant accepts instructor_id, effective rate, payment_intent_id', async () => {
    _setPhase2AImplementedForTests(true);
    const { sql, calls } = makeMockSql({ phase2aSchemaExists: true });

    const result = await grantCredits({
      sql,
      ...baseArgs,
      instructorId: 7,
      effectiveRatePencePerMinute: 92,
      paymentIntentId: 'pi_test_p2',
    });

    expect(result.ok).toBe(true);
    expect(result.legacyPreCutover).toBe(false);
    expect(result.instructorId).toBe(7);

    // The bound values include all three Phase-2A fields.
    const phase2ACall = calls.find(c => c.text.includes('WITH ensured AS'));
    expect(phase2ACall).toBeTruthy();
    expect(phase2ACall.values).toContain(7);   // instructorId
    expect(phase2ACall.values).toContain(92);  // effectiveRatePencePerMinute
    expect(phase2ACall.values).toContain('pi_test_p2');
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

// ──────────────────────────────────────────────────────────────────────────────
// lockBalanceAndMutate — dispatcher-routing tests
// ──────────────────────────────────────────────────────────────────────────────
// Same gating story as grantCredits(): PHASE_2A_IMPLEMENTED is the master
// switch; env var / schema check are secondary signals. The Pre-2A path
// locks learner_users + writes balance_minutes; the Phase-2A path locks
// LCB + reconciles via the ledger SUM.

function makeMutateMockSql({ phase2aSchemaExists, mode }) {
  // mode: 'ok' → CTE returns a row (success);
  //       'no-row' + 'learner-found-with-balance' → CTE returns nothing,
  //         disambiguation query returns a learner row;
  //       'no-row' + 'learner-missing' → CTE + disambiguation both return [].
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    if (text.includes('information_schema.columns')) {
      return Promise.resolve(phase2aSchemaExists ? [{ '?column?': 1 }] : []);
    }
    // Phase 2A CTE.
    if (text.includes('WITH ensured AS') && text.includes('learner_credit_balances')) {
      if (mode === 'ok') return Promise.resolve([{ balance_minutes: 120, transaction_id: 7 }]);
      // no-row paths trigger disambiguation query
      return Promise.resolve([]);
    }
    // Pre-2A CTE.
    if (text.includes('WITH locked AS') && text.includes('INSERT INTO credit_transactions')) {
      if (mode === 'ok') return Promise.resolve([{ balance_minutes: 120, transaction_id: 7 }]);
      return Promise.resolve([]);
    }
    // Disambiguation read.
    if (text.includes('SELECT balance_minutes') && text.includes('FROM learner_users')) {
      return Promise.resolve(mode === 'learner-missing' ? [] : [{ balance_minutes: 30 }]);
    }
    if (text.includes('SELECT balance_minutes') && text.includes('FROM learner_credit_balances')) {
      return Promise.resolve([{ balance_minutes: 30 }]);
    }
    return Promise.resolve([]);
  };
  return { sql, calls };
}

test.describe('lockBalanceAndMutate dispatcher', () => {

  test.beforeEach(() => {
    _resetPhaseDetectionForTests();
    _setPhase2AImplementedForTests(false);
    delete process.env.PER_INSTRUCTOR_CREDITS_PHASE_2A;
  });

  test.afterAll(() => {
    _resetPhaseDetectionForTests();
    _setPhase2AImplementedForTests(false);
    delete process.env.PER_INSTRUCTOR_CREDITS_PHASE_2A;
  });

  const baseMutateArgs = {
    learnerId: 1,
    schoolId: 1,
    delta: 60,
    ledgerType: 'admin_add',
    reason: 'manual top-up',
  };

  test('PHASE_2A_IMPLEMENTED=false → routes to Pre-2A (locks learner_users)', async () => {
    const { sql, calls } = makeMutateMockSql({ phase2aSchemaExists: true, mode: 'ok' });
    const result = await lockBalanceAndMutate(sql, baseMutateArgs);
    expect(result.ok).toBe(true);
    expect(result.balanceMinutes).toBe(120);
    expect(calls.some(c => c.text.includes('WITH locked AS') && c.text.includes('FROM learner_users'))).toBe(true);
    // Did NOT touch the LCB CTE.
    expect(calls.some(c => c.text.includes('WITH ensured AS'))).toBe(false);
  });

  test('PHASE_2A_IMPLEMENTED=true + schema present → routes to Phase 2A LCB CTE', async () => {
    _setPhase2AImplementedForTests(true);
    const { sql, calls } = makeMutateMockSql({ phase2aSchemaExists: true, mode: 'ok' });
    const result = await lockBalanceAndMutate(sql, { ...baseMutateArgs, instructorId: 1 });
    expect(result.ok).toBe(true);
    expect(result.instructorId).toBe(1);
    expect(calls.some(c => c.text.includes('WITH ensured AS') && c.text.includes('learner_credit_balances'))).toBe(true);
  });

  test('Pre-2A INSUFFICIENT_BALANCE: CTE returns no row + learner exists', async () => {
    const { sql } = makeMutateMockSql({ phase2aSchemaExists: false, mode: 'learner-found-with-balance' });
    const result = await lockBalanceAndMutate(sql, { ...baseMutateArgs, delta: -120 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INSUFFICIENT_BALANCE');
    expect(result.balanceMinutes).toBe(30);
  });

  test('Pre-2A LEARNER_NOT_FOUND: CTE returns no row + learner missing', async () => {
    const { sql } = makeMutateMockSql({ phase2aSchemaExists: false, mode: 'learner-missing' });
    const result = await lockBalanceAndMutate(sql, { ...baseMutateArgs, delta: 30 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('LEARNER_NOT_FOUND');
  });

  test('rejects invalid ledgerType', async () => {
    const { sql } = makeMutateMockSql({ phase2aSchemaExists: false, mode: 'ok' });
    await expect(
      lockBalanceAndMutate(sql, { ...baseMutateArgs, ledgerType: 'made_up_type' })
    ).rejects.toThrow(/ledgerType must be one of/);
  });

  test('rejects zero delta', async () => {
    const { sql } = makeMutateMockSql({ phase2aSchemaExists: false, mode: 'ok' });
    await expect(
      lockBalanceAndMutate(sql, { ...baseMutateArgs, delta: 0 })
    ).rejects.toThrow(/non-zero integer/);
  });

  test('Phase 2A grandfathers missing instructorId to id=1', async () => {
    _setPhase2AImplementedForTests(true);
    const { sql, calls } = makeMutateMockSql({ phase2aSchemaExists: true, mode: 'ok' });

    const origWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => { warnings.push(args.join(' ')); };
    try {
      const result = await lockBalanceAndMutate(sql, baseMutateArgs); // no instructorId
      expect(result.ok).toBe(true);
      expect(result.instructorId).toBe(1);
      // The Phase-2A CTE was actually called and instructorId=1 made it into the bound values.
      const ctaCall = calls.find(c => c.text.includes('WITH ensured AS'));
      expect(ctaCall).toBeTruthy();
      expect(ctaCall.values).toContain(1);
      expect(warnings.some(w => w.includes('legacy_pre_cutover'))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });
});
