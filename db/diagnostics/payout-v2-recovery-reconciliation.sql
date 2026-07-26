-- Payout v2 future-payout recovery reconciliation.
-- READ ONLY. Recovery obligations and their applications are append-only;
-- outstanding value is derived rather than maintained by updating history.
-- Run only after the inactive Payout v2 schema has been applied.

-- 1. Recovery obligations, applied value, and remaining value. Every child
-- join includes school_id and every result retains explicit tenant scope.
SELECT
  parent.school_id,
  parent.instructor_id,
  parent.id AS recovery_adjustment_id,
  parent.currency,
  ABS(parent.amount_pence)::bigint AS original_recovery_pence,
  COALESCE(SUM(child.amount_pence), 0)::bigint AS applied_recovery_pence,
  (
    ABS(parent.amount_pence)
    - COALESCE(SUM(child.amount_pence), 0)
  )::bigint AS remaining_recovery_pence,
  parent.metadata->>'recovery_policy' AS recovery_policy,
  parent.metadata->>'source_v1_payout_id' AS source_v1_payout_id,
  parent.created_at
FROM payout_adjustments parent
LEFT JOIN payout_adjustments child
  ON child.parent_adjustment_id = parent.id
 AND child.school_id = parent.school_id
 AND child.adjustment_type = 'recovery_application'
WHERE parent.adjustment_type = 'recovery'
GROUP BY
  parent.school_id,
  parent.instructor_id,
  parent.id,
  parent.currency,
  parent.amount_pence,
  parent.metadata,
  parent.created_at
ORDER BY parent.school_id, parent.instructor_id, parent.created_at, parent.id;

-- 2. Batch deduction conservation. This query must return no rows.
SELECT
  pb.school_id,
  pb.id AS payout_batch_id,
  pb.instructor_id,
  pb.recovery_deducted_pence AS batch_recovery_pence,
  COALESCE(SUM(pa.amount_pence), 0)::bigint AS application_recovery_pence
FROM payout_batches pb
LEFT JOIN payout_adjustments pa
  ON pa.payout_batch_id = pb.id
 AND pa.school_id = pb.school_id
 AND pa.adjustment_type = 'recovery_application'
GROUP BY
  pb.school_id,
  pb.id,
  pb.instructor_id,
  pb.recovery_deducted_pence
HAVING pb.recovery_deducted_pence <> COALESCE(SUM(pa.amount_pence), 0)
ORDER BY pb.school_id, pb.id;

-- 3. Recovery applications whose instructor/currency/policy contradict their
-- parent or batch. Schema guards should make this result empty.
SELECT
  child.school_id,
  child.id AS recovery_application_id,
  child.parent_adjustment_id,
  child.payout_batch_id,
  child.instructor_id AS application_instructor_id,
  parent.instructor_id AS parent_instructor_id,
  pb.instructor_id AS batch_instructor_id
FROM payout_adjustments child
JOIN payout_adjustments parent
  ON parent.id = child.parent_adjustment_id
 AND parent.school_id = child.school_id
JOIN payout_batches pb
  ON pb.id = child.payout_batch_id
 AND pb.school_id = child.school_id
WHERE child.adjustment_type = 'recovery_application'
  AND (
    parent.adjustment_type <> 'recovery'
    OR child.instructor_id <> parent.instructor_id
    OR child.instructor_id <> pb.instructor_id
    OR child.currency <> parent.currency
    OR child.currency <> pb.currency
    OR child.metadata->>'recovery_policy' <> 'full_available_offset'
  )
ORDER BY child.school_id, child.id;

-- 4. Recovery obligations with missing or malformed v1 evidence. This query
-- must return no rows before an operator creates or activates a recovery.
SELECT
  pa.school_id,
  pa.instructor_id,
  pa.id AS recovery_adjustment_id,
  pa.evidence_reference,
  pa.metadata
FROM payout_adjustments pa
WHERE pa.adjustment_type = 'recovery'
  AND (
    pa.metadata->>'recovery_policy' <> 'full_available_offset'
    OR NULLIF(BTRIM(pa.metadata->>'source_v1_payout_id'), '') IS NULL
    OR COALESCE(pa.metadata->>'source_stripe_transfer_id', '') NOT LIKE 'tr\_%' ESCAPE '\'
    OR jsonb_typeof(pa.metadata->'source_legacy_booking_ids') <> 'array'
    OR jsonb_array_length(pa.metadata->'source_legacy_booking_ids') = 0
  )
ORDER BY pa.school_id, pa.id;
