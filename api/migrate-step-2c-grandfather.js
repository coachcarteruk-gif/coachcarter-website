// Step 2c grandfather — backfill learner_credit_balances.grandfathered_at on
// legacy LCB rows created by /api/migrate-step-2c's mechanical
// balance_minutes-copy backfill. Per Plan A in
// memory/project_step_4_5_shipped.md and PER-INSTRUCTOR-CREDITS-PLAN.md
// §Step 2 backfill (L601-611).
//
// Usage:
//   GET  /api/migrate-step-2c-grandfather?secret=...  → dry-run report
//   POST /api/migrate-step-2c-grandfather?secret=...  → write grandfathered_at + marker
//
// What this does:
//   1. ALTER TABLE learner_credit_balances ADD COLUMN IF NOT EXISTS
//      grandfathered_at TIMESTAMPTZ (idempotent; the same DDL also lives in
//      db/migration.sql so /api/migrate ships it via the catch-all path).
//   2. UPDATE learner_credit_balances SET grandfathered_at = NOW()
//      WHERE the row is pure-legacy: balance_minutes > 0, grandfathered_at
//      currently NULL, and NO credit_transactions rows exist for that
//      (school_id, learner_id, instructor_id) pair.
//   3. Write 'per_instructor_credits_step_2c_grandfather' marker.
//
// What the predicate is and why:
//   The load-bearing predicate is the pair-scoped NOT EXISTS on
//   credit_transactions. That is the structural definition of "legacy
//   pre-Phase-2A backfill": an LCB row whose per-pair ledger is completely
//   empty. Any pair with at least one credit_transactions row, even a
//   zero-minute one, is excluded from grandfathering — those have ledger
//   activity and must be resolved in the drift report manually.
//
//   The Step 2c migration_markers row's completed_at is reported in dry-run
//   output as supporting evidence ("how many of the rows we're about to
//   grandfather have updated_at within 60s of the 2c marker"), but it is
//   NOT used in the predicate. Step 2c's backfill INSERT and marker write
//   are two separately-awaited SQL statements with no explicit BEGIN, so
//   updated_at ≈ marker.completed_at is a correlation clue, not a
//   transactional guarantee.
//
// What this does NOT do:
//   - Does NOT touch mixed-state rows (legacy backfill + new Phase-2A
//     activity on the same pair). Those keep flagging in the divergence
//     cron until manually resolved, after which the operator can
//     UPDATE…SET grandfathered_at = NOW() by hand if appropriate.
//   - Does NOT change cron-credit-reconcile.js — the conditional
//     suppression predicate is added there in a separate edit in this PR.
//   - Does NOT touch Step 6 four-scenario grandfather policy
//     (docs/credits-grandfather.md TODO). This migration is mechanical.

const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { safeEqual } = require('./_auth');

const PREREQ_MARKER_KEY = 'per_instructor_credits_step_2c';
const MARKER_KEY        = 'per_instructor_credits_step_2c_grandfather';

