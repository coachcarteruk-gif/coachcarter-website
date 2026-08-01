-- Stripe Connect Simon launch Slice 2: future migration/application postflight.
-- READ ONLY. Run after the approved corrective migration and application
-- deployment, and before any separately approved shadow configuration change.
BEGIN TRANSACTION READ ONLY;

SELECT
  POSITION(
    'to_jsonb(OLD)->>fill_column IS NOT NULL'
    IN pg_get_functiondef('stripe_launch_guard_payout_source_update()'::regprocedure)
  ) > 0 AS payout_source_fill_once_fix_present;

SELECT mode, COUNT(*)::bigint AS config_rows
FROM stripe_connect_launch_configs
GROUP BY mode
ORDER BY mode;

SELECT origin, regime, evidence_status, COUNT(*)::bigint AS contracts
FROM lesson_payment_contracts
GROUP BY origin, regime, evidence_status
ORDER BY origin, regime, evidence_status;

SELECT COUNT(*)::bigint AS contract_source_link_mismatches
FROM lesson_payment_contracts c
LEFT JOIN payout_funding_sources s
  ON s.id = c.funding_source_id
 AND s.school_id = c.school_id
WHERE s.id IS NULL
   OR s.lesson_payment_contract_id IS DISTINCT FROM c.id
   OR s.payment_origin IS DISTINCT FROM c.origin
   OR s.stripe_payment_created_at IS DISTINCT FROM c.stripe_payment_created_at
   OR s.stripe_funds_available_at IS DISTINCT FROM c.stripe_funds_available_at;

SELECT COUNT(*)::bigint AS complete_contracts_without_exactly_one_active_booking
FROM lesson_payment_contracts c
WHERE c.evidence_status = 'complete'
  AND (
    SELECT COUNT(*)
    FROM lesson_bookings b
    WHERE b.school_id = c.school_id
      AND b.lesson_payment_contract_id = c.id
      AND b.status IN ('scheduled', 'chargeable')
  ) <> 1;

SELECT COUNT(*)::bigint AS launch_sources_visible_to_legacy_earnings
FROM booking_earning_sources bes
JOIN payout_funding_sources s
  ON s.id = bes.funding_source_id
 AND s.school_id = bes.school_id
WHERE s.metadata->>'launch_accounting_version' = 'simon_launch_v1';

SELECT COUNT(*)::bigint AS launch_sources_visible_to_legacy_transfers
FROM payout_transfer_sources pts
JOIN payout_funding_sources s
  ON s.id = pts.funding_source_id
 AND s.school_id = pts.school_id
WHERE s.metadata->>'launch_accounting_version' = 'simon_launch_v1';

SELECT
  (SELECT COUNT(*)::bigint FROM stripe_launch_booking_earnings) AS launch_earnings,
  (SELECT COUNT(*)::bigint FROM stripe_launch_transfer_intents) AS launch_transfer_intents,
  (SELECT COUNT(*)::bigint FROM stripe_launch_transfer_attempts) AS launch_transfer_attempts,
  (SELECT COUNT(*)::bigint FROM refund_intents) AS launch_refund_intents,
  (SELECT COUNT(*)::bigint FROM refund_attempts) AS launch_refund_attempts;

ROLLBACK;
