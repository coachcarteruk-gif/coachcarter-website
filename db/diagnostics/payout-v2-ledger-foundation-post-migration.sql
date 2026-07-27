-- Payout v2 Slice 1 post-migration diagnostic.
-- READ ONLY. Run after applying schema to a non-production/test environment,
-- and later as a production pre-activation check after explicit approval.

-- 1. All 25 tables exist but remain empty after the schema-only rollout.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'payout_funding_sources',
    'payout_source_import_runs',
    'booking_earnings',
    'booking_earning_sources',
    'payout_batches',
    'payout_batch_earnings',
    'payout_transfers',
    'payout_transfer_attempts',
    'payout_transfer_sources',
    'payout_adjustments',
    'stripe_event_receipts',
    'payout_v2_connected_account_scopes',
    'connected_bank_payouts',
    'payout_v2_stripe_evidence_events',
    'payout_v2_stripe_evidence_transfer_links',
    'connected_bank_payout_transfer_links',
    'payout_v2_liquidity_config_versions',
    'payout_v2_refund_obligation_events',
    'payout_v2_protected_balance_snapshots',
    'payout_v2_operator_evidence',
    'payout_v2_protected_balance_alert_events',
    'payout_v2_cutover_config_versions',
    'payout_v2_shadow_cycle_evidence',
    'payout_v2_cutover_readiness_snapshots',
    'payout_v2_cutover_events'
  )
ORDER BY table_name;

SELECT 'payout_funding_sources' AS table_name, COUNT(*)::bigint AS row_count FROM payout_funding_sources
UNION ALL SELECT 'payout_source_import_runs', COUNT(*) FROM payout_source_import_runs
UNION ALL SELECT 'booking_earnings', COUNT(*) FROM booking_earnings
UNION ALL SELECT 'booking_earning_sources', COUNT(*) FROM booking_earning_sources
UNION ALL SELECT 'payout_batches', COUNT(*) FROM payout_batches
UNION ALL SELECT 'payout_batch_earnings', COUNT(*) FROM payout_batch_earnings
UNION ALL SELECT 'payout_transfers', COUNT(*) FROM payout_transfers
UNION ALL SELECT 'payout_transfer_attempts', COUNT(*) FROM payout_transfer_attempts
UNION ALL SELECT 'payout_transfer_sources', COUNT(*) FROM payout_transfer_sources
UNION ALL SELECT 'payout_adjustments', COUNT(*) FROM payout_adjustments
UNION ALL SELECT 'stripe_event_receipts', COUNT(*) FROM stripe_event_receipts
UNION ALL SELECT 'payout_v2_connected_account_scopes', COUNT(*) FROM payout_v2_connected_account_scopes
UNION ALL SELECT 'connected_bank_payouts', COUNT(*) FROM connected_bank_payouts
UNION ALL SELECT 'payout_v2_stripe_evidence_events', COUNT(*) FROM payout_v2_stripe_evidence_events
UNION ALL SELECT 'payout_v2_stripe_evidence_transfer_links', COUNT(*) FROM payout_v2_stripe_evidence_transfer_links
UNION ALL SELECT 'connected_bank_payout_transfer_links', COUNT(*) FROM connected_bank_payout_transfer_links
UNION ALL SELECT 'payout_v2_liquidity_config_versions', COUNT(*) FROM payout_v2_liquidity_config_versions
UNION ALL SELECT 'payout_v2_refund_obligation_events', COUNT(*) FROM payout_v2_refund_obligation_events
UNION ALL SELECT 'payout_v2_protected_balance_snapshots', COUNT(*) FROM payout_v2_protected_balance_snapshots
UNION ALL SELECT 'payout_v2_operator_evidence', COUNT(*) FROM payout_v2_operator_evidence
UNION ALL SELECT 'payout_v2_protected_balance_alert_events', COUNT(*) FROM payout_v2_protected_balance_alert_events
UNION ALL SELECT 'payout_v2_cutover_config_versions', COUNT(*) FROM payout_v2_cutover_config_versions
UNION ALL SELECT 'payout_v2_shadow_cycle_evidence', COUNT(*) FROM payout_v2_shadow_cycle_evidence
UNION ALL SELECT 'payout_v2_cutover_readiness_snapshots', COUNT(*) FROM payout_v2_cutover_readiness_snapshots
UNION ALL SELECT 'payout_v2_cutover_events', COUNT(*) FROM payout_v2_cutover_events
ORDER BY table_name;

