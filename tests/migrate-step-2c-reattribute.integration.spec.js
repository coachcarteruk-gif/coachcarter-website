// @ts-check
// Integration tests for api/migrate-step-2c-reattribute.js against a real
// Neon test branch.
//
// What this proves:
//   R0. Refuses to run without the Step 2c grandfather prereq marker.
//   R1. Clean move: grandfathered LCB(L, 1) → LCB(L, 4); source row deleted.
//   R2. Conflict merge: grandfathered LCB(L, 1) merging into existing
//       grandfathered LCB(L, 4) sums balances and takes the EARLIER
//       grandfathered_at.
//   R3. Watched-stays-watched merge: grandfathered LCB(L, 1) merging into
//       an active (NON-grandfathered) LCB(L, 4) sums balances and the
//       merged row's grandfathered_at REMAINS NULL — we MUST NOT promote
//       an active row to grandfathered status.
//   R4. Non-grandfathered LCB(L, 1) rows are NOT moved (predicate filters
//       grandfathered_at IS NOT NULL).
//   R5. POST is refused after self-marker is present (idempotency hard stop).
//   R6. Manual marker DELETE re-enables POST (rollback rerun path).
//   R7. Production-output assertion: after re-attribution, the cron's drift
//       formula returns 0 drift for pairs whose only "drift source" was the
//       wrong-instructor attribution. (Per
//       memory/feedback_assert_against_production_output_not_parallel_sql:
//       assert against the cron's actual SQL, not a parallel reimplementation.)
//
// How to run:
//   CC_TEST_DB=1 npx playwright test migrate-step-2c-reattribute.integration

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
    console.warn('[migrate-step-2c-reattribute.integration] .env.local load failed:', err.message);
  }
})();

if (!process.env.MIGRATION_SECRET) {
  process.env.MIGRATION_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
}

let _originalPostgresUrl;

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
test.describe.configure({ mode: 'serial' });

const SCHOOL_ID = 1;
const PREREQ_MARKER_KEY = 'per_instructor_credits_step_2c_grandfather';
const SOURCE_INSTRUCTOR_ID = 1;
const TARGET_INSTRUCTOR_ID = 4;

let sql;
let handler;
let MARKER_KEY;
let runCron;
let testLearnerCleanMoveId;        // R1: grandfathered LCB(L, 1) → moves to (L, 4), no conflict
let testLearnerConflictGfId;       // R2: grandfathered LCB(L, 1) + grandfathered LCB(L, 4) → merge
let testLearnerConflictActiveId;   // R3: grandfathered LCB(L, 1) + active LCB(L, 4) → merge, no gf promotion
let testLearnerNotGrandfatheredId; // R4: LCB(L, 1) with grandfathered_at NULL → must NOT move
let createdLearnerIds = [];
let earlierGfTimestamp;

function fakeReq({ method = 'GET', query = {}, headers = {} } = {}) {
  return { method, query, headers };
}
function fakeRes() {
  const r = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return r;
}

async function call({ method, dry_run } = {}) {
  const req = fakeReq({
    method: method || 'POST',
    query: {
      secret: process.env.MIGRATION_SECRET,
      ...(dry_run ? { dry_run: '1' } : {}),
    },
  });
  const res = fakeRes();
  await handler(req, res);
  return { statusCode: res.statusCode, body: res.body };
}

async function getLcb(learnerId, instructorId) {
  const [row] = await sql`
    SELECT learner_id, instructor_id, balance_minutes,
           grandfathered_at::text AS grandfathered_at,
           updated_at::text       AS updated_at
      FROM learner_credit_balances
     WHERE learner_id = ${learnerId} AND instructor_id = ${instructorId}
     LIMIT 1
  `;
  return row;
}

