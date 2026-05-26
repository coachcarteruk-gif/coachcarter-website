// Pure accounting planner for partial paid repeat-offer attribution.
//
// This helper deliberately does not read/write the database. It only proposes
// booking_credit_sources rows for booked lessons plus one credit_source_adjustments
// row for the unbooked/refunded portion of a paid repeat-offer source.

const { allocate } = require('./_pence-allocator');
const { splitFifoPlanAcrossBookings } = require('./_bcs-booking-plan');

function toPositiveInteger(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return n;
}

function toNonNegativeInteger(value, name) {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return n;
}

function toOptionalNonNegativeInteger(value, name) {
  if (value == null) return null;
  return toNonNegativeInteger(value, name);
}

function normalizeSource(source) {
  if (!source || typeof source !== 'object') {
    throw new TypeError('source must be an object');
  }

  const minutes = toPositiveInteger(source.minutes, 'source.minutes');
  const amountPence = toNonNegativeInteger(
    source.amount_pence ?? source.amountPence,
    'source.amount_pence'
  );
  const stripeFeePence = toNonNegativeInteger(
    source.stripe_fee_pence ?? source.stripeFeePence,
    'source.stripe_fee_pence'
  );
  const activeMinutesDrawn = toNonNegativeInteger(
    source.active_minutes_drawn ?? source.activeMinutesDrawn,
    'source.active_minutes_drawn'
  );
  const activeContributionPence = toNonNegativeInteger(
    source.active_contribution_pence ?? source.activeContributionPence,
    'source.active_contribution_pence'
  );
  const activeStripeFeePence = toNonNegativeInteger(
    source.active_stripe_fee_pence ?? source.activeStripeFeePence,
    'source.active_stripe_fee_pence'
  );
  const adjustedMinutes = toNonNegativeInteger(
    source.adjusted_minutes ?? source.adjustedMinutes,
    'source.adjusted_minutes'
  );
  const adjustedPence = toNonNegativeInteger(
    source.adjusted_pence ?? source.adjustedPence,
    'source.adjusted_pence'
  );

  if (activeMinutesDrawn + adjustedMinutes > minutes) {
    throw new RangeError(`source ${source.id} already has more consumed minutes than source minutes`);
  }
  if (activeContributionPence + adjustedPence > amountPence) {
    throw new RangeError(`source ${source.id} already has contribution plus adjustments above source amount`);
  }
  if (activeStripeFeePence > stripeFeePence) {
    throw new RangeError(`source ${source.id} has already over-allocated Stripe fee`);
  }

  return {
    id: toPositiveInteger(source.id, 'source.id'),
    school_id: toPositiveInteger(source.school_id ?? source.schoolId, 'source.school_id'),
    minutes,
    amount_pence: amountPence,
    stripe_fee_pence: stripeFeePence,
    effective_rate_pence_per_minute: toNonNegativeInteger(
      source.effective_rate_pence_per_minute ?? source.effectiveRatePencePerMinute,
      'source.effective_rate_pence_per_minute'
    ),
    absorbed_by: source.absorbed_by ?? source.absorbedBy ?? null,
    active_minutes_drawn: activeMinutesDrawn,
    active_contribution_pence: activeContributionPence,
    active_stripe_fee_pence: activeStripeFeePence,
    adjusted_minutes: adjustedMinutes,
    adjusted_pence: adjustedPence,
  };
}

function normalizeBookingTarget(booking, index, durationMins) {
  return {
    booking_id: toPositiveInteger(booking.booking_id ?? booking.id, `bookedLessons[${index}].booking_id`),
    minutes: toPositiveInteger(booking.minutes ?? durationMins, `bookedLessons[${index}].minutes`),
  };
}

function resolveRequestedMinutes({ requestedRepeatCount, requestedTotalMinutes, durationMins, sourceMinutes }) {
  if (requestedTotalMinutes != null) {
    return toPositiveInteger(requestedTotalMinutes, 'requestedTotalMinutes');
  }
  if (requestedRepeatCount != null) {
    const count = toPositiveInteger(requestedRepeatCount, 'requestedRepeatCount');
    const duration = toPositiveInteger(durationMins, 'durationMins');
    return count * duration;
  }
  return sourceMinutes;
}

