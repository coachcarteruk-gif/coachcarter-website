// Chip #3 retro-fix — flip credit_returned = TRUE on the three historical
// prod bookings that were rescheduled before the reschedule paths set
// credit_returned correctly.
//
// Background: the live reschedule paths in api/instructor.js
// (handleRescheduleBooking) and api/slots.js (handleReschedule) used to
// set the OLD booking's status to REFUNDED but NOT credit_returned. The
// new booking inherited the SAME minutes_deducted, so the divergence
// cron's booking_draws CTE — which filters on credit_returned = FALSE
// without filtering status — counted BOTH rows as active draws. Net
// result: +minutes_deducted of drift per reschedule (see Plan B3 forensic
// in memory/project_step_4_5_shipped.md).
//
// The same PR that introduces this migration also fixes the writer paths
// (api/instructor.js + api/slots.js handleReschedule) so future reschedules
// flip credit_returned = TRUE in lockstep with status = REFUNDED.
//
// This migration handles the THREE known historical instances on prod:
//
//   booking_id | learner_id | instructor_id | scheduled_date | mins
//   -----------|------------|---------------|----------------|-----
//          117 |         11 |             6 | 2026-04-29     |  90
//          133 |         55 |             4 | 2026-04-14     |  90
//          214 |         92 |             4 | 2026-05-26     |  90
//
// All three are confirmed via prod SQL probe: status=refunded,
// credit_returned=FALSE, minutes_deducted=90. They are the entire
// post-B3 cron drift_count (drift_count = 3, one per booking,
// drift_minutes = +90 each).
//
// Why marker-gated with an explicit allowlist (not a predicate sweep):
//   A predicate like "all refunded bookings with credit_returned=FALSE"
//   would be tempting but DANGEROUS. The same shape can be hit by:
//   - A future reschedule that we haven't yet investigated.
//   - A refund path that LEGITIMATELY leaves credit_returned=FALSE
//     because the minutes were genuinely forfeited (late-cancel
//     credit_forfeited path — see api/slots.js around L2234).
//   The credit_forfeited flag would make a sweep safer, but the safest
//   and most auditable answer is "the three bookings we already
//   identified," with a comment naming each.
//
// Usage:
//   GET  /api/migrate-credit-returned-retro-fix?secret=...  → dry-run report
//   POST /api/migrate-credit-returned-retro-fix?secret=...  → flip the flags
//
// What this does (atomically via single CTE):
//   1. For each of the 3 booking IDs in BOOKING_IDS, only when:
//        - status = 'refunded'
//        - credit_returned = FALSE
//        - credit_forfeited = FALSE   (do NOT touch late-cancel forfeitures)
//        - minutes_deducted IS NOT NULL AND > 0
//      UPDATE credit_returned = TRUE.
//   2. Write 'credits_credit_returned_retro_fix' marker.
//
// Idempotency:
//   - Marker hard-stop refuses second POST.
//   - The predicate `credit_returned = FALSE` provides belt-and-braces:
//     a rerun with the marker deleted still won't double-flip rows
//     already at TRUE.
//
// What this does NOT do:
//   - Does NOT touch any booking outside the allowlist.
//   - Does NOT affect LCB or credit_transactions.
//   - Does NOT auto-detect new reschedule-bug bookings — the fixed writer
//     paths prevent future instances; if anyone surfaces another
//     historical case, add it to BOOKING_IDS and ship as a follow-up.

const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { safeEqual } = require('./_auth');
const { REFUNDED } = require('./_booking-status');

const MARKER_KEY = 'credits_credit_returned_retro_fix';
const SCHOOL_ID  = 1;

