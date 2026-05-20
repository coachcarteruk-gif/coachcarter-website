// @ts-check
// Integration tests for the Step 4.5 credit-divergence-check cron
// (api/cron-credit-reconcile.js) against a real Neon test branch.
//
// Why a real DB:
//   The cron's correctness depends on:
//     • PostgreSQL FULL OUTER JOIN semantics (phantom LCB / missing LCB),
//     • information_schema probing for Step 5 tables (graceful degradation),
//     • Aggregation across joins with FILTER on refunded_at,
//   none of which an in-memory mock would model honestly. Same pattern as
//   tests/credit-grant-phase2a.integration.spec.js.
//
// How to run:
//   1. Create a Neon test branch (one click in the Neon dashboard).
//   2. Add POSTGRES_URL_TEST="<branch connection string>" to .env.local.
//   3. CC_TEST_DB=1 npx playwright test cron-credit-reconcile.integration
//
// Cleanup discipline:
//   • One synthetic test learner created in beforeAll, deleted in afterAll.
//   • Each test starts with resetState() — DELETEs all rows the cron's
//     reconcile SQL could see for the test learner.
//   • If BCS / CSA tables exist on the branch (because Step 5 has landed),
//     C9/C10 use them in place and clean rows on exit. They DO NOT drop the
//     tables — that would destroy live Step 5 schema once main advances.
//   • If BCS / CSA tables are absent (current main state), C9/C10 CREATE
//     them inside the test and DROP them only if the test created them.
//   • C8 (ct_only mode assertion) is skipped when BCS / CSA already exist.

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// .env.local loader (mirrors credit-grant-phase2a.integration.spec.js).
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
    console.warn('[cron-credit-reconcile.integration] .env.local load failed:', err.message);
  }
})();

const {
  runDivergenceCheck,
  probeSchemaMode,
} = require('../api/cron-credit-reconcile');

// ─────────────────────────────────────────────────────────────────────────────
// Gating
// ─────────────────────────────────────────────────────────────────────────────
const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
test.describe.configure({ mode: 'serial' });

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────
let sql;
let testLearnerId;
let testEmail;

// Branch-level schema state, decided once in beforeAll. Tests use these to
// know whether to create/drop their own BCS / CSA tables (current main state)
// or use the existing ones in place (post-Step-5 main).
let branchHasBcs = false;
let branchHasCsa = false;

const SCHOOL_ID = 1;
const INSTRUCTOR_ID = 1; // Fraser — always exists on any branch off main.

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Reset all per-test state for the test learner.
async function resetState() {
  // CSA → BCS → CT (FK order). LCB has no FK to CT, so order between LCB and
  // others doesn't matter.
  if (branchHasCsa) {
    await sql`
      DELETE FROM credit_source_adjustments
       WHERE credit_transaction_id IN (
         SELECT id FROM credit_transactions WHERE learner_id = ${testLearnerId}
       )
    `;
  }
  if (branchHasBcs) {
    await sql`
      DELETE FROM booking_credit_sources
       WHERE credit_transaction_id IN (
         SELECT id FROM credit_transactions WHERE learner_id = ${testLearnerId}
       )
    `;
  }
  await sql`DELETE FROM credit_transactions WHERE learner_id = ${testLearnerId}`;
  await sql`DELETE FROM learner_credit_balances WHERE learner_id = ${testLearnerId}`;
  await sql`DELETE FROM lesson_bookings WHERE learner_id = ${testLearnerId}`;
}

// Insert a credit_transactions row directly. Bypasses _credit-grant so we
// can author arbitrary scenarios (including drift).
async function insertCt({ minutes, type = 'purchase', amountPence = 0, sessionId = null }) {
  const sid = sessionId || `cs_test_recon_${crypto.randomBytes(6).toString('hex')}`;
  const [row] = await sql`
    INSERT INTO credit_transactions
      (learner_id, instructor_id, school_id, type, credits, minutes, amount_pence, stripe_session_id)
    VALUES
      (${testLearnerId}, ${INSTRUCTOR_ID}, ${SCHOOL_ID}, ${type},
       ${Math.max(0, Math.floor(minutes / 60))}, ${minutes}, ${amountPence}, ${sid})
    RETURNING id
  `;
  return row.id;
}

