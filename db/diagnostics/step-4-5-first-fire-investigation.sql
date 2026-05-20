-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4.5 first-fire diagnostic — investigates 34/37 drift pairs on prod.
-- ─────────────────────────────────────────────────────────────────────────────
-- Run in Neon SQL Console against PRODUCTION (not the test branch).
-- All queries are READ-ONLY. Run each section and paste the output back.
--
-- Pattern observed in the first cron fire 2026-05-20 21:02 UTC:
--   • 14 (learner, instructor=1 Fraser) pairs: LCB > 0, computed_ledger = 0
--   • 5  (learner, instructor=4 Simon)  pairs: LCB = 0, computed_ledger < 0
--   • Several learners appear in BOTH groups (e.g. learner 15, 19, 52)
--
-- Hypotheses to confirm or refute:
--   A. Step 2 backfill credited LCB without writing matching credit_transactions rows.
--      → Group A 'phantom LCB' would be expected legacy state, not corruption.
--   B. Simon's learners purchased credits attributed to Fraser (instructor 1)
--      but booked with Simon (instructor 4).
--      → Group B 'negative ledger' would mean the per-instructor CT split is
--        not lining up with the per-booking instructor.
-- ─────────────────────────────────────────────────────────────────────────────

-- Q1. For ONE Group A learner (15), see every credit_transactions row and
--     every booking. Are there CT rows at all? What instructor_id is on them?
SELECT
  'ct' AS source, id, learner_id, instructor_id, type, minutes,
  amount_pence, stripe_session_id, created_at::text
FROM credit_transactions
WHERE learner_id = 15
ORDER BY created_at, id;

SELECT
  'lb' AS source, id, learner_id, instructor_id, status,
  minutes_deducted, credit_returned, credit_forfeited,
  scheduled_date::text, created_at::text
FROM lesson_bookings
WHERE learner_id = 15
ORDER BY scheduled_date, id;

SELECT
  'lcb' AS source, learner_id, instructor_id, school_id, balance_minutes,
  updated_at::text
FROM learner_credit_balances
WHERE learner_id = 15;


-- Q2. Across ALL 14 Group A learners — do their credit_transactions rows
--     have instructor_id = NULL (pooled, Pre-2A) or non-NULL?
SELECT
  ct.learner_id,
  COUNT(*) FILTER (WHERE ct.instructor_id IS NULL)     AS pooled_ct_rows,
  COUNT(*) FILTER (WHERE ct.instructor_id IS NOT NULL) AS scoped_ct_rows,
  COUNT(*) FILTER (WHERE ct.instructor_id = 1)         AS fraser_scoped,
  COUNT(*) FILTER (WHERE ct.instructor_id = 4)         AS simon_scoped,
  SUM(ct.minutes) FILTER (WHERE ct.instructor_id IS NULL)     AS pooled_minutes_sum,
  SUM(ct.minutes) FILTER (WHERE ct.instructor_id IS NOT NULL) AS scoped_minutes_sum
FROM credit_transactions ct
WHERE ct.learner_id IN (15, 14, 24, 61, 74, 8, 52, 36, 53, 54, 31, 34, 13, 33, 19)
  AND ct.school_id = 1
GROUP BY ct.learner_id
ORDER BY ct.learner_id;


-- Q3. For ONE Group B learner (55, Simon's), the symmetric picture.
SELECT
  'ct' AS source, id, learner_id, instructor_id, type, minutes,
  amount_pence, stripe_session_id, created_at::text
FROM credit_transactions
WHERE learner_id = 55
ORDER BY created_at, id;

SELECT
  'lb' AS source, id, learner_id, instructor_id, status,
  minutes_deducted, credit_returned, credit_forfeited,
  scheduled_date::text
FROM lesson_bookings
WHERE learner_id = 55
ORDER BY scheduled_date, id;

SELECT
  'lcb' AS source, learner_id, instructor_id, balance_minutes
FROM learner_credit_balances
WHERE learner_id = 55;


-- Q4. Confirm Simon's identity and check whether he has ANY credit_transactions
--     rows attributed to him.
SELECT id, name, email, created_at::text
  FROM instructors WHERE id = 4;

SELECT
  COUNT(*)                                            AS total_ct_for_simon,
  COUNT(*) FILTER (WHERE type = 'purchase')           AS purchases,
  COUNT(*) FILTER (WHERE type = 'slot_purchase')      AS slot_purchases,
  SUM(minutes)                                        AS total_minutes
FROM credit_transactions
WHERE instructor_id = 4;


-- Q5. Sanity: do the Group A learners have lesson_bookings against Simon
--     (instructor_id = 4)? That would explain the per-learner cross-pairing.
SELECT
  lb.learner_id,
  lb.instructor_id,
  COUNT(*)                                                AS booking_count,
  SUM(lb.minutes_deducted) FILTER (WHERE lb.credit_returned = FALSE) AS active_deducted,
  SUM(lb.minutes_deducted) FILTER (WHERE lb.credit_returned = TRUE)  AS refunded_deducted
FROM lesson_bookings lb
WHERE lb.learner_id IN (15, 19, 52, 20)  -- learners appearing in BOTH groups
  AND lb.minutes_deducted IS NOT NULL
  AND lb.minutes_deducted > 0
GROUP BY lb.learner_id, lb.instructor_id
ORDER BY lb.learner_id, lb.instructor_id;


-- Q6. Step 2 migration markers — did the backfill complete cleanly?
SELECT marker, set_at::text, notes
FROM migration_markers
ORDER BY set_at DESC
LIMIT 10;


-- Q7. BCS table: does it actually have any rows on prod?
SELECT COUNT(*) AS bcs_rows,
       MIN(created_at)::text AS earliest,
       MAX(created_at)::text AS latest
FROM booking_credit_sources;

SELECT COUNT(*) AS csa_rows FROM credit_source_adjustments;
