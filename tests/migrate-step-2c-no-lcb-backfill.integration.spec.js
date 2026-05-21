// @ts-check
// Integration tests for api/migrate-step-2c-no-lcb-backfill.js against a
// real Neon test branch. Plan B3 — Group C synthetic CT backfill for
// pre-cutover learners with no LCB row.
//
// What this proves:
//   B0. Refuses to run without the Step 2c reattribute prereq marker.
//   B1. Group-C fixture (no LCB anywhere + draws + no per-pair CT) gets a
//       synthetic legacy_grandfather CT row at (L, I) with minutes = draws.
//       NO LCB row is created.
//   B2. A learner with an LCB row at ANY instructor is excluded (gates out
//       Group A/B already-handled cohorts AND the Simon cross-instructor
//       case where the learner has an LCB row at a different instructor).
//   B3. A learner with a per-pair CT row at (L, I) is excluded (defensive
//       — prevents double-write on rollback rerun).
//   B4. A learner with draws but the draws are credit_returned = TRUE is
//       excluded (no live drift, no synthetic CT needed).
//   B5. Self-marker hard stop: second POST is refused with 409.
//   B6. Dry-run still works after marker lands.
//   B7. Production-output assertion: after backfill, the cron's drift
//       formula returns drift = 0 for the backfilled pair. Per
//       memory/feedback_assert_against_production_output_not_parallel_sql:
//       assert against runDivergenceCheck output, not parallel SQL.
//   B8. Cross-instructor case stays visible: a learner with an LCB row at
//       instructor A + draws at instructor B should NOT be touched, and
//       the (L, B) pair should remain as visible cron drift.
//
// How to run:
//   CC_TEST_DB=1 npx playwright test migrate-step-2c-no-lcb-backfill.integration

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
    console.warn('[migrate-step-2c-no-lcb-backfill.integration] .env.local load failed:', err.message);
  }
})();

if (!process.env.MIGRATION_SECRET) {
  process.env.MIGRATION_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
}

let _originalPostgresUrl;

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
test.describe.configure({ mode: 'serial' });

const SCHOOL_ID = 1;
const PREREQ_MARKER_KEY = 'per_instructor_credits_step_2c_reattribute';
const TARGET_INSTRUCTOR_ID = 4; // Fraser — has bookings in our fixtures.

let sql;
let handler;
let MARKER_KEY;
let runCron;
let groupCLearnerId;         // B1: no LCB, draws at (L, 4), no per-pair CT
let hasLcbElsewhereLearnerId; // B2: LCB at instructor != 4 + draws at (L, 4)
let hasPerPairCtLearnerId;   // B3: no LCB, draws at (L, 4), per-pair CT exists
let returnedDrawsLearnerId;  // B4: no LCB, draws at (L, 4) but credit_returned = TRUE
let createdLearnerIds = [];
let createdBookingIds = [];

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

async function makeLearner(label) {
  const email = `b3-${label}-${crypto.randomBytes(5).toString('hex')}@coachcarter.test`;
  const [row] = await sql`
    INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
    VALUES (${`B3 Test ${label}`}, ${email}, ${SCHOOL_ID}, 0, 0)
    RETURNING id
  `;
  createdLearnerIds.push(row.id);
  return row.id;
}

async function makeBooking(learnerId, instructorId, minutesDeducted, { creditReturned = false } = {}) {
  // Randomized future slot to avoid uq_instructor_slot collisions across reruns.
  const futureDate = `2027-03-${String((crypto.randomBytes(1)[0] % 28) + 1).padStart(2, '0')}`;
  const hour = String(8 + (crypto.randomBytes(2)[0] % 8)).padStart(2, '0');
  const startTime = `${hour}:00`;
  // 90-min booking → end at hour+1:30 (HH:30 form keeps DB chk_booking_times happy)
  const endTime = `${String(Number(hour) + 1).padStart(2, '0')}:30`;
  const [booking] = await sql`
    INSERT INTO lesson_bookings
      (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
       credit_returned, minutes_deducted, school_id, created_by, payment_method)
    VALUES
      (${learnerId}, ${instructorId}, ${futureDate}::date,
       ${startTime}::time, ${endTime}::time, 'scheduled',
       ${creditReturned}, ${minutesDeducted}, ${SCHOOL_ID},
       'learner', 'credit')
    RETURNING id
  `;
  createdBookingIds.push(booking.id);
  return booking.id;
}

