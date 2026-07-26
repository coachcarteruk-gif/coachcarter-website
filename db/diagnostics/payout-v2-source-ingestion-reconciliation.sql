-- Payout v2 Slice 2A/2B source-ingestion reconciliation.
-- READ ONLY. This file neither classifies nor backfills a source. Every
-- tenant-bearing join includes school_id, and every cohort is reported by
-- school so an operator can review one tenant explicitly.

-- 1. Immutable source inventory and payout value by school/class/status.
SELECT
  pfs.school_id,
  pfs.funding_class,
  pfs.source_status,
  COUNT(*)::int AS source_rows,
  COALESCE(SUM(pfs.gross_collected_pence), 0)::bigint AS gross_collected_pence,
  COALESCE(SUM(pfs.stripe_fee_pence), 0)::bigint AS stripe_fee_pence,
  COALESCE(SUM(pfs.payable_pool_pence), 0)::bigint AS payable_pool_pence
FROM payout_funding_sources pfs
GROUP BY pfs.school_id, pfs.funding_class, pfs.source_status
ORDER BY pfs.school_id, pfs.funding_class, pfs.source_status;

-- 2. Read-only ingestion preview. These are candidates only; the query does
-- not infer a positive value from a lesson price, custom rate, or default.
SELECT
  ct.school_id,
  ct.type AS source_type,
  COUNT(*)::int AS candidate_rows,
  COUNT(*) FILTER (
    WHERE ct.type IN ('purchase', 'slot_purchase')
      AND NULLIF(BTRIM(ct.stripe_payment_intent_id), '') IS NULL
  )::int AS missing_payment_intent_rows,
  COUNT(*) FILTER (
    WHERE ct.type IN ('purchase', 'slot_purchase')
      AND ct.stripe_fee_pence IS NULL
  )::int AS missing_local_fee_snapshot_rows,
  COUNT(*) FILTER (
    WHERE ct.type = 'legacy_grandfather'
      AND COALESCE(ct.amount_pence, 0) > 0
  )::int AS positive_legacy_history_rows
FROM credit_transactions ct
JOIN instructors i
  ON i.id = ct.instructor_id
 AND i.school_id = ct.school_id
LEFT JOIN payout_funding_sources pfs
  ON pfs.credit_transaction_id = ct.id
 AND pfs.school_id = ct.school_id
WHERE ct.type IN ('purchase', 'slot_purchase', 'legacy_grandfather')
  AND pfs.id IS NULL
GROUP BY ct.school_id, ct.type
ORDER BY ct.school_id, ct.type;

-- 3. Fail-closed value checks. Every count must be zero before activation.
SELECT
  pfs.school_id,
  COUNT(*) FILTER (
    WHERE pfs.funding_class = 'legacy_pre_connect_settled'
      AND (
        pfs.stripe_fee_pence <> 0
        OR pfs.payable_pool_pence <> 0
        OR pfs.refundable_pool_pence <> 0
      )
  )::int AS positive_legacy_value_violations,
  COUNT(*) FILTER (
    WHERE pfs.funding_class = 'manual_review'
      AND (
        pfs.source_status <> 'manual_review'
        OR pfs.payable_pool_pence <> 0
      )
  )::int AS manual_review_value_violations,
  COUNT(*) FILTER (
    WHERE pfs.funding_class = 'stripe_backed'
      AND pfs.payable_pool_pence > 0
      AND (
        NULLIF(BTRIM(pfs.stripe_payment_intent_id), '') IS NULL
        OR NULLIF(BTRIM(pfs.stripe_charge_id), '') IS NULL
        OR NULLIF(BTRIM(pfs.stripe_balance_transaction_id), '') IS NULL
        OR pfs.metadata->>'fee_evidence' <> 'stripe_balance_transaction'
      )
  )::int AS positive_stripe_evidence_violations
FROM payout_funding_sources pfs
GROUP BY pfs.school_id
ORDER BY pfs.school_id;

-- 4. Source/transaction tenant or immutable-amount contradictions.
SELECT
  pfs.school_id AS source_school_id,
  ct.school_id AS transaction_school_id,
  pfs.id AS funding_source_id,
  pfs.credit_transaction_id,
  pfs.gross_collected_pence AS source_gross_pence,
  ct.amount_pence AS transaction_amount_pence
FROM payout_funding_sources pfs
JOIN credit_transactions ct
  ON ct.id = pfs.credit_transaction_id
 AND ct.school_id = pfs.school_id
WHERE pfs.gross_collected_pence IS DISTINCT FROM COALESCE(ct.amount_pence, 0)
ORDER BY pfs.school_id, pfs.id;

-- 5. Receipt status and duplicate-event guards by school.
SELECT
  ser.school_id,
  ser.processing_status,
  COUNT(*)::int AS receipt_rows,
  MIN(ser.received_at) AS oldest_received_at,
  MAX(ser.received_at) AS newest_received_at