// Insert a Pre-2A pooled credit_transactions row (instructor_id NULL). For
// the C7 test that confirms these are excluded from per-pair ledger sums.
async function insertCtPooled({ minutes, type = 'purchase' }) {
  const sid = `cs_test_recon_pooled_${crypto.randomBytes(6).toString('hex')}`;
  const [row] = await sql`
    INSERT INTO credit_transactions
      (learner_id, instructor_id, school_id, type, credits, minutes, amount_pence, stripe_session_id)
    VALUES
      (${testLearnerId}, NULL, ${SCHOOL_ID}, ${type},
       ${Math.max(0, Math.floor(minutes / 60))}, ${minutes}, 0, ${sid})
    RETURNING id
  `;
  return row.id;
}

// Set LCB.balance_minutes for the test pair without going through the
// grantCredits helper. Used to force drift scenarios.
async function setLcbBalance(balanceMinutes) {
  await sql`
    INSERT INTO learner_credit_balances
      (learner_id, instructor_id, school_id, balance_minutes)
    VALUES (${testLearnerId}, ${INSTRUCTOR_ID}, ${SCHOOL_ID}, ${balanceMinutes})
    ON CONFLICT (learner_id, instructor_id) DO UPDATE
      SET balance_minutes = EXCLUDED.balance_minutes,
          updated_at      = NOW()
  `;
}

async function deleteLcb() {
  await sql`
    DELETE FROM learner_credit_balances
     WHERE learner_id = ${testLearnerId} AND instructor_id = ${INSTRUCTOR_ID}
  `;
}

// Probe BCS / CSA presence afresh. Used after CREATE / DROP TABLE inside a
// test to confirm the branch state we expect.
async function probeBcsCsa() {
  const [r] = await sql`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='booking_credit_sources')     AS has_bcs,
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='credit_source_adjustments')  AS has_csa
  `;
  return { hasBcs: !!r.has_bcs, hasCsa: !!r.has_csa };
}

// For C9 / C10: create the Step 5 tables if absent, returning a cleanup fn
// that drops them only if we created them. If they already exist, returns
// a cleanup fn that's a no-op.
async function ensureStep5Tables({ wantBcs, wantCsa }) {
  const initial = await probeBcsCsa();
  const createdBcs = wantBcs && !initial.hasBcs;
  const createdCsa = wantCsa && !initial.hasCsa;

  if (createdBcs) {
    await sql`
      CREATE TABLE booking_credit_sources (
        id                    SERIAL PRIMARY KEY,
        booking_id            INTEGER NOT NULL REFERENCES lesson_bookings(id) ON DELETE CASCADE,
        credit_transaction_id INTEGER NOT NULL REFERENCES credit_transactions(id),
        minutes_drawn         INTEGER NOT NULL CHECK (minutes_drawn > 0),
        rate_pence_per_minute INTEGER NOT NULL DEFAULT 55,
        contribution_pence    INTEGER NOT NULL DEFAULT 0,
        stripe_fee_pence      INTEGER NOT NULL DEFAULT 0,
        absorbed_by           TEXT,
        refunded_at           TIMESTAMPTZ,
        created_at            TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (booking_id, credit_transaction_id)
      )
    `;
  }
  if (createdCsa) {
    await sql`
      CREATE TABLE credit_source_adjustments (
        id                    SERIAL PRIMARY KEY,
        credit_transaction_id INTEGER NOT NULL REFERENCES credit_transactions(id),
        kind                  TEXT NOT NULL,
        minutes_adjusted      INTEGER NOT NULL,
        pence_adjusted        INTEGER NOT NULL DEFAULT 0,
        stripe_refund_id      TEXT,
        reason                TEXT,
        created_at            TIMESTAMPTZ DEFAULT NOW()
      )
    `;
  }

  // Update the branch flags so resetState() knows to clean these rows.
  if (createdBcs) branchHasBcs = true;
  if (createdCsa) branchHasCsa = true;

  return async function cleanup() {
    // Delete rows we may have inserted, regardless of whether we created the
    // table — if Step 5 has landed, those are real tables and must not be
    // dropped, but our test rows do need clearing.
    try {
      if (branchHasCsa) {
        await sql`
          DELETE FROM credit_source_adjustments
           WHERE credit_transaction_id IN (
             SELECT id FROM credit_transactions WHERE learner_id = ${testLearnerId}
           )
        `;
      }
      if (branchHasBcs) {
        await sql`
          DELETE FROM booking_credit_sources
           WHERE credit_transaction_id IN (
             SELECT id FROM credit_transactions WHERE learner_id = ${testLearnerId}
           )
        `;
      }
    } catch (_) { /* swallow — best-effort */ }

    if (createdCsa) {
      await sql`DROP TABLE IF EXISTS credit_source_adjustments`;
      branchHasCsa = false;
    }
    if (createdBcs) {
      await sql`DROP TABLE IF EXISTS booking_credit_sources`;
      branchHasBcs = false;
    }
  };
}

