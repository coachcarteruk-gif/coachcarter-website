-- Stripe Connect Simon launch Slice 2: future production preflight.
-- READ ONLY. It does not create configuration, agreements, contracts, sources,
-- payouts, refunds, transfers, Stripe resources, or historical classifications.
BEGIN TRANSACTION READ ONLY;

SELECT
  to_regclass('public.stripe_connect_launch_configs') IS NOT NULL AS launch_config_schema_present,
  to_regclass('public.instructor_payout_agreement_versions') IS NOT NULL AS agreement_schema_present,
  to_regclass('public.lesson_payment_contracts') IS NOT NULL AS payment_contract_schema_present;

SELECT
  POSITION(
    'to_jsonb(OLD)->>fill_column IS NOT NULL'
    IN pg_get_functiondef('stripe_launch_guard_payout_source_update()'::regprocedure)
  ) > 0 AS payout_source_fill_once_fix_present;

SELECT payout_engine_version, COUNT(*)::bigint AS schools
FROM schools
GROUP BY payout_engine_version
ORDER BY payout_engine_version;

SELECT mode, COUNT(*)::bigint AS config_rows
FROM stripe_connect_launch_configs
GROUP BY mode
ORDER BY mode;

SELECT status, COUNT(*)::bigint AS agreement_rows
FROM instructor_payout_agreement_versions
GROUP BY status
ORDER BY status;

SELECT
  COUNT(*)::bigint AS existing_contracts,
  COUNT(*) FILTER (WHERE evidence_status = 'complete')::bigint AS complete_contracts,
  COUNT(*) FILTER (WHERE evidence_status = 'pending')::bigint AS pending_contracts,
  COUNT(*) FILTER (WHERE evidence_status = 'contradictory')::bigint AS contradictory_contracts,
  COUNT(*) FILTER (WHERE evidence_status = 'ineligible')::bigint AS ineligible_contracts
FROM lesson_payment_contracts;

SELECT
  (SELECT COUNT(*)::bigint FROM stripe_launch_booking_earnings) AS launch_earnings,
  (SELECT COUNT(*)::bigint FROM stripe_launch_transfer_intents) AS launch_transfer_intents,
  (SELECT COUNT(*)::bigint FROM stripe_launch_transfer_attempts) AS launch_transfer_attempts,
  (SELECT COUNT(*)::bigint FROM refund_intents) AS launch_refund_intents,
  (SELECT COUNT(*)::bigint FROM refund_attempts) AS launch_refund_attempts;

SELECT COUNT(*)::bigint AS historic_sources_with_unexpected_launch_bridge
FROM payout_funding_sources
WHERE lesson_payment_contract_id IS NULL
  AND (
    stripe_payment_created_at IS NOT NULL
    OR stripe_funds_available_at IS NOT NULL
    OR payment_origin IS NOT NULL
    OR source_booking_id IS NOT NULL
    OR evidence_completeness IS NOT NULL
    OR contradiction_code IS NOT NULL
  );

ROLLBACK;
