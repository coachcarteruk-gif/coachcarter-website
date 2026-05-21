// Step 2c no-LCB backfill (Plan B3). Synthetic credit_transactions backfill
// for the Group C class of cron drift: pre-cutover learners who have NO
// learner_credit_balances row at any instructor, but DO have active booking
// draws funded from the legacy pooled balance (instructor_id IS NULL CTs
// the cron deliberately excludes from its purchases CTE).
//
// On prod 2026-05-21 the live data shape after the first PR #185 dry-run
// surfaced a critical refinement. The 🏁 memory entry's basis for the
// 4 → 1 prediction was factually wrong: learner 11 (Laura Thomas) has
// NO LCB row anywhere. Their (11, 6) drift is not a "cross-instructor
// consumption" question — it's an isolated refunded-but-credit-not-
// returned booking (#117, status=refunded, credit_returned=FALSE,
// md=90). Learner 55 has the same shape on one of nine bookings
// (#133, refunded, credit_returned=FALSE, md=90).
//
// Those are exactly the latent bugs chip #3 (reschedule paths set
// credit_returned = TRUE on the old booking) is queued to fix. Plan B3
// MUST NOT grandfather them under legacy_grandfather — that would
// silently hide chip #3's target and create opposite-sign drift the
// moment chip #3 lands.
//
// So Plan B3 tightens the draws aggregation: synthetic CT minutes
// count only `lb.status != 'refunded'` bookings. Refunded-but-credit-
// not-returned rows stay visible to the cron as residual drift for
// chip #3. The "no LCB anywhere" gate stays in place to keep
// already-handled Group A/B cohorts excluded.
//
// Expected prod impact after this revision:
//   • (learner=55, instructor=4) draws=810  → synthetic CT 720 (90 stale-refund excluded)
//   • (learner=73, instructor=4) draws=180  → synthetic CT 180 (clean)
//   • (learner=92, instructor=4) draws= 90  → synthetic CT  90 (clean)
//   • (learner=11, instructor=6) draws= 90  → EXCLUDED (only booking is refunded; HAVING > 0 drops the pair)
//
// Total synthetic CT minutes: 990 (not 1,170).
//
// Cron drift after B3 lands:
//   • 2 residual pairs flag: (55, 4) +90 (booking #133) and (11, 6) +90 (booking #117).
//     Both go away when chip #3 flips credit_returned=TRUE on those bookings.
//
// Usage:
//   GET  /api/migrate-step-2c-no-lcb-backfill?secret=...  → dry-run report
//   POST /api/migrate-step-2c-no-lcb-backfill?secret=...  → INSERT synthetic CTs + marker
//
// What this does (atomically per-pair via a single CTE):
//   1. For every (learner, instructor) pair where:
//        • school_id = 1
//        • NO learner_credit_balances row exists for the learner at any
//          instructor (gates out Group A/B already-handled cohorts)
//        • NO credit_transactions row exists at (learner, instructor) with
//          instructor_id NOT NULL (defensive — prevents double-write on a
//          deliberate rollback rerun where the marker was deleted)
//        • Active booking draws exist at (learner, instructor) using the
//          cron's booking_draws predicate PLUS an additional
//          `lb.status != 'refunded'` filter. The cron itself doesn't filter
//          status (it considers any credit_returned=FALSE booking as an
//          active draw, refunded or not — that IS the refund-without-
//          credit-return bug chip #3 fixes). B3 narrows to clean-only so
//          stale refunded rows stay visible.
//        • Schema-aware: BCS-aware predicate variant when
//          booking_credit_sources table is present
//      INSERT ONE synthetic credit_transactions row with:
//        type            = 'legacy_grandfather'
//        source          = 'reconciliation'
//        payment_method  = 'migration'
//        instructor_id   = pair instructor
//        minutes         = SUM(active draws at the pair)
//        amount_pence    = 0
//        credits         = 0
//   2. Write 'per_instructor_credits_step_2c_no_lcb_backfill' marker.
//
// Math per pair (L, I) — drift reconciles by construction for the CLEAN
// portion, refund-bug residual stays visible:
//
//   Let D_clean = SUM(draws WHERE status != 'refunded') at (L, I)
//       D_bug  = SUM(draws WHERE status  = 'refunded') at (L, I)  (these
//                are the stale-refund rows chip #3 will flip)
//       D_total = D_clean + D_bug = the cron's booking_draws value
//
//   Before B3:
//     actual_lcb(L, I)  = 0                          (no LCB row)
//     ΣCT(L, I)         = 0                          (pooled CT has instructor_id IS NULL, excluded)
//     cron sees Σdraws  = D_total
//     expected          = -D_total
//     drift             = +D_total                    (cron flag, the headline drift today)
//
//   After B3 inserts synthetic CT(L, I, minutes=D_clean):
//     actual_lcb(L, I)  = 0                          (unchanged, NO LCB write)
//     ΣCT(L, I)         = D_clean
//     cron sees Σdraws  = D_total = D_clean + D_bug  (unchanged — cron still includes refunded)
//     expected          = D_clean − D_total = -D_bug
//     drift             = 0 − (-D_bug) = +D_bug      (residual = bug only)
//
//   When chip #3 later flips credit_returned=TRUE on the refunded
//   bookings, D_bug → 0 in the cron's view, so:
//     cron sees Σdraws  = D_clean
//     expected          = D_clean − D_clean = 0
//     drift             = 0  ✓
//
//   Net: B3 cleanly converts headline drift into residual bug drift,
//   without manufacturing opposite-sign drift in either direction.
//
// Why no LCB write (vs B1):
//   These learners spent their entire legacy pool. Active draws at the
//   pair equal the original legacy pool consumed at that instructor.
//   There is no remaining balance to grandfather. Adding an LCB row at
//   balance=0 would be a no-op for the cron and would just create a stale
//   zero-balance row Step 5 has to ignore later. The simpler answer is
//   "make the per-pair ledger coherent without manufacturing fake state."
//
// Idempotency belt-and-braces:
//   The marker provides the primary idempotency guarantee (POST refuses
//   when present). The candidate predicate's `NOT EXISTS CT at (L, I)
//   with instructor_id NOT NULL` provides the secondary guarantee for
//   the rollback-rerun path: even if the marker is manually deleted and
//   the endpoint re-POSTed, already-inserted synthetic CTs prevent a
//   second insert at the same pair.
//
// What this does NOT do:
//   - Does NOT touch LCB. No rows added, modified, or deleted.
//   - Does NOT touch lesson_bookings. The legacy draws stay where they
//     are; they are now matched by a per-pair CT instead of an absent one.
//   - Does NOT alter pre-Phase-2A pooled CTs (instructor_id IS NULL).
//     Those stay as the original pooled-era ledger. The cron's purchases
//     CTE excludes them, so no double-counting from the legacy side.
//   - Does NOT fix (learner=11, instructor=6). Learner 11 has an LCB
//     row at (11, 4) from B1's grandfather → reattribute path, so the
//     "no LCB anywhere" gate excludes them. The pair stays as visible
//     drift representing a real cross-instructor consumption question.
//   - Does NOT widen credit_transactions_type_check. Plan B1 (PR #184)
//     already widened it to include 'legacy_grandfather'; the constant
//     is also in db/migration.sql for fresh-environment installs.
//   - Does NOT delete the seed instructor #1. That's Plan B2.