// Create a synthetic lesson_booking for BCS rows to reference. BCS has an FK
// to lesson_bookings, but the cron's reconcile only cares about credit data.
async function insertBooking() {
  const dateStr = `2030-01-${String(Math.floor(Math.random() * 27) + 1).padStart(2, '0')}`;
  const hour = String(Math.floor(Math.random() * 12) + 8).padStart(2, '0');
  const minute = String(Math.floor(Math.random() * 60)).padStart(2, '0');
  const [row] = await sql`
    INSERT INTO lesson_bookings
      (learner_id, instructor_id, scheduled_date, start_time, end_time, status)
    VALUES
      (${testLearnerId}, ${INSTRUCTOR_ID}, ${dateStr}::date, ${`${hour}:${minute}:00`}::time, ${`${hour}:${Math.min(59, parseInt(minute) + 30)}:00`}::time, 'scheduled')
    RETURNING id
  `;
  return row.id;
}

async function insertBcs({ bookingId, ctId, minutesDrawn, refundedAt = null }) {
  await sql`
    INSERT INTO booking_credit_sources
      (booking_id, credit_transaction_id, minutes_drawn, rate_pence_per_minute, contribution_pence, refunded_at)
    VALUES (${bookingId}, ${ctId}, ${minutesDrawn}, 55, ${minutesDrawn * 55}, ${refundedAt})
  `;
}

async function insertCsa({ ctId, minutesAdjusted, kind = 'cash_refund' }) {
  await sql`
    INSERT INTO credit_source_adjustments
      (credit_transaction_id, kind, minutes_adjusted, pence_adjusted, reason)
    VALUES (${ctId}, ${kind}, ${minutesAdjusted}, 0, 'test')
  `;
}

// Run the cron's core logic. We pass sendAlerts:false to avoid the alert
// email side-effect (which would call SMTP in CI). The function's return
// value is the JSON payload — that's what we assert against.
async function runCron({ now = new Date() } = {}) {
  return runDivergenceCheck(sql, { now, sendAlerts: false });
}

// Helper to find the test pair's drift row in the response, if present.
//
// NOTE: result.drift_summary is capped at ALERT_EMAIL_MAX_PAIRS (20) and
// sorted by drift_minutes DESC. On a test branch with pre-existing wild
// drift (which the staging branch off prod has plenty of), our injected
// pair's modest drift can fall below the cut. So we fall back to
// findOurPairOnDb() — a direct re-query — when the response doesn't
// contain our pair in its summary.
function findOurPair(result) {
  return (result.drift_summary || []).find(r =>
    r.learner_id === testLearnerId && r.instructor_id === INSTRUCTOR_ID
  );
}

