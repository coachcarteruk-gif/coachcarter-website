-- Read-only Production preflight after migration 062 and application deploy,
-- before the separately authorised recording operation.
BEGIN TRANSACTION READ ONLY;

SELECT current_database() AS database_name, current_user AS database_role,
       pg_is_in_recovery() AS is_replica, NOW() AS observed_at;

SELECT i.id AS instructor_id, i.school_id, i.name, i.payouts_paused,
       i.stripe_onboarding_complete, i.stripe_account_id,
       c.id AS control_id, mb.id AS boundary_id, mb.settled_before_at,
       mb.first_system_period_end_at, mb.time_zone
  FROM instructors i
  JOIN interim_v1_instructor_controls c
    ON c.school_id = i.school_id AND c.instructor_id = i.id
  JOIN interim_v1_manual_settlement_boundaries mb
    ON mb.school_id = i.school_id AND mb.instructor_id = i.id
 WHERE i.school_id = 1 AND i.id = 6
   AND mb.id = '8716617e-0549-4d14-b9be-c2d37a1e0266'::uuid;

SELECT COUNT(*)::int AS chargeable_booking_count,
       ARRAY_AGG(lb.id ORDER BY lb.id) AS chargeable_booking_ids
  FROM lesson_bookings lb
  JOIN learner_users lu
    ON lu.id = lb.learner_id AND lu.school_id = lb.school_id
 WHERE lb.school_id = 1 AND lb.instructor_id = 6
   AND lb.status = 'chargeable'
   AND COALESCE(lu.is_test_account, FALSE) = FALSE
   AND ((lb.scheduled_date + lb.end_time) AT TIME ZONE 'Europe/London')
         >= '2026-09-04T11:00:00Z'::timestamptz
   AND ((lb.scheduled_date + lb.end_time) AT TIME ZONE 'Europe/London')
         < '2026-09-11T11:00:00Z'::timestamptz;

WITH interval_bookings AS (
  SELECT lb.id, lb.school_id, lb.lesson_payment_contract_id
    FROM lesson_bookings lb
    JOIN learner_users lu
      ON lu.id = lb.learner_id AND lu.school_id = lb.school_id
   WHERE lb.school_id = 1 AND lb.instructor_id = 6
     AND lb.status = 'chargeable'
     AND COALESCE(lu.is_test_account, FALSE) = FALSE
     AND ((lb.scheduled_date + lb.end_time) AT TIME ZONE 'Europe/London')
           >= '2026-09-04T11:00:00Z'::timestamptz
     AND ((lb.scheduled_date + lb.end_time) AT TIME ZONE 'Europe/London')
           < '2026-09-11T11:00:00Z'::timestamptz
)
SELECT
  (SELECT COUNT(*)::int FROM payout_line_items pli
    JOIN interval_bookings b ON b.id = pli.booking_id AND b.school_id = pli.school_id)
    AS instructor_v1_claims,
  (SELECT COUNT(*)::int FROM school_payout_line_items spli
    JOIN school_payouts sp ON sp.id = spli.school_payout_id
    JOIN interval_bookings b ON b.id = spli.booking_id AND b.school_id = sp.school_id)
    AS school_v1_claims,
  (SELECT COUNT(*)::int FROM booking_earnings be
    JOIN interval_bookings b ON b.id = be.booking_id AND b.school_id = be.school_id)
    AS payout_v2_earnings,
  (SELECT COUNT(*)::int FROM stripe_launch_booking_earnings launch_earning
    JOIN interval_bookings b
      ON b.school_id = launch_earning.school_id
     AND b.lesson_payment_contract_id = launch_earning.payment_contract_id)
    AS launch_earnings,
  (SELECT COUNT(*)::int FROM interim_v1_manual_payout_settlement_bookings claim
    JOIN interval_bookings b ON b.id = claim.booking_id AND b.school_id = claim.school_id)
    AS existing_manual_claims;

SELECT
  (SELECT COUNT(*)::int FROM interim_v1_manual_payout_settlements
    WHERE school_id = 1 AND instructor_id = 6) AS settlement_headers,
  (SELECT COUNT(*)::int FROM interim_v1_manual_payout_settlement_bookings
    WHERE school_id = 1 AND instructor_id = 6) AS settlement_booking_claims,
  (SELECT COUNT(*)::int FROM interim_v1_payout_approvals
    WHERE school_id = 1 AND instructor_id = 6) AS approvals,
  (SELECT COUNT(*)::int FROM instructor_payouts
    WHERE school_id = 1 AND instructor_id = 6) AS instructor_payouts,
  (SELECT COUNT(*)::int FROM interim_v1_transfer_intents
    WHERE school_id = 1 AND instructor_id = 6) AS transfer_intents,
  (SELECT COUNT(*)::int FROM interim_v1_transfer_attempts
    WHERE school_id = 1 AND instructor_id = 6) AS transfer_attempts,
  (SELECT COUNT(*)::int
     FROM refund_event_lines rel
     JOIN lesson_bookings lb
       ON lb.id = rel.lesson_booking_id AND lb.school_id = rel.school_id
    WHERE rel.school_id = 1 AND lb.instructor_id = 6
      AND ((lb.scheduled_date + lb.end_time) AT TIME ZONE 'Europe/London')
            >= '2026-09-04T11:00:00Z'::timestamptz
      AND ((lb.scheduled_date + lb.end_time) AT TIME ZONE 'Europe/London')
            < '2026-09-11T11:00:00Z'::timestamptz) AS target_refund_lines,
  (SELECT COUNT(*)::int FROM payout_funding_basis_events
    WHERE school_id = 1 AND instructor_id = 6) AS funding_basis_events,
  (SELECT COUNT(*)::int FROM payout_direct_evidence_observations
    WHERE school_id = 1 AND instructor_id = 6) AS direct_observations,
  (SELECT COUNT(*)::int FROM payout_flexible_source_evidence
    WHERE school_id = 1 AND source_id = 3) AS flexible_source_3_observations,
  (SELECT COUNT(*)::int FROM payout_flexible_source_evidence
    WHERE school_id = 1 AND source_id IN (5, 7)) AS flexible_source_5_7_observations,
  (SELECT COUNT(*)::int FROM interim_v1_funding_evidence
    WHERE school_id = 1 AND instructor_id = 6) AS interim_funding_evidence,
  (SELECT COUNT(*)::int FROM interim_v1_funding_evidence
    WHERE school_id = 1 AND instructor_id = 6
      AND evidence_status = 'pending') AS interim_funding_evidence_pending;

SELECT COUNT(*)::int AS audit_count, MAX(id) AS audit_max_id,
       COUNT(*) FILTER (
         WHERE action = 'payout.interim_v1_manual_payout_settlement_recorded'
           AND school_id = 1 AND target_type = 'instructor' AND target_id = 6
       )::int AS settlement_audit_rows
  FROM audit_log;

ROLLBACK;
