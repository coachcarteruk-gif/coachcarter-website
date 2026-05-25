-- Hotfix: stale active BCS rows on rescheduled credit-funded bookings.
--
-- READ-ONLY DRY RUN:
-- Finds booking_credit_sources rows still active even though their linked
-- booking has been marked refunded with credit_returned = TRUE.
-- Known prod row from 2026-05-25 investigation:
--   bcs_id = 4, booking_id = 235

SELECT
  bcs.id AS bcs_id,
  bcs.booking_id,
  bcs.credit_transaction_id,
  bcs.minutes_drawn,
  bcs.refunded_at,
  bcs.created_at AS bcs_created_at,
  lb.learner_id,
  lb.instructor_id,
  lb.school_id,
  lb.status,
  lb.credit_returned,
  lb.minutes_deducted,
  lb.rescheduled_from,
  lb.created_at AS booking_created_at
FROM booking_credit_sources bcs
JOIN lesson_bookings lb ON lb.id = bcs.booking_id
WHERE bcs.refunded_at IS NULL
  AND bcs.school_id = 1
  AND lb.school_id = 1
  AND lb.status = 'refunded'
  AND lb.credit_returned = TRUE
ORDER BY bcs.id;

-- PROPOSED REPAIR - DO NOT RUN WITHOUT EXPLICIT FRASER APPROVAL:
--
-- UPDATE booking_credit_sources bcs
--    SET refunded_at = NOW()
--   FROM lesson_bookings lb
--  WHERE lb.id = bcs.booking_id
--    AND bcs.refunded_at IS NULL
--    AND bcs.school_id = 1
--    AND lb.school_id = 1
--    AND lb.status = 'refunded'
--    AND lb.credit_returned = TRUE
-- RETURNING
--   bcs.id AS bcs_id,
--   bcs.booking_id,
--   bcs.credit_transaction_id,
--   bcs.minutes_drawn,
--   bcs.refunded_at;
