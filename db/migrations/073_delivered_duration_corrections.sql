-- A delivered-duration correction returns immutable allocations before appending
-- their corrected replacements. It is neither a cancellation nor a cash refund.
ALTER TABLE flexible_package_allocation_returns
  DROP CONSTRAINT IF EXISTS flexible_package_allocation_returns_reason_check;
ALTER TABLE flexible_package_allocation_returns
  ADD CONSTRAINT flexible_package_allocation_returns_reason_check
  CHECK (reason IN (
    'learner_cancelled_48h_plus',
    'admin_eligible_cancellation',
    'rescheduled_48h_plus',
    'delivered_duration_correction'
  ));
