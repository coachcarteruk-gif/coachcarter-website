-- Payout v2 Slice 3 earning/materialisation reconciliation.
-- READ ONLY. Run with an explicit psql school variable:
--   psql ... -v school_id=1 -f db/diagnostics/payout-v2-earning-shadow-reconciliation.sql
-- No query below may omit the explicit school scope.

-- 1. Per-earning conservation. Must return no rows.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT
  be.school_id,
  be.id AS booking_earning_id,
  be.booking_id,
  be.gross_price_snapshot_pence,
  be.stripe_fee_snapshot_pence,
  be.instructor_earning_pence,
  be.platform_fee_pence,
  be.franchise_fee_allocation_pence
FROM booking_earnings be
JOIN params p ON p.school_id = be.school_id
WHERE be.gross_price_snapshot_pence <>
  be.stripe_fee_snapshot_pence +
  be.instructor_earning_pence +
  be.platform_fee_pence +
  be.franchise_fee_allocation_pence
ORDER BY be.id;

-- 2. Funding-allocation totals must equal each earning. Must return no rows.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT
  be.school_id,
  be.id AS booking_earning_id,
  be.booking_id,
  be.gross_price_snapshot_pence,
  COALESCE(SUM(bes.gross_contribution_pence), 0)::bigint AS allocated_gross_pence,
  be.stripe_fee_snapshot_pence,
  COALESCE(SUM(bes.stripe_fee_contribution_pence), 0)::bigint AS allocated_stripe_fee_pence,
  be.instructor_earning_pence,
  COALESCE(SUM(bes.instructor_earning_contribution_pence), 0)::bigint
    AS allocated_instructor_pence,
  (be.platform_fee_pence + be.franchise_fee_allocation_pence)::bigint
    AS earning_non_instructor_pence,
  COALESCE(SUM(
    bes.platform_fee_contribution_pence + bes.franchise_fee_contribution_pence
  ), 0)::bigint AS allocated_non_instructor_pence
FROM booking_earnings be
JOIN params p ON p.school_id = be.school_id
LEFT JOIN booking_earning_sources bes
  ON bes.booking_earning_id = be.id
 AND bes.school_id = be.school_id
GROUP BY be.id
HAVING
  be.gross_price_snapshot_pence <> COALESCE(SUM(bes.gross_contribution_pence), 0)
  OR be.stripe_fee_snapshot_pence <>
    COALESCE(SUM(bes.stripe_fee_contribution_pence), 0)
  OR be.instructor_earning_pence <>
    COALESCE(SUM(bes.instructor_earning_contribution_pence), 0)
  OR be.platform_fee_pence + be.franchise_fee_allocation_pence <>
    COALESCE(SUM(
      bes.platform_fee_contribution_pence + bes.franchise_fee_contribution_pence
    ), 0)
ORDER BY be.id;

-- 3. A source's instructor allocation cannot exceed its payable pool.
-- Must return no rows.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT
  pfs.school_id,
  pfs.id AS funding_source_id,
  pfs.payable_pool_pence,
  COALESCE(SUM(bes.payable_contribution_pence), 0)::bigint AS allocated_pence
FROM payout_funding_sources pfs
JOIN params p ON p.school_id = pfs.school_id
LEFT JOIN booking_earning_sources bes
  ON bes.funding_source_id = pfs.id
 AND bes.school_id = pfs.school_id
GROUP BY pfs.id
HAVING COALESCE(SUM(bes.payable_contribution_pence), 0) > pfs.payable_pool_pence
ORDER BY pfs.id;

-- 4. Batch conservation and batch/claim total agreement. Must return no rows.
WITH params AS (SELECT :'school_id'::integer AS school_id),
claimed AS (
  SELECT
    pbe.school_id,
    pbe.payout_batch_id,
    COALESCE(SUM(be.gross_price_snapshot_pence), 0)::bigint AS gross_pence
  FROM payout_batch_earnings pbe
  JOIN params p ON p.school_id = pbe.school_id
  JOIN booking_earnings be
    ON be.id = pbe.booking_earning_id
   AND be.school_id = pbe.school_id
  GROUP BY pbe.school_id, pbe.payout_batch_id
)
SELECT
  pb.school_id,
  pb.id AS payout_batch_id,
  pb.payout_route,
  pb.gross_pence,
  claimed.gross_pence AS claimed_gross_pence,
  pb.stripe_fees_pence,
  pb.platform_fee_pence,
  pb.franchise_fee_pence,
  pb.instructor_amount_pence,
  pb.shortfall_pence,
  pb.deposit_deducted_pence,
  pb.recovery_deducted_pence
FROM payout_batches pb
JOIN params p ON p.school_id = pb.school_id
LEFT JOIN claimed
  ON claimed.payout_batch_id = pb.id
 AND claimed.school_id = pb.school_id
WHERE
  pb.gross_pence <>
    pb.stripe_fees_pence +
    pb.platform_fee_pence +
    pb.franchise_fee_pence +
    pb.instructor_amount_pence +
    pb.shortfall_pence +
    pb.deposit_deducted_pence +
    pb.recovery_deducted_pence
  OR pb.gross_pence <> COALESCE(claimed.gross_pence, 0)
ORDER BY pb.id;

-- 5. A booking may never be claimed by both payout routes. Must return no rows.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT
  be.school_id,
  be.booking_id,
  ARRAY_AGG(DISTINCT pb.payout_route ORDER BY pb.payout_route) AS payout_routes
FROM booking_earnings be
JOIN params p ON p.school_id = be.school_id
JOIN payout_batch_earnings pbe
  ON pbe.booking_earning_id = be.id
 AND pbe.school_id = be.school_id
JOIN payout_batches pb
  ON pb.id = pbe.payout_batch_id
 AND pb.school_id = pbe.school_id
GROUP BY be.school_id, be.booking_id
HAVING COUNT(DISTINCT pb.payout_route) > 1
ORDER BY be.booking_id;

-- 6. Slice 3 is inactive: materialised batches must remain planned and must
-- have no transfer attempt. Any row is an activation/transfer blocker.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT
  pb.school_id,
  pb.id AS payout_batch_id,
  pb.state,
  COUNT(pt.id)::int AS transfer_row_count
FROM payout_batches pb
JOIN params p ON p.school_id = pb.school_id
LEFT JOIN payout_transfers pt
  ON pt.payout_batch_id = pb.id
 AND pt.school_id = pb.school_id
GROUP BY pb.id
HAVING pb.state <> 'planned' OR COUNT(pt.id) <> 0
ORDER BY pb.id;

-- 7. Activation switch remains v1. Any row is a Slice 3 blocker.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT s.id AS school_id, s.payout_engine_version
FROM schools s
JOIN params p ON p.school_id = s.id
WHERE s.payout_engine_version <> 'v1';
