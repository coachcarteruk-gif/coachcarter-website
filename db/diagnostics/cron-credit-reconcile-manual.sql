-- ─────────────────────────────────────────────────────────────────────────────
-- Manual companion to api/cron-credit-reconcile.js (Step 4.5).
-- ─────────────────────────────────────────────────────────────────────────────
-- The daily cron emails a capped summary of drift pairs (default cap: 20).
-- When the alert says "and N more pair(s)" or you want to investigate a
-- specific pair, run the queries below against production.
--
-- LEDGER FORMULA (all three modes)
--   expected_balance_minutes
--     =  SUM(credit_transactions.minutes)                                       -- purchases
--      - SUM(lesson_bookings.minutes_deducted)
--             WHERE credit_returned = FALSE
--               AND (booking has no booking_credit_sources row)                  -- un-attributed booking draws
--      - SUM(booking_credit_sources.minutes_drawn) WHERE refunded_at IS NULL    -- attributed draws  [BCS modes only]
--      - SUM(credit_source_adjustments.minutes_adjusted)                        -- cash refunds      [full mode only]
--
-- USAGE
--   1. Pick the section matching the cron's schema_mode from the alert
--      email subject:
--        ct_only        — pre-Step-5 (no BCS / CSA tables yet)
--        ct_plus_bcs    — Step 5 partially landed
--        full           — Step 5 + 5.5 both shipped
--   2. Run the matching reconcile query in the Neon SQL console.
--   3. For each non-zero drift row, use the per-pair detail query at the
--      bottom to pull the contributing rows.
--
-- SAFETY
--   All queries here are READ-ONLY. The correction template for clearing
--   drift lives in db/diagnostics/hotfix-177-post-deploy-audit.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- MODE: ct_only
-- ═════════════════════════════════════════════════════════════════════════════
WITH purchases AS (
  SELECT
    ct.learner_id,
    ct.instructor_id,
    COALESCE(SUM(ct.minutes), 0)::int AS minutes
  FROM credit_transactions ct
  WHERE ct.school_id = 1
    AND ct.instructor_id IS NOT NULL
  GROUP BY ct.learner_id, ct.instructor_id
),
booking_draws AS (
  SELECT
    lb.learner_id,
    lb.instructor_id,
    COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
  FROM lesson_bookings lb
  WHERE lb.school_id = 1
    AND lb.credit_returned = FALSE
    AND lb.minutes_deducted IS NOT NULL
    AND lb.minutes_deducted > 0
  GROUP BY lb.learner_id, lb.instructor_id
),
ledger AS (
  SELECT
    COALESCE(p.learner_id,    bd.learner_id)    AS learner_id,
    COALESCE(p.instructor_id, bd.instructor_id) AS instructor_id,
      COALESCE(p.minutes,  0)
    - COALESCE(bd.minutes, 0)                   AS expected_balance_minutes
  FROM purchases p
  FULL OUTER JOIN booking_draws bd
    ON  bd.learner_id    = p.learner_id
    AND bd.instructor_id = p.instructor_id
)
SELECT
  COALESCE(lcb.learner_id,    l.learner_id)    AS learner_id,
  COALESCE(lcb.instructor_id, l.instructor_id) AS instructor_id,
  lu.name                                       AS learner_name,
  lu.email                                      AS learner_email,
  COALESCE(lcb.balance_minutes, 0)             AS actual_lcb_balance_minutes,
  COALESCE(l.expected_balance_minutes, 0)      AS computed_ledger_balance_minutes,
  COALESCE(lcb.balance_minutes, 0)
    - COALESCE(l.expected_balance_minutes, 0)  AS drift_minutes
FROM ledger l
FULL OUTER JOIN learner_credit_balances lcb
  ON  lcb.learner_id    = l.learner_id
  AND lcb.instructor_id = l.instructor_id
LEFT JOIN learner_users lu
  ON lu.id = COALESCE(lcb.learner_id, l.learner_id)
WHERE (lcb.school_id IS NULL OR lcb.school_id = 1)
  AND COALESCE(lcb.balance_minutes, 0)
        IS DISTINCT FROM COALESCE(l.expected_balance_minutes, 0)
ORDER BY ABS(COALESCE(lcb.balance_minutes, 0)
             - COALESCE(l.expected_balance_minutes, 0)) DESC,
         learner_id, instructor_id;

