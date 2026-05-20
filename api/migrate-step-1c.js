// Step 1c historical backfill for lesson_bookings.list_price_pence and
// list_price_source. Per PER-INSTRUCTOR-CREDITS-PLAN.md §Step 1c (L346-385).
//
// Usage:
//   GET  /api/migrate-step-1c?secret=...&dry_run=1   → count what each pass would touch, no writes
//   POST /api/migrate-step-1c?secret=...              → run the three passes + insert the marker
//
// What this does (and what it deliberately doesn't):
//
// PR #170 (Step 1b) made every new booking populate list_price_pence +
// list_price_source at INSERT. This endpoint fills in the historical rows
// (everything created before #170 merged). Three passes, applied in order
// against the still-NULL rows:
//
//   Pass 1 — zero-minute rows (free trials, demo, payment-disabled school):
//     list_price_pence = 0, list_price_source = 'live_compute_backfill'.
//
//   Pass 2 — live-compute rows (learner not anonymised, lesson_type still
//     exists, minutes_deducted > 0): compute via getEffectiveRatePencePerMinute,
//     tag 'live_compute_backfill'.
//
//   Pass 3 — orphan / anonymised / deleted-lesson-type rows: leave
//     list_price_pence NULL, tag 'unknown'. The payout cron pays everything
//     else and queues these for manual sign-off (plan L391-394).
//
// Plan L351's separate 'stripe_metadata' historical pass is deliberately
// SKIPPED in this PR — see project_step_1c_pass2_skipped memory note.
// In short: lesson_bookings has no stripe_session_id link to credit_transactions,
// so reconstructing the literal paid amount needs a fragile heuristic join.
// The cron pays 'stripe_metadata' and 'live_compute_backfill' identically;
// folding both into the live-compute pass costs only an audit-trail label.
//
// On successful completion of all three passes AND zero remaining NULLs, the
// 'per_instructor_credits_step_1c_backfill' row is written to migration_markers.
// Step 2's future DDL will refuse to run unless this row exists.
//
// Re-runnable: every UPDATE filters on `list_price_source IS NULL`, so a partial
// run that gets interrupted can be re-invoked and will pick up where it stopped.
// The marker INSERT uses ON CONFLICT DO NOTHING.

const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { safeEqual } = require('./_auth');
const { getEffectiveRatePencePerMinute } = require('./_pricing-helpers');