function allocateRemainingPence({ totalPence, activePence, adjustedPence, bookedMinutes, csaMinutes, remainingMinutes }) {
  const remainingPence = totalPence - activePence - adjustedPence;
  if (remainingPence < 0) {
    throw new RangeError('remaining source pence cannot be negative');
  }
  if (remainingPence === 0) {
    return { bookedPence: 0, csaPence: 0 };
  }

  const weights = [bookedMinutes, csaMinutes, remainingMinutes];
  const [bookedPence, csaPence] = allocate(remainingPence, weights);
  return { bookedPence, csaPence };
}

function sumField(rows, field) {
  return rows.reduce((sum, row) => sum + row[field], 0);
}

function planPartialRepeatOfferAccounting({
  source,
  schoolId,
  bookedLessons,
  durationMins,
  requestedRepeatCount,
  requestedTotalMinutes,
  unbookedMinutes,
  refundedMinutes,
  refundedPence,
  stripeRefundId = null,
  csaReason = 'Partial repeat offer refund for unbooked lessons',
}) {
  const resolvedSource = normalizeSource(source);
  const resolvedSchoolId = toPositiveInteger(schoolId ?? resolvedSource.school_id, 'schoolId');
  if (resolvedSchoolId !== resolvedSource.school_id) {
    throw new RangeError('schoolId must match source.school_id');
  }
  if (!Array.isArray(bookedLessons) || bookedLessons.length === 0) {
    throw new TypeError('bookedLessons must be a non-empty array');
  }

  const bookingTargets = bookedLessons.map((booking, index) =>
    normalizeBookingTarget(booking, index, durationMins)
  );
  const bookedMinutes = bookingTargets.reduce((sum, booking) => sum + booking.minutes, 0);
  const requestedMinutes = resolveRequestedMinutes({
    requestedRepeatCount,
    requestedTotalMinutes,
    durationMins,
    sourceMinutes: resolvedSource.minutes,
  });
  if (requestedMinutes !== resolvedSource.minutes) {
    throw new RangeError('requested minutes must match source.minutes for a single repeat-offer source');
  }

  const availableMinutes = resolvedSource.minutes
    - resolvedSource.active_minutes_drawn
    - resolvedSource.adjusted_minutes;
  const explicitCsaMinutes = refundedMinutes ?? unbookedMinutes;
  const csaMinutes = explicitCsaMinutes == null
    ? availableMinutes - bookedMinutes
    : toNonNegativeInteger(explicitCsaMinutes, 'refundedMinutes');
  if (bookedMinutes + csaMinutes > availableMinutes) {
    throw new RangeError('booked plus CSA minutes cannot exceed available source minutes');
  }

  const remainingAfterPlanMinutes = availableMinutes - bookedMinutes - csaMinutes;
  if (remainingAfterPlanMinutes !== 0) {
    throw new RangeError('partial repeat accounting must account for all available source minutes via booked BCS plus CSA');
  }
  const explicitRefundedPence = toOptionalNonNegativeInteger(refundedPence, 'refundedPence');
  const remainingContributionPence = resolvedSource.amount_pence
    - resolvedSource.active_contribution_pence
    - resolvedSource.adjusted_pence;
  if (explicitRefundedPence != null && explicitRefundedPence > remainingContributionPence) {
    throw new RangeError('refundedPence cannot exceed remaining source contribution pence');
  }
  if (explicitRefundedPence != null && explicitRefundedPence > 0 && csaMinutes === 0) {
    throw new RangeError('refundedPence requires positive CSA minutes to carry the cash refund adjustment');
  }

  const contributionSplit = explicitRefundedPence == null
    ? allocateRemainingPence({
      totalPence: resolvedSource.amount_pence,
      activePence: resolvedSource.active_contribution_pence,
      adjustedPence: resolvedSource.adjusted_pence,
      bookedMinutes,
      csaMinutes,
      remainingMinutes: remainingAfterPlanMinutes,
    })
    : {
      bookedPence: remainingContributionPence - explicitRefundedPence,
      csaPence: explicitRefundedPence,
    };

  const remainingStripeFeePence = resolvedSource.stripe_fee_pence
    - resolvedSource.active_stripe_fee_pence;
  if (remainingStripeFeePence < 0) {
    throw new RangeError('remaining source Stripe fee cannot be negative');
  }

  const feeSplit = remainingAfterPlanMinutes === 0
    ? {
      bookedPence: remainingStripeFeePence,
      csaPence: 0,
    }
    : allocateRemainingPence({
      totalPence: resolvedSource.stripe_fee_pence,
      activePence: resolvedSource.active_stripe_fee_pence,
      adjustedPence: 0,
      bookedMinutes,
      csaMinutes: 0,
      remainingMinutes: csaMinutes + remainingAfterPlanMinutes,
    });

  const bcsDrawPlan = splitFifoPlanAcrossBookings({
    plannedRows: [{
      credit_transaction_id: resolvedSource.id,
      minutes_drawn: bookedMinutes,
      rate_pence_per_minute: resolvedSource.effective_rate_pence_per_minute,
      contribution_pence: contributionSplit.bookedPence,
      stripe_fee_pence: feeSplit.bookedPence,
      absorbed_by: resolvedSource.absorbed_by,
      school_id: resolvedSchoolId,
    }],
    bookingTargets,
  });

  const csaAdjustmentPlan = csaMinutes > 0
    ? {
      school_id: resolvedSchoolId,
      credit_transaction_id: resolvedSource.id,
      kind: 'cash_refund',
      minutes_adjusted: csaMinutes,
      pence_adjusted: contributionSplit.csaPence,
      reason: csaReason,
      stripe_refund_id: stripeRefundId,
    }
    : null;

  const activeBcsMinutesAfterPlan = resolvedSource.active_minutes_drawn + sumField(bcsDrawPlan, 'minutes_drawn');
  const activeContributionAfterPlan = resolvedSource.active_contribution_pence + sumField(bcsDrawPlan, 'contribution_pence');
  const activeStripeFeeAfterPlan = resolvedSource.active_stripe_fee_pence + sumField(bcsDrawPlan, 'stripe_fee_pence');
  const adjustedMinutesAfterPlan = resolvedSource.adjusted_minutes + (csaAdjustmentPlan?.minutes_adjusted ?? 0);
  const adjustedPenceAfterPlan = resolvedSource.adjusted_pence + (csaAdjustmentPlan?.pence_adjusted ?? 0);

  return {
    ok: true,
    school_id: resolvedSchoolId,
    credit_transaction_id: resolvedSource.id,
    requested_minutes: requestedMinutes,
    booked_minutes: bookedMinutes,
    csa_minutes: csaMinutes,
    remaining_unplanned_minutes: remainingAfterPlanMinutes,
    bcs_draw_plan: bcsDrawPlan,
    csa_adjustment_plan: csaAdjustmentPlan,
    totals: {
      bcs_minutes: sumField(bcsDrawPlan, 'minutes_drawn'),
      bcs_contribution_pence: sumField(bcsDrawPlan, 'contribution_pence'),
      bcs_stripe_fee_pence: sumField(bcsDrawPlan, 'stripe_fee_pence'),
      csa_minutes: csaAdjustmentPlan?.minutes_adjusted ?? 0,
      csa_pence_adjusted: csaAdjustmentPlan?.pence_adjusted ?? 0,
    },
    invariants: {
      minutes_conserved: activeBcsMinutesAfterPlan + adjustedMinutesAfterPlan === resolvedSource.minutes,
      contribution_conserved: activeContributionAfterPlan + adjustedPenceAfterPlan === resolvedSource.amount_pence,
      active_stripe_fee_not_over_allocated: activeStripeFeeAfterPlan <= resolvedSource.stripe_fee_pence,
      exhausted_source: activeBcsMinutesAfterPlan + adjustedMinutesAfterPlan === resolvedSource.minutes,
    },
  };
}

module.exports = {
  planPartialRepeatOfferAccounting,
};
