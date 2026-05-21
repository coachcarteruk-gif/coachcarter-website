// Step 2c re-attribution + synthetic-CT backfill (Plan B1). Fixes the
// wrong-instructor target chosen by /api/migrate-step-2c's mechanical
// backfill, and makes the per-instructor ledger internally coherent by
// emitting one synthetic credit_transactions row per moved learner. The
// synthetic CT records the ORIGINAL legacy pool size at the target
// instructor — i.e. current grandfathered LCB balance PLUS all active
// booking draws at that pair — so the divergence cron's
// expected = ΣCT − Σmin_deducted formula reconciles exactly against the
// moved LCB balance. Drift on every re-attributed pair becomes 0 by
// construction.
//
// Usage:
//   GET  /api/migrate-step-2c-reattribute?secret=...  → dry-run report
//   POST /api/migrate-step-2c-reattribute?secret=...  → DDL + move + backfill + marker
//
// What this does (in order, atomically per-pair via a single CTE):
//   0. Widen credit_transactions_type_check to include 'legacy_grandfather'.
//   1. For every grandfathered LCB row at instructor_id=1 (the seed
//      "James Carter" row Step 2c mistakenly targeted), move the balance
//      to instructor_id=4 (Fraser's real account). DELETE the source row.
//   2. Insert ONE synthetic credit_transactions row per moved (learner,
//      target=4) pair, with:
//        type            = 'legacy_grandfather'
//        source          = 'reconciliation'
//        payment_method  = 'migration'
//        instructor_id   = 4
//        minutes         = moved_lcb.balance_minutes + active_draws_at_target
//        amount_pence    = 0
//        credits         = 0
//      "active_draws_at_target" mirrors the cron's booking_draws CTE
//      predicate EXACTLY (per schema mode) so the cron's reconcile math
//      agrees by construction.
//   3. Write 'per_instructor_credits_step_2c_reattribute' marker.
//
// Shape B synthetic-CT math (per Fraser's call on the Plan C handoff):
//
//   original_legacy_pool_at_target_instructor
//     = remaining_grandfathered_lcb_at_target
//     + already_spent_active_draws_at_target
//
//   synthetic_ct.minutes = original_legacy_pool_at_target_instructor
//
//   actual_lcb(L, 4)   = remaining_grandfathered_lcb_at_target
//   expected           = ΣCT − Σmin_deducted
//                      = synthetic_ct.minutes − active_draws_at_target
//                      = (remaining + draws) − draws
//                      = remaining
//   drift              = actual_lcb − expected = remaining − remaining = 0
//
// Mirroring the cron's predicate is load-bearing — if the migration and
// cron disagree about what counts as a draw, the migration manufactures
// a new drift class. The handler probes information_schema to pick the
// matching draws-predicate variant (ct_only / ct_plus_bcs / full),
// identical to api/cron-credit-reconcile.js::probeSchemaMode.
//
// Cross-instructor cases (e.g. learner 11 spent Fraser's legacy pool on
// a Simon=6 lesson) are NOT covered by this synthetic CT — the draws
// scan is scoped to (learner_id, instructor_id = TARGET_INSTRUCTOR_ID).
// Those pairs remain as visible drift in the cron, representing real
// cross-instructor consumption questions that need a separate human
// decision (transfer minutes from Fraser legacy to Simon, or leave as
// tracked imbalance). On the current prod data this surfaces ONE pair
// — (learner 11, instructor 6, +90 min) — and that's deliberate.
//
// Why a synthetic CT at all (versus just re-attributing LCB):
//   Re-attribution alone makes the cron drift LOUDER, not quieter — the
//   actual_lcb jumps 0 → balance_minutes but the ledger still has no
//   per-pair CT, so expected goes more negative. The synthetic CT is the
//   structural answer: the legacy pool IS a real credit source for the
//   per-instructor ledger, it just predates per-instructor tracking.
//   Recording it as such lines up with Step 5 BCS work, which will
//   attribute every booking deduction to a credit source.
//
// Why 'legacy_grandfather' type (versus reusing 'admin_add'):
//   CHECK constraint widening is the more permanent shape. The type
//   itself is self-describing; future analytics get the honest answer
//   for free. Precedent: Step 2.5 widened the CHECK to add 'free_trial'
//   the same way. CHECK widening is one idempotent ALTER.
//
// Conflict policy on (learner_id, instructor_id = 4) LCB collisions:
//   • balance_minutes — SUM. The grandfathered legacy pool stacks on top
//     of any active Phase-2A balance.
//   • grandfathered_at — NULL if either side was NULL (conservative).
//     Encoded with CASE rather than LEAST() because LEAST(NULL, ts)
//     returns ts in PG (verified empirically), which would PROMOTE an
//     active row to grandfathered — exactly the wrong direction.
//
// What this does NOT do:
//   - Does NOT delete the seed instructor #1 row. That's Plan B2.
//   - Does NOT touch non-grandfathered rows at instructor=1.
//   - Does NOT alter lesson_bookings.instructor_id on historical rows.
//   - Does NOT change pre-Phase-2A pooled CT rows (instructor_id IS NULL).
//     Those stay as the original pooled-era ledger; the synthetic CTs are
//     PER-INSTRUCTOR ledger entries scoped to instructor=4. The cron's
//     purchases CTE excludes instructor_id IS NULL rows, so no double-
//     counting.
//   - Does NOT alter learner_users.balance_minutes (no LCB rows are
//     added/removed at the per-learner level after the move).
//   - Does NOT fix the (learner=11, instructor=6) cross-instructor pair
//     or other refund-without-credit-return bugs surfaced by the cron.

