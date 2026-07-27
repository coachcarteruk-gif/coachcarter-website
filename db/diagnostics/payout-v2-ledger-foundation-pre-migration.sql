-- Payout v2 Slice 0/1 pre-migration diagnostic.
-- READ ONLY: every statement is SELECT/CTE SELECT. Run against the target
-- environment before any v2 schema or data migration. Any non-zero violation
-- count blocks cutover; it does not authorise an automatic repair.

-- 1. Schema presence. Before the first schema-only rollout all 25 rows should
-- be absent. A mixture of present and absent objects means an unexplained
-- partial application and blocks the rollout.
SELECT expected.table_name,
       to_regclass('public.' || expected.table_name) IS NOT NULL AS already_exists
FROM (VALUES
  ('payout_funding_sources'),
  ('payout_source_import_runs'),
  ('booking_earnings'),
  ('booking_earning_sources'),
  ('payout_batches'),
  ('payout_batch_earnings'),
  ('payout_transfers'),
  ('payout_transfer_attempts'),
  ('payout_transfer_sources'),
  ('payout_adjustments'),
  ('stripe_event_receipts'),
  ('payout_v2_connected_account_scopes'),
  ('connected_bank_payouts'),
  ('payout_v2_stripe_evidence_events'),
  ('payout_v2_stripe_evidence_transfer_links'),
  ('connected_bank_payout_transfer_links'),
  ('payout_v2_liquidity_config_versions'),
  ('payout_v2_refund_obligation_events'),
  ('payout_v2_protected_balance_snapshots'),
  ('payout_v2_operator_evidence'),
  ('payout_v2_protected_balance_alert_events'),
  ('payout_v2_cutover_config_versions'),
  ('payout_v2_shadow_cycle_evidence'),
  ('payout_v2_cutover_readiness_snapshots'),
  ('payout_v2_cutover_events')
) AS expected(table_name)
ORDER BY expected.table_name;

-- 2. Legacy/pre-Connect sources. All payout-valuing fields must be zero.
SELECT
  COUNT(*)::int AS legacy_source_rows,
  COALESCE(SUM(ct.minutes), 0)::int AS legacy_minutes,
  COALESCE(SUM(ct.amount_pence), 0)::int AS legacy_amount_pence,
  COUNT(*) FILTER (WHERE COALESCE(ct.amount_pence, 0) <> 0)::int
    AS positive_legacy_amount_violations
FROM credit_transactions ct
WHERE ct.type = 'legacy_grandfather';

SELECT
  COUNT(*)::int AS legacy_allocation_rows,
  COALESCE(SUM(bcs.minutes_drawn), 0)::int AS legacy_allocated_minutes,
  COALESCE(SUM(bcs.contribution_pence), 0)::int AS legacy_contribution_pence,
  COALESCE(SUM(bcs.stripe_fee_pence), 0)::int AS legacy_stripe_fee_pence,
  COUNT(*) FILTER (
    WHERE COALESCE(bcs.contribution_pence, 0) <> 0
       OR COALESCE(bcs.stripe_fee_pence, 0) <> 0
  )::int AS positive_legacy_contribution_violations
FROM booking_credit_sources bcs
JOIN credit_transactions ct
  ON ct.id = bcs.credit_transaction_id
 AND ct.school_id = bcs.school_id
WHERE ct.type = 'legacy_grandfather';