const MARKER_KEY = 'per_instructor_credits_step_1c_backfill';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.query.secret || req.headers['x-migration-secret'];
  if (!safeEqual(secret, process.env.MIGRATION_SECRET)) {
    return res.status(401).json({ error: 'Invalid or missing migration secret' });
  }

  // GET implies dry-run unless dry_run=0 is explicit; POST is always real.
  // Belt-and-braces: also accept dry_run=1 on POST so an operator can probe
  // without flipping HTTP method.
  const isDryRun = req.method === 'GET' || req.query.dry_run === '1';

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const result = {
      dry_run: isDryRun,
      passes: {},
      marker_written: false,
      total_remaining_null: null,
    };

    // ── Pass 1: zero-minute rows ─────────────────────────────────────────────
    // Free trials, demo bookings, payment-disabled-school bookings. All
    // legitimately had no list price; tag live_compute_backfill (not
    // live_compute_insert) because the snapshot decision is being made now,
    // not at insert time.
    if (isDryRun) {
      const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count
          FROM lesson_bookings
         WHERE list_price_source IS NULL
           AND minutes_deducted = 0
      `;
      result.passes.zero_minute = { would_update: count };
    } else {
      const rows = await sql`
        UPDATE lesson_bookings
           SET list_price_pence  = 0,
               list_price_source = 'live_compute_backfill'
         WHERE list_price_source IS NULL
           AND minutes_deducted = 0
        RETURNING id
      `;
      result.passes.zero_minute = { updated: rows.length };
    }

    // ── Pass 2: live-compute rows ────────────────────────────────────────────
    // Fetch eligible rows (small batch sizes to keep memory bounded; ORDER BY
    // id for determinism). Compute price per-row via the helper. Batched
    // single-row UPDATEs — concurrency-safe because of the NULL guard.
    //
    // For each row we need: school_id, instructor_id, learner_id, and the
    // booking's duration. Use the booking's own minutes_deducted as the
    // duration source — that's what was actually charged at booking time.
    // Falling back to lt.duration_minutes would risk drift if the lesson type
    // has been edited since.
    const eligible = await sql`
      SELECT lb.id,
             lb.school_id,
             lb.instructor_id,
             lb.learner_id,
             lb.minutes_deducted AS duration_minutes
        FROM lesson_bookings lb
        JOIN learner_users lu ON lu.id = lb.learner_id
        JOIN lesson_types  lt ON lt.id = lb.lesson_type_id
       WHERE lb.list_price_source IS NULL
         AND lb.minutes_deducted > 0
       ORDER BY lb.id ASC
    `;

    if (isDryRun) {
      result.passes.live_compute = { would_update: eligible.length };
    } else {
      let updated = 0;
      let failed  = 0;
      for (const row of eligible) {
        try {
          const ratePencePerMinute = await getEffectiveRatePencePerMinute(sql, {
            schoolId:     row.school_id,
            instructorId: row.instructor_id,
            learnerId:    row.learner_id,
          });
          const listPricePence = Math.round(row.duration_minutes * ratePencePerMinute);

          // Single-row UPDATE. NULL guard means a concurrent process or a
          // re-run can't double-write; the second writer's WHERE matches zero.
          const result2 = await sql`
            UPDATE lesson_bookings
               SET list_price_pence  = ${listPricePence},
                   list_price_source = 'live_compute_backfill'
             WHERE id = ${row.id}
               AND list_price_source IS NULL
            RETURNING id
          `;
          if (result2.length > 0) updated++;
        } catch (rowErr) {
          failed++;
          console.error(`[step-1c] live-compute row ${row.id} failed:`, rowErr.message);
        }
      }
      result.passes.live_compute = { updated, failed, considered: eligible.length };
    }

    // ── Pass 3: unknown (everything still NULL after passes 1 + 2) ───────────
    // Anonymised learners, deleted lesson_types, orphan rows. Leaving
    // list_price_pence NULL is deliberate — the source tag is the load-bearing
    // signal; the cron's getReviewBookings query filters on source='unknown'.
    if (isDryRun) {
      const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count
          FROM lesson_bookings
         WHERE list_price_source IS NULL
      `;
      result.passes.unknown = { would_update: count };
    } else {
      const rows = await sql`
        UPDATE lesson_bookings
           SET list_price_source = 'unknown'
         WHERE list_price_source IS NULL
        RETURNING id
      `;
      result.passes.unknown = { updated: rows.length };
    }

    // ── Final NULL count + marker insert ─────────────────────────────────────
    const [{ count: remaining }] = await sql`
      SELECT COUNT(*)::int AS count
        FROM lesson_bookings
       WHERE list_price_source IS NULL
    `;
    result.total_remaining_null = remaining;

    if (!isDryRun) {
      if (remaining > 0) {
        // Loud failure: passes 1-3 should cover every row. If any are still
        // NULL, something is wrong (race with a concurrent INSERT? schema
        // drift?) and Step 2's marker check would refuse to run anyway.
        // Better to fail visibly here than silently mark complete.
        const msg = `Backfill incomplete: ${remaining} rows still have list_price_source IS NULL after all three passes. Marker NOT written.`;
        console.error('[step-1c]', msg);
        return res.status(500).json({ ok: false, error: msg, result });
      }

      // All rows tagged. Marker is the green light for Step 2.
      const markerRows = await sql`
        INSERT INTO migration_markers (key, notes)
        VALUES (${MARKER_KEY}, 'list_price_pence + list_price_source backfilled')
        ON CONFLICT (key) DO NOTHING
        RETURNING key, completed_at
      `;
      result.marker_written = markerRows.length > 0;
      result.marker_already_present = markerRows.length === 0;
    }

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[step-1c] migration failed:', err);
    reportError('/api/migrate-step-1c', err);
    return res.status(500).json({ ok: false, error: 'Migration failed', details: err.message });
  }
};

// Exported for tests.
module.exports.MARKER_KEY = MARKER_KEY;
