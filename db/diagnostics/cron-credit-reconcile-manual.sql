-- ─────────────────────────────────────────────────────────────────────────────
-- Manual companion to api/cron-credit-reconcile.js (Step 4.5).
-- ─────────────────────────────────────────────────────────────────────────────
-- The daily cron emails a capped summary of drift pairs (default cap: 20).
-- When the alert says "and N more pair(s)" or you want to investigate a
-- specific pair, run the queries below against production.
--
-- USAGE
--   1. Pick the section matching the cron's schema_mode from the alert
--      email subject:
--        ct_only        — current main state (no BCS / CSA tables yet)
--        ct_plus_bcs    — Step 5 schema partially landed
--        full           — Step 5 + 5.5 both shipped
--   2. Run the matching reconcile query in the Neon SQL console.
--   3. For each non-zero drift row, use the per-pair detail query at the
--      bottom to pull the contributing credit_transactions + (where present)
--      booking_credit_sources + credit_source_adjustments rows.
--
-- SAFETY
--   All queries here are READ-ONLY. The correction template for clearing
--   drift lives in db/diagnostics/hotfix-177-post-deploy-audit.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- MODE: ct_only
-- ═════════════════════════════════════════════════════════════════════════════
-- Use when booking_credit_sources and credit_source_adjustments do NOT exist
-- (current main state, pre-Step-5).
-- ═════════════════════════════════════════════════════════════════════════════
WITH ledger AS (
  SELECT
    ct.learner_id,
    ct.instructor_id,
    COALESCE(SUM(ct.minutes), 0)::int AS expected_balance_minutes
  FROM credit_transactions ct
  WHERE ct.school_id = 1
    AND ct.instructor_id IS NOT NULL
  GROUP BY ct.learner_id, ct.instructor_id
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
ORDER BY drift_minutes DESC, learner_id, instructor_id;

-- ═════════════════════════════════════════════════════════════════════════════
-- MODE: ct_plus_bcs
-- ═════════════════════════════════════════════════════════════════════════════
-- Use when booking_credit_sources exists but credit_source_adjustments does not.
-- BCS rows with refunded_at IS NOT NULL are EXCLUDED — those minutes have
-- returned to the source.
-- ═════════════════════════════════════════════════════════════════════════════
WITH bcs_per_ct AS (
  SELECT
    bcs.credit_transaction_id,
    SUM(bcs.minutes_drawn)::int AS minutes_drawn
  FROM booking_credit_sources bcs
  WHERE bcs.refunded_at IS NULL
  GROUP BY bcs.credit_transaction_id
),
ledger AS (
  SELECT
    ct.learner_id,
    ct.instructor_id,
      COALESCE(SUM(ct.minutes), 0)::int
    - COALESCE(SUM(bpc.minutes_drawn), 0)::int AS expected_balance_minutes
  FROM credit_transactions ct
  LEFT JOIN bcs_per_ct bpc ON bpc.credit_transaction_id = ct.id
  WHERE ct.school_id = 1
    AND ct.instructor_id IS NOT NULL
  GROUP BY ct.learner_id, ct.instructor_id
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
ORDER BY drift_minutes DESC, learner_id, instructor_id;

-- ═════════════════════════════════════════════════════════════════════════════
-- MODE: full
-- ═════════════════════════════════════════════════════════════════════════════
-- Use when both booking_credit_sources and credit_source_adjustments exist
-- (post-Step-5.5 steady state).
-- ═════════════════════════════════════════════════════════════════════════════
WITH bcs_per_ct AS (
  SELECT
    bcs.credit_transaction_id,
    SUM(bcs.minutes_drawn)::int AS minutes_drawn
  FROM booking_credit_sources bcs
  WHERE bcs.refunded_at IS NULL
  GROUP BY bcs.credit_transaction_id
),
csa_per_ct AS (
  SELECT
    csa.credit_transaction_id,
    SUM(csa.minutes_adjusted)::int AS minutes_adjusted
  FROM credit_source_adjustments csa
  GROUP BY csa.credit_transaction_id
),
ledger AS (
  SELECT
    ct.learner_id,
    ct.instructor_id,
      COALESCE(SUM(ct.minutes), 0)::int
    - COALESCE(SUM(bpc.minutes_drawn),    0)::int
    - COALESCE(SUM(cpc.minutes_adjusted), 0)::int AS expected_balance_minutes
  FROM credit_transactions ct
  LEFT JOIN bcs_per_ct bpc ON bpc.credit_transaction_id = ct.id
  LEFT JOIN csa_per_ct cpc ON cpc.credit_transaction_id = ct.id
  WHERE ct.school_id = 1
    AND ct.instructor_id IS NOT NULL
  GROUP BY ct.learner_id, ct.instructor_id
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
ORDER BY drift_minutes DESC, learner_id, instructor_id;

-- ═════════════════════════════════════════════════════════════════════════════
-- PER-PAIR DETAIL
-- ═════════════════════════════════════════════════════════════════════════════
-- Once you have a drift row from one of the queries above, replace the
-- placeholders below with the learner_id and instructor_id, then run.
-- Works in Neon SQL Console — no psql variables required.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Credit-transactions ledger for the pair ─────────────────────────────────
SELECT
  id,
  type,
  minutes,
  amount_pence,
  stripe_session_id,
  created_at
FROM credit_transactions
WHERE learner_id    = /* paste learner_id */    NULL
  AND instructor_id = /* paste instructor_id */ NULL
  AND school_id     = 1
ORDER BY created_at, id;

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