const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { safeEqual } = require('./_auth');
const { REFUNDED } = require('./_booking-status');

const PREREQ_MARKER_KEY = 'per_instructor_credits_step_2c_reattribute';
const MARKER_KEY        = 'per_instructor_credits_step_2c_no_lcb_backfill';

const SCHOOL_ID = 1; // CoachCarter — only school with per-instructor credits at cutover.

// Probe whether booking_credit_sources is present. Mirrors
// api/cron-credit-reconcile.js::probeSchemaMode and
// api/migrate-step-2c-reattribute.js::probeBcsPresent. The draws predicate
// MUST match the cron's booking_draws CTE byte-for-byte, or the migration
// manufactures new drift.
async function probeBcsPresent(sql) {
  const [row] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'booking_credit_sources'
    ) AS has_bcs
  `;
  return !!row.has_bcs;
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
        error: `Step 2c no-LCB backfill requires ${PREREQ_MARKER_KEY} marker. Run /api/migrate-step-2c-reattribute first.`,
      });
    }

    // ── Self-marker hard stop ──────────────────────────────────────────────
    // If our own marker is present this is a rerun. Dry-run (GET) still
    // works so the operator can inspect the predicate's current state, but
    // POST refuses. Rationale: a later POST could double-insert synthetic
    // CTs if the candidate predicate ever drifts (e.g. a new learner is
    // observed without an LCB row but with draws — exactly the wrong moment
    // to auto-backfill silently).
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
               `Refusing to rerun — a second pass could double-insert synthetic CT rows ` +
               `if a new pair has appeared since. To force a rerun (e.g. after a ` +
               `deliberate rollback), DELETE the '${MARKER_KEY}' row from ` +
               `migration_markers first. (The NOT EXISTS CT predicate provides ` +
               `belt-and-braces protection, but the marker is the primary gate.)`,
        self_marker: selfMarkerRow,
      });
    }

    // ── Schema mode probe ───────────────────────────────────────────────────
    const hasBcs = await probeBcsPresent(sql);

    // ── Candidate set (dry-run preview) ─────────────────────────────────────
    // Two variants for the draws predicate, mirroring the cron's
    // booking_draws CTE exactly per schema mode. See cron-credit-
    // reconcile.js#booking_draws for the source-of-truth shape.
    //
    // The candidate query groups by (learner_id, instructor_id) and only
    // returns pairs whose sum of active draws > 0. Pairs whose ONLY
    // matching booking was already closed out (credit_returned = TRUE or
    // minutes_deducted = 0) are excluded — there's no drift to silence.
    // Dry-run candidates query. The `lb.status != ${REFUNDED}` filter is
    // the tightening vs the cron's booking_draws CTE. The cron itself does
    // not filter status — it considers any credit_returned=FALSE booking
    // an active draw, which IS the refund-without-credit-return bug
    // chip #3 fixes. B3 narrows synthetic CT minutes to the clean subset,
    // so stale-refund rows stay visible as residual cron drift.
    let candidates;
    if (hasBcs) {
      candidates = await sql`
        SELECT
          lb.learner_id,
          lb.instructor_id,
          SUM(lb.minutes_deducted)::int AS draws_minutes,
          COUNT(*)::int                 AS draws_booking_count,
          lu.name                       AS learner_name,
          lu.email                      AS learner_email,
          i.name                        AS instructor_name
        FROM lesson_bookings lb
        LEFT JOIN learner_users lu ON lu.id = lb.learner_id
        LEFT JOIN instructors  i  ON i.id  = lb.instructor_id
        WHERE lb.school_id = ${SCHOOL_ID}
          AND lb.credit_returned = FALSE
          AND lb.minutes_deducted IS NOT NULL
          AND lb.minutes_deducted > 0
          AND lb.status != ${REFUNDED}
          AND NOT EXISTS (
            SELECT 1 FROM booking_credit_sources bcs2
             WHERE bcs2.booking_id = lb.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM learner_credit_balances lcb
             WHERE lcb.learner_id = lb.learner_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM credit_transactions ct
             WHERE ct.school_id     = lb.school_id
               AND ct.learner_id    = lb.learner_id
               AND ct.instructor_id = lb.instructor_id
          )
        GROUP BY lb.learner_id, lb.instructor_id, lu.name, lu.email, i.name
        HAVING SUM(lb.minutes_deducted) > 0
        ORDER BY SUM(lb.minutes_deducted) DESC, lb.learner_id, lb.instructor_id
      `;
    } else {
      candidates = await sql`
        SELECT
          lb.learner_id,
          lb.instructor_id,
          SUM(lb.minutes_deducted)::int AS draws_minutes,
          COUNT(*)::int                 AS draws_booking_count,
          lu.name                       AS learner_name,
          lu.email                      AS learner_email,
          i.name                        AS instructor_name
        FROM lesson_bookings lb
        LEFT JOIN learner_users lu ON lu.id = lb.learner_id
        LEFT JOIN instructors  i  ON i.id  = lb.instructor_id
        WHERE lb.school_id = ${SCHOOL_ID}
          AND lb.credit_returned = FALSE
          AND lb.minutes_deducted IS NOT NULL
          AND lb.minutes_deducted > 0
          AND lb.status != ${REFUNDED}
          AND NOT EXISTS (
            SELECT 1 FROM learner_credit_balances lcb
             WHERE lcb.learner_id = lb.learner_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM credit_transactions ct
             WHERE ct.school_id     = lb.school_id
               AND ct.learner_id    = lb.learner_id
               AND ct.instructor_id = lb.instructor_id
          )
        GROUP BY lb.learner_id, lb.instructor_id, lu.name, lu.email, i.name
        HAVING SUM(lb.minutes_deducted) > 0
        ORDER BY SUM(lb.minutes_deducted) DESC, lb.learner_id, lb.instructor_id
      `;
    }

    const totalSyntheticCtMinutes = candidates.reduce(
      (s, c) => s + (c.draws_minutes || 0), 0
    );

    // ── Per-candidate context for the dry-run reviewer ─────────────────────
    // For each candidate pair we surface:
    //   • pooled_ct_*  — pooled (instructor_id IS NULL) CT minutes for the
    //     learner. The legacy pool the cron's purchases CTE excludes; the
    //     structural reason these pairs drift today.
    //   • stale_refund_draws_at_pair — sum of minutes_deducted on bookings
    //     at (L, I) where status='refunded' AND credit_returned=FALSE. This
    //     IS the bug class chip #3 fixes. The number is the expected
    //     residual cron drift at this pair after B3 lands (because the
    //     cron's booking_draws still counts these rows, even though B3's
    //     synthetic CT does not).
    //   • expected_residual_cron_drift_after_b3 — alias for the above; the
    //     dry-run consumer's primary safety check.
    const candidatesBreakdown = [];
    for (const c of candidates) {
      const [pooled] = await sql`
        SELECT
          COUNT(*)::int                       AS pooled_ct_rows,
          COALESCE(SUM(ct.minutes), 0)::int   AS pooled_ct_minutes
          FROM credit_transactions ct
         WHERE ct.school_id     = ${SCHOOL_ID}
           AND ct.learner_id    = ${c.learner_id}
           AND ct.instructor_id IS NULL
      `;
      // Stale-refund draws at the SAME pair, using the cron's
      // credit_returned/minutes_deducted predicate plus status='refunded'.
      // BCS-aware variant matches the cron's full-mode booking_draws so the
      // residual prediction is faithful.
      let stale;
      if (hasBcs) {
        [stale] = await sql`
          SELECT COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
            FROM lesson_bookings lb
           WHERE lb.school_id = ${SCHOOL_ID}
             AND lb.learner_id = ${c.learner_id}
             AND lb.instructor_id = ${c.instructor_id}
             AND lb.credit_returned = FALSE
             AND lb.minutes_deducted IS NOT NULL
             AND lb.minutes_deducted > 0
             AND lb.status = ${REFUNDED}
             AND NOT EXISTS (
               SELECT 1 FROM booking_credit_sources bcs2
                WHERE bcs2.booking_id = lb.id
             )
        `;
      } else {
        [stale] = await sql`
          SELECT COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
            FROM lesson_bookings lb
           WHERE lb.school_id = ${SCHOOL_ID}
             AND lb.learner_id = ${c.learner_id}
             AND lb.instructor_id = ${c.instructor_id}
             AND lb.credit_returned = FALSE
             AND lb.minutes_deducted IS NOT NULL
             AND lb.minutes_deducted > 0
             AND lb.status = ${REFUNDED}
        `;
      }
      candidatesBreakdown.push({
        learner_id: c.learner_id,
        instructor_id: c.instructor_id,
        learner_name: c.learner_name,
        learner_email: c.learner_email,
        instructor_name: c.instructor_name,
        draws_booking_count: c.draws_booking_count,
        active_draw_minutes_at_pair: c.draws_minutes,
        synthetic_ct_minutes: c.draws_minutes,
        pooled_ct_rows_for_learner: pooled.pooled_ct_rows,
        pooled_ct_minutes_for_learner: pooled.pooled_ct_minutes,
        stale_refund_draws_at_pair: stale.minutes,
        expected_residual_cron_drift_after_b3: stale.minutes,
      });
    }

    const result = {
      dry_run: isDryRun,
      prereq_marker: prereqRow,
      self_marker: selfMarkerRow || null,
      schema_mode: hasBcs ? 'bcs_aware' : 'ct_only',
      has_bcs: hasBcs,
      candidate_count: candidates.length,
      candidates_total: candidates.length,
      candidates_breakdown: candidatesBreakdown.slice(0, 25),
      total_synthetic_ct_minutes: totalSyntheticCtMinutes,
      synthetic_ct_rows_written: 0,
      marker_written: false,
    };

    if (isDryRun) {
      return res.json({ ok: true, ...result });
    }

    // ── Atomic INSERT + marker ──────────────────────────────────────────────
    // Single statement with CTEs:
    //   marker_lock — INSERT migration_markers row (ON CONFLICT DO NOTHING).
    //     Concurrent POSTs race here; loser inserts 0 rows.
    //   target_pairs — re-evaluate the candidate predicate at write time
    //     (NOT a frozen list from the dry-run query). Gated on marker_lock
    //     having produced a row. The predicate is re-evaluated against
    //     current data so a Phase-2A writer landing a CT row for a candidate
    //     pair between dry-run and POST legitimately excludes that pair.
    //   inserted — one synthetic CT per target pair.
    //
    // The draws-aggregation subquery is repeated in both schema-mode branches
    // because the BCS NOT EXISTS clause is the only difference and pulling
    // it out as a parameter would lose the planner's ability to inline.
    // target_pairs CTE applies the SAME tightened predicate as the dry-run
    // candidates query — `lb.status != REFUNDED` excludes the stale-refund
    // bug class from the synthetic CT sum. Predicate is re-evaluated at
    // write time (not via a frozen list from the dry-run), so a Phase-2A
    // writer landing a CT row or status flip between dry-run and POST
    // legitimately excludes that pair.
    let stats;
    if (hasBcs) {
      [stats] = await sql`
        WITH marker_lock AS (
          INSERT INTO migration_markers (key, notes)
          VALUES (${MARKER_KEY}, 'Plan B3 — synthetic legacy_grandfather CT backfill for pre-cutover learners with no LCB row (Group C). BCS-aware draws predicate, status!=refunded.')
          ON CONFLICT (key) DO NOTHING
          RETURNING key, completed_at::text AS completed_at
        ),
        target_pairs AS (
          SELECT
            lb.learner_id,
            lb.instructor_id,
            SUM(lb.minutes_deducted)::int AS draws_minutes
          FROM lesson_bookings lb
          WHERE EXISTS (SELECT 1 FROM marker_lock)
            AND lb.school_id = ${SCHOOL_ID}
            AND lb.credit_returned = FALSE
            AND lb.minutes_deducted IS NOT NULL
            AND lb.minutes_deducted > 0
            AND lb.status != ${REFUNDED}
            AND NOT EXISTS (
              SELECT 1 FROM booking_credit_sources bcs2
               WHERE bcs2.booking_id = lb.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM learner_credit_balances lcb
               WHERE lcb.learner_id = lb.learner_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM credit_transactions ct
               WHERE ct.school_id     = lb.school_id
                 AND ct.learner_id    = lb.learner_id
                 AND ct.instructor_id = lb.instructor_id
            )
          GROUP BY lb.learner_id, lb.instructor_id
          HAVING SUM(lb.minutes_deducted) > 0
        ),
        inserted AS (
          INSERT INTO credit_transactions
            (learner_id, instructor_id, school_id, type, source, payment_method,
             minutes, credits, amount_pence, created_at)
          SELECT
            tp.learner_id,
            tp.instructor_id,
            ${SCHOOL_ID},
            'legacy_grandfather',
            'reconciliation',
            'migration',
            tp.draws_minutes,
            0, 0, NOW()
          FROM target_pairs tp
          RETURNING id, minutes
        )
        SELECT
          (SELECT COUNT(*)::int FROM inserted)              AS synthetic_ct_rows_written,
          (SELECT COALESCE(SUM(minutes), 0)::int FROM inserted) AS synthetic_ct_total_minutes,
          (SELECT COUNT(*)::int FROM marker_lock)           AS marker_written,
          (SELECT completed_at FROM marker_lock LIMIT 1)    AS marker_completed_at
      `;
    } else {
      [stats] = await sql`
        WITH marker_lock AS (
          INSERT INTO migration_markers (key, notes)
          VALUES (${MARKER_KEY}, 'Plan B3 — synthetic legacy_grandfather CT backfill for pre-cutover learners with no LCB row (Group C). ct_only draws predicate, status!=refunded.')
          ON CONFLICT (key) DO NOTHING
          RETURNING key, completed_at::text AS completed_at
        ),
        target_pairs AS (
          SELECT
            lb.learner_id,
            lb.instructor_id,
            SUM(lb.minutes_deducted)::int AS draws_minutes
          FROM lesson_bookings lb
          WHERE EXISTS (SELECT 1 FROM marker_lock)
            AND lb.school_id = ${SCHOOL_ID}
            AND lb.credit_returned = FALSE
            AND lb.minutes_deducted IS NOT NULL
            AND lb.minutes_deducted > 0
            AND lb.status != ${REFUNDED}
            AND NOT EXISTS (
              SELECT 1 FROM learner_credit_balances lcb
               WHERE lcb.learner_id = lb.learner_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM credit_transactions ct
               WHERE ct.school_id     = lb.school_id
                 AND ct.learner_id    = lb.learner_id
                 AND ct.instructor_id = lb.instructor_id
            )
          GROUP BY lb.learner_id, lb.instructor_id
          HAVING SUM(lb.minutes_deducted) > 0
        ),
        inserted AS (
          INSERT INTO credit_transactions
            (learner_id, instructor_id, school_id, type, source, payment_method,
             minutes, credits, amount_pence, created_at)
          SELECT
            tp.learner_id,
            tp.instructor_id,
            ${SCHOOL_ID},
            'legacy_grandfather',
            'reconciliation',
            'migration',
            tp.draws_minutes,
            0, 0, NOW()
          FROM target_pairs tp
          RETURNING id, minutes
        )
        SELECT
          (SELECT COUNT(*)::int FROM inserted)              AS synthetic_ct_rows_written,
          (SELECT COALESCE(SUM(minutes), 0)::int FROM inserted) AS synthetic_ct_total_minutes,
          (SELECT COUNT(*)::int FROM marker_lock)           AS marker_written,
          (SELECT completed_at FROM marker_lock LIMIT 1)    AS marker_completed_at
      `;
    }

    result.synthetic_ct_rows_written         = stats.synthetic_ct_rows_written;
    result.synthetic_ct_total_minutes_actual = stats.synthetic_ct_total_minutes;
    result.marker_written                    = stats.marker_written > 0;
    result.marker_already_present            = stats.marker_written === 0;
    if (stats.marker_completed_at) {
      result.self_marker = { key: MARKER_KEY, completed_at: stats.marker_completed_at };
    }

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[step-2c-no-lcb-backfill] migration failed:', err);
    reportError('/api/migrate-step-2c-no-lcb-backfill', err);
    return res.status(500).json({ ok: false, error: 'Migration failed', details: err.message });
  }
};

module.exports.MARKER_KEY        = MARKER_KEY;
module.exports.PREREQ_MARKER_KEY = PREREQ_MARKER_KEY;
module.exports.SCHOOL_ID         = SCHOOL_ID;