const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { safeEqual } = require('./_auth');

const PREREQ_MARKER_KEY = 'per_instructor_credits_step_2c_grandfather';
const MARKER_KEY        = 'per_instructor_credits_step_2c_reattribute';

const SCHOOL_ID            = 1; // CoachCarter — only school with per-instructor credits at cutover.
const SOURCE_INSTRUCTOR_ID = 1; // The mistakenly-targeted seed "James Carter" row.
const TARGET_INSTRUCTOR_ID = 4; // Fraser's real account.

// Reference allowlist (mirrors db/migration.sql L754-770 after Plan B1).
// Inlined as a literal SQL string in the DDL below because the Neon driver
// has no raw-SQL escape hatch. Exported for the integration test.
const TYPE_ALLOWLIST = [
  'purchase', 'refund', 'slot_purchase', 'edit_adjustment',
  'admin_add', 'admin_remove', 'referral_bonus', 'referral_reward',
  'free_trial', 'legacy_grandfather',
];

// Probe whether BCS is present. Mirrors api/cron-credit-reconcile.js's
// probeSchemaMode logic for the BCS-aware mode selection — the migration
// MUST use the same draws predicate as the cron, or the synthetic CT
// will mis-count and manufacture new drift.
async function probeBcsPresent(sql) {
  const [row] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'booking_credit_sources'
    ) AS has_bcs
  `;
  return !!row.has_bcs;
}

// Per-pair preview: for one grandfathered LCB candidate, compute the
// active-draws count using the cron-matching predicate, and the resulting
// synthetic CT minutes. Used in dry-run output so reviewers can spot any
// overcount before apply. The cron's draws predicate has TWO shapes
// depending on whether BCS exists; we mirror exactly.
async function previewPair(sql, learnerId, hasBcs) {
  let drawsRows;
  if (hasBcs) {
    drawsRows = await sql`
      SELECT COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
        FROM lesson_bookings lb
       WHERE lb.school_id = ${SCHOOL_ID}
         AND lb.learner_id = ${learnerId}
         AND lb.instructor_id = ${TARGET_INSTRUCTOR_ID}
         AND lb.credit_returned = FALSE
         AND lb.minutes_deducted IS NOT NULL
         AND lb.minutes_deducted > 0
         AND NOT EXISTS (
           SELECT 1 FROM booking_credit_sources bcs2
            WHERE bcs2.booking_id = lb.id
         )
    `;
  } else {
    drawsRows = await sql`
      SELECT COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
        FROM lesson_bookings lb
       WHERE lb.school_id = ${SCHOOL_ID}
         AND lb.learner_id = ${learnerId}
         AND lb.instructor_id = ${TARGET_INSTRUCTOR_ID}
         AND lb.credit_returned = FALSE
         AND lb.minutes_deducted IS NOT NULL
         AND lb.minutes_deducted > 0
    `;
  }
  return drawsRows[0].minutes;
}

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
        error: `Step 2c re-attribute requires ${PREREQ_MARKER_KEY} marker. Run /api/migrate-step-2c-grandfather first.`,
      });
    }

    // ── Target instructor sanity check ──────────────────────────────────────
    const [targetRow] = await sql`
      SELECT id, name, email, school_id
        FROM instructors
       WHERE id = ${TARGET_INSTRUCTOR_ID} AND school_id = ${SCHOOL_ID}
       LIMIT 1
    `;
    if (!targetRow) {
      return res.status(409).json({
        ok: false,
        error: `Target instructor id=${TARGET_INSTRUCTOR_ID} not found in school ${SCHOOL_ID}. ` +
               `This migration is CoachCarter-specific — do not run on other schools.`,
      });
    }

    // ── Self-marker hard stop ──────────────────────────────────────────────
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
               `Refusing to rerun — a second pass could re-route newly-created LCB rows ` +
               `or double-write synthetic CT rows. To force a rerun (e.g. after a ` +
               `deliberate rollback), DELETE the '${MARKER_KEY}' row from ` +
               `migration_markers first.`,
        self_marker: selfMarkerRow,
      });
    }

    // ── Schema mode probe ───────────────────────────────────────────────────
    const hasBcs = await probeBcsPresent(sql);

    // ── Candidate set + per-pair preview ────────────────────────────────────
    const candidates = await sql`
      SELECT
        lcb.learner_id,
        lcb.instructor_id,
        lcb.balance_minutes,
        lcb.grandfathered_at::text AS grandfathered_at,
        lcb.updated_at::text       AS lcb_updated_at,
        lu.name                    AS learner_name,
        lu.email                   AS learner_email
      FROM learner_credit_balances lcb
      LEFT JOIN learner_users lu ON lu.id = lcb.learner_id
      WHERE lcb.school_id        = ${SCHOOL_ID}
        AND lcb.instructor_id    = ${SOURCE_INSTRUCTOR_ID}
        AND lcb.grandfathered_at IS NOT NULL
      ORDER BY lcb.balance_minutes DESC, lcb.learner_id
    `;

    // Per-pair Shape B breakdown for the dry-run JSON — gives reviewers
    // a dead-simple way to spot an accidental overcount.
    const candidatesBreakdown = [];
    for (const c of candidates) {
      const activeDraws = await previewPair(sql, c.learner_id, hasBcs);
      const syntheticCtMinutes = c.balance_minutes + activeDraws;
      candidatesBreakdown.push({
        learner_id: c.learner_id,
        learner_name: c.learner_name,
        learner_email: c.learner_email,
        moved_balance_minutes: c.balance_minutes,
        active_draw_minutes_at_target: activeDraws,
        synthetic_ct_minutes: syntheticCtMinutes,
        expected_post_drift: 0,
      });
    }

    // Conflict analysis on (learner_id, instructor_id = 4) LCB rows.
    const conflicts = [];
    for (const c of candidates) {
      const [target] = await sql`
        SELECT balance_minutes, grandfathered_at::text AS grandfathered_at
          FROM learner_credit_balances
         WHERE learner_id = ${c.learner_id} AND instructor_id = ${TARGET_INSTRUCTOR_ID}
         LIMIT 1
      `;
      if (target) {
        conflicts.push({
          learner_id: c.learner_id,
          existing_target_balance: target.balance_minutes,
          existing_target_grandfathered_at: target.grandfathered_at,
          incoming_legacy_balance: c.balance_minutes,
          incoming_legacy_grandfathered_at: c.grandfathered_at,
          merged_balance: target.balance_minutes + c.balance_minutes,
          merged_grandfathered_at:
            (target.grandfathered_at && c.grandfathered_at)
              ? (target.grandfathered_at < c.grandfathered_at ? target.grandfathered_at : c.grandfathered_at)
              : null,
        });
      }
    }

    const totalMinutesToMove = candidates.reduce((s, c) => s + (c.balance_minutes || 0), 0);
    const totalSyntheticCtMinutes = candidatesBreakdown.reduce((s, c) => s + c.synthetic_ct_minutes, 0);
    const totalActiveDrawMinutes  = candidatesBreakdown.reduce((s, c) => s + c.active_draw_minutes_at_target, 0);

    const result = {
      dry_run: isDryRun,
      prereq_marker: prereqRow,
      self_marker: selfMarkerRow || null,
      source_instructor_id: SOURCE_INSTRUCTOR_ID,
      target_instructor_id: TARGET_INSTRUCTOR_ID,
      target_instructor: targetRow,
      schema_mode: hasBcs ? 'bcs_aware' : 'ct_only',
      has_bcs: hasBcs,
      candidate_count: candidates.length,
      candidates_total: candidates.length,
      candidates_breakdown: candidatesBreakdown.slice(0, 25),
      total_minutes_to_move: totalMinutesToMove,
      total_active_draw_minutes_at_target: totalActiveDrawMinutes,
      total_synthetic_ct_minutes: totalSyntheticCtMinutes,
      conflict_count: conflicts.length,
      conflicts,
      check_constraint_widened: false,
      rows_moved: 0,
      rows_deleted: 0,
      synthetic_ct_rows_written: 0,
      marker_written: false,
    };

    if (isDryRun) {
      return res.json({ ok: true, ...result });
    }

    // ── Step 0: widen credit_transactions_type_check ───────────────────────
    // DROP + ADD pattern (PG can't CREATE OR REPLACE a CHECK constraint).
    // The CHECK body is a literal in the tagged template — the Neon driver
    // doesn't expose a raw-SQL escape hatch. Mirrored in db/migration.sql
    // for fresh-environment installs.
    //
    // Held outside the main CTE because PG can't combine DDL with the
    // INSERT...DELETE...INSERT CTE.
    //
    // Idempotency: DROP IF EXISTS is a no-op when the constraint isn't
    // present. The ADD always runs. If a prior partial run already added
    // the wider constraint, this drops and re-adds — same effective state.
    await sql`ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_type_check`;
    await sql`
      ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_type_check
        CHECK (type IN (
          'purchase',
          'refund',
          'slot_purchase',
          'edit_adjustment',
          'admin_add',
          'admin_remove',
          'referral_bonus',
          'referral_reward',
          'free_trial',
          'legacy_grandfather'
        ))
    `;
    result.check_constraint_widened = true;

    // ── Steps 1+2+3: atomic move + synthetic CT + marker ────────────────────
    // Single statement with CTEs. Two variants per schema mode — the
    // synthetic_cts CTE's active_draws subquery mirrors the cron's
    // booking_draws predicate exactly.
    //
    // Order of CTEs (both variants):
    //   marker_lock — INSERT migration_markers row (ON CONFLICT DO NOTHING).
    //     Concurrent POSTs race here; loser gets rows_moved = 0.
    //   source_rows — SELECT grandfathered rows at instructor=1, gated on
    //     marker_lock having produced a row.
    //   moved — INSERT into LCB at instructor=4, ON CONFLICT merge with
    //     watched-stays-watched grandfathered_at semantics.
    //   deleted — DELETE the source rows, gated on `moved` having returned.
    //   synthetic_cts — one CT per source row. minutes = source balance
    //     PLUS active draws at (learner, TARGET) using the cron-matching
    //     predicate. RETURNING id so the count surfaces in the response.
    //
    // source_rows is a SELECT CTE so its tuples are stable across the
    // whole statement (PG §7.8.4). The synthetic_cts CTE reads from
    // source_rows (not from deleted) so we still have the learner_id +
    // balance_minutes after the DELETE has committed within the CTE.
    let stats;
    if (hasBcs) {
      [stats] = await sql`
        WITH marker_lock AS (
          INSERT INTO migration_markers (key, notes)
          VALUES (${MARKER_KEY}, 'Re-attribute grandfathered LCB rows from seed instructor=1 to Fraser=4 + Shape-B synthetic legacy_grandfather CT backfill (BCS-aware). Step 2c GRANDFATHER_INSTRUCTOR_ID was wrong.')
          ON CONFLICT (key) DO NOTHING
          RETURNING key, completed_at::text AS completed_at
        ),
        source_rows AS (
          SELECT learner_id, school_id, balance_minutes, grandfathered_at
            FROM learner_credit_balances
           WHERE EXISTS (SELECT 1 FROM marker_lock)
             AND school_id        = ${SCHOOL_ID}
             AND instructor_id    = ${SOURCE_INSTRUCTOR_ID}
             AND grandfathered_at IS NOT NULL
        ),
        moved AS (
          INSERT INTO learner_credit_balances
            (learner_id, instructor_id, school_id, balance_minutes, grandfathered_at, updated_at)
          SELECT
            learner_id, ${TARGET_INSTRUCTOR_ID}, school_id,
            balance_minutes, grandfathered_at, NOW()
          FROM source_rows
          ON CONFLICT (learner_id, instructor_id) DO UPDATE
            SET balance_minutes  = learner_credit_balances.balance_minutes + EXCLUDED.balance_minutes,
                grandfathered_at = CASE
                                     WHEN learner_credit_balances.grandfathered_at IS NULL THEN NULL
                                     WHEN EXCLUDED.grandfathered_at IS NULL              THEN NULL
                                     WHEN learner_credit_balances.grandfathered_at
                                          < EXCLUDED.grandfathered_at THEN learner_credit_balances.grandfathered_at
                                     ELSE EXCLUDED.grandfathered_at
                                   END,
                updated_at       = NOW()
          RETURNING learner_id
        ),
        deleted AS (
          DELETE FROM learner_credit_balances
           WHERE EXISTS (SELECT 1 FROM moved)
             AND school_id        = ${SCHOOL_ID}
             AND instructor_id    = ${SOURCE_INSTRUCTOR_ID}
             AND grandfathered_at IS NOT NULL
          RETURNING learner_id
        ),
        synthetic_cts AS (
          INSERT INTO credit_transactions
            (learner_id, instructor_id, school_id, type, source, payment_method,
             minutes, credits, amount_pence, created_at)
          SELECT
            sr.learner_id,
            ${TARGET_INSTRUCTOR_ID},
            sr.school_id,
            'legacy_grandfather',
            'reconciliation',
            'migration',
            sr.balance_minutes + COALESCE((
              SELECT SUM(lb.minutes_deducted)::int
                FROM lesson_bookings lb
               WHERE lb.school_id = sr.school_id
                 AND lb.learner_id = sr.learner_id
                 AND lb.instructor_id = ${TARGET_INSTRUCTOR_ID}
                 AND lb.credit_returned = FALSE
                 AND lb.minutes_deducted IS NOT NULL
                 AND lb.minutes_deducted > 0
                 AND NOT EXISTS (
                   SELECT 1 FROM booking_credit_sources bcs2
                    WHERE bcs2.booking_id = lb.id
                 )
            ), 0),
            0, 0, NOW()
          FROM source_rows sr
          WHERE EXISTS (SELECT 1 FROM moved)
          RETURNING id, minutes
        )
        SELECT
          (SELECT COUNT(*)::int FROM moved)              AS rows_moved,
          (SELECT COUNT(*)::int FROM deleted)            AS rows_deleted,
          (SELECT COUNT(*)::int FROM synthetic_cts)      AS synthetic_ct_rows_written,
          (SELECT COALESCE(SUM(minutes), 0)::int FROM synthetic_cts) AS synthetic_ct_total_minutes,
          (SELECT COUNT(*)::int FROM marker_lock)        AS marker_written,
          (SELECT completed_at FROM marker_lock LIMIT 1) AS marker_completed_at
      `;
    } else {
      // ct_only variant — no BCS table, no NOT EXISTS BCS exclusion. Used
      // by environments that haven't applied Step 5 schema (test branches,
      // fresh dev DBs).
      [stats] = await sql`
        WITH marker_lock AS (
          INSERT INTO migration_markers (key, notes)
          VALUES (${MARKER_KEY}, 'Re-attribute grandfathered LCB rows from seed instructor=1 to Fraser=4 + Shape-B synthetic legacy_grandfather CT backfill (ct_only). Step 2c GRANDFATHER_INSTRUCTOR_ID was wrong.')
          ON CONFLICT (key) DO NOTHING
          RETURNING key, completed_at::text AS completed_at
        ),
        source_rows AS (
          SELECT learner_id, school_id, balance_minutes, grandfathered_at
            FROM learner_credit_balances
           WHERE EXISTS (SELECT 1 FROM marker_lock)
             AND school_id        = ${SCHOOL_ID}
             AND instructor_id    = ${SOURCE_INSTRUCTOR_ID}
             AND grandfathered_at IS NOT NULL
        ),
        moved AS (
          INSERT INTO learner_credit_balances
            (learner_id, instructor_id, school_id, balance_minutes, grandfathered_at, updated_at)
          SELECT
            learner_id, ${TARGET_INSTRUCTOR_ID}, school_id,
            balance_minutes, grandfathered_at, NOW()
          FROM source_rows
          ON CONFLICT (learner_id, instructor_id) DO UPDATE
            SET balance_minutes  = learner_credit_balances.balance_minutes + EXCLUDED.balance_minutes,
                grandfathered_at = CASE
                                     WHEN learner_credit_balances.grandfathered_at IS NULL THEN NULL
                                     WHEN EXCLUDED.grandfathered_at IS NULL              THEN NULL
                                     WHEN learner_credit_balances.grandfathered_at
                                          < EXCLUDED.grandfathered_at THEN learner_credit_balances.grandfathered_at
                                     ELSE EXCLUDED.grandfathered_at
                                   END,
                updated_at       = NOW()
          RETURNING learner_id
        ),
        deleted AS (
          DELETE FROM learner_credit_balances
           WHERE EXISTS (SELECT 1 FROM moved)
             AND school_id        = ${SCHOOL_ID}
             AND instructor_id    = ${SOURCE_INSTRUCTOR_ID}
             AND grandfathered_at IS NOT NULL
          RETURNING learner_id
        ),
        synthetic_cts AS (
          INSERT INTO credit_transactions
            (learner_id, instructor_id, school_id, type, source, payment_method,
             minutes, credits, amount_pence, created_at)
          SELECT
            sr.learner_id,
            ${TARGET_INSTRUCTOR_ID},
            sr.school_id,
            'legacy_grandfather',
            'reconciliation',
            'migration',
            sr.balance_minutes + COALESCE((
              SELECT SUM(lb.minutes_deducted)::int
                FROM lesson_bookings lb
               WHERE lb.school_id = sr.school_id
                 AND lb.learner_id = sr.learner_id
                 AND lb.instructor_id = ${TARGET_INSTRUCTOR_ID}
                 AND lb.credit_returned = FALSE
                 AND lb.minutes_deducted IS NOT NULL
                 AND lb.minutes_deducted > 0
            ), 0),
            0, 0, NOW()
          FROM source_rows sr
          WHERE EXISTS (SELECT 1 FROM moved)
          RETURNING id, minutes
        )
        SELECT
          (SELECT COUNT(*)::int FROM moved)              AS rows_moved,
          (SELECT COUNT(*)::int FROM deleted)            AS rows_deleted,
          (SELECT COUNT(*)::int FROM synthetic_cts)      AS synthetic_ct_rows_written,
          (SELECT COALESCE(SUM(minutes), 0)::int FROM synthetic_cts) AS synthetic_ct_total_minutes,
          (SELECT COUNT(*)::int FROM marker_lock)        AS marker_written,
          (SELECT completed_at FROM marker_lock LIMIT 1) AS marker_completed_at
      `;
    }

    result.rows_moved                       = stats.rows_moved;
    result.rows_deleted                     = stats.rows_deleted;
    result.synthetic_ct_rows_written        = stats.synthetic_ct_rows_written;
    result.synthetic_ct_total_minutes_actual = stats.synthetic_ct_total_minutes;
    result.marker_written                   = stats.marker_written > 0;
    result.marker_already_present           = stats.marker_written === 0;
    if (stats.marker_completed_at) {
      result.self_marker = { key: MARKER_KEY, completed_at: stats.marker_completed_at };
    }

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[step-2c-reattribute] migration failed:', err);
    reportError('/api/migrate-step-2c-reattribute', err);
    return res.status(500).json({ ok: false, error: 'Migration failed', details: err.message });
  }
};

module.exports.MARKER_KEY            = MARKER_KEY;
module.exports.PREREQ_MARKER_KEY     = PREREQ_MARKER_KEY;
module.exports.SCHOOL_ID             = SCHOOL_ID;
module.exports.SOURCE_INSTRUCTOR_ID  = SOURCE_INSTRUCTOR_ID;
module.exports.TARGET_INSTRUCTOR_ID  = TARGET_INSTRUCTOR_ID;
module.exports.TYPE_ALLOWLIST        = TYPE_ALLOWLIST;