FROM stripe_event_receipts ser
GROUP BY ser.school_id, ser.processing_status
ORDER BY ser.school_id, ser.processing_status;

SELECT
  ser.stripe_event_id,
  COUNT(*)::int AS receipt_rows,
  COUNT(DISTINCT ser.school_id)::int AS school_count
FROM stripe_event_receipts ser
GROUP BY ser.stripe_event_id
HAVING COUNT(*) > 1
ORDER BY ser.stripe_event_id;

-- 6. Known external/cash-shaped chargeable cohorts remain review-only. This
-- report deliberately does not create or classify payout funding.
SELECT
  lb.school_id,
  CASE
    WHEN LOWER(COALESCE(lb.payment_method, '')) = 'cash' THEN 'cash_labelled'
    WHEN lb.created_by ILIKE 'setmore%'
      THEN 'setmore_or_external'
    ELSE 'other_unproven_external'
  END AS review_cohort,
  COUNT(*)::int AS booking_rows
FROM lesson_bookings lb
WHERE lb.status = 'chargeable'
  AND (
    LOWER(COALESCE(lb.payment_method, '')) = 'cash'
    OR lb.created_by ILIKE 'setmore%'
  )
GROUP BY
  lb.school_id,
  CASE
    WHEN LOWER(COALESCE(lb.payment_method, '')) = 'cash' THEN 'cash_labelled'
    WHEN lb.created_by ILIKE 'setmore%'
      THEN 'setmore_or_external'
    ELSE 'other_unproven_external'
  END
ORDER BY lb.school_id, review_cohort;

-- 7. Reviewed historical import runs. A successful run is immutable and its
-- created + existing counts must equal the full reviewed candidate cohort.
SELECT
  pir.school_id,
  pir.id AS import_run_id,
  pir.import_version,
  pir.plan_fingerprint,
  pir.candidate_count,
  pir.created_source_count,
  pir.existing_source_count,
  pir.totals,
  pir.operator_identity,
  pir.evidence_reference,
  pir.applied_at
FROM payout_source_import_runs pir
ORDER BY pir.school_id, pir.applied_at, pir.id;

-- 8. Every imported run should reconcile to at least its candidate count in
-- the full school-scoped historical cohort. A later producer can add more
-- sources, so this is a lower-bound check rather than equality.
SELECT
  pir.school_id,
  pir.id AS import_run_id,
  pir.candidate_count AS reviewed_candidate_count,
  COUNT(pfs.id)::int AS current_historical_source_count
FROM payout_source_import_runs pir
LEFT JOIN payout_funding_sources pfs
  ON pfs.school_id = pir.school_id
 AND pfs.credit_transaction_id IS NOT NULL
GROUP BY pir.school_id, pir.id, pir.candidate_count
HAVING COUNT(pfs.id) < pir.candidate_count
ORDER BY pir.school_id, pir.id;

-- 9. Remaining producer gaps by immutable local payment shape. This is
-- read-only and never treats a price, cash label, or Setmore origin as proof.
SELECT
  ct.school_id,
  CASE
    WHEN lo.id IS NOT NULL THEN 'accepted_paid_offer'
    WHEN lr.id IS NOT NULL THEN 'captured_request_to_book'
    ELSE 'other_stripe_source'
  END AS producer_cohort,
  COUNT(*)::int AS credit_transaction_rows,
  COUNT(*) FILTER (WHERE pfs.id IS NULL)::int AS missing_funding_source_rows,
  COUNT(*) FILTER (
    WHERE pfs.funding_class = 'manual_review'
  )::int AS manual_review_source_rows
FROM credit_transactions ct
LEFT JOIN payout_funding_sources pfs
  ON pfs.school_id = ct.school_id
 AND pfs.credit_transaction_id = ct.id
LEFT JOIN lesson_offers lo
  ON lo.school_id = ct.school_id
 AND lo.stripe_session_id = ct.stripe_session_id
 AND lo.status = 'accepted'
LEFT JOIN lesson_requests lr
  ON lr.school_id = ct.school_id
 AND lr.stripe_session_id = ct.stripe_session_id
 AND lr.status = 'accepted'
 AND lr.booking_id IS NOT NULL
WHERE ct.type = 'slot_purchase'
  AND (
    lo.id IS NOT NULL
    OR lr.id IS NOT NULL
    OR NULLIF(BTRIM(ct.stripe_session_id), '') IS NOT NULL
  )
GROUP BY
  ct.school_id,
  CASE
    WHEN lo.id IS NOT NULL THEN 'accepted_paid_offer'
    WHEN lr.id IS NOT NULL THEN 'captured_request_to_book'
    ELSE 'other_stripe_source'
  END
ORDER BY ct.school_id, producer_cohort;
