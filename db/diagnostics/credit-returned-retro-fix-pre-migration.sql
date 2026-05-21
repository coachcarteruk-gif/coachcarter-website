-- Pre-migration verification for /api/migrate-credit-returned-retro-fix.
-- Run before POSTing the migration. Confirms exactly which rows the
-- predicate will touch — the three known reschedule-bug bookings on
-- prod: #117, #133, #214.

-- ── 1. Marker absence check ────────────────────────────────────────────
-- Must NOT exist pre-migration.
SELECT key, completed_at::text
  FROM migration_markers
 WHERE key = 'credits_credit_returned_retro_fix';

-- ── 2. Target row inspection ───────────────────────────────────────────
-- Each row's will_flip should be TRUE. If any is FALSE, investigate the
-- difference (status drift, credit_returned already TRUE, credit_forfeited
-- now TRUE, minutes_deducted zeroed).
SELECT
  lb.id,
  lb.learner_id,
  lu.name                    AS learner_name,
  lb.instructor_id,
  i.name                     AS instructor_name,
  lb.scheduled_date::text    AS scheduled_date,
  lb.start_time::text        AS start_time,
  lb.status,
  lb.credit_returned,
  lb.credit_forfeited,
  lb.minutes_deducted,
  (lb.status = 'refunded'
   AND lb.credit_returned = FALSE
   AND COALESCE(lb.credit_forfeited, FALSE) = FALSE
   AND lb.minutes_deducted IS NOT NULL
   AND lb.minutes_deducted > 0)              AS will_flip
FROM lesson_bookings lb
LEFT JOIN learner_users lu ON lu.id = lb.learner_id
LEFT JOIN instructors  i  ON i.id  = lb.instructor_id
WHERE lb.id IN (117, 133, 214)
  AND COALESCE(lb.school_id, 1) = 1
ORDER BY lb.id;

-- ── 3. Cron drift before migration ─────────────────────────────────────
-- Operator: re-run /api/cron-credit-reconcile (Bearer ${CRON_SECRET}).
-- Expected drift_summary entries (per Plan B3 ship 2026-05-21 12:19 UTC):
--   (learner=11, instructor=6) +90  (booking #117)
--   (learner=55, instructor=4) +90  (booking #133)
--   (learner=92, instructor=4) +90  (booking #214)
-- drift_count = 3.

-- ── 4. Sanity: no other reschedule-bug bookings exist ──────────────────
-- After this migration, the writer-path fix in the same PR prevents
-- future instances. But if any OTHER refunded-but-credit-not-returned
-- bookings exist on prod that we didn't know about, they will keep
-- alerting after this migration runs. Surface them so the operator can
-- decide whether to expand the allowlist before applying.
SELECT
  lb.id,
  lb.learner_id,
  lb.instructor_id,
  lb.scheduled_date::text   AS scheduled_date,
  lb.status,
  lb.credit_returned,
  lb.credit_forfeited,
  lb.minutes_deducted,
  lb.rescheduled_from,
  CASE
    WHEN lb.rescheduled_from IS NOT NULL THEN 'reschedule bug (matches chip #3 pattern)'
    ELSE 'unknown — investigate before applying'
  END AS hypothesis
FROM lesson_bookings lb
WHERE lb.school_id = 1
  AND lb.status = 'refunded'
  AND lb.credit_returned = FALSE
  AND COALESCE(lb.credit_forfeited, FALSE) = FALSE
  AND lb.minutes_deducted IS NOT NULL
  AND lb.minutes_deducted > 0
  AND lb.id NOT IN (117, 133, 214)
ORDER BY lb.scheduled_date DESC, lb.id;
-- Expected: zero rows. If non-zero on prod 2026-05-21, halt and expand
-- the allowlist in api/migrate-credit-returned-retro-fix.js before
-- POSTing.
