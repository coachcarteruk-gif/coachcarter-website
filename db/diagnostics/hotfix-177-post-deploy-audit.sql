-- ─────────────────────────────────────────────────────────────────────────────
-- Hotfix PR #177 — post-deploy audit
-- ─────────────────────────────────────────────────────────────────────────────
-- OUTCOME (2026-05-20 ~19:50 UTC):
--   Q1 returned ZERO rows in the bug window. No slot-purchase webhooks fired
--   between PR #176 merge and PR #177 deploy, so no LCB inflation occurred.
--   No corrections required. This file is retained as a reference template
--   for any future Phase 2A drift investigation (e.g. when Step 4.5
--   divergence-check cron flags a row, or after a future migration touches
--   the LCB writer paths).
--
-- Bug window:
--   START: 2026-05-20 16:25:38 UTC (PR #176 squash-merged to main; Vercel
--          began auto-deploy ~immediately after).
--   END:   2026-05-20 19:46:00 UTC (approx — PR #177 merge at 19:44:23, plus
--          ~90s for Vercel deploy completion).
--
-- What broke:
--   lockBalanceAdjustPhase2A's SELECT clause was `WHERE NOT $isDeduct`. For
--   any negative delta against an existing LCB row, isDeduct=true → SELECT
--   returned zero rows → INSERT attempted nothing → ON CONFLICT never fired
--   → helper returned INSUFFICIENT_BALANCE. webhook.js slot-purchase fires
--   `+durationMins` (lands) then `-durationMins` (silently fails) — so the
--   slot-pinned net-zero pair leaves LCB.balance_minutes inflated by
--   durationMins per affected webhook.
--
-- Affected webhook code paths (both call lockBalanceAdjustLCB):
--   - api/webhook.js handleSlotBooking       — `slot_purchase` ledger,
--                                              durationMins net-zero
--   - api/webhook.js handleOfferBooking      — `slot_purchase` ledger,
--                                              totalMinutes net-zero
--                                              (slot-pinned offers only)
--
-- Side effects per affected webhook:
--   - credit_transactions: ONE 'slot_purchase' row, written CORRECTLY before
--                          the broken adjust.
--   - learner_credit_balances.balance_minutes: INFLATED by minutes.
--   - learner_users.balance_minutes:           INFLATED by minutes via the
--                                              LCB → learner_users sync
--                                              trigger.
--   - lesson_bookings: created correctly (booking insert is independent).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- USAGE
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Set the deploy timestamp marker below to when Vercel finished deploying
--    PR #177 (UTC). Round up generously — 5min buffer is fine.
-- 2. Run each query block in the Neon SQL console against production.
-- 3. Report findings — manual correction is row-by-row; do not bulk update.

-- ── Bug window for the original 2026-05-20 incident ─────────────────────────
\set bug_start_ts '2026-05-20 16:25:38+00'
\set bug_end_ts   '2026-05-20 19:46:00+00'

-- ─────────────────────────────────────────────────────────────────────────────
-- Q1. SCOPE — how many slot_purchase credit_transactions rows were written
-- during the bug window? Each one is a candidate inflation event.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  COUNT(*)                                                AS candidate_rows,
  COUNT(DISTINCT learner_id)                              AS distinct_learners,
  COUNT(DISTINCT (learner_id, instructor_id))             AS distinct_pairs,
  SUM(minutes)                                            AS total_minutes_inflated_worst_case,
  MIN(created_at)                                         AS earliest,
  MAX(created_at)                                         AS latest
FROM credit_transactions
WHERE type = 'slot_purchase'
  AND created_at >= :'bug_start_ts'::timestamptz
  AND created_at <  :'bug_end_ts'::timestamptz
  AND school_id = 1
  AND instructor_id IS NOT NULL;   -- Phase 2A writes set this; Pre-2A leaves NULL

