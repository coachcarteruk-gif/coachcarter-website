function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function feeModel(instructor) {
  return instructor.weekly_franchise_fee_pence != null ? 'franchise' : 'commission';
}

function buildLegacyPayoutOverviewEstimate(instructor, bookings) {
  if (!Array.isArray(bookings) || bookings.length === 0) return null;

  const franchiseFee = instructor.weekly_franchise_fee_pence != null
    ? integer(instructor.weekly_franchise_fee_pence)
    : null;
  const grossPence = bookings.reduce((sum, booking) => sum + integer(booking.price_pence), 0);
  let estimatedPence;

  if (franchiseFee != null) {
    estimatedPence = grossPence - Math.min(franchiseFee, grossPence);
  } else {
    const commissionRate = Number.parseFloat(instructor.commission_rate) || 0.85;
    estimatedPence = bookings.reduce(
      (sum, booking) => sum + Math.round(integer(booking.price_pence) * commissionRate),
      0
    );
  }

  return {
    instructor_id: instructor.id,
    name: instructor.name,
    eligible_lessons: bookings.length,
    estimated_pence: estimatedPence,
    paused: instructor.payouts_paused,
    fee_model: feeModel(instructor),
    payout_path: 'legacy',
    manually_settled_lessons: 0,
    manual_settlement_boundary: null,
    blockers: [],
    estimate_unavailable: false,
  };
}

function buildControlledPayoutOverviewEstimate(instructor, preview) {
  const excluded = Array.isArray(preview?.excluded) ? preview.excluded : [];
  const included = Array.isArray(preview?.included) ? preview.included : [];
  const proposedTransferPence = preview?.totals?.proposed_transfer_pence;

  return {
    instructor_id: instructor.id,
    name: instructor.name,
    eligible_lessons: included.length,
    estimated_pence: Number.isSafeInteger(proposedTransferPence) ? proposedTransferPence : null,
    paused: instructor.payouts_paused,
    fee_model: feeModel(instructor),
    payout_path: 'interim_v1_controlled',
    manually_settled_lessons: excluded.filter(
      (booking) => booking.reason === 'MANUALLY_SETTLED_BEFORE_CUTOFF'
    ).length,
    manual_settlement_boundary: preview?.manual_settlement_boundary || null,
    blockers: Array.isArray(preview?.blockers) ? preview.blockers : [],
    estimate_unavailable: !Number.isSafeInteger(proposedTransferPence),
  };
}

function buildUnavailableControlledPayoutOverviewEstimate(instructor) {
  const boundary = instructor.manual_settlement_boundary_id ? {
    id: instructor.manual_settlement_boundary_id,
    settled_before_at: instructor.settled_before_at || null,
    first_system_period_end_at: instructor.first_system_period_end_at || null,
    time_zone: instructor.manual_settlement_time_zone || null,
  } : null;

  return {
    instructor_id: instructor.id,
    name: instructor.name,
    eligible_lessons: 0,
    estimated_pence: null,
    paused: instructor.payouts_paused,
    fee_model: feeModel(instructor),
    payout_path: 'interim_v1_controlled',
    manually_settled_lessons: null,
    manual_settlement_boundary: boundary,
    blockers: ['CONTROLLED_PREVIEW_UNAVAILABLE'],
    estimate_unavailable: true,
  };
}

module.exports = {
  buildControlledPayoutOverviewEstimate,
  buildLegacyPayoutOverviewEstimate,
  buildUnavailableControlledPayoutOverviewEstimate,
};