-- 3. Remaining live legacy-funded bookings. proposed_payout_pence is derived
-- only from immutable source evidence, never from list/live lesson price.
WITH legacy_bookings AS (
  SELECT
    lb.school_id,
    lb.id AS booking_id,
    lb.instructor_id,
    lb.status,
    lb.scheduled_date,
    COALESCE(SUM(bcs.contribution_pence)
      FILTER (WHERE bcs.refunded_at IS NULL), 0)::int AS source_contribution_pence,
    COALESCE(SUM(bcs.stripe_fee_pence)
      FILTER (WHERE bcs.refunded_at IS NULL), 0)::int AS source_stripe_fee_pence,
    lb.list_price_pence
  FROM lesson_bookings lb
  JOIN booking_credit_sources bcs
    ON bcs.booking_id = lb.id
   AND bcs.school_id = lb.school_id
  JOIN credit_transactions ct
    ON ct.id = bcs.credit_transaction_id
   AND ct.school_id = bcs.school_id
   AND ct.type = 'legacy_grandfather'
  WHERE lb.status IN ('scheduled', 'chargeable')
  GROUP BY lb.school_id, lb.id, lb.instructor_id, lb.status,
           lb.scheduled_date, lb.list_price_pence
)
SELECT *,
       0::int AS proposed_payout_pence,
       (source_contribution_pence <> 0 OR source_stripe_fee_pence <> 0)
         AS hard_legacy_violation
FROM legacy_bookings
ORDER BY school_id, scheduled_date, booking_id;

-- 4. Historical 19 June transfer and line evidence. Preserve these rows. The
-- owner selected future-payout recovery, but this diagnostic never creates the
-- £414 opening adjustment or edits the historical payout.
SELECT
  ip.school_id,
  ip.id AS payout_id,
  ip.instructor_id,
  ip.amount_pence,
  ip.platform_fee_pence,
  ip.stripe_fees_pence,
  ip.stripe_transfer_id,
  ip.status,
  ip.completed_at,
  COUNT(pli.id)::int AS line_count,
  COALESCE(SUM(pli.instructor_amount_pence), 0)::int AS line_instructor_pence
FROM instructor_payouts ip
LEFT JOIN payout_line_items pli
  ON pli.payout_id = ip.id
 AND pli.school_id = ip.school_id
WHERE ip.created_at >= TIMESTAMPTZ '2026-06-19 00:00:00+00'
  AND ip.created_at <  TIMESTAMPTZ '2026-06-20 00:00:00+00'
GROUP BY ip.school_id, ip.id
ORDER BY ip.id;

-- 5. Ambiguous cash/external/free cohorts. Labels do not decide liability.
-- Rows remain manual review until explicit evidence says who collected money
-- and whether the instructor obligation was already settled.
SELECT
  lb.school_id,
  CASE
    WHEN lb.payment_method = 'cash' THEN 'cash_manual_review'
    WHEN lb.payment_method = 'free' OR lb.created_by = 'free_trial_self_serve'
      THEN 'free_zero'
    WHEN lb.created_by ILIKE 'setmore%' THEN 'setmore_external_manual_review'
    ELSE 'other_non_credit_manual_review'
  END AS cohort,
  lb.status,
  COUNT(*)::int AS booking_count,
  COALESCE(SUM(lb.list_price_pence), 0)::int AS snapshotted_list_pence
FROM lesson_bookings lb
WHERE lb.payment_method IN ('cash', 'free')
   OR lb.created_by ILIKE 'setmore%'
GROUP BY lb.school_id, cohort, lb.status
ORDER BY lb.school_id, cohort, lb.status;

-- 6. Existing v1 cross-route duplicate claims.
SELECT
  pli.school_id AS direct_school_id,
  sp.school_id AS school_route_school_id,
  pli.booking_id,
  pli.payout_id,
  spli.school_payout_id
FROM payout_line_items pli
JOIN school_payout_line_items spli
  ON spli.booking_id = pli.booking_id
JOIN school_payouts sp
  ON sp.id = spli.school_payout_id
ORDER BY pli.booking_id;

-- Schools whose configuration currently permits both route families. This is
-- a routing decision requirement even when no duplicate claim yet exists.
SELECT
  s.id AS school_id,
  s.stripe_onboarding_complete AS school_connect_ready,
  COUNT(i.id) FILTER (
    WHERE i.stripe_onboarding_complete = TRUE
      AND i.payouts_paused = FALSE
      AND i.stripe_account_id IS NOT NULL
  )::int AS direct_ready_instructors