-- ─────────────────────────────────────────────────────────────────────────────
-- Q2. PER-PAIR DIVERGENCE — for every (learner_id, instructor_id) pair that
-- saw a slot_purchase in the window, compute the expected LCB balance vs
-- the actual LCB balance.
--
-- Expected balance for the pair = SUM(credit_transactions.minutes) for that
-- pair (all rows, all time — the ledger is the source of truth).
--
-- Actual balance = learner_credit_balances.balance_minutes.
--
-- Drift = actual - expected. POSITIVE drift is the bug's footprint
-- (LCB inflated above what the ledger says it should be).
--
-- A non-zero drift with positive sign is presumed bug-caused. Negative or
-- pre-existing drift would predate this incident — flag separately.
-- ─────────────────────────────────────────────────────────────────────────────
WITH affected_pairs AS (
  SELECT DISTINCT learner_id, instructor_id
    FROM credit_transactions
   WHERE type = 'slot_purchase'
     AND created_at >= :'bug_start_ts'::timestamptz
     AND created_at <  :'bug_end_ts'::timestamptz
     AND school_id = 1
     AND instructor_id IS NOT NULL
),
ledger_sums AS (
  SELECT ct.learner_id, ct.instructor_id,
         COALESCE(SUM(ct.minutes), 0)::int AS expected_balance_minutes
    FROM credit_transactions ct
    JOIN affected_pairs ap
      ON ap.learner_id = ct.learner_id
     AND ap.instructor_id = ct.instructor_id
   WHERE ct.school_id = 1
   GROUP BY ct.learner_id, ct.instructor_id
)
SELECT
  ls.learner_id,
  ls.instructor_id,
  lu.name                                                 AS learner_name,
  lu.email                                                AS learner_email,
  ls.expected_balance_minutes,
  COALESCE(lcb.balance_minutes, 0)                        AS actual_lcb_balance_minutes,
  COALESCE(lcb.balance_minutes, 0) - ls.expected_balance_minutes
                                                          AS drift_minutes,
  -- How many slot_purchase rows happened in the bug window for this pair —
  -- a back-of-envelope estimate of how many net-zero pairs were broken.
  (
    SELECT COUNT(*) FROM credit_transactions ct2
     WHERE ct2.learner_id    = ls.learner_id
       AND ct2.instructor_id = ls.instructor_id
       AND ct2.type = 'slot_purchase'
       AND ct2.created_at >= :'bug_start_ts'::timestamptz
       AND ct2.created_at <  :'bug_end_ts'::timestamptz
  )                                                       AS slot_purchases_in_window,
  -- Sum of durationMins / totalMinutes for that pair's window slot_purchases.
  -- For slot-pinned offers / single-slot purchases the *expected* inflation
  -- per row is the row's `minutes` value (each net-zero pair leaks that
  -- much). Drift should match this sum exactly. A mismatch means
  -- something else is going on — pre-existing drift, or a non-bug
  -- adjustment in the same window.
  (
    SELECT COALESCE(SUM(ct2.minutes), 0)::int FROM credit_transactions ct2
     WHERE ct2.learner_id    = ls.learner_id
       AND ct2.instructor_id = ls.instructor_id
       AND ct2.type = 'slot_purchase'
       AND ct2.created_at >= :'bug_start_ts'::timestamptz
       AND ct2.created_at <  :'bug_end_ts'::timestamptz
  )                                                       AS expected_drift_minutes
  FROM ledger_sums ls
  LEFT JOIN learner_credit_balances lcb
    ON  lcb.learner_id    = ls.learner_id
    AND lcb.instructor_id = ls.instructor_id
  LEFT JOIN learner_users lu
    ON  lu.id = ls.learner_id
 ORDER BY drift_minutes DESC, ls.learner_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Q3. POOLED learner_users.balance_minutes divergence
