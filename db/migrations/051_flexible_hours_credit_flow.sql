-- Flexible Hours credit-flow alignment.
--
-- One learner may have only one unresolved Flexible Hours Checkout at a time,
-- regardless of which package size they selected. A completed purchase is
-- separately guarded in application control flow until its spendable balance
-- reaches zero.
DROP INDEX IF EXISTS uq_flexible_attempt_active_product;
CREATE UNIQUE INDEX IF NOT EXISTS uq_flexible_attempt_active_learner
  ON flexible_package_purchase_attempts(school_id, learner_id)
  WHERE status IN ('created','submitting','pending','review_required');

-- A 48h+ reschedule preserves value by appending an exact return for every old
-- booking allocation and an identical replacement allocation in one database
-- transaction. Historical allocation evidence is never updated or deleted.
ALTER TABLE flexible_package_allocation_returns
  DROP CONSTRAINT IF EXISTS flexible_package_allocation_returns_reason_check;
ALTER TABLE flexible_package_allocation_returns
  ADD CONSTRAINT flexible_package_allocation_returns_reason_check
  CHECK (reason IN (
    'learner_cancelled_48h_plus',
    'admin_eligible_cancellation',
    'rescheduled_48h_plus'
  ));