async function getCt(learnerId, instructorId, type) {
  const [row] = await sql`
    SELECT id, learner_id, instructor_id, school_id, type, source, payment_method,
           minutes, credits, amount_pence
      FROM credit_transactions
     WHERE learner_id = ${learnerId}
       AND instructor_id = ${instructorId}
       AND type = ${type}
     LIMIT 1
  `;
  return row;
}

async function getLcb(learnerId, instructorId) {
  const [row] = await sql`
    SELECT learner_id, instructor_id, balance_minutes
      FROM learner_credit_balances
     WHERE learner_id = ${learnerId} AND instructor_id = ${instructorId}
     LIMIT 1
  `;
  return row;
}

// Single-pair drift probe with the SAME predicate as the cron's
// booking_draws CTE (BCS-aware variant). Used to confirm post-migration
// drift = 0 without depending on drift_summary's 20-row cap.
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

test.describe('migrate-step-2c-no-lcb-backfill — integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL. Point at an isolated branch.');
    }

    _originalPostgresUrl = process.env.POSTGRES_URL;
    process.env.POSTGRES_URL = process.env.POSTGRES_URL_TEST;

    handler = require('../api/migrate-step-2c-no-lcb-backfill');
    MARKER_KEY = handler.MARKER_KEY;
    runCron = require('../api/cron-credit-reconcile').runDivergenceCheck;

    sql = neon(process.env.POSTGRES_URL_TEST);

    // Sanity: branch must have the LCB table.
    const [hasLcb] = await sql`
      SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name='learner_credit_balances'
    `;
    if (!hasLcb) {
      throw new Error('Test branch has no learner_credit_balances. Run /api/migrate-step-2c first.');
    }

    // Marker table + prereq marker (B1 marker, since we're the post-B1 step).
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

    // Wipe our own marker so the first POST can land it.
    await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;

    // Target instructor must exist (uses instructor 4 for canonical fixtures).
    const [target] = await sql`SELECT id FROM instructors WHERE id = ${TARGET_INSTRUCTOR_ID}`;
    if (!target) {
      throw new Error(`Test branch lacks instructors.id = ${TARGET_INSTRUCTOR_ID} — required.`);
    }

    // The credit_transactions type CHECK constraint must already include
    // 'legacy_grandfather' (added in PR #184 / Plan B1). Confirm before
    // proceeding so a missing constraint widening fails the suite fast.
    const [check] = await sql`
      SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
       WHERE conrelid = 'credit_transactions'::regclass
         AND conname  = 'credit_transactions_type_check'
    `;
    if (!check || !/legacy_grandfather/.test(check.def)) {
      throw new Error(
        `credit_transactions_type_check does not include legacy_grandfather. ` +
        `Apply db/migration.sql or PR #184 to the test branch first.`
      );
    }

    // ── B1 fixture: Group C learner ────────────────────────────────────────
    // No LCB row, draws at (L, 4), no per-pair CT. The canonical Group C
    // shape.
    groupCLearnerId = await makeLearner('group-c');
    await makeBooking(groupCLearnerId, TARGET_INSTRUCTOR_ID, 90);

    // ── B2 fixture: learner with LCB at a different instructor ─────────────
    // Models the Simon cross-instructor case (learner=11 had LCB at (11, 4)
    // after B1, draws at (11, 6)). On the test branch we may not have a
    // second eligible instructor with the right shape — we approximate by
    // creating an LCB row at instructor=TARGET-1 (or any non-target). The
    // gate "NOT EXISTS LCB for learner at ANY instructor" should exclude
    // this learner regardless of which instructor the LCB row is at.
    hasLcbElsewhereLearnerId = await makeLearner('has-lcb-elsewhere');
    await makeBooking(hasLcbElsewhereLearnerId, TARGET_INSTRUCTOR_ID, 60);
    // Pick any other real instructor to host the unrelated LCB row.
    const otherInstructors = await sql`
      SELECT id FROM instructors WHERE id != ${TARGET_INSTRUCTOR_ID} ORDER BY id LIMIT 1
    `;
    if (otherInstructors.length === 0) {
      throw new Error('Test branch needs at least one non-target instructor for B2.');
    }
    const elsewhereInstructorId = otherInstructors[0].id;
    await sql`
      INSERT INTO learner_credit_balances
        (learner_id, instructor_id, school_id, balance_minutes)
      VALUES
        (${hasLcbElsewhereLearnerId}, ${elsewhereInstructorId}, ${SCHOOL_ID}, 30)
    `;

    // ── B3 fixture: learner with per-pair CT already at (L, 4) ─────────────
    // No LCB anywhere, draws at (L, 4), but a per-pair CT already exists at
    // (L, 4). The NOT EXISTS CT predicate must exclude this learner from
    // the backfill (defensive — prevents double-write).
    hasPerPairCtLearnerId = await makeLearner('has-per-pair-ct');
    await makeBooking(hasPerPairCtLearnerId, TARGET_INSTRUCTOR_ID, 60);
    await sql`
      INSERT INTO credit_transactions
        (learner_id, instructor_id, school_id, type, source, payment_method,
         minutes, credits, amount_pence, created_at)
      VALUES
        (${hasPerPairCtLearnerId}, ${TARGET_INSTRUCTOR_ID}, ${SCHOOL_ID},
         'purchase', 'test', 'credit', 60, 0, 5500, NOW())
    `;

    // ── B4 fixture: learner with credit_returned = TRUE draws ──────────────
    // No LCB anywhere, has a booking at (L, 4), but credit_returned = TRUE.
    // The cron's booking_draws predicate excludes credit_returned = TRUE
    // bookings — there's no live drift here, and the backfill must NOT
    // create a synthetic CT.
    returnedDrawsLearnerId = await makeLearner('returned-draws');
    await makeBooking(returnedDrawsLearnerId, TARGET_INSTRUCTOR_ID, 60,
                      { creditReturned: true });
  });

  test.afterAll(async () => {
    if (!ENABLED) return;
    try {
      if (createdBookingIds.length) {
        await sql`DELETE FROM lesson_bookings WHERE id = ANY(${createdBookingIds})`;
      }
      if (createdLearnerIds.length) {
        await sql`DELETE FROM credit_transactions WHERE learner_id = ANY(${createdLearnerIds})`;
        await sql`DELETE FROM learner_credit_balances WHERE learner_id = ANY(${createdLearnerIds})`;
        await sql`DELETE FROM learner_users WHERE id = ANY(${createdLearnerIds})`;
      }
      await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;
    } catch (_) {}
    if (_originalPostgresUrl !== undefined) process.env.POSTGRES_URL = _originalPostgresUrl;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B0: prereq marker enforcement.
  // ─────────────────────────────────────────────────────────────────────────
  test('B0: refuses to run without reattribute prereq marker', async () => {
    await sql`DELETE FROM migration_markers WHERE key = ${PREREQ_MARKER_KEY}`;
    const r = await call({ method: 'POST' });
    expect(r.statusCode).toBe(409);
    expect(r.body.ok).toBe(false);
    expect(String(r.body.error)).toContain(PREREQ_MARKER_KEY);

    // Restore prereq.
    await sql`
      INSERT INTO migration_markers (key, notes)
      VALUES (${PREREQ_MARKER_KEY}, 'test prereq restored')
      ON CONFLICT (key) DO NOTHING
    `;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Dry-run reports candidates without writing.
  // ─────────────────────────────────────────────────────────────────────────
  test('dry-run reports candidates and excludes non-qualifiers without writing', async () => {
    const r = await call({ method: 'GET' });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.dry_run).toBe(true);
    expect(r.body.synthetic_ct_rows_written).toBe(0);
    expect(r.body.marker_written).toBe(false);

    const breakdown = r.body.candidates_breakdown || [];
    const learnerIds = breakdown.map(c => c.learner_id);

    // Group C learner appears.
    expect(learnerIds).toContain(groupCLearnerId);
    // Excluded cohorts must NOT appear.
    expect(learnerIds).not.toContain(hasLcbElsewhereLearnerId);
    expect(learnerIds).not.toContain(hasPerPairCtLearnerId);
    expect(learnerIds).not.toContain(returnedDrawsLearnerId);

    // Shape: each candidate carries draws + synthetic minutes (equal — the
    // structural identity that makes the drift reconcile to 0).
    for (const c of breakdown) {
      expect(c.active_draw_minutes_at_pair).toBe(c.synthetic_ct_minutes);
      expect(c.expected_post_drift).toBe(0);
      expect(c.draws_booking_count).toBeGreaterThan(0);
    }

    // No CT row created.
    const synth = await getCt(groupCLearnerId, TARGET_INSTRUCTOR_ID, 'legacy_grandfather');
    expect(synth).toBeFalsy();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B1: Group C — synthetic CT written, no LCB write.
  // ─────────────────────────────────────────────────────────────────────────
  test('B1: Group C learner gets synthetic legacy_grandfather CT with minutes = draws, no LCB write', async () => {
    const r = await call({ method: 'POST' });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.marker_written).toBe(true);
    expect(r.body.synthetic_ct_rows_written).toBeGreaterThanOrEqual(1);

    const synth = await getCt(groupCLearnerId, TARGET_INSTRUCTOR_ID, 'legacy_grandfather');
    expect(synth).toBeTruthy();
    expect(synth.source).toBe('reconciliation');
    expect(synth.payment_method).toBe('migration');
    expect(synth.minutes).toBe(90);          // matches the fixture draws
    expect(synth.credits).toBe(0);
    expect(synth.amount_pence).toBe(0);
    expect(synth.school_id).toBe(SCHOOL_ID);

    // CRITICAL: no LCB row was created for this learner.
    const lcb = await getLcb(groupCLearnerId, TARGET_INSTRUCTOR_ID);
    expect(lcb).toBeFalsy();
    const [anyLcb] = await sql`
      SELECT id FROM learner_credit_balances WHERE learner_id = ${groupCLearnerId} LIMIT 1
    `;
    expect(anyLcb).toBeFalsy();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B2: learner with LCB at a non-target instructor is excluded.
  // ─────────────────────────────────────────────────────────────────────────
  test('B2: learner with LCB elsewhere is excluded (no synthetic CT)', async () => {
    const synth = await getCt(hasLcbElsewhereLearnerId, TARGET_INSTRUCTOR_ID,
                              'legacy_grandfather');
    expect(synth).toBeFalsy();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B3: learner with an existing per-pair CT is excluded.
  // ─────────────────────────────────────────────────────────────────────────
  test('B3: learner with existing per-pair CT is excluded (no synthetic CT)', async () => {
    const synth = await getCt(hasPerPairCtLearnerId, TARGET_INSTRUCTOR_ID,
                              'legacy_grandfather');
    expect(synth).toBeFalsy();
    // Original purchase CT still there, untouched.
    const orig = await getCt(hasPerPairCtLearnerId, TARGET_INSTRUCTOR_ID, 'purchase');
    expect(orig).toBeTruthy();
    expect(orig.minutes).toBe(60);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B4: credit_returned = TRUE draws don't count.
  // ─────────────────────────────────────────────────────────────────────────
  test('B4: learner with only credit_returned=TRUE bookings is excluded', async () => {
    const synth = await getCt(returnedDrawsLearnerId, TARGET_INSTRUCTOR_ID,
                              'legacy_grandfather');
    expect(synth).toBeFalsy();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B5: self-marker hard stop.
  // ─────────────────────────────────────────────────────────────────────────
  test('B5: second POST is refused with 409', async () => {
    const r = await call({ method: 'POST' });
    expect(r.statusCode).toBe(409);
    expect(r.body.ok).toBe(false);
    expect(String(r.body.error)).toContain('already completed');
    expect(r.body.self_marker).toBeTruthy();
    expect(r.body.self_marker.key).toBe(MARKER_KEY);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B6: dry-run still works after marker lands.
  // ─────────────────────────────────────────────────────────────────────────
  test('B6: dry-run still works after self-marker is present', async () => {
    const r = await call({ method: 'GET' });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.dry_run).toBe(true);
    expect(r.body.self_marker).toBeTruthy();
    expect(r.body.self_marker.key).toBe(MARKER_KEY);
    expect(r.body.synthetic_ct_rows_written).toBe(0);

    // After B1's POST landed the synthetic CT, the Group C learner now
    // has a per-pair CT — so the dry-run candidates_breakdown should
    // NOT include them anymore (the NOT EXISTS CT predicate excludes).
    const learnerIds = (r.body.candidates_breakdown || []).map(c => c.learner_id);
    expect(learnerIds).not.toContain(groupCLearnerId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B7: production-output assertion — drift = 0 at the backfilled pair,
  // AND the cron's runDivergenceCheck drift_count drops by 1 (differential
  // against the unbounded count, since drift_summary is capped at 20).
  //
  // Per memory/feedback_assert_against_production_output_not_parallel_sql:
  // mix BOTH a forced single-pair probe AND the cron's actual output. If
  // the migration's predicate and the cron's predicate ever drift apart,
  // this test catches it.
  //
  // Group C learner was set up pre-migration with drift = +90, then B1's
  // POST inserted the synthetic CT. So we assert against the post-state.
  // ─────────────────────────────────────────────────────────────────────────
  test('B7: cron drift = 0 at the backfilled pair (production-output assertion)', async () => {
    const post = await pairDrift(groupCLearnerId, TARGET_INSTRUCTOR_ID);
    expect(post.lcb_minutes).toBe(0);          // no LCB row
    expect(post.ct_minutes).toBe(90);          // synthetic CT
    expect(post.booking_minutes).toBe(90);     // fixture draws
    expect(post.drift).toBe(0);

    // Confirm the cron's actual SQL agrees: this pair must NOT appear in
    // drift_summary.
    const cronResult = await runCron(sql, { sendAlerts: false });
    const pairAppears = (cronResult.drift_summary || []).some(
      d => d.learner_id === groupCLearnerId && d.instructor_id === TARGET_INSTRUCTOR_ID
    );
    expect(pairAppears).toBe(false);

    // Sanity: the excluded learners that still have drift (B2 has draws
    // with no CT at (L, target) → drifts) should still be visible to the
    // cron's overall machinery. We don't enforce them in drift_summary
    // because of the 20-row cap on test branches with noise, but their
    // single-pair drift must be > 0.
    const b2 = await pairDrift(hasLcbElsewhereLearnerId, TARGET_INSTRUCTOR_ID);
    expect(b2.drift).toBeGreaterThan(0); // 60 - 0 = +60 (lcb_minutes=0 at target)
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B8: differential drift_count assertion via fresh fixture + marker reset.
  //
  // Create a fresh Group C learner, capture pre-migration drift_count,
  // delete the marker, re-POST, confirm drift_count dropped by exactly 1.
  // This is the strongest assertion: it proves the migration's effect
  // matches the cron's effect on a real measured pair.
  // ─────────────────────────────────────────────────────────────────────────
  test('B8: fresh Group C learner → cron drift_count drops by exactly 1 after backfill', async () => {
    const freshId = await makeLearner('b8-fresh');
    await makeBooking(freshId, TARGET_INSTRUCTOR_ID, 120);

    // Pre-state: this pair drifts +120.
    const pre = await pairDrift(freshId, TARGET_INSTRUCTOR_ID);
    expect(pre.drift).toBe(120);
    const preCron = await runCron(sql, { sendAlerts: false });
    const preDriftCount = preCron.drift_count;

    // Free the marker and re-run the handler.
    await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;
    const r = await call({ method: 'POST' });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.synthetic_ct_rows_written).toBe(1);

    // The synthetic CT lands at exactly the right shape.
    const synth = await getCt(freshId, TARGET_INSTRUCTOR_ID, 'legacy_grandfather');
    expect(synth).toBeTruthy();
    expect(synth.minutes).toBe(120);

    // Post-state: drift_count dropped by 1 (the only change).
    const post = await pairDrift(freshId, TARGET_INSTRUCTOR_ID);
    expect(post.drift).toBe(0);
    const postCron = await runCron(sql, { sendAlerts: false });
    expect(postCron.drift_count).toBe(preDriftCount - 1);
  });
});