-- ─────────────────────────────────────────────────────────────────────────────
-- The LCB → learner_users sync trigger keeps learner_users.balance_minutes =
-- SUM(LCB.balance_minutes) for that learner. So if LCB was inflated, the
-- pooled balance was inflated too.
--
-- This query computes the pooled-divergence for each affected learner:
-- learner_users.balance_minutes  vs  SUM(LCB.balance_minutes) for the learner.
--
-- If the sync trigger is doing its job, drift_pooled_minutes will equal
-- SUM(drift_minutes_per_pair) from Q2. If they don't match, the trigger
-- isn't firing for every LCB write — escalate.
-- ─────────────────────────────────────────────────────────────────────────────
WITH affected_learners AS (
  SELECT DISTINCT learner_id
    FROM credit_transactions
   WHERE type = 'slot_purchase'
     AND created_at >= :'bug_start_ts'::timestamptz
     AND created_at <  :'bug_end_ts'::timestamptz
     AND school_id = 1
     AND instructor_id IS NOT NULL
)
SELECT
  al.learner_id,
  lu.name,
  lu.email,
  lu.balance_minutes                                      AS pooled_balance,
  COALESCE(SUM(lcb.balance_minutes), 0)                   AS sum_of_lcb,
  lu.balance_minutes - COALESCE(SUM(lcb.balance_minutes), 0)
                                                          AS trigger_drift,
  -- Expected pooled balance = SUM(ct.minutes) for the learner (across all
  -- instructors). If the pool is correct, this equals pooled_balance.
  (
    SELECT COALESCE(SUM(ct.minutes), 0)::int FROM credit_transactions ct
     WHERE ct.learner_id = al.learner_id AND ct.school_id = 1
  )                                                       AS expected_pooled_balance,
  lu.balance_minutes - (
    SELECT COALESCE(SUM(ct.minutes), 0)::int FROM credit_transactions ct
     WHERE ct.learner_id = al.learner_id AND ct.school_id = 1
  )                                                       AS pooled_drift_from_ledger
  FROM affected_learners al
  JOIN learner_users lu ON lu.id = al.learner_id
  LEFT JOIN learner_credit_balances lcb ON lcb.learner_id = al.learner_id
 GROUP BY al.learner_id, lu.name, lu.email, lu.balance_minutes
 ORDER BY pooled_drift_from_ledger DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- Q4. SANITY — check there are no Pre-2A 'slot_purchase' rows in the window
-- that would have followed the Pre-2A code path (instructor_id NULL).
-- This shouldn't happen given the dispatcher is on Phase 2A, but worth a
-- look in case the env-var or schema-detection returned false somewhere.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS pre2a_style_slot_purchases_in_window
  FROM credit_transactions
 WHERE type = 'slot_purchase'
   AND created_at >= :'bug_start_ts'::timestamptz
   AND created_at <  :'bug_end_ts'::timestamptz
   AND school_id = 1
   AND instructor_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Q5. SLOT BOOKINGS THAT FIRED THE NET-ZERO — to know which lesson_bookings
-- correspond to each inflation event. Useful when reaching out to the learner
-- (or to confirm the booking actually exists and isn't a separate orphan).
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  ct.id                                                   AS credit_tx_id,
  ct.created_at                                           AS purchase_at,
  ct.learner_id,
  ct.instructor_id,
  lu.name                                                 AS learner_name,
  ct.minutes                                              AS inflated_by_minutes,
  ct.amount_pence,
  ct.stripe_session_id,
  ct.stripe_payment_intent_id,
  -- Try to find the matching lesson_booking via stripe_session_id.
  lb.id                                                   AS lesson_booking_id,
  lb.scheduled_date,
  lb.start_time
  FROM credit_transactions ct
  JOIN learner_users lu ON lu.id = ct.learner_id
  LEFT JOIN lesson_bookings lb
    ON  lb.stripe_session_id = ct.stripe_session_id
    AND lb.learner_id        = ct.learner_id
 WHERE ct.type = 'slot_purchase'
   AND ct.created_at >= :'bug_start_ts'::timestamptz
   AND ct.created_at <  :'bug_end_ts'::timestamptz
   AND ct.school_id = 1
   AND ct.instructor_id IS NOT NULL
 ORDER BY ct.created_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- CORRECTION TEMPLATE — DO NOT RUN WITHOUT REVIEWING Q2 OUTPUT FIRST
-- ─────────────────────────────────────────────────────────────────────────────
-- For each row in Q2 with drift_minutes > 0 AND drift_minutes ==
-- expected_drift_minutes (i.e. the drift is exactly the sum of in-window
-- slot_purchases for that pair — confirming bug provenance), correct LCB by:
--
--   BEGIN;
--   UPDATE learner_credit_balances
--      SET balance_minutes = balance_minutes - :drift_minutes,
--          updated_at      = NOW()
--    WHERE learner_id    = :learner_id
--      AND instructor_id = :instructor_id
--      AND balance_minutes >= :drift_minutes;   -- safety, must be true
--   -- Verify: SELECT * FROM learner_credit_balances WHERE ...
--   -- COMMIT;  ← only after manual eyeballing
--
-- The LCB → learner_users sync trigger will fire on the UPDATE and decrement
-- the pooled learner_users.balance_minutes by the same amount. Verify in Q3
-- after each correction.
--
-- If drift_minutes != expected_drift_minutes — STOP. Something else is going
-- on (concurrent legitimate adjustment, pre-existing drift, Setmore sync,
-- admin top-up). Investigate before correcting.