-- ═════════════════════════════════════════════════════════════════════════════
-- MODE: ct_plus_bcs
-- ═════════════════════════════════════════════════════════════════════════════
WITH bcs_per_pair AS (
  SELECT
    ct.learner_id,
    ct.instructor_id,
    SUM(bcs.minutes_drawn)::int AS minutes
  FROM booking_credit_sources bcs
  JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
  WHERE bcs.refunded_at IS NULL
    AND ct.school_id = 1
    AND ct.instructor_id IS NOT NULL
  GROUP BY ct.learner_id, ct.instructor_id
),
purchases AS (
  SELECT ct.learner_id, ct.instructor_id, COALESCE(SUM(ct.minutes), 0)::int AS minutes
    FROM credit_transactions ct
   WHERE ct.school_id = 1 AND ct.instructor_id IS NOT NULL
   GROUP BY ct.learner_id, ct.instructor_id
),
booking_draws AS (
  SELECT lb.learner_id, lb.instructor_id, COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
    FROM lesson_bookings lb
   WHERE lb.school_id = 1
     AND lb.credit_returned = FALSE
     AND lb.minutes_deducted IS NOT NULL
     AND lb.minutes_deducted > 0
     AND NOT EXISTS (SELECT 1 FROM booking_credit_sources bcs2 WHERE bcs2.booking_id = lb.id)
   GROUP BY lb.learner_id, lb.instructor_id
),
all_pairs AS (
  SELECT learner_id, instructor_id FROM purchases
  UNION SELECT learner_id, instructor_id FROM booking_draws
  UNION SELECT learner_id, instructor_id FROM bcs_per_pair
),
ledger AS (
  SELECT
    ap.learner_id,
    ap.instructor_id,
      COALESCE(p.minutes,  0)
    - COALESCE(bd.minutes, 0)
    - COALESCE(b.minutes,  0) AS expected_balance_minutes
  FROM all_pairs ap
  LEFT JOIN purchases     p  ON p.learner_id  = ap.learner_id AND p.instructor_id  = ap.instructor_id
  LEFT JOIN booking_draws bd ON bd.learner_id = ap.learner_id AND bd.instructor_id = ap.instructor_id
  LEFT JOIN bcs_per_pair  b  ON b.learner_id  = ap.learner_id AND b.instructor_id  = ap.instructor_id
)
SELECT
  COALESCE(lcb.learner_id, l.learner_id)       AS learner_id,
  COALESCE(lcb.instructor_id, l.instructor_id) AS instructor_id,
  lu.name                                       AS learner_name,
  lu.email                                      AS learner_email,
  COALESCE(lcb.balance_minutes, 0)             AS actual_lcb_balance_minutes,
  COALESCE(l.expected_balance_minutes, 0)      AS computed_ledger_balance_minutes,
  COALESCE(lcb.balance_minutes, 0)
    - COALESCE(l.expected_balance_minutes, 0)  AS drift_minutes
FROM ledger l
FULL OUTER JOIN learner_credit_balances lcb
  ON lcb.learner_id    = l.learner_id
 AND lcb.instructor_id = l.instructor_id
LEFT JOIN learner_users lu
  ON lu.id = COALESCE(lcb.learner_id, l.learner_id)
WHERE (lcb.school_id IS NULL OR lcb.school_id = 1)
  AND COALESCE(lcb.balance_minutes, 0)
        IS DISTINCT FROM COALESCE(l.expected_balance_minutes, 0)
ORDER BY ABS(COALESCE(lcb.balance_minutes, 0)
             - COALESCE(l.expected_balance_minutes, 0)) DESC,
         learner_id, instructor_id;

