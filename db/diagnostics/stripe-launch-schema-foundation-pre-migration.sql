-- Stripe launch Slice 1 schema foundation: PRE-MIGRATION DIAGNOSTIC.
-- READ ONLY. This file contains SELECT/CTE statements only. It does not apply
-- migration 039, create launch configuration, classify history, or mutate data.

-- 1. Fail-closed collision inventory. Before migration 039, every expected
-- Slice 1 relation must be absent; a present relation requires investigation.
WITH expected(relation_name) AS (
  VALUES
    ('stripe_connect_launch_configs'),
    ('stripe_connect_launch_events'),
    ('instructor_payout_agreement_versions'),
    ('lesson_payment_contracts'),
    ('lesson_outcome_revisions'),
    ('lesson_issue_tokens'),
    ('lesson_issue_reports'),
    ('lesson_issue_actions'),
    ('refund_intents'),
    ('refund_attempts'),
    ('connect_account_state_events'),
    ('payout_runs'),
    ('instructor_payout_batches'),
    ('instructor_payout_obligations'),
    ('instructor_payout_obligation_applications'),
    ('stripe_launch_booking_earnings'),
    ('stripe_launch_transfer_intents'),
    ('stripe_launch_transfer_attempts'),
    ('payout_batch_earning_dispositions'),
    ('payout_statements'),
    ('payout_statement_delivery_attempts'),
    ('payment_disputes'),
    ('payment_dispute_events'),
    ('dispute_evidence_pack_versions'),
    ('dispute_notification_attempts'),
    ('financial_job_occurrences')
), observed AS (
  SELECT e.relation_name,
         to_regclass('public.' || e.relation_name) IS NOT NULL AS already_present
  FROM expected e
)
SELECT 'slice_1_relation_collision' AS diagnostic,
       COUNT(*) FILTER (WHERE already_present) = 0 AS pass,
       COUNT(*) FILTER (WHERE already_present) AS observed_count,
       0::BIGINT AS expected_count,
       COALESCE(string_agg(relation_name, ', ' ORDER BY relation_name)
         FILTER (WHERE already_present), '') AS detail
FROM observed;

-- 2. Existing engine state. Slice 1 is not an engine cutover: every school must
-- remain v1 before and after this migration.
SELECT 'existing_payout_engine_state' AS diagnostic,
       COUNT(*) FILTER (WHERE payout_engine_version <> 'v1') = 0 AS pass,
       COUNT(*) AS school_count,
       COUNT(*) FILTER (WHERE payout_engine_version = 'v1') AS v1_count,
       COUNT(*) FILTER (WHERE payout_engine_version = 'v2') AS v2_count,
       md5(COALESCE(string_agg(
         id::TEXT || ':' || payout_engine_version,
         ',' ORDER BY id
       ), '')) AS state_fingerprint
FROM schools;

-- 3. Production-shaped historic fingerprints. Capture these results before
-- migration and compare with the postflight output; counts and fingerprints
-- must be identical.
SELECT 'lesson_bookings' AS historic_relation,
       COUNT(*) AS row_count,
       md5(COALESCE(string_agg(
         concat_ws('|', id, school_id, learner_id, instructor_id, status,
           scheduled_date, start_time, end_time),
         ',' ORDER BY id
       ), '')) AS historic_fingerprint
FROM lesson_bookings
UNION ALL
SELECT 'payout_funding_sources',
       COUNT(*),
       md5(COALESCE(string_agg(
         concat_ws('|', id, school_id, learner_id, instructor_id, funding_class,
           currency, gross_collected_pence, stripe_fee_pence,
           payable_pool_pence, refundable_pool_pence, source_status,
           source_fingerprint),
         ',' ORDER BY id
       ), ''))
FROM payout_funding_sources
UNION ALL
SELECT 'booking_earnings',
       COUNT(*),
       md5(COALESCE(string_agg(
         concat_ws('|', id, school_id, booking_id, instructor_id, payout_route,
           gross_price_snapshot_pence, stripe_fee_snapshot_pence,
           instructor_earning_pence, platform_fee_pence, earning_status,
           calculation_fingerprint),
         ',' ORDER BY id
       ), ''))
FROM booking_earnings
UNION ALL
SELECT 'refund_events',
       COUNT(*),
       md5(COALESCE(string_agg(
         concat_ws('|', id, school_id, learner_id, refund_type, status,
           gross_refund_pence, processing_fee_withheld_pence,
           net_refund_pence, stripe_payment_intent_id, stripe_charge_id,
           stripe_refund_id, idempotency_key),
         ',' ORDER BY id
       ), ''))
FROM refund_events
ORDER BY historic_relation;

-- 4. Existing Payout v2 tenant-integrity checks. Any non-zero result blocks
-- rollout review independently of migration 039.
SELECT 'payout_funding_source_instructor_tenant_mismatch' AS diagnostic,
       COUNT(*) = 0 AS pass,
       COUNT(*) AS violation_count
FROM payout_funding_sources pfs
JOIN instructors i ON i.id = pfs.instructor_id
WHERE i.school_id <> pfs.school_id
UNION ALL
SELECT 'payout_funding_source_learner_tenant_mismatch',
       COUNT(*) = 0,
       COUNT(*)
FROM payout_funding_sources pfs
JOIN learner_users l ON l.id = pfs.learner_id
WHERE l.school_id <> pfs.school_id
UNION ALL
SELECT 'lesson_booking_instructor_tenant_mismatch',
       COUNT(*) = 0,
       COUNT(*)
FROM lesson_bookings b
JOIN instructors i ON i.id = b.instructor_id
WHERE i.school_id <> b.school_id
UNION ALL
SELECT 'lesson_booking_learner_tenant_mismatch',
       COUNT(*) = 0,
       COUNT(*)
FROM lesson_bookings b
JOIN learner_users l ON l.id = b.learner_id
WHERE l.school_id <> b.school_id
ORDER BY diagnostic;

-- 5. Stripe identity uniqueness in existing sources. Null identities are not
-- claims and are intentionally excluded.
WITH claims AS (
  SELECT 'stripe_checkout_session_id' AS identity_kind,
         stripe_checkout_session_id AS identity_value
  FROM payout_funding_sources
  WHERE stripe_checkout_session_id IS NOT NULL
  UNION ALL
  SELECT 'stripe_payment_intent_id', stripe_payment_intent_id
  FROM payout_funding_sources
  WHERE stripe_payment_intent_id IS NOT NULL
  UNION ALL
  SELECT 'stripe_charge_id', stripe_charge_id
  FROM payout_funding_sources
  WHERE stripe_charge_id IS NOT NULL
  UNION ALL
  SELECT 'stripe_balance_transaction_id', stripe_balance_transaction_id
  FROM payout_funding_sources
  WHERE stripe_balance_transaction_id IS NOT NULL
), duplicates AS (
  SELECT identity_kind, identity_value, COUNT(*) AS claim_count
  FROM claims
  GROUP BY identity_kind, identity_value
  HAVING COUNT(*) > 1
)
SELECT 'existing_stripe_identity_duplicates' AS diagnostic,
       COUNT(*) = 0 AS pass,
       COUNT(*) AS duplicate_identity_count,
       COALESCE(string_agg(identity_kind || ':' || identity_value, ', '
         ORDER BY identity_kind, identity_value), '') AS detail
FROM duplicates;
