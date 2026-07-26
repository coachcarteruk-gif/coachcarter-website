-- Payout v2 Slice 6 protected-balance/operator evidence diagnostic.
-- READ ONLY. Optional psql settings:
--   SET payout_v2.scope_kind = 'global'; -- or school
--   SET payout_v2.school_id = '1';
--   SET payout_v2.proposed_withdrawal_pence = '10000';

WITH requested_scope AS (
  SELECT
    COALESCE(NULLIF(current_setting('payout_v2.scope_kind', true), ''), 'global') AS scope_kind,
    NULLIF(current_setting('payout_v2.school_id', true), '')::int AS school_id,
    NULLIF(current_setting('payout_v2.proposed_withdrawal_pence', true), '')::bigint
      AS proposed_withdrawal_pence
),
latest_snapshot AS (
  SELECT pbs.*
    FROM payout_v2_protected_balance_snapshots pbs
    CROSS JOIN requested_scope rs
   WHERE pbs.scope_kind = rs.scope_kind
     AND pbs.school_id IS NOT DISTINCT FROM rs.school_id
   ORDER BY pbs.input_timestamp DESC, pbs.id DESC
   LIMIT 1
)
SELECT
  rs.scope_kind,
  rs.school_id,
  ls.input_timestamp,
  ls.stripe_available_pence,
  ls.stripe_pending_pence,
  ls.calculation_json->'components' AS protected_components,
  ls.transfer_readiness_pence,
  ls.protected_free_cash_pence,
  rs.proposed_withdrawal_pence,
  CASE WHEN rs.proposed_withdrawal_pence IS NULL THEN NULL
       ELSE ls.protected_free_cash_pence - rs.proposed_withdrawal_pence END
    AS projected_protected_free_cash_pence,
  ls.blocker_codes,
  ls.calculation_version,
  ls.calculation_fingerprint,
  ls.position_fingerprint,
  (NOW() - ls.input_timestamp) > INTERVAL '5 minutes' AS stale_snapshot
FROM requested_scope rs
LEFT JOIN latest_snapshot ls ON TRUE;

SELECT logical_identity, state, amount_pence, evidence_status, school_id
FROM (
  SELECT DISTINCT ON (school_id, logical_identity)
         school_id, logical_identity, state, amount_pence, evidence_status,
         sequence_no, id
    FROM payout_v2_refund_obligation_events
   ORDER BY school_id, logical_identity, sequence_no DESC, id DESC
) latest
WHERE state = 'approved'
ORDER BY school_id, logical_identity;

SELECT school_id, id, state, amount_pence, stripe_transfer_id,
       last_error_code, created_at
  FROM payout_transfers
 WHERE state IN ('submitting', 'reconciling')
 ORDER BY school_id, created_at, id;

SELECT school_id, stripe_payout_id, state, failure_code, failed_at,
       evidence_json->>'operator_review_required' AS operator_review_required
  FROM connected_bank_payouts
 WHERE state IN ('failed', 'manual_review')
 ORDER BY school_id, created_at DESC;

SELECT scope_kind, school_id, calculation_fingerprint, COUNT(*)::int AS snapshot_count
  FROM payout_v2_protected_balance_snapshots
 GROUP BY scope_kind, school_id, calculation_fingerprint
HAVING COUNT(*) > 1;

SELECT oe.scope_kind, oe.school_id, oe.logical_identity, oe.decision,
       oe.calculation_fingerprint, oe.refusal_codes, oe.created_at
  FROM payout_v2_operator_evidence oe
  LEFT JOIN payout_v2_protected_balance_snapshots pbs
    ON pbs.calculation_fingerprint = oe.calculation_fingerprint
 WHERE oe.evidence_type = 'withdrawal_preflight'
   AND pbs.id IS NULL
 ORDER BY oe.created_at DESC;

SELECT school_id, funding_class, source_status, COUNT(*)::int AS source_count
  FROM payout_funding_sources
 WHERE funding_class = 'manual_review'
    OR source_status IN ('manual_review', 'disputed')
    OR (funding_class = 'legacy_pre_connect_settled' AND payable_pool_pence > 0)
 GROUP BY school_id, funding_class, source_status
 ORDER BY school_id, funding_class, source_status;

SELECT 'implicit_global_scope_violation' AS violation, id, scope_kind, school_id
  FROM payout_v2_protected_balance_snapshots
 WHERE (scope_kind = 'global' AND school_id IS NOT NULL)
    OR (scope_kind = 'school' AND school_id IS NULL)
UNION ALL
SELECT 'operator_scope_violation', id, scope_kind, school_id
  FROM payout_v2_operator_evidence
 WHERE (scope_kind = 'global' AND school_id IS NOT NULL)
    OR (scope_kind = 'school' AND school_id IS NULL);