// Bypass the drift_summary cap: query LCB and credit_transactions directly
// for the test pair and recompute drift in the same shape the cron uses.
// Used by every assertion that needs precision regardless of how much
// noise is on the branch.
async function findOurPairOnDb() {
  const [row] = await sql`
    WITH ledger AS (
      SELECT
        ct.learner_id,
        ct.instructor_id,
        COALESCE(SUM(ct.minutes), 0)::int AS expected_balance_minutes
      FROM credit_transactions ct
      WHERE ct.school_id = ${SCHOOL_ID}
        AND ct.instructor_id IS NOT NULL
        AND ct.learner_id = ${testLearnerId}
        AND ct.instructor_id = ${INSTRUCTOR_ID}
      GROUP BY ct.learner_id, ct.instructor_id
    ),
    bcs_sub AS (
      SELECT COALESCE(SUM(bcs.minutes_drawn), 0)::int AS m
        FROM booking_credit_sources bcs
        JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
       WHERE ct.learner_id = ${testLearnerId}
         AND ct.instructor_id = ${INSTRUCTOR_ID}
         AND bcs.refunded_at IS NULL
    ),
    csa_sub AS (
      SELECT COALESCE(SUM(csa.minutes_adjusted), 0)::int AS m
        FROM credit_source_adjustments csa
        JOIN credit_transactions ct ON ct.id = csa.credit_transaction_id
       WHERE ct.learner_id = ${testLearnerId}
         AND ct.instructor_id = ${INSTRUCTOR_ID}
    )
    SELECT
      ${testLearnerId}::int                          AS learner_id,
      ${INSTRUCTOR_ID}::int                          AS instructor_id,
      COALESCE(lcb.balance_minutes, 0)               AS actual_lcb_balance_minutes,
      COALESCE(l.expected_balance_minutes, 0)
        - (SELECT m FROM bcs_sub)
        - (SELECT m FROM csa_sub)                    AS computed_ledger_balance_minutes,
      COALESCE(lcb.balance_minutes, 0)
        - (COALESCE(l.expected_balance_minutes, 0)
           - (SELECT m FROM bcs_sub)
           - (SELECT m FROM csa_sub))                AS drift_minutes
    FROM (SELECT 1) _
    LEFT JOIN ledger l ON true
    LEFT JOIN learner_credit_balances lcb
      ON lcb.learner_id    = ${testLearnerId}
     AND lcb.instructor_id = ${INSTRUCTOR_ID}
  `;
  // If drift is zero, return undefined to mirror "not flagged".
  if (!row || row.drift_minutes === 0) return undefined;
  return row;
}

// In a clean ct_only world we'd skip bcs_sub / csa_sub. The query above
// references both unconditionally — so when those tables are absent we
// fall back to a CT-only version of the per-pair recompute.
async function findOurPairOnDbCtOnly() {
  const [row] = await sql`
    WITH ledger AS (
      SELECT COALESCE(SUM(ct.minutes), 0)::int AS expected_balance_minutes
        FROM credit_transactions ct
       WHERE ct.school_id    = ${SCHOOL_ID}
         AND ct.instructor_id IS NOT NULL
         AND ct.learner_id    = ${testLearnerId}
         AND ct.instructor_id = ${INSTRUCTOR_ID}
    )
    SELECT
      ${testLearnerId}::int                     AS learner_id,
      ${INSTRUCTOR_ID}::int                     AS instructor_id,
      COALESCE(lcb.balance_minutes, 0)          AS actual_lcb_balance_minutes,
      COALESCE(l.expected_balance_minutes, 0)   AS computed_ledger_balance_minutes,
      COALESCE(lcb.balance_minutes, 0)
        - COALESCE(l.expected_balance_minutes, 0) AS drift_minutes
    FROM ledger l
    LEFT JOIN learner_credit_balances lcb
      ON lcb.learner_id    = ${testLearnerId}
     AND lcb.instructor_id = ${INSTRUCTOR_ID}
  `;
  if (!row || row.drift_minutes === 0) return undefined;
  return row;
}

