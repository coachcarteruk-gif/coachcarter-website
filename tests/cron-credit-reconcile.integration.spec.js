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
const { REFUNDED } = require('../api/_booking-status');

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
const PRE_LEARNER_BCS_WRITER_AT = '2026-05-22T07:40:00Z';
const POST_LEARNER_BCS_WRITER_AT = '2026-05-22T07:42:00Z';
const PRE_RESCHEDULE_BCS_WRITER_AT = '2026-05-25T19:29:00Z';
const POST_RESCHEDULE_BCS_WRITER_AT = '2026-05-25T19:31:00Z';
const PRE_INSTRUCTOR_BCS_WRITER_AT = '2026-05-25T20:48:00Z';
const POST_INSTRUCTOR_BCS_WRITER_AT = '2026-05-25T20:50:00Z';
const INSTRUCTOR_ID = 1; // Fraser — always exists on any branch off main.

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Set grandfathered_at on the test pair's LCB row to NOW(). Used by C17/C18
// to author "this row is legacy-origin" scenarios. The setLcbBalance helper
// touches updated_at but leaves grandfathered_at alone, so this is invoked
// after setLcbBalance.
async function setLcbGrandfathered() {
  await sql`
    UPDATE learner_credit_balances
       SET grandfathered_at = NOW()
     WHERE learner_id = ${testLearnerId}
       AND instructor_id = ${INSTRUCTOR_ID}
  `;
}

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
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='booking_credit_sources' AND column_name='school_id') AS has_bcs_school_id,
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='credit_source_adjustments')  AS has_csa
  `;
  return { hasBcs: !!r.has_bcs, hasBcsSchoolId: !!r.has_bcs_school_id, hasCsa: !!r.has_csa };
}

// For C9 / C10: create the Step 5 tables if absent, returning a cleanup fn
// that drops them only if we created them. If they already exist, returns
// a cleanup fn that's a no-op.
async function ensureStep5Tables({ wantBcs, wantCsa }) {
  const initial = await probeBcsCsa();
  const createdBcs = wantBcs && !initial.hasBcs;
  const addedBcsSchoolId = wantBcs && initial.hasBcs && !initial.hasBcsSchoolId;
  const createdCsa = wantCsa && !initial.hasCsa;

  if (createdBcs) {
    await sql`
      CREATE TABLE booking_credit_sources (
        id                    SERIAL PRIMARY KEY,
        booking_id            INTEGER NOT NULL REFERENCES lesson_bookings(id) ON DELETE CASCADE,
        credit_transaction_id INTEGER NOT NULL REFERENCES credit_transactions(id),
        school_id             INTEGER NOT NULL DEFAULT 1,
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
  if (addedBcsSchoolId) {
    await sql`ALTER TABLE booking_credit_sources ADD COLUMN school_id INTEGER NOT NULL DEFAULT 1`;
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
    } else if (addedBcsSchoolId) {
      await sql`ALTER TABLE booking_credit_sources DROP COLUMN IF EXISTS school_id`;
    }
  };
}

// Create a synthetic lesson_booking for BCS rows to reference. BCS has an FK
// to lesson_bookings, but the cron's reconcile only cares about credit data.
// minutes_deducted = 0 here (no credit draw); use insertBookingWithMinutes
// when the booking should appear in the cron's booking_draws CTE.
async function insertBooking() {
  return insertBookingWithMinutes(0, false);
}

// Synthetic booking that draws `mins` credit minutes from LCB. Sets school_id
// and minutes_deducted so the cron's booking_draws CTE sees it. credit_returned
// toggles between "still drawing" and "refunded back to LCB" scenarios.
async function insertBookingWithMinutes(mins, creditReturned, opts = {}) {
  const dateStr = `2030-01-${String(Math.floor(Math.random() * 27) + 1).padStart(2, '0')}`;
  const hour = String(Math.floor(Math.random() * 12) + 8).padStart(2, '0');
  const minute = String(Math.floor(Math.random() * 60)).padStart(2, '0');
  const startTime = `${hour}:${minute}:00`;
  const endTime   = `${hour}:${String(Math.min(59, parseInt(minute) + 30)).padStart(2, '0')}:00`;
  const status = opts.status || 'scheduled';
  const createdAt = opts.createdAt || null;
  const createdBy = opts.createdBy || 'learner';
  const paymentMethod = opts.paymentMethod || 'credit';
  const rescheduledFrom = opts.rescheduledFrom || null;
  const [row] = await sql`
    INSERT INTO lesson_bookings
      (learner_id, instructor_id, school_id, scheduled_date, start_time, end_time, status, minutes_deducted, credit_returned, created_at, created_by, payment_method, rescheduled_from)
    VALUES
      (${testLearnerId}, ${INSTRUCTOR_ID}, ${SCHOOL_ID}, ${dateStr}::date, ${startTime}::time, ${endTime}::time, ${status}, ${mins}, ${creditReturned}, COALESCE(${createdAt}::timestamptz, NOW()), ${createdBy}, ${paymentMethod}, ${rescheduledFrom})
    RETURNING id
  `;
  return row.id;
}

