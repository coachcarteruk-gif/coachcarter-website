-- Payout v2 Slice 4 inactive transfer-intent reconciliation.
-- READ ONLY. Run only after migration 035 exists, with an explicit school:
--   psql ... -v school_id=1 -f db/diagnostics/payout-v2-transfer-reconciliation.sql

-- 1. Materialized batch facts must match the retained immutable plan snapshot.
-- Must return no rows.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT pb.id AS payout_batch_id, pb.state, pb.plan_fingerprint
FROM payout_batches pb
JOIN params p ON p.school_id = pb.school_id
WHERE pb.plan_json IS NULL
   OR pb.plan_json->>'calculation_version' <> pb.calculation_version
   OR (pb.plan_json->>'school_id')::integer <> pb.school_id
   OR pb.plan_json->>'payout_route' <> pb.payout_route
   OR (pb.plan_json->'totals'->>'gross_pence')::integer <> pb.gross_pence
   OR (pb.plan_json->'totals'->>'stripe_fees_pence')::integer <> pb.stripe_fees_pence
   OR (pb.plan_json->'totals'->>'platform_fee_pence')::integer <> pb.platform_fee_pence
   OR (pb.plan_json->'totals'->>'franchise_fee_pence')::integer <> pb.franchise_fee_pence
   OR (pb.plan_json->'totals'->>'net_shadow_transfer_pence')::integer <>
      pb.instructor_amount_pence
   OR (pb.plan_json->'totals'->>'shortfall_deducted_pence')::integer <>
      pb.shortfall_pence
   OR (pb.plan_json->'totals'->>'deposit_deducted_pence')::integer <>
      pb.deposit_deducted_pence
   OR (pb.plan_json->'totals'->>'recovery_deducted_pence')::integer <>
      pb.recovery_deducted_pence
ORDER BY pb.id;

-- 2. Vehicle deposits are off-system in v2. Must return no rows.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT id AS payout_batch_id, deposit_deducted_pence
FROM payout_batches pb
JOIN params p ON p.school_id = pb.school_id
WHERE pb.deposit_deducted_pence <> 0
   OR COALESCE((pb.plan_json->'totals'->>'deposit_deducted_pence')::integer, 0) <> 0
ORDER BY pb.id;

-- 3. Each logical transfer must conserve its immutable source allocations.
-- Must return no rows.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT
  pt.id AS payout_transfer_id,
  pt.amount_pence,
  COALESCE(SUM(pts.amount_pence), 0)::bigint AS allocated_pence
FROM payout_transfers pt
JOIN params p ON p.school_id = pt.school_id
LEFT JOIN payout_transfer_sources pts
  ON pts.school_id = pt.school_id
 AND pts.payout_transfer_id = pt.id
GROUP BY pt.id
HAVING pt.amount_pence <> COALESCE(SUM(pts.amount_pence), 0)
ORDER BY pt.id;

-- 4. Transferred source pence must not exceed either source allocation or pool.
-- Must return no rows.
WITH params AS (SELECT :'school_id'::integer AS school_id),
source_totals AS (
  SELECT
    pfs.id,
    pfs.school_id,
    pfs.payable_pool_pence,
    COALESCE(SUM(bes.instructor_earning_contribution_pence), 0)::bigint
      AS allocated_pence,
    COALESCE((
      SELECT SUM(pts.amount_pence)
      FROM payout_transfer_sources pts
      WHERE pts.school_id = pfs.school_id
        AND pts.funding_source_id = pfs.id
    ), 0)::bigint AS transfer_pence
  FROM payout_funding_sources pfs
  JOIN params p ON p.school_id = pfs.school_id
  LEFT JOIN booking_earning_sources bes
    ON bes.school_id = pfs.school_id
   AND bes.funding_source_id = pfs.id
  GROUP BY pfs.id
)
SELECT *
FROM source_totals
WHERE transfer_pence > allocated_pence
   OR transfer_pence > payable_pool_pence
ORDER BY id;

-- 5. Route and destination shapes must agree between batch and intent.
-- Must return no rows.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT pt.id AS payout_transfer_id, pb.id AS payout_batch_id
FROM payout_transfers pt
JOIN params p ON p.school_id = pt.school_id
JOIN payout_batches pb
  ON pb.id = pt.payout_batch_id
 AND pb.school_id = pt.school_id
WHERE pt.plan_fingerprint <> pb.plan_fingerprint
   OR pt.currency <> pb.currency
   OR (pb.payout_route = 'instructor_direct' AND (
        pt.instructor_id IS DISTINCT FROM pb.instructor_id
        OR pt.destination_school_id IS NOT NULL
      ))
   OR (pb.payout_route = 'school' AND (
        pt.instructor_id IS NOT NULL
        OR pt.destination_school_id IS DISTINCT FROM pb.school_id
      ))
ORDER BY pt.id;

-- 6. Settled batches must have every positive logical transfer attached and
-- transferred. Zero-amount batches must have no transfer rows. Must return none.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT
  pb.id AS payout_batch_id,
  pb.instructor_amount_pence,
  pb.state,
  COUNT(pt.id)::int AS transfer_count,
  COUNT(pt.id) FILTER (WHERE pt.state <> 'transferred')::int AS incomplete_count,
  COALESCE(SUM(pt.amount_pence), 0)::bigint AS transfer_pence
FROM payout_batches pb
JOIN params p ON p.school_id = pb.school_id
LEFT JOIN payout_transfers pt
  ON pt.school_id = pb.school_id
 AND pt.payout_batch_id = pb.id
GROUP BY pb.id
HAVING
  (pb.instructor_amount_pence = 0 AND COUNT(pt.id) <> 0)
  OR (
    pb.state IN ('transferred', 'bank_paid', 'bank_payout_failed')
    AND pb.instructor_amount_pence > 0
    AND (
      COUNT(pt.id) = 0
      OR COUNT(pt.id) FILTER (WHERE pt.state <> 'transferred') <> 0
      OR COALESCE(SUM(pt.amount_pence), 0) <> pb.instructor_amount_pence
    )
  )
ORDER BY pb.id;

-- 7. Ambiguous intents and their last append-only evidence for operator review.
WITH params AS (SELECT :'school_id'::integer AS school_id),
latest AS (
  SELECT DISTINCT ON (pta.payout_transfer_id)
    pta.payout_transfer_id,
    pta.outcome,
    pta.occurred_at,
    pta.evidence_json
  FROM payout_transfer_attempts pta
  JOIN params p ON p.school_id = pta.school_id
  ORDER BY pta.payout_transfer_id, pta.occurred_at DESC, pta.id DESC
)
SELECT
  pt.id AS payout_transfer_id,
  pt.payout_batch_id,
  pt.state,
  pt.request_created_at,
  pt.last_error_code,
  latest.outcome AS latest_evidence_outcome,
  latest.occurred_at AS latest_evidence_at
FROM payout_transfers pt
JOIN params p ON p.school_id = pt.school_id
LEFT JOIN latest ON latest.payout_transfer_id = pt.id
WHERE pt.state IN ('submitting', 'reconciling')
ORDER BY pt.request_created_at, pt.id;

-- 8. Activation remains unchanged by Slice 4. Informational only.
WITH params AS (SELECT :'school_id'::integer AS school_id)
SELECT id AS school_id, payout_engine_version
FROM schools s
JOIN params p ON p.school_id = s.id;
