-- Stripe launch Slice 1 schema foundation: POST-MIGRATION DIAGNOSTIC.
-- READ ONLY. This file contains SELECT/CTE statements only. It never applies a
-- migration, inserts launch rows, changes an engine version, or mutates data.

-- 1. Exact Slice 1 table inventory.
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
         to_regclass('public.' || e.relation_name) IS NOT NULL AS present
  FROM expected e
)
SELECT 'slice_1_table_inventory' AS diagnostic,
       bool_and(present) AND COUNT(*) = 26 AS pass,
       COUNT(*) FILTER (WHERE present) AS observed_count,
       26::BIGINT AS expected_count,
       COALESCE(string_agg(relation_name, ', ' ORDER BY relation_name)
         FILTER (WHERE NOT present), '') AS missing
FROM observed;

-- 2. Inertness proof: every newly-created launch relation must contain zero
-- rows. Existing payout_funding_sources and lesson_bookings are deliberately
-- excluded because migration 039 only adds nullable columns to them.
WITH launch_counts(relation_name, row_count) AS (
  SELECT 'stripe_connect_launch_configs', COUNT(*) FROM stripe_connect_launch_configs
  UNION ALL SELECT 'stripe_connect_launch_events', COUNT(*) FROM stripe_connect_launch_events
  UNION ALL SELECT 'instructor_payout_agreement_versions', COUNT(*) FROM instructor_payout_agreement_versions
  UNION ALL SELECT 'lesson_payment_contracts', COUNT(*) FROM lesson_payment_contracts
  UNION ALL SELECT 'lesson_outcome_revisions', COUNT(*) FROM lesson_outcome_revisions
  UNION ALL SELECT 'lesson_issue_tokens', COUNT(*) FROM lesson_issue_tokens
  UNION ALL SELECT 'lesson_issue_reports', COUNT(*) FROM lesson_issue_reports
  UNION ALL SELECT 'lesson_issue_actions', COUNT(*) FROM lesson_issue_actions
  UNION ALL SELECT 'refund_intents', COUNT(*) FROM refund_intents
  UNION ALL SELECT 'refund_attempts', COUNT(*) FROM refund_attempts
  UNION ALL SELECT 'connect_account_state_events', COUNT(*) FROM connect_account_state_events
  UNION ALL SELECT 'payout_runs', COUNT(*) FROM payout_runs
  UNION ALL SELECT 'instructor_payout_batches', COUNT(*) FROM instructor_payout_batches
  UNION ALL SELECT 'instructor_payout_obligations', COUNT(*) FROM instructor_payout_obligations
  UNION ALL SELECT 'instructor_payout_obligation_applications', COUNT(*) FROM instructor_payout_obligation_applications
  UNION ALL SELECT 'stripe_launch_booking_earnings', COUNT(*) FROM stripe_launch_booking_earnings
  UNION ALL SELECT 'stripe_launch_transfer_intents', COUNT(*) FROM stripe_launch_transfer_intents
  UNION ALL SELECT 'stripe_launch_transfer_attempts', COUNT(*) FROM stripe_launch_transfer_attempts
  UNION ALL SELECT 'payout_batch_earning_dispositions', COUNT(*) FROM payout_batch_earning_dispositions
  UNION ALL SELECT 'payout_statements', COUNT(*) FROM payout_statements
  UNION ALL SELECT 'payout_statement_delivery_attempts', COUNT(*) FROM payout_statement_delivery_attempts
  UNION ALL SELECT 'payment_disputes', COUNT(*) FROM payment_disputes
  UNION ALL SELECT 'payment_dispute_events', COUNT(*) FROM payment_dispute_events
  UNION ALL SELECT 'dispute_evidence_pack_versions', COUNT(*) FROM dispute_evidence_pack_versions
  UNION ALL SELECT 'dispute_notification_attempts', COUNT(*) FROM dispute_notification_attempts
  UNION ALL SELECT 'financial_job_occurrences', COUNT(*) FROM financial_job_occurrences
)
SELECT 'slice_1_zero_launch_rows' AS diagnostic,
       COALESCE(SUM(row_count), 0) = 0 AS pass,
       COALESCE(SUM(row_count), 0) AS observed_count,
       0::NUMERIC AS expected_count,
       COALESCE(string_agg(relation_name || '=' || row_count, ', '
         ORDER BY relation_name) FILTER (WHERE row_count <> 0), '') AS non_empty
FROM launch_counts;

-- 3. Existing engine state remains v1; a v2 school fails this postflight.
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

-- 4. Production-shaped historic fingerprints. Compare directly to preflight.
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

