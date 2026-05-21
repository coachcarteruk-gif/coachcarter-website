-- Post-migration verification for /api/migrate-credit-returned-retro-fix.
-- Run immediately after POSTing the migration. Confirms the marker
-- landed, the three target rows flipped, and the cron drift dropped.

-- ── 1. Marker landed ───────────────────────────────────────────────────
SELECT key, completed_at::text, notes
  FROM migration_markers
 WHERE key = 'credits_credit_returned_retro_fix';

-- ── 2. Target rows now have credit_returned = TRUE ─────────────────────
-- All three should be: status='refunded', credit_returned=TRUE,
-- credit_forfeited=FALSE, minutes_deducted=90.
SELECT
  id,
  learner_id,
  instructor_id,
  scheduled_date::text,
  status,
  credit_returned,
  credit_forfeited,
  minutes_deducted,
  cancelled_at::text
FROM lesson_bookings
WHERE id IN (117, 133, 214)
ORDER BY id;

-- ── 3. Cron drift after migration ──────────────────────────────────────
-- Operator: re-run /api/cron-credit-reconcile.
-- Expected: drift_count drops 3 → 0 (or to whatever residual exists
-- from activity that hit prod between Plan B3 apply 2026-05-21 12:19 UTC
-- and this migration's POST).
--
-- If drift_count > 0, examine the drift_summary entries:
--   • If any are at (learner=11/55/92, instructor=6/4) — the flip didn't
--     take. Re-run query (2) above to diagnose.
--   • If new entries surface (different learner_id or instructor_id),
--     those are POST-B3 activity-driven drift, not historical. Run the
--     hypothesis query (db/diagnostics/cron-credit-reconcile-manual.sql)
--     to triage.

-- ── 4. Verify no other refund-bug bookings remain ──────────────────────
-- The query mirrors section 4 of the pre-migration diagnostic. Should
-- return zero rows after the writer-path fix is in production AND the
-- retro-fix has run.
SELECT
  lb.id,
  lb.learner_id,
  lb.instructor_id,
  lb.scheduled_date::text,
  lb.status,
  lb.credit_returned,
  lb.credit_forfeited,
  lb.minutes_deducted,
  lb.rescheduled_from
FROM lesson_bookings lb
WHERE lb.school_id = 1
  AND lb.status = 'refunded'
  AND lb.credit_returned = FALSE
  AND COALESCE(lb.credit_forfeited, FALSE) = FALSE
  AND lb.minutes_deducted IS NOT NULL
  AND lb.minutes_deducted > 0
ORDER BY lb.scheduled_date DESC, lb.id;
-- Expected: zero rows. If non-zero, a new reschedule between the writer-
-- path fix landing on Vercel and the retro-fix POST has slipped through
-- the unfixed code path — should be impossible if both ship in the same
-- deploy.