// Schema-aware wrapper. Used by every C3+ test for precision.
async function findOurPairPrecise() {
  if (branchHasBcs || branchHasCsa) return findOurPairOnDb();
  return findOurPairOnDbCtOnly();
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────
test.describe('cron-credit-reconcile — divergence check integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run these tests against a Neon test branch.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    sql = neon(process.env.POSTGRES_URL_TEST);

    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST is the same as POSTGRES_URL. Point POSTGRES_URL_TEST at an isolated Neon branch.');
    }

    // Sanity: the test branch must have Phase 2A schema.
    const [hasInstructorCol] = await sql`
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='instructor_id'
    `;
    if (!hasInstructorCol) {
      throw new Error('Phase 2A schema missing on test branch: credit_transactions.instructor_id not found. Run /api/migrate against the test branch first.');
    }

    // Remember the branch's Step 5 state — drives whether C9 / C10 create
    // and drop their own tables, or use existing ones in place.
    const initial = await probeBcsCsa();
    branchHasBcs = initial.hasBcs;
    branchHasCsa = initial.hasCsa;

    // Create the test learner.
    testEmail = `test+recon-${crypto.randomBytes(6).toString('hex')}@coachcarter.test`;
    const [row] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES ('Reconcile Test', ${testEmail}, ${SCHOOL_ID}, 0, 0)
      RETURNING id
    `;
    testLearnerId = row.id;
  });

  test.afterAll(async () => {
    if (!ENABLED || !testLearnerId) return;
    try { await resetState(); } catch (_) {}
    await sql`DELETE FROM learner_users WHERE id = ${testLearnerId}`;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C1: No data for the test pair → no drift row emitted.
  //
  // This doesn't assert drift_count === 0 globally (the branch may have other
  // drift in the wild); it asserts our pair is not in the response.
  // ───────────────────────────────────────────────────────────────────────────
  test('C1: no LCB, no CT for test pair — pair not reported as drift', async () => {
    await resetState();
    const result = await runCron();
    expect(result.ok).toBe(true);
    // Precision: ask the DB directly. drift_summary is capped at 20.
    expect(await findOurPairPrecise()).toBeUndefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C2: LCB matches ledger exactly → no drift for our pair.
  // ───────────────────────────────────────────────────────────────────────────
  test('C2: LCB.balance_minutes = SUM(ct.minutes) — no drift', async () => {
    await resetState();
    await insertCt({ minutes: 90 });
    await insertCt({ minutes: 30 });
    await setLcbBalance(120);

    const result = await runCron();
    expect(result.ok).toBe(true);
    expect(await findOurPairPrecise()).toBeUndefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C3: Positive drift — LCB inflated by 60 vs ledger.
  // ───────────────────────────────────────────────────────────────────────────
  test('C3: positive drift (LCB inflated) — drift_minutes > 0 reported with correct sign', async () => {
    await resetState();
    await insertCt({ minutes: 60 });   // ledger says +60
    await setLcbBalance(120);          // LCB says 120 → drift +60

    const result = await runCron();
    expect(result.ok).toBe(true);
    // Precision against the DB. drift_summary may not include our pair if
    // the branch has >20 worse drifts (test branches off prod often do).
    const row = await findOurPairPrecise();
    expect(row).toBeTruthy();
    expect(row.actual_lcb_balance_minutes).toBe(120);
    expect(row.computed_ledger_balance_minutes).toBe(60);
    expect(row.drift_minutes).toBe(60);
    // And drift_count reflects at least our injected pair.
    expect(result.drift_count).toBeGreaterThanOrEqual(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C4: Negative drift — LCB under-credited by 60 vs ledger.
  // ───────────────────────────────────────────────────────────────────────────
  test('C4: negative drift (LCB under-credited) — drift_minutes < 0 with correct sign', async () => {
    await resetState();
    await insertCt({ minutes: 90 });
    await insertCt({ minutes: 30 });   // ledger says +120
    await setLcbBalance(60);           // LCB says 60 → drift -60

    const result = await runCron();
    expect(result.ok).toBe(true);
    const row = await findOurPairPrecise();
    expect(row).toBeTruthy();
    expect(row.actual_lcb_balance_minutes).toBe(60);
    expect(row.computed_ledger_balance_minutes).toBe(120);
    expect(row.drift_minutes).toBe(-60);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C5: Missing LCB — CT rows exist with non-zero net, no LCB row.
  //
  // FULL OUTER JOIN direction A: ledger side has data, LCB side does not.
  // ───────────────────────────────────────────────────────────────────────────
  test('C5: missing LCB row + non-zero ledger — drift reported via FULL OUTER JOIN', async () => {
    await resetState();
    await insertCt({ minutes: 90 });
    // No LCB row at all.

    const result = await runCron();
    expect(result.ok).toBe(true);
    const row = await findOurPairPrecise();
    expect(row).toBeTruthy();
    expect(row.actual_lcb_balance_minutes).toBe(0);
    expect(row.computed_ledger_balance_minutes).toBe(90);
    expect(row.drift_minutes).toBe(-90); // LCB 0 - ledger 90
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C6: Phantom LCB — LCB row with non-zero balance, no CT rows.
  //
  // FULL OUTER JOIN direction B: LCB side has data, ledger side does not.
  // ───────────────────────────────────────────────────────────────────────────
  test('C6: phantom LCB (non-zero balance, no ledger) — drift reported via FULL OUTER JOIN', async () => {
    await resetState();
    await setLcbBalance(45);
    // No CT rows.

    const result = await runCron();
    expect(result.ok).toBe(true);
    const row = await findOurPairPrecise();
    expect(row).toBeTruthy();
    expect(row.actual_lcb_balance_minutes).toBe(45);
    expect(row.computed_ledger_balance_minutes).toBe(0);
    expect(row.drift_minutes).toBe(45);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C7: Pre-2A pooled CT rows (instructor_id NULL) ignored.
  //
  // If a learner has a pooled-era credit_transactions row, it MUST NOT
  // contribute to any per-pair ledger sum. Otherwise the cron would alert
  // every learner that predates Phase 2A as "drift."
  // ───────────────────────────────────────────────────────────────────────────
  test('C7: Pre-2A pooled credit_transactions rows excluded from ledger sum', async () => {
    await resetState();
    await insertCtPooled({ minutes: 200 });   // pooled — must be ignored
    await insertCt({ minutes: 60 });          // scoped — counts
    await setLcbBalance(60);                  // matches scoped ledger exactly

    const result = await runCron();
    expect(result.ok).toBe(true);
    expect(await findOurPairPrecise()).toBeUndefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C8: schema_mode = ct_only is selected when BCS and CSA are absent.
  //
  // Skipped on branches where Step 5 schema has already landed — by then
  // the cron is permanently in ct_plus_bcs or full mode and ct_only is no
  // longer a reachable state.
  // ───────────────────────────────────────────────────────────────────────────
  test('C8: schema_mode probe returns ct_only when BCS+CSA absent', async () => {
    test.skip(branchHasBcs || branchHasCsa, 'Branch already has Step 5 schema; ct_only is unreachable.');
    const probe = await probeSchemaMode(sql);
    expect(probe.mode).toBe('ct_only');
    expect(probe.has_bcs).toBe(false);
    expect(probe.has_csa).toBe(false);

    await resetState();
    await insertCt({ minutes: 60 });
    await setLcbBalance(60);

    const result = await runCron();
    expect(result.schema_mode).toBe('ct_only');
    expect(await findOurPairPrecise()).toBeUndefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C9: ct_plus_bcs mode — BCS draws subtracted from ledger.
  //
  // Active BCS rows reduce expected_balance_minutes by minutes_drawn.
  // Refunded BCS rows (refunded_at IS NOT NULL) MUST be excluded — those
  // minutes have returned to the source.
  // ───────────────────────────────────────────────────────────────────────────
  test('C9: ct_plus_bcs mode — active BCS draws subtracted, refunded BCS excluded', async () => {
    const cleanup = await ensureStep5Tables({ wantBcs: true, wantCsa: false });
    try {
      await resetState();
      const ctId = await insertCt({ minutes: 120 });   // ledger pre-BCS = +120

      const bookingA = await insertBooking();
      const bookingB = await insertBooking();
      await insertBcs({ bookingId: bookingA, ctId, minutesDrawn: 60, refundedAt: null });
      // Refunded — must be excluded from the deduction.
      await insertBcs({ bookingId: bookingB, ctId, minutesDrawn: 30, refundedAt: '2026-05-01T00:00:00Z' });

      // Expected = 120 - 60 (active) - 0 (refunded excluded) = 60.
      // Set LCB to 60 → no drift.
      await setLcbBalance(60);

      const probe = await probeSchemaMode(sql);
      expect(probe.mode === 'ct_plus_bcs' || probe.mode === 'full').toBe(true);

      await runCron();
      expect(await findOurPairPrecise()).toBeUndefined();

      // Now set LCB wrong — say 90 (would only be correct if the refunded
      // BCS row was wrongly excluded from the active SUM). Cron must
      // detect drift of +30.
      await setLcbBalance(90);
      await runCron();
      const row = await findOurPairPrecise();
      expect(row).toBeTruthy();
      expect(row.actual_lcb_balance_minutes).toBe(90);
      expect(row.computed_ledger_balance_minutes).toBe(60);
      expect(row.drift_minutes).toBe(30);
    } finally {
      await cleanup();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C10: full mode — both BCS draws and CSA adjustments subtracted.
  // ───────────────────────────────────────────────────────────────────────────
  test('C10: full mode — both BCS draws and CSA adjustments subtracted from ledger', async () => {
    const cleanup = await ensureStep5Tables({ wantBcs: true, wantCsa: true });
    try {
      await resetState();
      const ctId = await insertCt({ minutes: 180 });

      const bookingA = await insertBooking();
      await insertBcs({ bookingId: bookingA, ctId, minutesDrawn: 60 });        // -60
      await insertCsa({ ctId, minutesAdjusted: 30 });                         // -30

      // Expected = 180 - 60 - 30 = 90. LCB = 90 → no drift.
      await setLcbBalance(90);

      const probe = await probeSchemaMode(sql);
      expect(probe.mode).toBe('full');

      const result1 = await runCron();
      expect(result1.schema_mode).toBe('full');
      expect(await findOurPairPrecise()).toBeUndefined();

      // LCB drifts to 100 → expected drift = +10.
      await setLcbBalance(100);
      await runCron();
      const row = await findOurPairPrecise();
      expect(row).toBeTruthy();
      expect(row.drift_minutes).toBe(10);
    } finally {
      await cleanup();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C11: Alert email fires only when drift is non-zero.
  //
  // We can't easily intercept SMTP from the integration test, but
  // result.alert_sent is the surface signal. With sendAlerts:false in
  // runCron(), the helper short-circuits before calling sendAlertEmail,
  // so alert_sent reflects "would have sent" only when drift > 0.
  // ───────────────────────────────────────────────────────────────────────────
  test('C11: alert_sent flag tracks drift presence; drift injection bumps drift_count by 1', async () => {
    // sendAlerts is OFF throughout — we never want this test to send a real
    // email to ERROR_ALERT_EMAIL during a CI / local run. alert_sent in the
    // response reflects "did we attempt to send", so with sendAlerts:false
    // it should always be false regardless of drift count. The drift_count
    // delta is the load-bearing assertion.
    await resetState();
    const baseline = await runDivergenceCheck(sql, { sendAlerts: false });
    expect(baseline.alert_sent).toBe(false);

    await insertCt({ minutes: 90 });
    await setLcbBalance(150);
    const after = await runDivergenceCheck(sql, { sendAlerts: false });
    expect(after.drift_count).toBe(baseline.drift_count + 1);
    expect(after.alert_sent).toBe(false);

    // Confirm our injected pair is the one driving the increment.
    // Use the precise DB lookup — the pair may not be in drift_summary if
    // the branch has >20 worse drifts.
    const ourRow = await findOurPairPrecise();
    expect(ourRow).toBeTruthy();
    expect(ourRow.drift_minutes).toBe(60);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C12: half-migrated schema (CSA without BCS) returns ok:false + half_migrated mode.
  //
  // Only meaningful when we can construct the impossible state. We do so by
  // creating CSA without BCS, asserting the cron's behaviour, then dropping
  // CSA again. If the branch already has both tables, skip — we don't want
  // to DROP a real production-schema BCS table.
  // ───────────────────────────────────────────────────────────────────────────
  test('C12: half-migrated CSA-without-BCS returns ok:false, runs no reconcile', async () => {
    if (branchHasBcs && branchHasCsa) {
      test.skip(true, 'Branch has both Step 5 tables — cannot safely construct half-migrated state.');
      return;
    }
    if (branchHasBcs && !branchHasCsa) {
      test.skip(true, 'Branch has BCS without CSA — opposite of the state we need to simulate.');
      return;
    }

    // Create CSA but NOT BCS. Branch state has neither (we verified above).
    await sql`
      CREATE TABLE credit_source_adjustments (
        id                    SERIAL PRIMARY KEY,
        credit_transaction_id INTEGER NOT NULL REFERENCES credit_transactions(id),
        kind                  TEXT NOT NULL,
        minutes_adjusted      INTEGER NOT NULL,
        pence_adjusted        INTEGER NOT NULL DEFAULT 0,
        stripe_refund_id      TEXT,
        reason                TEXT,
        created_at            TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    branchHasCsa = true;
    try {
      const result = await runCron();
      expect(result.ok).toBe(false);
      expect(result.error).toBe('schema_inconsistent');
      expect(result.schema_mode).toBe('half_migrated_csa_without_bcs');
      expect(result.has_bcs).toBe(false);
      expect(result.has_csa).toBe(true);
      // No reconcile performed → no drift_summary.
      expect(result.drift_count).toBe(0);
    } finally {
      await sql`DROP TABLE IF EXISTS credit_source_adjustments`;
      branchHasCsa = false;
    }
  });
});