-- 2. Every v2 school_id is NOT NULL and has no default.
SELECT
  table_name,
  is_nullable,
  column_default,
  (is_nullable = 'NO' AND column_default IS NULL) AS school_scope_contract_ok
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'school_id'
  AND table_name IN (
    'payout_funding_sources',
    'payout_source_import_runs',
    'booking_earnings',
    'booking_earning_sources',
    'payout_batches',
    'payout_batch_earnings',
    'payout_transfers',
    'payout_transfer_attempts',
    'payout_transfer_sources',
    'payout_adjustments',
    'stripe_event_receipts',
    'payout_v2_connected_account_scopes',
    'connected_bank_payouts',
    'payout_v2_stripe_evidence_events',
    'payout_v2_stripe_evidence_transfer_links',
    'connected_bank_payout_transfer_links',
    'payout_v2_refund_obligation_events',
    'payout_v2_cutover_config_versions',
    'payout_v2_shadow_cycle_evidence',
    'payout_v2_cutover_readiness_snapshots',
    'payout_v2_cutover_events'
  )
ORDER BY table_name;

-- Global/school control tables deliberately allow NULL school_id only when
-- scope_kind = 'global'; no row exists yet in a schema-only rollout.
SELECT
  table_name,
  is_nullable,
  column_default,
  (is_nullable = 'YES' AND column_default IS NULL) AS scoped_global_contract_ok
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'school_id'
  AND table_name IN (
    'payout_v2_liquidity_config_versions',
    'payout_v2_protected_balance_snapshots',
    'payout_v2_operator_evidence',
    'payout_v2_protected_balance_alert_events'
  )
ORDER BY table_name;

-- 3. Required uniqueness and append-only triggers are installed.
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'booking_earnings_school_id_booking_id_key',
    'payout_batch_earnings_school_id_booking_earning_id_key',
    'payout_transfers_idempotency_key_key',
    'payout_transfers_school_id_logical_transfer_fingerprint_key',
    'uq_payout_transfers_stripe_id'
  )
ORDER BY indexname;

SELECT event_object_table, trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN (
    'payout_funding_sources',
    'payout_source_import_runs',
    'booking_earnings',
    'booking_earning_sources',
    'payout_batches',
    'payout_batch_earnings',
    'payout_transfers',
    'payout_transfer_attempts',
    'payout_transfer_sources',
    'payout_adjustments',
    'stripe_event_receipts',
    'payout_v2_connected_account_scopes',
    'connected_bank_payouts',
    'payout_v2_stripe_evidence_events',
    'payout_v2_stripe_evidence_transfer_links',
    'connected_bank_payout_transfer_links',
    'payout_v2_liquidity_config_versions',
    'payout_v2_refund_obligation_events',
    'payout_v2_protected_balance_snapshots',
    'payout_v2_operator_evidence',
    'payout_v2_protected_balance_alert_events',
    'payout_v2_cutover_config_versions',
    'payout_v2_shadow_cycle_evidence',
    'payout_v2_cutover_readiness_snapshots',
    'payout_v2_cutover_events'
  )
ORDER BY event_object_table, trigger_name, event_manipulation;

-- 4. Zero legacy contribution remains a hard pre-activation gate. A migrated
-- v2 legacy source with positive payable value is impossible by constraint;
-- the v1 evidence below must also remain zero before ingestion.
SELECT
  COUNT(*)::int AS legacy_source_rows,
  COALESCE(SUM(ct.amount_pence), 0)::int AS legacy_amount_pence,
  COUNT(*) FILTER (WHERE COALESCE(ct.amount_pence, 0) <> 0)::int
    AS positive_legacy_amount_violations
FROM credit_transactions ct
WHERE ct.type = 'legacy_grandfather';

SELECT
  COUNT(*)::int AS legacy_allocation_rows,
  COALESCE(SUM(bcs.contribution_pence), 0)::int AS legacy_contribution_pence,
  COUNT(*) FILTER (
    WHERE COALESCE(bcs.contribution_pence, 0) <> 0
       OR COALESCE(bcs.stripe_fee_pence, 0) <> 0
  )::int AS positive_legacy_contribution_violations
FROM booking_credit_sources bcs
JOIN credit_transactions ct
  ON ct.id = bcs.credit_transaction_id
 AND ct.school_id = bcs.school_id
WHERE ct.type = 'legacy_grandfather';

-- 5. Cross-route and tenant violations still block activation.
SELECT pli.booking_id, pli.school_id AS direct_school_id,
       sp.school_id AS school_route_school_id
FROM payout_line_items pli
JOIN school_payout_line_items spli ON spli.booking_id = pli.booking_id
JOIN school_payouts sp ON sp.id = spli.school_payout_id
ORDER BY pli.booking_id;

SELECT be.school_id, be.booking_id, COUNT(*)::int AS logical_earnings
FROM booking_earnings be
GROUP BY be.school_id, be.booking_id
HAVING COUNT(*) > 1;

-- 6. The activation switch must still be v1 after Slice 1.
SELECT id AS school_id, payout_engine_version
FROM schools
ORDER BY id;
