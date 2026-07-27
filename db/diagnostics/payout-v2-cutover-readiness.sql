-- Payout v2 Slice 7 controlled-cutover readiness (read-only).
--
-- Required psql variable:
--   \set school_id 1
--
-- This diagnostic does not approve a cutover and does not write evidence. It
-- exposes the school-scoped facts an operator must compare with an immutable
-- application-generated readiness snapshot. Stripe/API reconciliation remains
-- a separate explicit input; a local transfer row is not bank settlement.

WITH target_school AS (
  SELECT id, payout_engine_version
    FROM schools
   WHERE id = :'school_id'::integer
),
latest_config AS (
  SELECT c.*
    FROM payout_v2_cutover_config_versions c
   WHERE c.school_id = :'school_id'::integer
   ORDER BY c.version_no DESC, c.id DESC
   LIMIT 1
),
shadow_cycles AS (
  SELECT
    COUNT(*) FILTER (
      WHERE decision = 'accepted'
        AND unexplained_difference_count = 0
        AND ambiguous_source_count = 0
    ) AS accepted_count,
    COUNT(DISTINCT period_start) FILTER (WHERE decision = 'accepted') AS distinct_period_count,
    COUNT(DISTINCT shadow_statement_fingerprint)
      FILTER (WHERE decision = 'accepted') AS distinct_statement_count,
    COALESCE(SUM(unexplained_difference_count), 0) AS unexplained_difference_count,
    COALESCE(SUM(ambiguous_source_count), 0) AS ambiguous_source_count
  FROM payout_v2_shadow_cycle_evidence
  WHERE school_id = :'school_id'::integer
),
ambiguous_sources AS (
  SELECT COUNT(*) AS violation_count
    FROM payout_funding_sources
   WHERE school_id = :'school_id'::integer
     AND (
       funding_class = 'manual_review'
       OR (
         funding_class = 'external_cash_payable'
         AND (
           source_status = 'manual_review'
           OR NOT (metadata ? 'evidence_reference')
           OR NULLIF(BTRIM(metadata->>'evidence_reference'), '') IS NULL
         )
       )
     )
),
legacy_positive AS (
  SELECT COUNT(*) AS violation_count
    FROM payout_funding_sources
   WHERE school_id = :'school_id'::integer
     AND funding_class = 'legacy_pre_connect_settled'
     AND payable_pool_pence > 0
),
cross_route AS (
  SELECT COUNT(*) AS violation_count
    FROM booking_earnings be
    JOIN payout_line_items pli ON pli.booking_id = be.booking_id
   WHERE be.school_id = :'school_id'::integer
  UNION ALL
  SELECT COUNT(*) AS violation_count
    FROM booking_earnings be
    JOIN school_payout_line_items spli ON spli.booking_id = be.booking_id
   WHERE be.school_id = :'school_id'::integer
),
unresolved_transfers AS (
  SELECT COUNT(*) AS violation_count
    FROM payout_transfers
   WHERE school_id = :'school_id'::integer
     AND state IN ('submitting', 'reconciling')
),
active_incidents AS (
  SELECT COUNT(*) AS violation_count
    FROM payout_v2_cutover_events
   WHERE school_id = :'school_id'::integer
     AND event_type IN ('incident_opened', 'rollback_started')
     AND status = 'open'
),
v1_inflight AS (
  SELECT COUNT(*) AS violation_count
    FROM instructor_payouts ip
    JOIN instructors i ON i.id = ip.instructor_id
   WHERE i.school_id = :'school_id'::integer
     AND ip.status IN ('pending', 'processing')
  UNION ALL
  SELECT COUNT(*) AS violation_count
    FROM school_payouts sp
   WHERE sp.school_id = :'school_id'::integer
     AND sp.status IN ('pending', 'processing')
),
latest_protected AS (
  SELECT calculation_fingerprint, position_fingerprint,
         protected_free_cash_pence, transfer_readiness_pence, blocker_codes
    FROM payout_v2_protected_balance_snapshots
   WHERE scope_kind = 'global'
     AND school_id IS NULL
   ORDER BY input_timestamp DESC, id DESC
   LIMIT 1
)
SELECT
  :'school_id'::integer AS school_id,
  COALESCE((SELECT payout_engine_version FROM target_school), 'missing') AS payout_engine_version,
  (SELECT config_fingerprint FROM latest_config) AS config_fingerprint,
  (SELECT payout_route FROM latest_config) AS configured_route,
  (SELECT first_live_instructor_id FROM latest_config) AS first_live_instructor_id,
  (SELECT first_live_cap_pence FROM latest_config) AS first_live_cap_pence,
  (SELECT mutation_operator_authority_class FROM latest_config) AS operator_authority_class,
  (SELECT accepted_count FROM shadow_cycles) AS accepted_shadow_cycle_count,
  (SELECT distinct_period_count FROM shadow_cycles) AS distinct_shadow_period_count,
  (SELECT distinct_statement_count FROM shadow_cycles) AS distinct_shadow_statement_count,
  (SELECT unexplained_difference_count FROM shadow_cycles) AS unexplained_difference_count,
  (SELECT ambiguous_source_count FROM shadow_cycles) AS shadow_ambiguous_source_count,
  (SELECT violation_count FROM ambiguous_sources) AS unresolved_external_cash_source_count,
  (SELECT violation_count FROM legacy_positive) AS legacy_positive_contribution_count,
  (SELECT COALESCE(SUM(violation_count), 0) FROM cross_route) AS cross_route_claim_count,
  (SELECT violation_count FROM unresolved_transfers) AS unresolved_transfer_count,
  (SELECT violation_count FROM active_incidents) AS active_incident_count,
  (SELECT COALESCE(SUM(violation_count), 0) FROM v1_inflight) AS v1_inflight_payout_count,
  (SELECT calculation_fingerprint FROM latest_protected) AS protected_calculation_fingerprint,
  (SELECT position_fingerprint FROM latest_protected) AS protected_position_fingerprint,
  (SELECT protected_free_cash_pence FROM latest_protected) AS protected_free_cash_pence,
  (SELECT transfer_readiness_pence FROM latest_protected) AS transfer_readiness_pence,
  (SELECT blocker_codes FROM latest_protected) AS protected_blocker_codes;