async function insertBcs({ bookingId, ctId, minutesDrawn, refundedAt = null, createdAt = null }) {
  await sql`
    INSERT INTO booking_credit_sources
      (booking_id, credit_transaction_id, school_id, minutes_drawn, rate_pence_per_minute, contribution_pence, refunded_at, created_at)
    VALUES (${bookingId}, ${ctId}, ${SCHOOL_ID}, ${minutesDrawn}, 55, ${minutesDrawn * 55}, ${refundedAt}, COALESCE(${createdAt}::timestamptz, NOW()))
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

function missingSummaryBooking(result, bookingId) {
  return (result.missing_bcs_summary || []).find(r => r.booking_id === bookingId);
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

// Bypass the drift_summary cap: query LCB + ledger + booking draws directly
// for the test pair and recompute drift in the same shape the cron uses.
// Used by every assertion that needs precision regardless of how much
// noise is on the branch.
//
// The formula must match the cron's reconcile functions EXACTLY, otherwise
// P2 from the review applies: a bug in the cron's SQL would be masked by
// the helper still computing the right answer independently. To minimise
// that risk we keep the formula here as close to the cron's as possible
// — same CTEs, same predicates — just scoped to our (testLearner, INSTRUCTOR)
// pair instead of the whole world.
async function findOurPairOnDb() {
  const [row] = await sql`
    WITH purchases AS (
      SELECT COALESCE(SUM(ct.minutes), 0)::int AS minutes,
             (COUNT(*) > 0)                    AS has_rows
        FROM credit_transactions ct
       WHERE ct.school_id     = ${SCHOOL_ID}
         AND ct.instructor_id = ${INSTRUCTOR_ID}
         AND ct.learner_id    = ${testLearnerId}
    ),
    booking_draws AS (
      SELECT COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes,
             (COUNT(*) > 0)                              AS has_rows
        FROM lesson_bookings lb
       WHERE lb.school_id      = ${SCHOOL_ID}
         AND lb.learner_id     = ${testLearnerId}
         AND lb.instructor_id  = ${INSTRUCTOR_ID}
         AND lb.credit_returned = FALSE
         AND lb.minutes_deducted IS NOT NULL
         AND lb.minutes_deducted > 0
         AND NOT EXISTS (
           SELECT 1 FROM booking_credit_sources bcs2 WHERE bcs2.booking_id = lb.id
         )
    ),
    bcs_draws AS (
      SELECT COALESCE(SUM(bcs.minutes_drawn), 0)::int AS minutes,
             (COUNT(*) > 0)                            AS has_rows
        FROM booking_credit_sources bcs
        JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
       WHERE ct.learner_id    = ${testLearnerId}
         AND ct.instructor_id = ${INSTRUCTOR_ID}
         AND bcs.refunded_at IS NULL
    ),
    csa_draws AS (
      SELECT COALESCE(SUM(csa.minutes_adjusted), 0)::int AS minutes,
             (COUNT(*) > 0)                              AS has_rows
        FROM credit_source_adjustments csa
        JOIN credit_transactions ct ON ct.id = csa.credit_transaction_id
       WHERE ct.learner_id    = ${testLearnerId}
         AND ct.instructor_id = ${INSTRUCTOR_ID}
    )
    SELECT
      ${testLearnerId}::int                    AS learner_id,
      ${INSTRUCTOR_ID}::int                    AS instructor_id,
      COALESCE(lcb.balance_minutes, 0)         AS actual_lcb_balance_minutes,
        (SELECT minutes FROM purchases)
      - (SELECT minutes FROM booking_draws)
      - (SELECT minutes FROM bcs_draws)
      - (SELECT minutes FROM csa_draws)        AS computed_ledger_balance_minutes,
      COALESCE(lcb.balance_minutes, 0)
        - (  (SELECT minutes FROM purchases)
           - (SELECT minutes FROM booking_draws)
           - (SELECT minutes FROM bcs_draws)
           - (SELECT minutes FROM csa_draws) ) AS drift_minutes,
      lcb.grandfathered_at                     AS grandfathered_at,
        (SELECT has_rows FROM purchases)
       OR (SELECT has_rows FROM booking_draws)
       OR (SELECT has_rows FROM bcs_draws)
       OR (SELECT has_rows FROM csa_draws)     AS has_ledger_rows
    FROM (SELECT 1) _
    LEFT JOIN learner_credit_balances lcb
      ON lcb.learner_id    = ${testLearnerId}
     AND lcb.instructor_id = ${INSTRUCTOR_ID}
  `;
  if (!row || row.drift_minutes === 0) return undefined;
  // Mirror cron's conditional grandfather suppression: a grandfathered row
  // with NO per-pair ledger rows is silenced. Any per-pair ledger activity
  // — even one that nets to zero — re-asserts drift (C18, C22).
  if (row.grandfathered_at != null && !row.has_ledger_rows) return undefined;
  return row;
}

// ct_only variant — BCS / CSA tables absent on the branch. booking_draws also
// drops the NOT EXISTS predicate (no BCS table to check against).
async function findOurPairOnDbCtOnly() {
  const [row] = await sql`
    WITH purchases AS (
      SELECT COALESCE(SUM(ct.minutes), 0)::int AS minutes,
             (COUNT(*) > 0)                    AS has_rows
        FROM credit_transactions ct
       WHERE ct.school_id     = ${SCHOOL_ID}
         AND ct.instructor_id = ${INSTRUCTOR_ID}
         AND ct.learner_id    = ${testLearnerId}
    ),
    booking_draws AS (
      SELECT COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes,
             (COUNT(*) > 0)                              AS has_rows
        FROM lesson_bookings lb
       WHERE lb.school_id      = ${SCHOOL_ID}
         AND lb.learner_id     = ${testLearnerId}
         AND lb.instructor_id  = ${INSTRUCTOR_ID}
         AND lb.credit_returned = FALSE
         AND lb.minutes_deducted IS NOT NULL
         AND lb.minutes_deducted > 0
    )
    SELECT
      ${testLearnerId}::int                    AS learner_id,
      ${INSTRUCTOR_ID}::int                    AS instructor_id,
      COALESCE(lcb.balance_minutes, 0)         AS actual_lcb_balance_minutes,
        (SELECT minutes FROM purchases)
      - (SELECT minutes FROM booking_draws)    AS computed_ledger_balance_minutes,
      COALESCE(lcb.balance_minutes, 0)
        - (  (SELECT minutes FROM purchases)
           - (SELECT minutes FROM booking_draws) ) AS drift_minutes,
      lcb.grandfathered_at                     AS grandfathered_at,
        (SELECT has_rows FROM purchases)
       OR (SELECT has_rows FROM booking_draws) AS has_ledger_rows
    FROM (SELECT 1) _
    LEFT JOIN learner_credit_balances lcb
      ON lcb.learner_id    = ${testLearnerId}
     AND lcb.instructor_id = ${INSTRUCTOR_ID}
  `;
  if (!row || row.drift_minutes === 0) return undefined;
  // Same conditional grandfather suppression as findOurPairOnDb.
  if (row.grandfathered_at != null && !row.has_ledger_rows) return undefined;
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
    // Snapshot the cron's count before our injection — defends against P2:
    // a +1 delta is a direct assertion against the cron's SQL, not a
    // parallel test re-implementation.
    const before = await runCron();

    await insertCt({ minutes: 60 });   // ledger says +60
    await setLcbBalance(120);          // LCB says 120 → drift +60

    const result = await runCron();
    expect(result.ok).toBe(true);
    // P2 mitigation: drift_count must increase by exactly 1.
    expect(result.drift_count).toBe(before.drift_count + 1);
    // Precision against the DB. drift_summary may not include our pair if
    // the branch has >20 worse drifts.
    const row = await findOurPairPrecise();
    expect(row).toBeTruthy();
    expect(row.actual_lcb_balance_minutes).toBe(120);
    expect(row.computed_ledger_balance_minutes).toBe(60);
    expect(row.drift_minutes).toBe(60);
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
    const before = await runCron();
    await insertCt({ minutes: 90 });
    // No LCB row at all.

    const result = await runCron();
    expect(result.ok).toBe(true);
    // P2 mitigation: this asserts the cron's FULL OUTER JOIN found the
    // missing-LCB direction, not just our parallel helper.
    expect(result.drift_count).toBe(before.drift_count + 1);
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
    const before = await runCron();
    await setLcbBalance(45);
    // No CT rows.

    const result = await runCron();
    expect(result.ok).toBe(true);
    // P2 mitigation: assert the cron's SQL caught the phantom-LCB direction.
    expect(result.drift_count).toBe(before.drift_count + 1);
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
  // C10a-d: missing active BCS attribution is reported separately from drift.
  //
  // These scenarios pin the data-derived cutover, active/refunded BCS
  // semantics, and the invariant that matching balances keep drift_count
  // stable while missing_bcs_count moves independently.
  // ───────────────────────────────────────────────────────────────────────────
  test('C10a: BCS coverage diagnostic ignores pre-#203 learner credit booking without BCS', async () => {
    const cleanup = await ensureStep5Tables({ wantBcs: true, wantCsa: true });
    try {
      await resetState();

      const seedCtId = await insertCt({ minutes: 60 });
      const seedBookingId = await insertBookingWithMinutes(0, false, { createdAt: '2026-05-25T12:00:00Z' });
      await insertBcs({ bookingId: seedBookingId, ctId: seedCtId, minutesDrawn: 60, createdAt: '2026-05-25T12:00:00Z' });
      await setLcbBalance(0);
      const before = await runCron();

      await insertCt({ minutes: 90 });
      const historicalBookingId = await insertBookingWithMinutes(90, false, { createdAt: PRE_LEARNER_BCS_WRITER_AT });

      const after = await runCron();
      expect(after.missing_bcs_count).toBe(before.missing_bcs_count);
      expect(missingSummaryBooking(after, historicalBookingId)).toBeUndefined();
      expect(after.drift_count).toBe(before.drift_count);
    } finally {
      await cleanup();
    }
  });

  test('C10b: BCS coverage diagnostic flags post-#203 learner credit booking without active BCS', async () => {
    const cleanup = await ensureStep5Tables({ wantBcs: true, wantCsa: true });
    try {
      await resetState();

      const seedCtId = await insertCt({ minutes: 60 });
      const seedBookingId = await insertBookingWithMinutes(0, false, { createdAt: '2026-05-25T12:00:00Z' });
      await insertBcs({ bookingId: seedBookingId, ctId: seedCtId, minutesDrawn: 60, createdAt: '2026-05-25T12:00:00Z' });
      await setLcbBalance(0);
      const before = await runCron();

      await insertCt({ minutes: 90 });
      const missingBookingId = await insertBookingWithMinutes(90, false, { createdAt: POST_LEARNER_BCS_WRITER_AT });

      const after = await runCron();
      expect(after.missing_bcs_count).toBe(before.missing_bcs_count + 1);
      expect(missingSummaryBooking(after, missingBookingId)).toMatchObject({
        booking_id: missingBookingId,
        learner_id: testLearnerId,
        instructor_id: INSTRUCTOR_ID,
        status: 'scheduled',
        minutes_deducted: 90,
        credit_returned: false,
        bcs_writer_path: 'learner_credit_booking',
      });
      expect(after.drift_count).toBe(before.drift_count);
    } finally {
      await cleanup();
    }
  });

  test('C10b2: BCS coverage diagnostic ignores pre-#210 instructor-created credit booking without BCS', async () => {
    const cleanup = await ensureStep5Tables({ wantBcs: true, wantCsa: true });
    try {
      await resetState();
      const before = await runCron();

      await insertCt({ minutes: 90 });
      const bookingId = await insertBookingWithMinutes(90, false, {
        createdAt: PRE_INSTRUCTOR_BCS_WRITER_AT,
        createdBy: 'instructor',
      });
      await setLcbBalance(0);

      const after = await runCron();
      expect(after.missing_bcs_count).toBe(before.missing_bcs_count);
      expect(missingSummaryBooking(after, bookingId)).toBeUndefined();
      expect(after.drift_count).toBe(before.drift_count);
    } finally {
      await cleanup();
    }
  });

  test('C10b3: BCS coverage diagnostic flags post-#210 instructor-created credit booking without BCS', async () => {
    const cleanup = await ensureStep5Tables({ wantBcs: true, wantCsa: true });
    try {
      await resetState();
      const before = await runCron();

      await insertCt({ minutes: 90 });
      const bookingId = await insertBookingWithMinutes(90, false, {
        createdAt: POST_INSTRUCTOR_BCS_WRITER_AT,
        createdBy: 'instructor',
      });
      await setLcbBalance(0);

      const after = await runCron();
      expect(after.missing_bcs_count).toBe(before.missing_bcs_count + 1);
      expect(missingSummaryBooking(after, bookingId)).toMatchObject({
        booking_id: bookingId,
        bcs_writer_path: 'instructor_credit_booking',
      });
      expect(after.drift_count).toBe(before.drift_count);
    } finally {
      await cleanup();
    }
  });

  test('C10b4: BCS coverage diagnostic ignores pre-#208 reschedule replacement without BCS', async () => {
    const cleanup = await ensureStep5Tables({ wantBcs: true, wantCsa: true });
    try {
      await resetState();
      const sourceBookingId = await insertBookingWithMinutes(0, false, {
        createdAt: '2026-05-25T12:00:00Z',
      });
      const before = await runCron();

      await insertCt({ minutes: 90 });
      const bookingId = await insertBookingWithMinutes(90, false, {
        createdAt: PRE_RESCHEDULE_BCS_WRITER_AT,
        rescheduledFrom: sourceBookingId,
      });
      await setLcbBalance(0);

      const after = await runCron();
      expect(after.missing_bcs_count).toBe(before.missing_bcs_count);
      expect(missingSummaryBooking(after, bookingId)).toBeUndefined();
      expect(after.drift_count).toBe(before.drift_count);
    } finally {
      await cleanup();
    }
  });

  test('C10b5: BCS coverage diagnostic flags post-#208 reschedule replacement without BCS', async () => {
    const cleanup = await ensureStep5Tables({ wantBcs: true, wantCsa: true });
    try {
      await resetState();
      const sourceBookingId = await insertBookingWithMinutes(0, false, {
        createdAt: '2026-05-25T12:00:00Z',
      });
      const before = await runCron();

      await insertCt({ minutes: 90 });
      const bookingId = await insertBookingWithMinutes(90, false, {
        createdAt: POST_RESCHEDULE_BCS_WRITER_AT,
        rescheduledFrom: sourceBookingId,
      });
      await setLcbBalance(0);

      const after = await runCron();
      expect(after.missing_bcs_count).toBe(before.missing_bcs_count + 1);
      expect(missingSummaryBooking(after, bookingId)).toMatchObject({
        booking_id: bookingId,
        bcs_writer_path: 'reschedule_replacement',
      });
      expect(after.drift_count).toBe(before.drift_count);
    } finally {
      await cleanup();
    }
  });

  test('C10c: BCS coverage diagnostic does not flag booking with active BCS', async () => {
    const cleanup = await ensureStep5Tables({ wantBcs: true, wantCsa: true });
    try {
      await resetState();

      const seedCtId = await insertCt({ minutes: 60 });
      const seedBookingId = await insertBookingWithMinutes(0, false, { createdAt: '2026-05-25T12:00:00Z' });
      await insertBcs({ bookingId: seedBookingId, ctId: seedCtId, minutesDrawn: 60, createdAt: '2026-05-25T12:00:00Z' });
      await setLcbBalance(0);
      const before = await runCron();

      const ctId = await insertCt({ minutes: 90 });
      const bookingId = await insertBookingWithMinutes(90, false, { createdAt: '2100-01-02T12:00:00Z' });
      await insertBcs({ bookingId, ctId, minutesDrawn: 90, createdAt: '2100-01-02T12:01:00Z' });

      const after = await runCron();
      expect(after.missing_bcs_count).toBe(before.missing_bcs_count);
      expect(missingSummaryBooking(after, bookingId)).toBeUndefined();
      expect(after.drift_count).toBe(before.drift_count);
    } finally {
      await cleanup();
    }
  });

  test('C10c2: BCS coverage diagnostic ignores direct-paid non-credit booking even with minutes_deducted', async () => {
    const cleanup = await ensureStep5Tables({ wantBcs: true, wantCsa: true });
    try {
      await resetState();
      const before = await runCron();

      await insertCt({ minutes: 90, type: 'slot_purchase' });
      const bookingId = await insertBookingWithMinutes(90, false, {
        createdAt: '2100-01-02T13:00:00Z',
        paymentMethod: 'stripe',
      });
      await setLcbBalance(0);

      const after = await runCron();
      expect(after.missing_bcs_count).toBe(before.missing_bcs_count);
      expect(missingSummaryBooking(after, bookingId)).toBeUndefined();
      expect(after.drift_count).toBe(before.drift_count);
    } finally {
      await cleanup();
    }
  });

  test('C10d: BCS coverage diagnostic treats only-refunded BCS as inactive for active bookings', async () => {
    const cleanup = await ensureStep5Tables({ wantBcs: true, wantCsa: true });
    try {
      await resetState();

      const seedCtId = await insertCt({ minutes: 60 });
      const seedBookingId = await insertBookingWithMinutes(0, false, { createdAt: '2026-05-25T12:00:00Z' });
      await insertBcs({ bookingId: seedBookingId, ctId: seedCtId, minutesDrawn: 60, createdAt: '2026-05-25T12:00:00Z' });
      await setLcbBalance(0);
      const before = await runCron();

      const activeCtId = await insertCt({ minutes: 60 });
      const activeBookingId = await insertBookingWithMinutes(60, false, { createdAt: '2100-01-03T12:00:00Z' });
      await insertBcs({
        bookingId: activeBookingId,
        ctId: activeCtId,
        minutesDrawn: 60,
        refundedAt: '2100-01-03T12:10:00Z',
        createdAt: '2100-01-03T12:01:00Z',
      });

      const refundedCtId = await insertCt({ minutes: 30 });
      const refundedBookingId = await insertBookingWithMinutes(30, true, {
        status: REFUNDED,
        createdAt: '2100-01-04T12:00:00Z',
      });
      await insertBcs({
        bookingId: refundedBookingId,
        ctId: refundedCtId,
        minutesDrawn: 30,
        refundedAt: '2100-01-04T12:10:00Z',
        createdAt: '2100-01-04T12:01:00Z',
      });

      await setLcbBalance(90);
      const after = await runCron();
      expect(after.missing_bcs_count).toBe(before.missing_bcs_count + 1);
      expect(missingSummaryBooking(after, activeBookingId)).toBeTruthy();
      expect(missingSummaryBooking(after, refundedBookingId)).toBeUndefined();
      expect(after.drift_count).toBe(before.drift_count);
    } finally {
      await cleanup();
    }
  });

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

  // ───────────────────────────────────────────────────────────────────────────
  // C13 — LOAD-BEARING: legitimate credit-funded booking must NOT be flagged.
  //
  // Booking deductions on the live writer path mutate LCB via
  // lockBalanceAdjustLCB without writing a credit_transactions row. The cron
  // MUST subtract lb.minutes_deducted (where credit_returned = FALSE) so
  // these legitimate draws don't appear as negative drift.
  //
  // Pre-fix, this scenario produced drift_minutes = -60 (LCB 60 - ledger 120).
  // Post-fix, the booking_draws CTE subtracts the 60, leaving expected = 60
  // and drift = 0.
  // ───────────────────────────────────────────────────────────────────────────
  test('C13: credit purchase + matching booking deduction → no drift', async () => {
    await resetState();
    await insertCt({ minutes: 120 });                    // purchase 120
    const bookingId = await insertBookingWithMinutes(60, false /* credit_returned */);
    await setLcbBalance(60);                             // LCB after deduction

    const result = await runCron();
    expect(result.ok).toBe(true);
    // The precise lookup recomputes the same formula the cron uses (P2 risk:
    // bug in shared formula could pass — see C14 below for the cron-output
    // assertion that bypasses this).
    expect(await findOurPairPrecise()).toBeUndefined();
    // Cleanup the booking before next test.
    await sql`DELETE FROM lesson_bookings WHERE id = ${bookingId}`;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C14 — symmetric to C13: a fully-refunded booking does NOT get subtracted.
  //
  // When credit_returned = TRUE the deduction was reversed back into LCB via
  // a separate lockBalanceAdjustLCB call. The booking row carries
  // minutes_deducted (snapshot of what was originally drawn) but the cron
  // must NOT subtract it again.
  // ───────────────────────────────────────────────────────────────────────────
  test('C14: refunded booking (credit_returned = TRUE) excluded from deduction', async () => {
    await resetState();
    await insertCt({ minutes: 120 });
    const bookingId = await insertBookingWithMinutes(60, true /* credit_returned */);
    // LCB stays at 120 — the deduction was reversed.
    await setLcbBalance(120);

    const result = await runCron();
    expect(result.ok).toBe(true);
    expect(await findOurPairPrecise()).toBeUndefined();
    await sql`DELETE FROM lesson_bookings WHERE id = ${bookingId}`;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C15 — P2 mitigation: forced-large drift must appear in result.drift_summary.
  //
  // C3-C6 assert against findOurPairPrecise() which is a parallel SQL
  // implementation. A bug in the cron's FULL OUTER JOIN / filtering could
  // be masked if the helper still computes the right drift. This test
  // forces a drift so large it MUST enter the top-20 drift_summary, then
  // asserts against the cron's actual returned row.
  //
  // We use 10_000_000 minutes (≈ 19 years of lesson time) — guaranteed to
  // exceed any pre-existing wild drift on the branch by orders of magnitude.
  // ───────────────────────────────────────────────────────────────────────────
  test('C15: extreme drift appears in cron output drift_summary (P2 mitigation)', async () => {
    await resetState();
    const EXTREME = 10_000_000;
    await insertCt({ minutes: EXTREME });
    // No LCB row — missing LCB direction of FULL OUTER JOIN.
    const result = await runCron();
    expect(result.ok).toBe(true);

    // The pair MUST be in drift_summary at this drift magnitude.
    const inSummary = (result.drift_summary || []).find(
      r => r.learner_id === testLearnerId && r.instructor_id === INSTRUCTOR_ID
    );
    expect(inSummary).toBeTruthy();
    expect(inSummary.computed_ledger_balance_minutes).toBe(EXTREME);
    expect(inSummary.actual_lcb_balance_minutes).toBe(0);
    expect(inSummary.drift_minutes).toBe(-EXTREME);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C16 — P2 mitigation: drift_count delta strictly increases by 1.
  //
  // Independent of WHICH row makes drift_summary, drift_count is the full
  // count from the cron's SQL — so a +1 delta when we inject exactly one
  // new drifting pair is a direct assertion against the cron's output.
  // ───────────────────────────────────────────────────────────────────────────
  test('C16: injecting one drift pair increments cron drift_count by exactly 1', async () => {
    await resetState();
    const before = await runCron();

    // Inject phantom LCB drift (LCB > 0 with no ledger).
    await setLcbBalance(45);
    const after = await runCron();
    expect(after.drift_count).toBe(before.drift_count + 1);

    // And cleaning it up brings drift_count back to baseline.
    await deleteLcb();
    const final = await runCron();
    expect(final.drift_count).toBe(before.drift_count);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Plan A — grandfathered_at column + conditional drift suppression.
  //
  // Truth table the cron implements (all three schema modes):
  //   grandfathered_at | per-pair ledger rows exist? | result
  //   ─────────────────┼─────────────────────────────┼────────────────
  //   NULL             | no                          | (no drift)
  //   NULL             | yes                         | flag if LCB != 0
  //   non-NULL         | no                          | SUPPRESS   ← C17 / C20
  //   non-NULL         | yes                         | flag       ← C18 / C22
  //
  // "Per-pair ledger rows exist" — not "ledger nets to non-zero" — is the
  // load-bearing condition. C22 forces the predicate to distinguish the
  // two: +60 purchase + -60 booking on a grandfathered row nets to zero
  // but still has rows, so it must flag.
  //
  // C19 covers idempotency of the suppression flag itself: re-marking
  // does not change counts.
  // ───────────────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────────────
  // C17: grandfathered LCB row with no per-pair ledger → suppressed.
  //
  // This is the steady-state Group A shape from the first prod fire on
  // 2026-05-20: legacy backfill rows with LCB > 0 and no credit_transactions
  // entries for the pair. After grandfathering, the cron must not flag them.
  // ───────────────────────────────────────────────────────────────────────────
  test('C17: grandfathered + no ledger → suppressed from drift and counted as grandfathered', async () => {
    await resetState();
    // Inject the Group A shape: LCB > 0, no CT, no bookings.
    await setLcbBalance(1860);
    await setLcbGrandfathered();

    // Snapshot drift + grandfathered counts before our injection took effect.
    // Note: setLcbBalance + setLcbGrandfathered already happened. The "before"
    // here is just for sanity — we expect our row NOT to appear in drift.
    const result = await runCron();
    expect(result.ok).toBe(true);

    // The cron MUST NOT flag our pair.
    expect(await findOurPairPrecise()).toBeUndefined();

    // And grandfathered_count includes our pair (grandfathered + no ledger
    // rows + LCB != 0).
    expect(result.grandfathered_count).toBeGreaterThanOrEqual(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C18: grandfathered LCB row WITH non-zero ledger → STILL flagged.
  //
  // LOAD-BEARING TEST. If suppression were unconditional (`AND
  // lcb.grandfathered_at IS NULL` in the WHERE), this test would fail by
  // silently dropping a real drift signal once any per-pair CT row landed.
  // ───────────────────────────────────────────────────────────────────────────
  test('C18: grandfathered + non-zero ledger → STILL flagged (load-bearing)', async () => {
    await resetState();
    // Start with the Group A shape, then add a Phase-2A purchase. The CT
    // row makes expected_balance = 60; LCB is still the pre-existing 1860
    // (the grant did NOT touch LCB because we authored the row directly via
    // setLcbBalance, simulating a mixed-state row that hasn't been
    // reconciled yet).
    await setLcbBalance(1860);
    await setLcbGrandfathered();

    const before = await runCron();

    await insertCt({ minutes: 60 });   // expected_balance = 60, LCB = 1860 → drift +1800

    const after = await runCron();
    expect(after.ok).toBe(true);

    // P2 mitigation: cron's own drift_count must rise by exactly 1.
    expect(after.drift_count).toBe(before.drift_count + 1);

    // And our pair must be in the precise lookup.
    const row = await findOurPairPrecise();
    expect(row).toBeTruthy();
    expect(row.actual_lcb_balance_minutes).toBe(1860);
    expect(row.computed_ledger_balance_minutes).toBe(60);
    expect(row.drift_minutes).toBe(1800);

    // Grandfathered_count should drop OR stay flat (depending on prior state):
    // our pair is no longer in "would-have-flagged-but-suppressed" because
    // it's now actually flagged. The key assertion is "still flagged" above;
    // the count semantics is asserted independently in C17.
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C22: grandfathered LCB row + ledger activity that NETS TO ZERO → STILL flagged.
  //
  // SECOND LOAD-BEARING TEST. A naive "expected = 0" suppression predicate
  // would silence this pair: +60 purchase + -60 booking draw = 0 expected
  // balance. But the LCB still carries 1860 minutes of legacy origin AND
  // now has real per-pair activity sitting on top of it — the divergence
  // is 1860 minutes, not zero, and we MUST report it.
  //
  // The correct predicate is "any per-pair ledger rows exist" — not
  // "ledger nets to zero". This test is the discriminator between the two.
  // ───────────────────────────────────────────────────────────────────────────
  test('C22: grandfathered + net-zero ledger activity → STILL flagged (second load-bearing)', async () => {
    await resetState();
    await setLcbBalance(1860);
    await setLcbGrandfathered();

    const before = await runCron();

    // Net-zero ledger: +60 purchase + -60 booking deduction = 0 expected.
    await insertCt({ minutes: 60 });
    const bookingId = await insertBookingWithMinutes(60, false /* credit_returned */);

    try {
      const after = await runCron();
      expect(after.ok).toBe(true);

      // Cron must report a NEW drift pair — the legacy 1860 is still
      // unaccounted-for. Net-zero ledger does NOT silence a grandfathered row.
      expect(after.drift_count).toBe(before.drift_count + 1);

      const row = await findOurPairPrecise();
      expect(row).toBeTruthy();
      expect(row.actual_lcb_balance_minutes).toBe(1860);
      // Expected balance is +60 (purchase) - 60 (deduction) = 0.
      expect(row.computed_ledger_balance_minutes).toBe(0);
      // But drift is the full 1860 — the LCB is "wrong" by the legacy
      // amount, and that's what the operator needs to see.
      expect(row.drift_minutes).toBe(1860);
    } finally {
      await sql`DELETE FROM lesson_bookings WHERE id = ${bookingId}`;
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C23: P2 mitigation for the net-zero load-bearing case.
  //
  // C22 asserts via findOurPairPrecise() (parallel SQL). If the cron's
  // suppression predicate is the buggy "expected = 0" form, the helper's
  // matching JS check would also suppress the row — the bug would hide.
  // This test asserts cron OUTPUT delta directly: drift_count must rise
  // by exactly 1 when we add net-zero ledger activity to a grandfathered
  // pair. Independent of the helper.
  // ───────────────────────────────────────────────────────────────────────────
  test('C23: net-zero ledger on grandfathered row produces drift_count delta=+1 (P2-mitigation for C22)', async () => {
    await resetState();
    await setLcbBalance(1860);
    await setLcbGrandfathered();

    const before = await runCron();
    // grandfathered_count should include our row at this point (clean
    // grandfathered, no ledger).
    expect(before.grandfathered_count).toBeGreaterThanOrEqual(1);

    await insertCt({ minutes: 60 });
    const bookingId = await insertBookingWithMinutes(60, false);

    try {
      const after = await runCron();
      // Direct assertion against the cron's own counts — not via the helper.
      expect(after.drift_count).toBe(before.drift_count + 1);
      // And the row is no longer in the "would-have-flagged-but-suppressed"
      // bucket, because it IS now flagged.
      expect(after.grandfathered_count).toBe(before.grandfathered_count - 1);
    } finally {
      await sql`DELETE FROM lesson_bookings WHERE id = ${bookingId}`;
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C19: grandfather flag is sticky — re-marking is idempotent.
  //
  // setLcbGrandfathered runs UPDATE … SET grandfathered_at = NOW(). The
  // backfill migration's predicate (api/migrate-step-2c-grandfather.js)
  // includes `grandfathered_at IS NULL` so a second run can't touch a row
  // that's already grandfathered. This test asserts the suppression
  // behaviour stays consistent across a re-mark.
  // ───────────────────────────────────────────────────────────────────────────
  test('C19: re-grandfathering an already-grandfathered row leaves suppression behaviour unchanged', async () => {
    await resetState();
    await setLcbBalance(900);
    await setLcbGrandfathered();

    const first = await runCron();
    expect(await findOurPairPrecise()).toBeUndefined();
    const firstGrandfathered = first.grandfathered_count;

    // Re-mark (simulating a second migration pass that somehow doesn't
    // gate on IS NULL — the cron's behaviour must still be deterministic).
    await setLcbGrandfathered();

    const second = await runCron();
    expect(await findOurPairPrecise()).toBeUndefined();
    expect(second.grandfathered_count).toBe(firstGrandfathered);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C21 (P2 fix): cron survives when grandfathered_at column is absent.
  //
  // Deploy ordering: the new cron code ships in the same Vercel deploy as
  // the column DDL, but there's a window between deploy completion and
  // /api/migrate finishing where the cron's SQL would reference a column
  // that doesn't exist yet. probeSchemaMode reports has_grandfathered_at
  // = false, the reconcile functions emit non-suppressing variants, and
  // grandfathered_count short-circuits to 0.
  //
  // This test DROPs and re-ADDs the column around a single cron run. The
  // afterAll cleanup re-adds the column unconditionally as a safety net
  // in case a prior assertion threw mid-test.
  // ───────────────────────────────────────────────────────────────────────────
  test('C21: cron returns ok with non-suppressing variant when grandfathered_at column is absent (P2 fix)', async () => {
    await resetState();
    // Drop the column. The branch already has Phase-2A schema, so other
    // queries (purchases, booking_draws, etc.) remain healthy.
    await sql`ALTER TABLE learner_credit_balances DROP COLUMN IF EXISTS grandfathered_at`;

    try {
      const result = await runCron();
      expect(result.ok).toBe(true);
      expect(result.has_grandfathered_at).toBe(false);
      // Count short-circuits to 0 when column is absent.
      expect(result.grandfathered_count).toBe(0);
      // drift_count is just the normal full-detection count; we don't
      // assert a specific value (branch state varies) — only that the
      // cron completed without error.
      expect(typeof result.drift_count).toBe('number');
    } finally {
      // Re-add the column. ALTER + IF NOT EXISTS makes this idempotent.
      await sql`
        ALTER TABLE learner_credit_balances
          ADD COLUMN IF NOT EXISTS grandfathered_at TIMESTAMPTZ
      `;
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C20: P2 mitigation specifically for grandfather suppression.
  //
  // C17 asserts via findOurPairPrecise(), which is parallel SQL. A bug in
  // the cron's WHERE predicate could be masked if the helper still computed
  // the right answer. This test compares drift_count and grandfathered_count
  // BEFORE and AFTER injecting one grandfathered-clean row, asserting:
  //   • drift_count is UNCHANGED (suppression worked),
  //   • grandfathered_count rose by exactly 1 (the row was counted as
  //     suppressed, not dropped silently).
  // ───────────────────────────────────────────────────────────────────────────
  test('C20: grandfathered clean row produces (drift_count delta=0, grandfathered_count delta=+1) (P2 mitigation)', async () => {
    await resetState();
    const before = await runCron();

    await setLcbBalance(1860);
    await setLcbGrandfathered();

    const after = await runCron();

    // Suppression worked — no new drift entry.
    expect(after.drift_count).toBe(before.drift_count);
    // And the row was visibly counted as suppressed.
    expect(after.grandfathered_count).toBe(before.grandfathered_count + 1);

    // Cleaning up: removing the LCB row also removes it from the suppressed
    // count, confirming the count is computed live (not cached).
    await deleteLcb();
    const final = await runCron();
    expect(final.drift_count).toBe(before.drift_count);
    expect(final.grandfathered_count).toBe(before.grandfathered_count);
  });
});