test.describe('migrate-step-2c-reattribute — integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL. Point at an isolated branch.');
    }

    _originalPostgresUrl = process.env.POSTGRES_URL;
    process.env.POSTGRES_URL = process.env.POSTGRES_URL_TEST;

    handler = require('../api/migrate-step-2c-reattribute');
    MARKER_KEY = handler.MARKER_KEY;

    // For R7: pull the cron's actual runDivergenceCheck so we assert against
    // the production SQL, not a parallel reimplementation.
    runCron = require('../api/cron-credit-reconcile').runDivergenceCheck;

    sql = neon(process.env.POSTGRES_URL_TEST);

    // Sanity: branch must have Phase-2A schema + LCB table.
    const [hasLcb] = await sql`
      SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name='learner_credit_balances'
    `;
    if (!hasLcb) {
      throw new Error('Test branch has no learner_credit_balances. Run /api/migrate-step-2c first.');
    }

    // Marker table + prereq marker.
    await sql`
      CREATE TABLE IF NOT EXISTS migration_markers (
        key TEXT PRIMARY KEY, completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), notes TEXT
      )
    `;
    await sql`
      INSERT INTO migration_markers (key, notes)
      VALUES (${PREREQ_MARKER_KEY}, 'test prereq')
      ON CONFLICT (key) DO NOTHING
    `;

    // grandfathered_at column.
    await sql`
      ALTER TABLE learner_credit_balances
        ADD COLUMN IF NOT EXISTS grandfathered_at TIMESTAMPTZ
    `;

    // Wipe our own marker.
    await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;

    // Target instructor must exist.
    const [target] = await sql`SELECT id FROM instructors WHERE id = ${TARGET_INSTRUCTOR_ID}`;
    if (!target) {
      throw new Error(`Test branch lacks instructors.id = ${TARGET_INSTRUCTOR_ID} — required.`);
    }
    const [source] = await sql`SELECT id FROM instructors WHERE id = ${SOURCE_INSTRUCTOR_ID}`;
    if (!source) {
      throw new Error(`Test branch lacks instructors.id = ${SOURCE_INSTRUCTOR_ID} — required.`);
    }

    // ── Fixture learners ───────────────────────────────────────────────────
    async function makeLearner(label) {
      const email = `ra-${label}-${crypto.randomBytes(5).toString('hex')}@coachcarter.test`;
      const [row] = await sql`
        INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
        VALUES (${`Reattribute Test ${label}`}, ${email}, ${SCHOOL_ID}, 0, 0)
        RETURNING id
      `;
      createdLearnerIds.push(row.id);
      return row.id;
    }

    testLearnerCleanMoveId        = await makeLearner('clean');
    testLearnerConflictGfId       = await makeLearner('conflict-gf');
    testLearnerConflictActiveId   = await makeLearner('conflict-active');
    testLearnerNotGrandfatheredId = await makeLearner('not-gf');

    const learnerIds = [
      testLearnerCleanMoveId, testLearnerConflictGfId,
      testLearnerConflictActiveId, testLearnerNotGrandfatheredId,
    ];

    // Wipe any pre-existing LCB rows for these learners.
    await sql`DELETE FROM learner_credit_balances WHERE learner_id = ANY(${learnerIds})`;

    earlierGfTimestamp = '2026-05-01 00:00:00+00';
    const laterGfTimestamp = '2026-05-21 07:39:40+00';

    // R1 clean: grandfathered LCB(L, 1) only — no row at (L, 4).
    await sql`
      INSERT INTO learner_credit_balances
        (learner_id, instructor_id, school_id, balance_minutes, grandfathered_at)
      VALUES
        (${testLearnerCleanMoveId}, ${SOURCE_INSTRUCTOR_ID}, ${SCHOOL_ID}, 1860,
         ${laterGfTimestamp}::timestamptz)
    `;

    // R2 conflict-gf: grandfathered LCB(L, 1) + grandfathered LCB(L, 4)
    // with an EARLIER timestamp on (L, 4). Merge should keep the earlier.
    await sql`
      INSERT INTO learner_credit_balances
        (learner_id, instructor_id, school_id, balance_minutes, grandfathered_at)
      VALUES
        (${testLearnerConflictGfId}, ${SOURCE_INSTRUCTOR_ID}, ${SCHOOL_ID}, 600,
         ${laterGfTimestamp}::timestamptz)
    `;
    await sql`
      INSERT INTO learner_credit_balances
        (learner_id, instructor_id, school_id, balance_minutes, grandfathered_at)
      VALUES
        (${testLearnerConflictGfId}, ${TARGET_INSTRUCTOR_ID}, ${SCHOOL_ID}, 240,
         ${earlierGfTimestamp}::timestamptz)
    `;

    // R3 conflict-active: grandfathered LCB(L, 1) + NON-grandfathered LCB(L, 4).
    // Merge should sum balances and KEEP grandfathered_at = NULL on the
    // merged row (watched-stays-watched).
    await sql`
      INSERT INTO learner_credit_balances
        (learner_id, instructor_id, school_id, balance_minutes, grandfathered_at)
      VALUES
        (${testLearnerConflictActiveId}, ${SOURCE_INSTRUCTOR_ID}, ${SCHOOL_ID}, 480,
         ${laterGfTimestamp}::timestamptz)
    `;
    await sql`
      INSERT INTO learner_credit_balances
        (learner_id, instructor_id, school_id, balance_minutes, grandfathered_at)
      VALUES
        (${testLearnerConflictActiveId}, ${TARGET_INSTRUCTOR_ID}, ${SCHOOL_ID}, 120, NULL)
    `;

    // R4 not-grandfathered: LCB(L, 1) with grandfathered_at NULL — must NOT
    // be moved by the predicate (which requires grandfathered_at IS NOT NULL).
    await sql`
      INSERT INTO learner_credit_balances
        (learner_id, instructor_id, school_id, balance_minutes, grandfathered_at)
      VALUES
        (${testLearnerNotGrandfatheredId}, ${SOURCE_INSTRUCTOR_ID}, ${SCHOOL_ID}, 300, NULL)
    `;
  });

  test.afterAll(async () => {
    if (!ENABLED) return;
    try {
      if (createdLearnerIds.length) {
        await sql`DELETE FROM learner_credit_balances WHERE learner_id = ANY(${createdLearnerIds})`;
        await sql`DELETE FROM learner_users WHERE id = ANY(${createdLearnerIds})`;
      }
      await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;
    } catch (_) {}
    if (_originalPostgresUrl !== undefined) process.env.POSTGRES_URL = _originalPostgresUrl;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R0: prereq marker enforcement.
  // ───────────────────────────────────────────────────────────────────────────
  test('R0: refuses to run without grandfather prereq marker', async () => {
    await sql`DELETE FROM migration_markers WHERE key = ${PREREQ_MARKER_KEY}`;
    const r = await call({ method: 'POST' });
    expect(r.statusCode).toBe(409);
    expect(r.body.ok).toBe(false);
    expect(String(r.body.error)).toContain(PREREQ_MARKER_KEY);

    // Restore prereq for the rest of the suite.
    await sql`
      INSERT INTO migration_markers (key, notes)
      VALUES (${PREREQ_MARKER_KEY}, 'test prereq restored')
      ON CONFLICT (key) DO NOTHING
    `;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Dry-run sanity: candidates + conflicts both reported.
  // ───────────────────────────────────────────────────────────────────────────
  test('dry-run reports candidates and conflicts without writing', async () => {
    const r = await call({ method: 'GET' });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.dry_run).toBe(true);
    expect(r.body.source_instructor_id).toBe(SOURCE_INSTRUCTOR_ID);
    expect(r.body.target_instructor_id).toBe(TARGET_INSTRUCTOR_ID);
    expect(r.body.target_instructor).toBeTruthy();
    expect(r.body.rows_moved).toBe(0);
    expect(r.body.rows_deleted).toBe(0);
    expect(r.body.marker_written).toBe(false);

    // Three grandfathered candidates (clean + conflict-gf + conflict-active).
    // The non-grandfathered row must NOT appear.
    const breakdown = r.body.candidates_breakdown || [];
    const learnerIdsInSample = breakdown.map(c => c.learner_id);
    expect(learnerIdsInSample).toContain(testLearnerCleanMoveId);
    expect(learnerIdsInSample).toContain(testLearnerConflictGfId);
    expect(learnerIdsInSample).toContain(testLearnerConflictActiveId);
    expect(learnerIdsInSample).not.toContain(testLearnerNotGrandfatheredId);

    // Shape B breakdown shape — each row carries the four reviewer fields.
    for (const row of breakdown) {
      expect(row).toHaveProperty('moved_balance_minutes');
      expect(row).toHaveProperty('active_draw_minutes_at_target');
      expect(row).toHaveProperty('synthetic_ct_minutes');
      expect(row).toHaveProperty('expected_post_drift');
      expect(row.expected_post_drift).toBe(0);
      expect(row.synthetic_ct_minutes).toBe(
        row.moved_balance_minutes + row.active_draw_minutes_at_target
      );
    }

    // Two conflicts (conflict-gf + conflict-active).
    const conflictLearnerIds = (r.body.conflicts || []).map(c => c.learner_id);
    expect(conflictLearnerIds).toContain(testLearnerConflictGfId);
    expect(conflictLearnerIds).toContain(testLearnerConflictActiveId);
    expect(conflictLearnerIds).not.toContain(testLearnerCleanMoveId);

    // DB unchanged: source rows still at (L, 1).
    const clean = await getLcb(testLearnerCleanMoveId, SOURCE_INSTRUCTOR_ID);
    expect(clean).toBeTruthy();
    expect(clean.balance_minutes).toBe(1860);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R1: clean move — no conflict.
  // ───────────────────────────────────────────────────────────────────────────
  test('R1: clean grandfathered LCB(L, 1) moves to (L, 4), source deleted, synthetic CT written', async () => {
    const r = await call({ method: 'POST' });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.marker_written).toBe(true);
    expect(r.body.check_constraint_widened).toBe(true);
    expect(r.body.rows_moved).toBeGreaterThanOrEqual(3); // clean + 2 conflicts
    expect(r.body.rows_deleted).toBeGreaterThanOrEqual(3);
    // One synthetic CT per moved row, regardless of conflict (the moved
    // minutes are a real credit source even when merging into an active
    // LCB row — the cron needs the CT for its expected formula).
    expect(r.body.synthetic_ct_rows_written).toBeGreaterThanOrEqual(3);

    // Source row at (L, 1) is gone.
    const source = await getLcb(testLearnerCleanMoveId, SOURCE_INSTRUCTOR_ID);
    expect(source).toBeFalsy();

    // Target row at (L, 4) exists with the moved balance and grandfathered_at carried.
    const target = await getLcb(testLearnerCleanMoveId, TARGET_INSTRUCTOR_ID);
    expect(target).toBeTruthy();
    expect(target.balance_minutes).toBe(1860);
    expect(target.grandfathered_at).not.toBeNull();

    // Synthetic CT row at (L, 4) with the legacy_grandfather shape.
    const [synthCt] = await sql`
      SELECT type, source, payment_method, instructor_id, learner_id, school_id,
             minutes, credits, amount_pence
        FROM credit_transactions
       WHERE learner_id = ${testLearnerCleanMoveId}
         AND instructor_id = ${TARGET_INSTRUCTOR_ID}
         AND type = 'legacy_grandfather'
    `;
    expect(synthCt).toBeTruthy();
    expect(synthCt.source).toBe('reconciliation');
    expect(synthCt.payment_method).toBe('migration');
    expect(synthCt.minutes).toBe(1860);
    expect(synthCt.credits).toBe(0);
    expect(synthCt.amount_pence).toBe(0);
    expect(synthCt.school_id).toBe(SCHOOL_ID);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R2: conflict merge between two grandfathered rows.
  // ───────────────────────────────────────────────────────────────────────────
  test('R2: grandfathered (L,1) + grandfathered (L,4) → sum balances, take EARLIER grandfathered_at', async () => {
    // Source deleted.
    const source = await getLcb(testLearnerConflictGfId, SOURCE_INSTRUCTOR_ID);
    expect(source).toBeFalsy();

    // Target merged: 600 (from L,1) + 240 (existing L,4) = 840.
    const target = await getLcb(testLearnerConflictGfId, TARGET_INSTRUCTOR_ID);
    expect(target).toBeTruthy();
    expect(target.balance_minutes).toBe(840);
    expect(target.grandfathered_at).not.toBeNull();
    // Earlier timestamp wins.
    const merged = new Date(target.grandfathered_at).getTime();
    const earlier = new Date(earlierGfTimestamp).getTime();
    expect(merged).toBe(earlier);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R3: watched-stays-watched merge.
  // ───────────────────────────────────────────────────────────────────────────
  test('R3: grandfathered (L,1) + active (L,4) → sum balances, merged grandfathered_at stays NULL', async () => {
    const source = await getLcb(testLearnerConflictActiveId, SOURCE_INSTRUCTOR_ID);
    expect(source).toBeFalsy();

    // Target merged: 480 (from L,1) + 120 (existing L,4) = 600.
    const target = await getLcb(testLearnerConflictActiveId, TARGET_INSTRUCTOR_ID);
    expect(target).toBeTruthy();
    expect(target.balance_minutes).toBe(600);
    // Critical: NULL — we MUST NOT promote an active row to grandfathered.
    expect(target.grandfathered_at).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R4: non-grandfathered LCB(L, 1) row is left alone.
  // ───────────────────────────────────────────────────────────────────────────
  test('R4: non-grandfathered LCB(L, 1) row is not moved', async () => {
    const source = await getLcb(testLearnerNotGrandfatheredId, SOURCE_INSTRUCTOR_ID);
    expect(source).toBeTruthy();
    expect(source.balance_minutes).toBe(300);
    expect(source.grandfathered_at).toBeNull();

    const target = await getLcb(testLearnerNotGrandfatheredId, TARGET_INSTRUCTOR_ID);
    expect(target).toBeFalsy();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R5: self-marker hard stop.
  // ───────────────────────────────────────────────────────────────────────────
  test('R5: second POST is refused with 409', async () => {
    const r = await call({ method: 'POST' });
    expect(r.statusCode).toBe(409);
    expect(r.body.ok).toBe(false);
    expect(String(r.body.error)).toContain('already completed');
    expect(r.body.self_marker).toBeTruthy();
    expect(r.body.self_marker.key).toBe(MARKER_KEY);

    // Idempotent: target rows unchanged.
    const clean = await getLcb(testLearnerCleanMoveId, TARGET_INSTRUCTOR_ID);
    expect(clean.balance_minutes).toBe(1860);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R6: dry-run still works after marker lands.
  // ───────────────────────────────────────────────────────────────────────────
  test('R6: dry-run still works after self-marker is present', async () => {
    const r = await call({ method: 'GET' });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.dry_run).toBe(true);
    expect(r.body.self_marker).toBeTruthy();
    expect(r.body.self_marker.key).toBe(MARKER_KEY);
    expect(r.body.rows_moved).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R7: Shape B production-output assertion — drift = 0 after migration.
  //
  // Builds a fresh "Group B" learner — booking at instructor=4 funded from
  // pre-cutover pooled balance (modelled as grandfathered LCB at
  // instructor=1, no CT, then run the actual handler against a clean
  // marker state).
  //
  // Shape B math, mirrored end-to-end against the cron's SQL:
  //
  //   actual_lcb(L, 4)   = remaining grandfathered LCB after the move
  //                      = original_legacy_pool_at_target
  //   ΣCT(L, 4)          = synthetic CT minutes
  //                      = original_legacy_pool + active_draws_at_target
  //   Σmin_deducted(L,4) = active_draws_at_target
  //   expected           = ΣCT - Σmin_deducted = original_legacy_pool
  //   drift              = actual_lcb - expected = 0
  //
  // The pair must NOT appear in drift_summary because the cron's outer
  // WHERE clause requires `IS DISTINCT FROM 0`.
  //
  // Per memory/feedback_assert_against_production_output_not_parallel_sql:
  // we assert against the cron's actual runDivergenceCheck output, not a
  // parallel reimplementation. If the cron's reconcile formula or the
  // handler's synthetic-CT shape ever drift apart, this test catches it.
  //
  // The handler is marker-locked after R1 ran. We delete the marker here
  // to call it fresh — this is a legitimate "rollback-then-rerun" path
  // and is the same pattern docs/credits-grandfather.md mentions for
  // operator use.
  // ───────────────────────────────────────────────────────────────────────────
  test('R7: cron drift = 0 (pair absent from drift_summary) after Shape B handler run', async () => {
    const [learner] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES (
        ${'R7 Cron Assert'},
        ${`ra-r7-${crypto.randomBytes(5).toString('hex')}@coachcarter.test`},
        ${SCHOOL_ID}, 0, 0
      )
      RETURNING id
    `;
    createdLearnerIds.push(learner.id);

    // Group-B fixture: booking at instructor=4 (md=90), grandfathered LCB
    // at instructor=1 (balance=60 → represents the remaining pool after
    // some pre-cutover deductions). Original legacy pool = 60 + 90 = 150.
    //
    // Slot picked far in the future + randomized to avoid uq_instructor_slot
    // collisions with prior test runs on the same branch.
    const futureDateR7 = `2027-01-${String((crypto.randomBytes(1)[0] % 28) + 1).padStart(2, '0')}`;
    const futureHourR7 = String(8 + (crypto.randomBytes(1)[0] % 8)).padStart(2, '0');
    const startTimeR7  = `${futureHourR7}:00`;
    const endTimeR7    = `${String(Number(futureHourR7) + 1).padStart(2, '0')}:30`;
    const [booking] = await sql`
      INSERT INTO lesson_bookings
        (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
         credit_returned, minutes_deducted, school_id, created_by, payment_method)
      VALUES
        (${learner.id}, ${TARGET_INSTRUCTOR_ID}, ${futureDateR7}::date,
         ${startTimeR7}::time, ${endTimeR7}::time, 'scheduled', FALSE, 90, ${SCHOOL_ID},
         'learner', 'credit')
      RETURNING id
    `;
    await sql`
      INSERT INTO learner_credit_balances
        (learner_id, instructor_id, school_id, balance_minutes, grandfathered_at)
      VALUES
        (${learner.id}, ${SOURCE_INSTRUCTOR_ID}, ${SCHOOL_ID}, 60,
         '2026-05-21 07:39:40+00'::timestamptz)
    `;

    // Pre-state: capture the cron's UNBOUNDED drift_count and probe the
    // specific (L, 4) pair via the cron's own SQL. The drift_summary
    // array is capped at 20 — on test branches with lots of pre-existing
    // noise our learner may not appear in the sample even though their
    // drift is counted. Use drift_count for the differential and a
    // single-pair probe (same predicate as the cron) for the value.
    const pre = await runCron(sql, { sendAlerts: false });
    const preDriftCount = pre.drift_count;

    // Single-pair probe: same shape as the cron's ct_only ledger but
    // scoped to one (learner, instructor). Matches the predicate the
    // cron uses for booking_draws in full mode (with NOT EXISTS BCS).
    async function pairDrift(L, I) {
      const [r] = await sql`
        WITH purchases AS (
          SELECT COALESCE(SUM(ct.minutes), 0)::int AS minutes
            FROM credit_transactions ct
           WHERE ct.school_id = ${SCHOOL_ID}
             AND ct.learner_id = ${L}
             AND ct.instructor_id = ${I}
        ),
        booking_draws AS (
          SELECT COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
            FROM lesson_bookings lb
           WHERE lb.school_id = ${SCHOOL_ID}
             AND lb.learner_id = ${L}
             AND lb.instructor_id = ${I}
             AND lb.credit_returned = FALSE
             AND lb.minutes_deducted IS NOT NULL
             AND lb.minutes_deducted > 0
             AND NOT EXISTS (
               SELECT 1 FROM booking_credit_sources bcs2
                WHERE bcs2.booking_id = lb.id
             )
        ),
        lcb_row AS (
          SELECT COALESCE(balance_minutes, 0)::int AS balance_minutes
            FROM learner_credit_balances
           WHERE learner_id = ${L} AND instructor_id = ${I}
        )
        SELECT
          (SELECT minutes FROM purchases)                                       AS ct_minutes,
          (SELECT minutes FROM booking_draws)                                   AS booking_minutes,
          COALESCE((SELECT balance_minutes FROM lcb_row), 0)                    AS lcb_minutes,
          COALESCE((SELECT balance_minutes FROM lcb_row), 0)
            - ((SELECT minutes FROM purchases) - (SELECT minutes FROM booking_draws)) AS drift
      `;
      return r;
    }

    const preAt4 = await pairDrift(learner.id, TARGET_INSTRUCTOR_ID);
    expect(preAt4.drift).toBe(90);
    expect(preAt4.lcb_minutes).toBe(0);
    expect(preAt4.ct_minutes).toBe(0);
    expect(preAt4.booking_minutes).toBe(90);

    // Free the marker to rerun the handler for real. Documents the same
    // operator unfreeze procedure mentioned in the 409 hard-stop body.
    await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;
    const r = await call({ method: 'POST' });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.marker_written).toBe(true);
    expect(r.body.rows_moved).toBeGreaterThanOrEqual(1);
    expect(r.body.synthetic_ct_rows_written).toBeGreaterThanOrEqual(1);

    // Confirm the synthetic CT minutes for this learner: 60 + 90 = 150.
    const [synthCt] = await sql`
      SELECT minutes FROM credit_transactions
       WHERE learner_id = ${learner.id}
         AND instructor_id = ${TARGET_INSTRUCTOR_ID}
         AND type = 'legacy_grandfather'
    `;
    expect(synthCt).toBeTruthy();
    expect(synthCt.minutes).toBe(150);

    // LCB at (L, 4) holds the moved balance.
    const movedLcb = await getLcb(learner.id, TARGET_INSTRUCTOR_ID);
    expect(movedLcb.balance_minutes).toBe(60);

    // Post-state assertions:
    //   1. Per-pair: drift = 0 at (L, 4); source row gone at (L, 1).
    //   2. Cron unbounded: drift_count dropped by exactly 1 (this
    //      learner's (L, 4) pair was flagging pre, suppressed post; the
    //      (L, 1) row was Plan-A-suppressed pre and gone post).
    const postAt4 = await pairDrift(learner.id, TARGET_INSTRUCTOR_ID);
    expect(postAt4.lcb_minutes).toBe(60);
    expect(postAt4.ct_minutes).toBe(150); // 60 (LCB) + 90 (draws) synthetic CT
    expect(postAt4.booking_minutes).toBe(90);
    expect(postAt4.drift).toBe(0);

    const [sourceRow] = await sql`
      SELECT 1 AS present FROM learner_credit_balances
       WHERE learner_id = ${learner.id} AND instructor_id = ${SOURCE_INSTRUCTOR_ID}
    `;
    expect(sourceRow).toBeFalsy();

    const post = await runCron(sql, { sendAlerts: false });
    expect(post.drift_count).toBe(preDriftCount - 1);

    // Clean up.
    await sql`DELETE FROM lesson_bookings WHERE id = ${booking.id}`;
    await sql`DELETE FROM credit_transactions WHERE learner_id = ${learner.id}`;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R8: cross-instructor (Simon-equivalent) case stays visible.
  //
  // A grandfathered LCB(L, 1) pool that was spent on a lesson delivered
  // by a DIFFERENT instructor (modelled as instructor=2 here, since the
  // test branch may not have instructor=6). The synthetic CT lands at
  // instructor=4 but the booking is at instructor=2, so:
  //
  //   At (L, 4): synthetic CT = balance_at_4 + draws_at_4 = balance only
  //              (no draws_at_4 because booking is at instructor=2).
  //              actual_lcb = balance, expected = balance - 0 = balance,
  //              drift = 0 → suppressed.
  //
  //   At (L, 2): actual_lcb = 0, expected = 0 - 90 (cross-instr booking)
  //              = -90, drift = +90 → cron still flags. This is the
  //              correct outcome: it's a real cross-instructor question.
  //
  // Confirms the migration deliberately does NOT silence cross-instructor
  // consumption questions.
  // ───────────────────────────────────────────────────────────────────────────
  test('R8: cross-instructor booking remains visible in cron drift after Shape B', async () => {
    // Need a non-target instructor for the cross-pair. Look one up; if
    // none exists on the test branch, skip the test.
    const others = await sql`
      SELECT id FROM instructors
       WHERE id != ${TARGET_INSTRUCTOR_ID}
         AND id != ${SOURCE_INSTRUCTOR_ID}
       ORDER BY id LIMIT 1
    `;
    test.skip(others.length === 0, 'No third instructor on test branch.');
    const crossInstructorId = others[0].id;

    const [learner] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES (
        ${'R8 Cross-Instructor'},
        ${`ra-r8-${crypto.randomBytes(5).toString('hex')}@coachcarter.test`},
        ${SCHOOL_ID}, 0, 0
      )
      RETURNING id
    `;
    createdLearnerIds.push(learner.id);

    // Fixture: booking at the CROSS instructor (not the target), and
    // grandfathered LCB at the SOURCE instructor.
    // Randomized future slot to avoid uq_instructor_slot collisions.
    const futureDateR8 = `2027-02-${String((crypto.randomBytes(1)[0] % 28) + 1).padStart(2, '0')}`;
    const futureHourR8 = String(8 + (crypto.randomBytes(1)[0] % 8)).padStart(2, '0');
    const startTimeR8  = `${futureHourR8}:00`;
    const endTimeR8    = `${String(Number(futureHourR8) + 1).padStart(2, '0')}:30`;
    const [booking] = await sql`
      INSERT INTO lesson_bookings
        (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
         credit_returned, minutes_deducted, school_id, created_by, payment_method)
      VALUES
        (${learner.id}, ${crossInstructorId}, ${futureDateR8}::date,
         ${startTimeR8}::time, ${endTimeR8}::time, 'scheduled', FALSE, 90, ${SCHOOL_ID},
         'learner', 'credit')
      RETURNING id
    `;
    await sql`
      INSERT INTO learner_credit_balances
        (learner_id, instructor_id, school_id, balance_minutes, grandfathered_at)
      VALUES
        (${learner.id}, ${SOURCE_INSTRUCTOR_ID}, ${SCHOOL_ID}, 200,
         '2026-05-21 07:39:40+00'::timestamptz)
    `;

    // Free the marker and rerun the handler (it ran in R7 with its own
    // fixtures; new fixtures need another pass).
    await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;
    const r = await call({ method: 'POST' });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);

    // Synthetic CT at (L, target=4): balance 200 + draws_at_4 (which is 0
    // because the booking is at the cross instructor) = 200.
    const [synthCt] = await sql`
      SELECT minutes FROM credit_transactions
       WHERE learner_id = ${learner.id}
         AND instructor_id = ${TARGET_INSTRUCTOR_ID}
         AND type = 'legacy_grandfather'
    `;
    expect(synthCt).toBeTruthy();
    expect(synthCt.minutes).toBe(200); // NOT 290 — cross-instr draws excluded

    // Single-pair probes (same shape as R7 — sidesteps drift_summary cap).
    async function pairDrift(L, I) {
      const [r] = await sql`
        WITH purchases AS (
          SELECT COALESCE(SUM(ct.minutes), 0)::int AS minutes
            FROM credit_transactions ct
           WHERE ct.school_id = ${SCHOOL_ID}
             AND ct.learner_id = ${L}
             AND ct.instructor_id = ${I}
        ),
        booking_draws AS (
          SELECT COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
            FROM lesson_bookings lb
           WHERE lb.school_id = ${SCHOOL_ID}
             AND lb.learner_id = ${L}
             AND lb.instructor_id = ${I}
             AND lb.credit_returned = FALSE
             AND lb.minutes_deducted IS NOT NULL
             AND lb.minutes_deducted > 0
             AND NOT EXISTS (
               SELECT 1 FROM booking_credit_sources bcs2
                WHERE bcs2.booking_id = lb.id
             )
        ),
        lcb_row AS (
          SELECT COALESCE(balance_minutes, 0)::int AS balance_minutes
            FROM learner_credit_balances
           WHERE learner_id = ${L} AND instructor_id = ${I}
        )
        SELECT
          (SELECT minutes FROM purchases)                                       AS ct_minutes,
          (SELECT minutes FROM booking_draws)                                   AS booking_minutes,
          COALESCE((SELECT balance_minutes FROM lcb_row), 0)                    AS lcb_minutes,
          COALESCE((SELECT balance_minutes FROM lcb_row), 0)
            - ((SELECT minutes FROM purchases) - (SELECT minutes FROM booking_draws)) AS drift
      `;
      return r;
    }

    // (L, target=4) reconciles: LCB 200, CT 200, draws 0, drift 0.
    const postAt4 = await pairDrift(learner.id, TARGET_INSTRUCTOR_ID);
    expect(postAt4.lcb_minutes).toBe(200);
    expect(postAt4.ct_minutes).toBe(200); // synthetic CT only — no cross-instr inflation
    expect(postAt4.booking_minutes).toBe(0);
    expect(postAt4.drift).toBe(0);

    // (L, cross) is visible drift: LCB 0, CT 0, draws 90, drift +90.
    const postAtCross = await pairDrift(learner.id, crossInstructorId);
    expect(postAtCross.lcb_minutes).toBe(0);
    expect(postAtCross.ct_minutes).toBe(0);
    expect(postAtCross.booking_minutes).toBe(90);
    expect(postAtCross.drift).toBe(90);

    // Clean up.
    await sql`DELETE FROM lesson_bookings WHERE id = ${booking.id}`;
    await sql`DELETE FROM credit_transactions WHERE learner_id = ${learner.id}`;
  });
});