const SCHOOL_ID = 1; // CoachCarter — only school with per-instructor credits at the cutover.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.query.secret || req.headers['x-migration-secret'];
  if (!safeEqual(secret, process.env.MIGRATION_SECRET)) {
    return res.status(401).json({ error: 'Invalid or missing migration secret' });
  }

  const isDryRun = req.method === 'GET' || req.query.dry_run === '1';

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // ── Prereq marker check ─────────────────────────────────────────────────
    const [prereqRow] = await sql`
      SELECT key, completed_at::text AS completed_at
        FROM migration_markers
       WHERE key = ${PREREQ_MARKER_KEY}
       LIMIT 1
    `;
    if (!prereqRow) {
      return res.status(409).json({
        ok: false,
        error: `Step 2c grandfather requires ${PREREQ_MARKER_KEY} marker. Run /api/migrate-step-2c first.`,
      });
    }

    // ── Self-marker hard stop (P1) ─────────────────────────────────────────
    // If our own marker already exists, this is a rerun. Dry-run (GET) is
    // still allowed so the operator can inspect what the predicate WOULD do
    // against current data, but POST refuses. Rationale: a later POST could
    // grandfather a newly-created bad LCB row (LCB > 0, no per-pair CT) that
    // is in fact a writer regression we want the cron to alert on — silencing
    // it as "legacy" would be the wrong outcome.
    //
    // Re-grandfathering after a true rollback is a manual action: DELETE the
    // marker row first, then re-POST. This is deliberately friction-laden.
    const [selfMarkerRow] = await sql`
      SELECT key, completed_at::text AS completed_at
        FROM migration_markers
       WHERE key = ${MARKER_KEY}
       LIMIT 1
    `;
    if (selfMarkerRow && !isDryRun) {
      return res.status(409).json({
        ok: false,
        error: `Migration already completed at ${selfMarkerRow.completed_at}. ` +
               `Refusing to rerun — a second pass could silence a newly-created bad LCB ` +
               `row as "legacy". To force a rerun (e.g. after a deliberate rollback), ` +
               `DELETE the '${MARKER_KEY}' row from migration_markers first.`,
        self_marker: selfMarkerRow,
      });
    }

    // ── Ensure the column exists (idempotent) ──────────────────────────────
    // Mirror of db/migration.sql; running this here means the endpoint can
    // be invoked on environments where the generic /api/migrate hasn't been
    // re-run yet.
    await sql`
      ALTER TABLE learner_credit_balances
        ADD COLUMN IF NOT EXISTS grandfathered_at TIMESTAMPTZ
    `;

    // ── Confirm the column landed ──────────────────────────────────────────
    const [colRow] = await sql`
      SELECT 1 AS present
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = 'learner_credit_balances'
         AND column_name  = 'grandfathered_at'
       LIMIT 1
    `;
    if (!colRow) {
      return res.status(500).json({
        ok: false,
        error: 'grandfathered_at column missing after ALTER. Aborting.',
      });
    }

    // ── Candidate set: pure-legacy rows ────────────────────────────────────
    // The predicate IS the load-bearing definition of "legacy". An LCB row
    // qualifies iff:
    //   • school_id = 1 (only school in scope at cutover),
    //   • balance_minutes > 0 (something to grandfather; zero-balance rows
    //     don't drift even without the flag),
    //   • grandfathered_at IS NULL (don't re-mark already-grandfathered),
    //   • no credit_transactions row exists for the (learner, instructor)
    //     pair at the same school — the structural shape of pre-Phase-2A
    //     backfill that has had no Phase-2A activity since.
    const candidates = await sql`
      SELECT
        lcb.learner_id,
        lcb.instructor_id,
        lcb.balance_minutes,
        lcb.grandfathered_at::text AS grandfathered_at,
        lcb.updated_at::text       AS lcb_updated_at,
        COALESCE((
          SELECT COUNT(*)::int FROM credit_transactions ct
           WHERE ct.school_id     = lcb.school_id
             AND ct.learner_id    = lcb.learner_id
             AND ct.instructor_id = lcb.instructor_id
        ), 0) AS scoped_ct_count,
        COALESCE((
          SELECT SUM(ct.minutes)::int FROM credit_transactions ct
           WHERE ct.school_id     = lcb.school_id
             AND ct.learner_id    = lcb.learner_id
             AND ct.instructor_id = lcb.instructor_id
        ), 0) AS scoped_ct_minutes
      FROM learner_credit_balances lcb
      WHERE lcb.school_id        = ${SCHOOL_ID}
        AND lcb.balance_minutes  > 0
        AND lcb.grandfathered_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM credit_transactions ct
           WHERE ct.school_id     = lcb.school_id
             AND ct.learner_id    = lcb.learner_id
             AND ct.instructor_id = lcb.instructor_id
        )
      ORDER BY lcb.balance_minutes DESC, lcb.learner_id, lcb.instructor_id
    `;

    // ── Supporting evidence: Step 2c marker-window correlation count ───────
    // Of the candidates, how many have lcb.updated_at within 60s of the
    // Step 2c marker.completed_at. NOT used in the predicate — eyeball aid
    // only.
    const [{ marker_window_match_count }] = await sql`
      SELECT COUNT(*)::int AS marker_window_match_count
        FROM learner_credit_balances lcb
       WHERE lcb.school_id        = ${SCHOOL_ID}
         AND lcb.balance_minutes  > 0
         AND lcb.grandfathered_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM credit_transactions ct
            WHERE ct.school_id     = lcb.school_id
              AND ct.learner_id    = lcb.learner_id
              AND ct.instructor_id = lcb.instructor_id
         )
         AND lcb.updated_at BETWEEN
              (${prereqRow.completed_at}::timestamptz - interval '60 seconds')
          AND (${prereqRow.completed_at}::timestamptz + interval '60 seconds')
    `;

    const result = {
      dry_run: isDryRun,
      prereq_marker: prereqRow,
      self_marker: selfMarkerRow || null,
      column_present: true,
      candidate_count: candidates.length,
      candidates_sample: candidates.slice(0, 25), // bounded for the JSON body
      candidates_total: candidates.length,
      marker_window_match_count,
      rows_updated: 0,
      marker_written: false,
    };

    if (isDryRun) {
      return res.json({ ok: true, ...result });
    }

    // ── Write grandfathered_at = NOW() to candidates ───────────────────────
    // RE-EVALUATE the predicate at UPDATE time (not via id-in list). The
    // candidate query above used a snapshot; if a Phase-2A writer landed
    // a credit_transactions row for a candidate pair between the SELECT
    // and the UPDATE, that pair must NOT be grandfathered. The pair-scoped
    // NOT EXISTS in the UPDATE WHERE is the authoritative predicate.
    const updated = await sql`
      UPDATE learner_credit_balances lcb
         SET grandfathered_at = NOW()
       WHERE lcb.school_id        = ${SCHOOL_ID}
         AND lcb.balance_minutes  > 0
         AND lcb.grandfathered_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM credit_transactions ct
            WHERE ct.school_id     = lcb.school_id
              AND ct.learner_id    = lcb.learner_id
              AND ct.instructor_id = lcb.instructor_id
         )
      RETURNING lcb.learner_id, lcb.instructor_id
    `;
    result.rows_updated = updated.length;

    // ── Marker write ────────────────────────────────────────────────────────
    const markerRows = await sql`
      INSERT INTO migration_markers (key, notes)
      VALUES (${MARKER_KEY}, ${`grandfathered_at backfill for pure-legacy LCB rows — ${updated.length} row(s) flagged`})
      ON CONFLICT (key) DO NOTHING
      RETURNING key, completed_at::text AS completed_at
    `;
    result.marker_written        = markerRows.length > 0;
    result.marker_already_present = markerRows.length === 0;

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[step-2c-grandfather] migration failed:', err);
    reportError('/api/migrate-step-2c-grandfather', err);
    return res.status(500).json({ ok: false, error: 'Migration failed', details: err.message });
  }
};

module.exports.MARKER_KEY        = MARKER_KEY;
module.exports.PREREQ_MARKER_KEY = PREREQ_MARKER_KEY;
module.exports.SCHOOL_ID         = SCHOOL_ID;