FROM schools s
LEFT JOIN instructors i ON i.school_id = s.id
GROUP BY s.id, s.stripe_onboarding_complete
HAVING s.stripe_onboarding_complete = TRUE
   AND COUNT(i.id) FILTER (
     WHERE i.stripe_onboarding_complete = TRUE
       AND i.payouts_paused = FALSE
       AND i.stripe_account_id IS NOT NULL
   ) > 0
ORDER BY s.id;

-- 7. Tenant-scope violations in the current financial graph.
WITH violations AS (
  SELECT 'booking_instructor' AS relation, COUNT(*)::bigint AS violation_count
  FROM lesson_bookings lb
  JOIN instructors i ON i.id = lb.instructor_id
  WHERE lb.school_id <> i.school_id
  UNION ALL
  SELECT 'booking_learner', COUNT(*)
  FROM lesson_bookings lb
  JOIN learner_users lu ON lu.id = lb.learner_id
  WHERE lb.school_id <> lu.school_id
  UNION ALL
  SELECT 'credit_instructor', COUNT(*)
  FROM credit_transactions ct
  JOIN instructors i ON i.id = ct.instructor_id
  WHERE ct.instructor_id IS NOT NULL AND ct.school_id <> i.school_id
  UNION ALL
  SELECT 'bcs_booking', COUNT(*)
  FROM booking_credit_sources bcs
  JOIN lesson_bookings lb ON lb.id = bcs.booking_id
  WHERE bcs.school_id <> lb.school_id
  UNION ALL
  SELECT 'bcs_credit_transaction', COUNT(*)
  FROM booking_credit_sources bcs
  JOIN credit_transactions ct ON ct.id = bcs.credit_transaction_id
  WHERE bcs.school_id <> ct.school_id
  UNION ALL
  SELECT 'direct_payout_instructor', COUNT(*)
  FROM instructor_payouts ip
  JOIN instructors i ON i.id = ip.instructor_id
  WHERE ip.school_id <> i.school_id
  UNION ALL
  SELECT 'direct_payout_line_parent', COUNT(*)
  FROM payout_line_items pli
  JOIN instructor_payouts ip ON ip.id = pli.payout_id
  WHERE pli.school_id <> ip.school_id
  UNION ALL
  SELECT 'direct_payout_line_booking', COUNT(*)
  FROM payout_line_items pli
  JOIN lesson_bookings lb ON lb.id = pli.booking_id
  WHERE pli.school_id <> lb.school_id
  UNION ALL
  SELECT 'school_payout_line_parent', COUNT(*)
  FROM school_payout_line_items spli
  JOIN school_payouts sp ON sp.id = spli.school_payout_id
  JOIN lesson_bookings lb ON lb.id = spli.booking_id
  WHERE sp.school_id <> lb.school_id
)
SELECT * FROM violations ORDER BY relation;

-- 8. Local transfer state. Any processing row, completed row without a Stripe
-- ID, or same Stripe ID used twice requires reconciliation before cutover.
SELECT
  'direct' AS payout_route,
  ip.school_id,
  ip.id AS payout_id,
  ip.status,
  ip.amount_pence,
  ip.stripe_transfer_id,
  ip.created_at,
  ip.completed_at
FROM instructor_payouts ip
WHERE ip.status IN ('processing', 'completed')
UNION ALL
SELECT
  'school',
  sp.school_id,
  sp.id,
  sp.status,
  sp.amount_pence,
  sp.stripe_transfer_id,
  sp.created_at,
  sp.completed_at
FROM school_payouts sp
WHERE sp.status IN ('processing', 'completed')
ORDER BY created_at, payout_route, payout_id;

SELECT stripe_transfer_id, COUNT(*)::int AS local_uses
FROM (
  SELECT stripe_transfer_id FROM instructor_payouts
  UNION ALL
  SELECT stripe_transfer_id FROM school_payouts
) local_transfers
WHERE stripe_transfer_id IS NOT NULL
GROUP BY stripe_transfer_id
HAVING COUNT(*) > 1
ORDER BY stripe_transfer_id;