-- 5. Required critical index inventory. The full index definitions are also
-- emitted below for reviewer inspection.
WITH expected(index_name) AS (
  VALUES
    ('uq_refund_events_id_school_launch'),
    ('uq_admin_users_id_school_launch'),
    ('uq_lesson_payment_contracts_pi_global'),
    ('uq_lesson_payment_contracts_charge_global'),
    ('uq_payout_funding_sources_launch_contract'),
    ('uq_lesson_bookings_active_launch_contract'),
    ('uq_refund_intents_stripe_refund'),
    ('uq_connect_state_events_stripe_event'),
    ('uq_instructor_obligation_weekly_source'),
    ('uq_instructor_obligation_dispute_source'),
    ('uq_stripe_launch_transfer_id'),
    ('uq_financial_job_occurrence_global'),
    ('uq_financial_job_occurrence_school')
), observed AS (
  SELECT e.index_name, to_regclass('public.' || e.index_name) IS NOT NULL AS present
  FROM expected e
)
SELECT 'slice_1_critical_index_inventory' AS diagnostic,
       bool_and(present) AND COUNT(*) = 13 AS pass,
       COUNT(*) FILTER (WHERE present) AS observed_count,
       13::BIGINT AS expected_count,
       COALESCE(string_agg(index_name, ', ' ORDER BY index_name)
         FILTER (WHERE NOT present), '') AS missing
FROM observed;

SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (
    tablename IN (
      'stripe_connect_launch_configs', 'stripe_connect_launch_events',
      'instructor_payout_agreement_versions', 'lesson_payment_contracts',
      'lesson_outcome_revisions', 'lesson_issue_tokens',
      'lesson_issue_reports', 'lesson_issue_actions', 'refund_intents',
      'refund_attempts', 'connect_account_state_events', 'payout_runs',
      'instructor_payout_batches', 'instructor_payout_obligations',
      'instructor_payout_obligation_applications',
      'stripe_launch_booking_earnings', 'stripe_launch_transfer_intents',
      'stripe_launch_transfer_attempts', 'payout_batch_earning_dispositions',
      'payout_statements', 'payout_statement_delivery_attempts',
      'payment_disputes', 'payment_dispute_events',
      'dispute_evidence_pack_versions', 'dispute_notification_attempts',
      'financial_job_occurrences'
    )
    OR indexname LIKE '%launch%'
  )
ORDER BY tablename, indexname;

-- 6. Constraint inventory and structural tenant proof. Every Slice 1 relation
-- has school_id; all relationships to tenant-owned parents are composite FKs.
WITH launch_tables(table_name) AS (
  VALUES
    ('stripe_connect_launch_configs'), ('stripe_connect_launch_events'),
    ('instructor_payout_agreement_versions'), ('lesson_payment_contracts'),
    ('lesson_outcome_revisions'), ('lesson_issue_tokens'),
    ('lesson_issue_reports'), ('lesson_issue_actions'), ('refund_intents'),
    ('refund_attempts'), ('connect_account_state_events'), ('payout_runs'),
    ('instructor_payout_batches'), ('instructor_payout_obligations'),
    ('instructor_payout_obligation_applications'),
    ('stripe_launch_booking_earnings'), ('stripe_launch_transfer_intents'),
    ('stripe_launch_transfer_attempts'), ('payout_batch_earning_dispositions'),
    ('payout_statements'), ('payout_statement_delivery_attempts'),
    ('payment_disputes'), ('payment_dispute_events'),
    ('dispute_evidence_pack_versions'), ('dispute_notification_attempts'),
    ('financial_job_occurrences')
), observed AS (
  SELECT l.table_name,
         EXISTS (
           SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema = 'public'
             AND c.table_name = l.table_name
             AND c.column_name = 'school_id'
         ) AS has_school_id
  FROM launch_tables l
)
SELECT 'slice_1_explicit_school_scope' AS diagnostic,
       bool_and(has_school_id) AND COUNT(*) = 26 AS pass,
       COUNT(*) FILTER (WHERE has_school_id) AS observed_count,
       26::BIGINT AS expected_count,
       COALESCE(string_agg(table_name, ', ' ORDER BY table_name)
         FILTER (WHERE NOT has_school_id), '') AS missing
FROM observed;

SELECT c.conrelid::regclass::TEXT AS relation_name,
       c.conname AS constraint_name,
       c.contype AS constraint_type,
       c.condeferrable,
       c.condeferred,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.connamespace = 'public'::regnamespace
  AND (
    c.conrelid::regclass::TEXT IN (
      'stripe_connect_launch_configs', 'stripe_connect_launch_events',
      'instructor_payout_agreement_versions', 'lesson_payment_contracts',
      'lesson_outcome_revisions', 'lesson_issue_tokens',
      'lesson_issue_reports', 'lesson_issue_actions', 'refund_intents',
      'refund_attempts', 'connect_account_state_events', 'payout_runs',
      'instructor_payout_batches', 'instructor_payout_obligations',
      'instructor_payout_obligation_applications',
      'stripe_launch_booking_earnings', 'stripe_launch_transfer_intents',
      'stripe_launch_transfer_attempts', 'payout_batch_earning_dispositions',
      'payout_statements', 'payout_statement_delivery_attempts',
      'payment_disputes', 'payment_dispute_events',
      'dispute_evidence_pack_versions', 'dispute_notification_attempts',
      'financial_job_occurrences'
    )
    OR c.conname LIKE '%launch%'
  )