-- ═════════════════════════════════════════════════════════════════════════════
-- MODE: full
-- ═════════════════════════════════════════════════════════════════════════════
WITH bcs_per_pair AS (
  SELECT ct.learner_id, ct.instructor_id, SUM(bcs.minutes_drawn)::int AS minutes
    FROM booking_credit_sources bcs
    JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
   WHERE bcs.refunded_at IS NULL AND ct.school_id = 1 AND ct.instructor_id IS NOT NULL
   GROUP BY ct.learner_id, ct.instructor_id
),
csa_per_pair AS (
  SELECT ct.learner_id, ct.instructor_id, SUM(csa.minutes_adjusted)::int AS minutes
    FROM credit_source_adjustments csa
    JOIN credit_transactions ct ON ct.id = csa.credit_transaction_id
   WHERE ct.school_id = 1 AND ct.instructor_id IS NOT NULL
   GROUP BY ct.learner_id, ct.instructor_id
),
purchases AS (
  SELECT ct.learner_id, ct.instructor_id, COALESCE(SUM(ct.minutes), 0)::int AS minutes
    FROM credit_transactions ct
   WHERE ct.school_id = 1 AND ct.instructor_id IS NOT NULL
   GROUP BY ct.learner_id, ct.instructor_id
),
booking_draws AS (
  SELECT lb.learner_id, lb.instructor_id, COALESCE(SUM(lb.minutes_deducted), 0)::int AS minutes
    FROM lesson_bookings lb
   WHERE lb.school_id = 1
     AND lb.credit_returned = FALSE
     AND lb.minutes_deducted IS NOT NULL
     AND lb.minutes_deducted > 0
     AND NOT EXISTS (SELECT 1 FROM booking_credit_sources bcs2 WHERE bcs2.booking_id = lb.id)
   GROUP BY lb.learner_id, lb.instructor_id
),
all_pairs AS (
  SELECT learner_id, instructor_id FROM purchases
  UNION SELECT learner_id, instructor_id FROM booking_draws
  UNION SELECT learner_id, instructor_id FROM bcs_per_pair
  UNION SELECT learner_id, instructor_id FROM csa_per_pair
),
ledger AS (
  SELECT
    ap.learner_id,
    ap.instructor_id,
      COALESCE(p.minutes,  0)
    - COALESCE(bd.minutes, 0)
    - COALESCE(b.minutes,  0)
    - COALESCE(c.minutes,  0) AS expected_balance_minutes
  FROM all_pairs ap
  LEFT JOIN purchases     p  ON p.learner_id  = ap.learner_id AND p.instructor_id  = ap.instructor_id
  LEFT JOIN booking_draws bd ON bd.learner_id = ap.learner_id AND bd.instructor_id = ap.instructor_id
  LEFT JOIN bcs_per_pair  b  ON b.learner_id  = ap.learner_id AND b.instructor_id  = ap.instructor_id
  LEFT JOIN csa_per_pair  c  ON c.learner_id  = ap.learner_id AND c.instructor_id  = ap.instructor_id
)
SELECT
  COALESCE(lcb.learner_id, l.learner_id)       AS learner_id,
  COALESCE(lcb.instructor_id, l.instructor_id) AS instructor_id,
  lu.name                                       AS learner_name,
  lu.email                                      AS learner_email,
  COALESCE(lcb.balance_minutes, 0)             AS actual_lcb_balance_minutes,
  COALESCE(l.expected_balance_minutes, 0)      AS computed_ledger_balance_minutes,
  COALESCE(lcb.balance_minutes, 0)
    - COALESCE(l.expected_balance_minutes, 0)  AS drift_minutes
FROM ledger l
FULL OUTER JOIN learner_credit_balances lcb
  ON lcb.learner_id    = l.learner_id
 AND lcb.instructor_id = l.instructor_id
LEFT JOIN learner_users lu
  ON lu.id = COALESCE(lcb.learner_id, l.learner_id)
WHERE (lcb.school_id IS NULL OR lcb.school_id = 1)
  AND COALESCE(lcb.balance_minutes, 0)
        IS DISTINCT FROM COALESCE(l.expected_balance_minutes, 0)
ORDER BY ABS(COALESCE(lcb.balance_minutes, 0)
             - COALESCE(l.expected_balance_minutes, 0)) DESC,
         learner_id, instructor_id;

-- ═════════════════════════════════════════════════════════════════════════════
-- PER-PAIR DETAIL
-- ═════════════════════════════════════════════════════════════════════════════
-- Replace the placeholders with the learner_id and instructor_id from a
-- drift row, then run each block.

-- ── Credit-transactions ledger for the pair ─────────────────────────────────
SELECT id, type, minutes, amount_pence, stripe_session_id, created_at
  FROM credit_transactions
 WHERE learner_id    = /* paste learner_id */    NULL
   AND instructor_id = /* paste instructor_id */ NULL
   AND school_id     = 1
 ORDER BY created_at, id;

-- ── Booking draws for the pair (un-attributed bookings) ─────────────────────
SELECT id, scheduled_date, start_time, status, minutes_deducted, credit_returned, credit_forfeited, cancelled_at
  FROM lesson_bookings
 WHERE learner_id    = /* paste learner_id */    NULL
   AND instructor_id = /* paste instructor_id */ NULL
   AND school_id     = 1
   AND minutes_deducted IS NOT NULL
   AND minutes_deducted > 0
 ORDER BY scheduled_date, start_time;

-- ── BCS draws for the pair (run only if booking_credit_sources exists) ──────
-- SELECT bcs.id, bcs.booking_id, bcs.credit_transaction_id,
--        bcs.minutes_drawn, bcs.refunded_at, bcs.created_at
--   FROM booking_credit_sources bcs
--   JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
--  WHERE ct.learner_id    = /* paste learner_id */    NULL
--    AND ct.instructor_id = /* paste instructor_id */ NULL
--  ORDER BY bcs.created_at, bcs.id;

-- ── CSA adjustments for the pair (run only if credit_source_adjustments exists)
-- SELECT csa.id, csa.credit_transaction_id, csa.kind,
--        csa.minutes_adjusted, csa.pence_adjusted, csa.stripe_refund_id,
--        csa.reason, csa.created_at
--   FROM credit_source_adjustments csa
--   JOIN credit_transactions ct ON ct.id = csa.credit_transaction_id
--  WHERE ct.learner_id    = /* paste learner_id */    NULL
--    AND ct.instructor_id = /* paste instructor_id */ NULL
--  ORDER BY csa.created_at, csa.id;