// The three known prod bookings to flip. See header for forensic.
const BOOKING_IDS = [117, 133, 214];

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

    // ── Self-marker hard stop ──────────────────────────────────────────
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
               `Refusing to rerun — DELETE the '${MARKER_KEY}' row from ` +
               `migration_markers first if you need to. The credit_returned ` +
               `= FALSE predicate in the UPDATE provides belt-and-braces ` +
               `protection, but the marker is the primary gate.`,
        self_marker: selfMarkerRow,
      });
    }

    // ── Per-target inspection (dry-run preview) ────────────────────────
    // For each ID in BOOKING_IDS, report current state so the operator
    // can confirm the predicate will match exactly what they expect.
    const inspectRows = await sql`
      SELECT
        lb.id,
        lb.learner_id,
        lb.instructor_id,
        lb.scheduled_date::text   AS scheduled_date,
        lb.start_time::text       AS start_time,
        lb.status,
        lb.credit_returned,
        lb.credit_forfeited,
        lb.minutes_deducted,
        lu.name                   AS learner_name,
        i.name                    AS instructor_name,
        (lb.status = ${REFUNDED}
         AND lb.credit_returned = FALSE
         AND COALESCE(lb.credit_forfeited, FALSE) = FALSE
         AND lb.minutes_deducted IS NOT NULL
         AND lb.minutes_deducted > 0)              AS will_flip
      FROM lesson_bookings lb
      LEFT JOIN learner_users lu ON lu.id = lb.learner_id
      LEFT JOIN instructors  i  ON i.id  = lb.instructor_id
      WHERE lb.id = ANY(${BOOKING_IDS})
        AND COALESCE(lb.school_id, 1) = ${SCHOOL_ID}
      ORDER BY lb.id
    `;

    // Sanity: surface any booking IDs that exist but are NOT going to flip
    // (the operator should explicitly approve before applying).
    const targetsNotFlipping = inspectRows.filter(r => !r.will_flip);
    const missingIds = BOOKING_IDS.filter(id => !inspectRows.some(r => r.id === id));

    const result = {
      dry_run: isDryRun,
      self_marker: selfMarkerRow || null,
      target_booking_ids: BOOKING_IDS,
      inspect_rows: inspectRows,
      will_flip_count: inspectRows.filter(r => r.will_flip).length,
      will_not_flip_count: targetsNotFlipping.length,
      will_not_flip_details: targetsNotFlipping,
      missing_booking_ids: missingIds,
      rows_flipped: 0,
      marker_written: false,
    };

    if (isDryRun) {
      return res.json({ ok: true, ...result });
    }

    // ── Atomic UPDATE + marker write ───────────────────────────────────
    // marker_lock first (ON CONFLICT DO NOTHING). Two concurrent POSTs
    // race here; loser sees rows_flipped = 0.
    //
    // The UPDATE re-evaluates the predicate at write time — predicate
    // changes between dry-run and POST legitimately exclude rows.
    const [stats] = await sql`
      WITH marker_lock AS (
        INSERT INTO migration_markers (key, notes)
        VALUES (${MARKER_KEY}, 'Chip #3 retro-fix — flip credit_returned=TRUE on the 3 historical reschedule-bug bookings (#117, #133, #214)')
        ON CONFLICT (key) DO NOTHING
        RETURNING key, completed_at::text AS completed_at
      ),
      flipped AS (
        UPDATE lesson_bookings lb
           SET credit_returned = TRUE
         WHERE EXISTS (SELECT 1 FROM marker_lock)
           AND lb.id = ANY(${BOOKING_IDS})
           AND COALESCE(lb.school_id, 1) = ${SCHOOL_ID}
           AND lb.status = ${REFUNDED}
           AND lb.credit_returned = FALSE
           AND COALESCE(lb.credit_forfeited, FALSE) = FALSE
           AND lb.minutes_deducted IS NOT NULL
           AND lb.minutes_deducted > 0
        RETURNING lb.id, lb.learner_id, lb.instructor_id, lb.minutes_deducted
      )
      SELECT
        (SELECT COUNT(*)::int FROM flipped)                          AS rows_flipped,
        (SELECT COALESCE(SUM(minutes_deducted), 0)::int FROM flipped) AS total_minutes_flipped,
        (SELECT COUNT(*)::int FROM marker_lock)                      AS marker_written,
        (SELECT completed_at FROM marker_lock LIMIT 1)               AS marker_completed_at
    `;

    result.rows_flipped         = stats.rows_flipped;
    result.total_minutes_flipped = stats.total_minutes_flipped;
    result.marker_written       = stats.marker_written > 0;
    result.marker_already_present = stats.marker_written === 0;
    if (stats.marker_completed_at) {
      result.self_marker = { key: MARKER_KEY, completed_at: stats.marker_completed_at };
    }

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[migrate-credit-returned-retro-fix] failed:', err);
    reportError('/api/migrate-credit-returned-retro-fix', err);
    return res.status(500).json({ ok: false, error: 'Migration failed', details: err.message });
  }
};

module.exports.MARKER_KEY    = MARKER_KEY;
module.exports.BOOKING_IDS   = BOOKING_IDS;
module.exports.SCHOOL_ID     = SCHOOL_ID;