ORDER BY relation_name, constraint_name;

-- 7. Function and trigger inventory. Counts are exact for migration 039:
-- 25 launch functions and 68 non-internal triggers (16 generated append-only
-- evidence triggers plus 52 literal triggers).
SELECT 'slice_1_function_inventory' AS diagnostic,
       COUNT(*) = 25 AS pass,
       COUNT(*) AS observed_count,
       25::BIGINT AS expected_count,
       string_agg(p.proname, ', ' ORDER BY p.proname) AS detail
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'stripe_launch_%';

SELECT 'slice_1_trigger_inventory' AS diagnostic,
       COUNT(*) = 68 AS pass,
       COUNT(*) AS observed_count,
       68::BIGINT AS expected_count,
       COALESCE(string_agg(c.relname || '.' || t.tgname, ', '
         ORDER BY c.relname, t.tgname), '') AS detail
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND (
    t.tgname LIKE '%launch%'
    OR t.tgname IN (
      'payout_funding_sources_append_only',
      'payout_agreements_write_guard', 'payout_agreements_no_delete',
      'lesson_payment_contracts_regime_guard',
      'lesson_payment_contracts_update_guard',
      'lesson_payment_contracts_no_delete',
      'lesson_contract_completion_guard',
      'lesson_booking_contract_completion_guard',
      'lesson_outcome_revisions_insert_guard',
      'lesson_issue_tokens_no_delete', 'lesson_issue_tokens_immutable_facts',
      'lesson_issue_reports_insert_guard', 'refund_intents_no_delete',
      'refund_intents_immutable_facts', 'refund_intents_state_guard',
      'refund_intents_insert_guard', 'refund_attempts_insert_guard',
      'payout_runs_no_delete', 'payout_runs_immutable_facts',
      'payout_runs_state_guard', 'instructor_payout_batches_no_delete',
      'instructor_payout_batches_immutable_facts',
      'instructor_payout_batches_state_guard',
      'instructor_payout_batches_insert_guard',
      'obligations_insert_guard', 'obligation_applications_insert_guard',
      'payout_dispositions_insert_guard', 'payment_disputes_no_delete',
      'payment_disputes_immutable_facts', 'payment_disputes_state_guard',
      'financial_job_occurrences_no_delete',
      'financial_job_occurrences_immutable_facts',
      'financial_job_occurrences_state_guard'
    )
    OR (
      t.tgname LIKE '%_append_only'
      AND c.relname IN (
        'stripe_connect_launch_events', 'lesson_outcome_revisions',
        'lesson_issue_reports', 'lesson_issue_actions', 'refund_attempts',
        'connect_account_state_events', 'instructor_payout_obligations',
        'instructor_payout_obligation_applications',
        'stripe_launch_booking_earnings', 'stripe_launch_transfer_attempts',
        'payout_batch_earning_dispositions', 'payout_statements',
        'payout_statement_delivery_attempts', 'payment_dispute_events',
        'dispute_evidence_pack_versions', 'dispute_notification_attempts'
      )
    )
  );

-- 8. Nullable bridge columns have no defaults. Their presence must not alter
-- historic records or silently manufacture contract/evidence identity.
WITH expected(table_name, column_name) AS (
  VALUES
    ('lesson_bookings', 'lesson_payment_contract_id'),
    ('lesson_bookings', 'slot_released_at'),
    ('lesson_bookings', 'slot_release_reason'),
    ('payout_funding_sources', 'stripe_payment_created_at'),
    ('payout_funding_sources', 'stripe_funds_available_at'),
    ('payout_funding_sources', 'payment_origin'),
    ('payout_funding_sources', 'source_booking_id'),
    ('payout_funding_sources', 'lesson_payment_contract_id'),
    ('payout_funding_sources', 'evidence_completeness'),
    ('payout_funding_sources', 'contradiction_code')
), observed AS (
  SELECT e.table_name, e.column_name, c.is_nullable, c.column_default
  FROM expected e
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = e.table_name
   AND c.column_name = e.column_name
)
SELECT 'slice_1_nullable_bridge_columns' AS diagnostic,
       COUNT(*) = 10
         AND bool_and(is_nullable = 'YES' AND column_default IS NULL) AS pass,
       COUNT(*) FILTER (WHERE is_nullable = 'YES' AND column_default IS NULL) AS observed_count,
       10::BIGINT AS expected_count,
       COALESCE(string_agg(table_name || '.' || column_name, ', '
         ORDER BY table_name, column_name)
         FILTER (WHERE is_nullable IS DISTINCT FROM 'YES'
           OR column_default IS NOT NULL), '') AS invalid
FROM observed;
