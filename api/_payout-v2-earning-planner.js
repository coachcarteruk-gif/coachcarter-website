const {
  SCHEDULED,
  REFUNDED,
  isChargeable,
} = require('./_booking-status');
const {
  FUNDING_CLASSES,
  ZERO_PAYOUT_FUNDING_CLASSES,
  fingerprintPayoutPlan,
  resolveFundingContribution,
} = require('./_payout-v2-contracts');
const {
  planFullOffsetRecovery,
} = require('./_payout-v2-recovery');

const PAYOUT_V2_EARNING_CALCULATION_VERSION = 'payout-v2-earning-planner-v1';
const PAYOUT_ROUTES = Object.freeze(['instructor_direct', 'school']);
const POLICY_KINDS = Object.freeze([
  'commission',
  'franchise',
  'school_platform_fee',
]);

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
}

function requireNonNegativePence(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer in pence`);
  }
}

function requireBasisPoints(value, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new TypeError(`${field} must be an integer between 0 and 10000 basis points`);
  }
}

function cleanText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}

function isoDate(value, field) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${field} must be a valid date`);
  return parsed.toISOString();
}

function dateOnly(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new TypeError(`${field} must use YYYY-MM-DD`);
  }
  return text;
}

function roundBasisPoints(amountPence, basisPoints) {
  requireNonNegativePence(amountPence, 'amountPence');
  requireBasisPoints(basisPoints, 'basisPoints');
  return Math.floor((amountPence * basisPoints + 5_000) / 10_000);
}

/**
 * Deterministic largest-remainder allocation. Keys break equal remainders, so
 * array input order can never move a penny between accounting lines.
 */
function allocatePence(totalPence, weightedRows) {
  requireNonNegativePence(totalPence, 'totalPence');
  if (!Array.isArray(weightedRows)) throw new TypeError('weightedRows must be an array');
  if (weightedRows.length === 0) {
    if (totalPence !== 0) throw new Error('Cannot allocate positive pence without rows');
    return [];
  }
  const totalWeight = weightedRows.reduce((total, row, index) => {
    requireNonNegativePence(row.weight, `weightedRows[${index}].weight`);
    cleanText(String(row.key), `weightedRows[${index}].key`);
    return total + row.weight;
  }, 0);
  if (totalPence > totalWeight) {
    throw new Error('Allocated pence cannot exceed available weighted pence');
  }
  if (totalWeight === 0) {
    if (totalPence !== 0) throw new Error('Cannot allocate positive pence over zero weight');
    return weightedRows.map(() => 0);
  }

  const rows = weightedRows.map((row, index) => {
    const numerator = totalPence * row.weight;
    return {
      index,
      key: String(row.key),
      allocated: Math.floor(numerator / totalWeight),
      remainder: numerator % totalWeight,
    };
  });
  let remaining = totalPence - rows.reduce((sum, row) => sum + row.allocated, 0);
  rows.sort((left, right) => (
    right.remainder - left.remainder || left.key.localeCompare(right.key)
  ));
  for (let index = 0; index < rows.length && remaining > 0; index += 1) {
    rows[index].allocated += 1;
    remaining -= 1;
  }
  rows.sort((left, right) => left.index - right.index);
  return rows.map((row) => row.allocated);
}

function normalizePolicy(policy, payoutRoute) {
  if (!policy || typeof policy !== 'object') throw new TypeError('policy is required');
  if (!POLICY_KINDS.includes(policy.kind)) throw new TypeError('policy.kind is unsupported');
  const snapshot = {
    kind: policy.kind,
    evidence_reference: cleanText(policy.evidenceReference, 'policy.evidenceReference'),
    snapshotted_at: isoDate(policy.snapshottedAt, 'policy.snapshottedAt'),
  };

  if (payoutRoute === 'school') {
    if (policy.kind !== 'school_platform_fee') {
      throw new TypeError('school route requires school_platform_fee policy');
    }
    requireBasisPoints(policy.platformFeeBps, 'policy.platformFeeBps');
    return { ...snapshot, platform_fee_bps: policy.platformFeeBps };
  }
  if (policy.kind === 'school_platform_fee') {
    throw new TypeError('instructor_direct route cannot use school_platform_fee policy');
  }
  if (policy.kind === 'commission') {
    requireBasisPoints(policy.commissionRateBps, 'policy.commissionRateBps');
    return { ...snapshot, commission_rate_bps: policy.commissionRateBps };
  }

  requireNonNegativePence(policy.weeklyFranchiseFeePence, 'policy.weeklyFranchiseFeePence');
  requireNonNegativePence(policy.priorShortfallPence, 'policy.priorShortfallPence');
  if (policy.depositPence != null && policy.depositPence !== 0) {
    throw new TypeError('Payout v2 vehicle deposits are handled off-system');
  }
  return {
    ...snapshot,
    weekly_franchise_fee_pence: policy.weeklyFranchiseFeePence,
    vehicle_deposit_policy: 'off_system',
    deposit_pence: 0,
    prior_shortfall_pence: policy.priorShortfallPence,
  };
}

function normalizeSource(source, index, booking, schoolId) {
  if (!source || typeof source !== 'object') {
    throw new TypeError(`booking ${booking.bookingId} source ${index} is required`);
  }
  const fundingClass = source.fundingClass;
  if (!FUNDING_CLASSES.includes(fundingClass)) {
    return {
      funding_source_id: source.fundingSourceId || null,
      booking_credit_source_id: source.bookingCreditSourceId || null,
      school_id: Number(source.schoolId),
      instructor_id: Number(source.instructorId),
      funding_class: fundingClass || 'unknown',
      source_status: source.sourceStatus || null,
      source_fingerprint: source.sourceFingerprint || null,
      gross_contribution_pence: 0,
      stripe_fee_contribution_pence: 0,
      payable_pool_pence: 0,
      already_allocated_pence: 0,
      evidence: source.evidence || {},
      invalid_reason: 'unknown_funding_class',
    };
  }

  const syntheticZero = source.fundingSourceId == null &&
    ZERO_PAYOUT_FUNDING_CLASSES.has(fundingClass);
  if (!syntheticZero) requirePositiveInteger(source.fundingSourceId, `sources[${index}].fundingSourceId`);
  if (source.bookingCreditSourceId != null) {
    requirePositiveInteger(
      source.bookingCreditSourceId,
      `sources[${index}].bookingCreditSourceId`
    );
  }
  requirePositiveInteger(source.schoolId, `sources[${index}].schoolId`);
  requirePositiveInteger(source.instructorId, `sources[${index}].instructorId`);
  requireNonNegativePence(
    source.grossContributionPence,
    `sources[${index}].grossContributionPence`
  );
  requireNonNegativePence(
    source.stripeFeeContributionPence,
    `sources[${index}].stripeFeeContributionPence`
  );
  requireNonNegativePence(source.payablePoolPence, `sources[${index}].payablePoolPence`);
  requireNonNegativePence(
    source.alreadyAllocatedPence || 0,
    `sources[${index}].alreadyAllocatedPence`
  );
  if (source.stripeFeeContributionPence > source.grossContributionPence) {
    throw new TypeError(`sources[${index}] Stripe fee exceeds gross contribution`);
  }

  let invalidReason = null;
  if (source.schoolId !== schoolId || source.schoolId !== booking.schoolId) {
    invalidReason = 'cross_school_funding_source';
  } else if (source.instructorId !== booking.instructorId) {
    invalidReason = 'cross_instructor_funding_source';
  } else if (!syntheticZero && !/^sha256:[0-9a-f]{64}$/.test(source.sourceFingerprint || '')) {
    invalidReason = 'missing_source_fingerprint';
  } else if (!syntheticZero && source.sourceStatus !== 'available') {
    invalidReason = source.sourceStatus === 'manual_review'
      ? 'manual_review_required'
      : 'funding_source_not_available';
  }

  return {
    funding_source_id: source.fundingSourceId == null
      ? null
      : Number(source.fundingSourceId),
    booking_credit_source_id: source.bookingCreditSourceId == null
      ? null
      : Number(source.bookingCreditSourceId),
    school_id: Number(source.schoolId),
    instructor_id: Number(source.instructorId),
    funding_class: fundingClass,
    source_status: source.sourceStatus || (syntheticZero ? 'available' : null),
    source_fingerprint: source.sourceFingerprint || null,
    gross_contribution_pence: source.grossContributionPence,
    stripe_fee_contribution_pence: source.stripeFeeContributionPence,
    payable_pool_pence: source.payablePoolPence,
    already_allocated_pence: source.alreadyAllocatedPence || 0,
    evidence: source.evidence || {},
    invalid_reason: invalidReason,
  };
}

function normalizeBooking(booking, index, schoolId, payoutRoute) {
  requirePositiveInteger(booking.bookingId, `bookings[${index}].bookingId`);
  requirePositiveInteger(booking.schoolId, `bookings[${index}].schoolId`);
  requirePositiveInteger(booking.instructorId, `bookings[${index}].instructorId`);
  if (![SCHEDULED, REFUNDED].includes(booking.status) && !isChargeable(booking.status)) {
    throw new TypeError(`bookings[${index}].status is unsupported`);
  }
  const existingRoutes = Array.isArray(booking.existingV1Routes)
    ? [...new Set(booking.existingV1Routes)].sort()
    : [];
  for (const route of existingRoutes) {
    if (!PAYOUT_ROUTES.includes(route)) {
      throw new TypeError(`bookings[${index}].existingV1Routes contains an unsupported route`);
    }
  }
  const normalized = {
    booking_id: booking.bookingId,
    school_id: booking.schoolId,
    instructor_id: booking.instructorId,
    status: booking.status,
    scheduled_date: dateOnly(booking.scheduledDate, `bookings[${index}].scheduledDate`),
    earned_at: isoDate(booking.earnedAt, `bookings[${index}].earnedAt`),
    payout_route: booking.payoutRoute,
    is_test_account: booking.isTestAccount === true,
    existing_v2_earning: booking.existingV2Earning === true,
    existing_v1_routes: existingRoutes,
    zero_funding_class: booking.zeroFundingClass || null,
  };
  if (normalized.school_id !== schoolId) normalized.scope_reason = 'cross_school_booking';
  else if (normalized.payout_route !== payoutRoute) normalized.scope_reason = 'payout_route_mismatch';
  else normalized.scope_reason = null;

  const sourceBooking = {
    bookingId: normalized.booking_id,
    schoolId: normalized.school_id,
    instructorId: normalized.instructor_id,
  };
  normalized.sources = (Array.isArray(booking.fundingSources) ? booking.fundingSources : [])
    .map((source, sourceIndex) => normalizeSource(
      source,
      sourceIndex,
      sourceBooking,
      schoolId
    ))
    .sort((left, right) => (
      (left.funding_source_id || Number.MAX_SAFE_INTEGER) -
        (right.funding_source_id || Number.MAX_SAFE_INTEGER) ||
      (left.booking_credit_source_id || Number.MAX_SAFE_INTEGER) -
        (right.booking_credit_source_id || Number.MAX_SAFE_INTEGER) ||
      left.funding_class.localeCompare(right.funding_class)
    ));
  return normalized;
}

function normalizeInput(input) {
  requirePositiveInteger(input.schoolId, 'schoolId');
  if (!PAYOUT_ROUTES.includes(input.payoutRoute)) {
    throw new TypeError('payoutRoute must be instructor_direct or school');
  }
  const periodStart = dateOnly(input.periodStart, 'periodStart');
  const periodEnd = dateOnly(input.periodEnd, 'periodEnd');
  if (periodStart > periodEnd) throw new TypeError('periodStart must not follow periodEnd');
  if (input.payoutRoute === 'instructor_direct') {
    requirePositiveInteger(input.destinationInstructorId, 'destinationInstructorId');
  }
  if (input.payoutRoute === 'school' && input.destinationInstructorId != null) {
    throw new TypeError('school route must not carry destinationInstructorId');
  }

  const normalized = {
    school_id: input.schoolId,
    payout_route: input.payoutRoute,
    destination_instructor_id: input.payoutRoute === 'instructor_direct'
      ? input.destinationInstructorId
      : null,
    destination_school_id: input.payoutRoute === 'school' ? input.schoolId : null,
    period_start: periodStart,
    period_end: periodEnd,
    policy: normalizePolicy(input.policy, input.payoutRoute),
    policy_blocker: input.policyBlocker || null,
    recoveries: Array.isArray(input.recoveries)
      ? input.recoveries.map((recovery) => ({
          id: Number(recovery.id),
          remainingPence: Number(recovery.remainingPence),
          createdAt: isoDate(recovery.createdAt, 'recoveries[].createdAt'),
        }))
      : [],
  };
  normalized.bookings = (Array.isArray(input.bookings) ? input.bookings : [])
    .map((booking, index) => normalizeBooking(
      booking,
      index,
      input.schoolId,
      input.payoutRoute
    ))
    .sort((left, right) => (
      left.scheduled_date.localeCompare(right.scheduled_date) ||
      left.booking_id - right.booking_id
    ));
  if (
    normalized.payout_route === 'instructor_direct' &&
    normalized.bookings.some(
      (booking) => booking.instructor_id !== normalized.destination_instructor_id
    )
  ) {
    normalized.destination_scope_error = 'mixed_instructor_direct_statement';
  } else {
    normalized.destination_scope_error = null;
  }
  return normalized;
}

function baseBookingResult(booking) {
  return {
    booking_id: booking.booking_id,
    school_id: booking.school_id,
    instructor_id: booking.instructor_id,
    scheduled_date: booking.scheduled_date,
    earned_at: booking.earned_at,
    booking_status: booking.status,
    payout_route: booking.payout_route,
    included: false,
    blocked: false,
    blocker_reason: null,
    review_reason: null,
    earning_status: 'zero_value',
    gross_snapshot_pence: 0,
    stripe_fee_pence: 0,
    instructor_earning_pence: 0,
    platform_fee_pence: 0,
    franchise_fee_pence: 0,
    deposit_deducted_pence: 0,
    shortfall_deducted_pence: 0,
    recovery_deducted_pence: 0,
    net_shadow_transfer_pence: 0,
    funding_classes: [...new Set(booking.sources.map((source) => source.funding_class))],
    funding_allocations: [],
  };
}

function initialBookingResult(booking, normalized) {
  const base = baseBookingResult(booking);
  const block = (reason) => ({
    ...base,
    blocked: true,
    blocker_reason: reason,
    review_reason: reason,
    earning_status: 'blocked',
  });

  if (booking.scope_reason) return block(booking.scope_reason);
  if (normalized.destination_scope_error) return block(normalized.destination_scope_error);
  if (normalized.policy_blocker) return block(normalized.policy_blocker);
  if (booking.existing_v2_earning) return block('booking_already_materialized_v2');
  if (booking.existing_v1_routes.length > 1) return block('booking_claimed_by_both_v1_routes');
  if (booking.existing_v1_routes.length === 1) {
    return block(`booking_already_claimed_v1_${booking.existing_v1_routes[0]}`);
  }
  if (booking.is_test_account) return block('test_account_excluded');
  if (booking.status === SCHEDULED) {
    return { ...base, review_reason: 'scheduled_not_earned' };
  }
  if (booking.status === REFUNDED) {
    return { ...base, review_reason: 'refunded_no_new_earning' };
  }
  return null;
}

function sourceAllocationKey(source) {
  return `${String(source.funding_source_id || 0).padStart(20, '0')}:` +
    `${String(source.booking_credit_source_id || 0).padStart(20, '0')}:` +
    source.funding_class;
}

function planBookingFunding(booking, normalized) {
  const initial = initialBookingResult(booking, normalized);
  if (initial) return initial;

  if (booking.sources.length === 0) {
    if (
      booking.zero_funding_class &&
      ZERO_PAYOUT_FUNDING_CLASSES.has(booking.zero_funding_class)
    ) {
      return {
        ...baseBookingResult({ ...booking, sources: [] }),
        included: true,
        review_reason: 'settled_or_zero_funded_source',
        funding_classes: [booking.zero_funding_class],
      };
    }
    return {
      ...baseBookingResult({ ...booking, sources: [] }),
      blocked: true,
      blocker_reason: 'missing_immutable_funding_source',
      review_reason: 'missing_immutable_funding_source',
      earning_status: 'blocked',
    };
  }

  const invalid = booking.sources.find((source) => source.invalid_reason);
  if (invalid) {
    return {
      ...baseBookingResult(booking),
      blocked: true,
      blocker_reason: invalid.invalid_reason,
      review_reason: invalid.invalid_reason,
      earning_status: 'blocked',
    };
  }
  const manual = booking.sources.find((source) => source.funding_class === 'manual_review');
  if (manual) {
    return {
      ...baseBookingResult(booking),
      blocked: true,
      blocker_reason: 'manual_review_required',
      review_reason: 'manual_review_required',
      earning_status: 'blocked',
    };
  }

  const payableSources = [];
  for (const source of booking.sources) {
    const zeroFunded = ZERO_PAYOUT_FUNDING_CLASSES.has(source.funding_class);
    const gross = zeroFunded ? 0 : source.gross_contribution_pence;
    const stripeFee = zeroFunded ? 0 : source.stripe_fee_contribution_pence;
    const requestedNet = gross - stripeFee;
    const contribution = resolveFundingContribution({
      fundingClass: source.funding_class,
      payablePoolPence: source.payable_pool_pence,
      requestedPence: requestedNet,
      evidence: source.evidence,
    });
    if (contribution.blocked) {
      return {
        ...baseBookingResult(booking),
        blocked: true,
        blocker_reason: contribution.reason,
        review_reason: contribution.reason,
        earning_status: 'blocked',
      };
    }
    payableSources.push({
      ...source,
      gross,
      stripeFee,
      availableNet: contribution.contributionPence,
      key: sourceAllocationKey(source),
    });
  }

  const gross = payableSources.reduce((total, source) => total + source.gross, 0);
  const stripeFee = payableSources.reduce((total, source) => total + source.stripeFee, 0);
  return {
    ...baseBookingResult(booking),
    included: true,
    earning_status: gross === 0 ? 'zero_value' : 'earned',
    gross_snapshot_pence: gross,
    stripe_fee_pence: stripeFee,
    _sources: payableSources,
    _net_pence: gross - stripeFee,
  };
}

function applyCommercialPolicy(results, normalized) {
  const eligible = results.filter((result) => result.included && !result.blocked);
  const positive = eligible.filter((result) => result.gross_snapshot_pence > 0);
  const policy = normalized.policy;

  if (policy.kind === 'franchise') {
    const totalNet = positive.reduce((total, result) => total + result._net_pence, 0);
    const franchiseApplied = Math.min(policy.weekly_franchise_fee_pence, totalNet);
    const allocations = allocatePence(franchiseApplied, positive.map((result) => ({
      key: result.booking_id,
      weight: result._net_pence,
    })));
    positive.forEach((result, index) => {
      result.franchise_fee_pence = allocations[index];
      result.instructor_earning_pence = result._net_pence - allocations[index];
    });
  } else {
    for (const result of positive) {
      if (policy.kind === 'commission') {
        const beforeFee = roundBasisPoints(
          result.gross_snapshot_pence,
          policy.commission_rate_bps
        );
        result.instructor_earning_pence = Math.max(0, beforeFee - result.stripe_fee_pence);
        result.platform_fee_pence =
          result.gross_snapshot_pence -
          result.stripe_fee_pence -
          result.instructor_earning_pence;
      } else {
        result.platform_fee_pence = Math.min(
          roundBasisPoints(result.gross_snapshot_pence, policy.platform_fee_bps),
          result._net_pence
        );
        result.instructor_earning_pence =
          result._net_pence - result.platform_fee_pence;
      }
    }
  }

  const sourceRemaining = new Map();
  for (const result of positive) {
    const sources = result._sources;
    let instructorAllocations;
    let franchiseAllocations;
    let platformAllocations;
    if (policy.kind === 'franchise') {
      franchiseAllocations = allocatePence(
        result.franchise_fee_pence,
        sources.map((source) => ({ key: source.key, weight: source.availableNet }))
      );
      instructorAllocations = sources.map(
        (source, index) => source.availableNet - franchiseAllocations[index]
      );
      platformAllocations = sources.map(() => 0);
    } else {
      instructorAllocations = allocatePence(
        result.instructor_earning_pence,
        sources.map((source) => ({ key: source.key, weight: source.availableNet }))
      );
      franchiseAllocations = sources.map(() => 0);
      platformAllocations = sources.map(
        (source, index) => source.availableNet - instructorAllocations[index]
      );
    }

    const capFailure = sources.find((source, index) => {
      if (source.funding_source_id == null) return false;
      if (!sourceRemaining.has(source.funding_source_id)) {
        sourceRemaining.set(
          source.funding_source_id,
          source.payable_pool_pence - source.already_allocated_pence
        );
      }
      return instructorAllocations[index] > sourceRemaining.get(source.funding_source_id);
    });
    if (capFailure) {
      result.included = false;
      result.blocked = true;
      result.blocker_reason = 'source_payable_pool_exceeded';
      result.review_reason = 'source_payable_pool_exceeded';
      result.earning_status = 'blocked';
      result.instructor_earning_pence = 0;
      result.platform_fee_pence = 0;
      result.franchise_fee_pence = 0;
      result.funding_allocations = [];
      continue;
    }

    result.funding_allocations = sources.map((source, index) => {
      if (source.funding_source_id != null) {
        sourceRemaining.set(
          source.funding_source_id,
          sourceRemaining.get(source.funding_source_id) - instructorAllocations[index]
        );
      }
      const allocationBody = {
        funding_source_id: source.funding_source_id,
        booking_credit_source_id: source.booking_credit_source_id,
        funding_class: source.funding_class,
        source_fingerprint: source.source_fingerprint,
        gross_contribution_pence: source.gross,
        stripe_fee_contribution_pence: source.stripeFee,
        payable_contribution_pence: instructorAllocations[index],
        instructor_earning_contribution_pence: instructorAllocations[index],
        platform_fee_contribution_pence: platformAllocations[index],
        franchise_fee_contribution_pence: franchiseAllocations[index],
      };
      return {
        ...allocationBody,
        allocation_fingerprint: fingerprintPayoutPlan(
          {
            school_id: normalized.school_id,
            booking_id: result.booking_id,
            ...allocationBody,
          },
          PAYOUT_V2_EARNING_CALCULATION_VERSION
        ),
      };
    });
  }

  for (const result of eligible.filter((row) => row.gross_snapshot_pence === 0)) {
    result.funding_allocations = (result._sources || []).map((source) => {
      const allocationBody = {
        funding_source_id: source.funding_source_id,
        booking_credit_source_id: source.booking_credit_source_id,
        funding_class: source.funding_class,
        source_fingerprint: source.source_fingerprint,
        gross_contribution_pence: 0,
        stripe_fee_contribution_pence: 0,
        payable_contribution_pence: 0,
        instructor_earning_contribution_pence: 0,
        platform_fee_contribution_pence: 0,
        franchise_fee_contribution_pence: 0,
      };
      return {
        ...allocationBody,
        allocation_fingerprint: fingerprintPayoutPlan(
          {
            school_id: normalized.school_id,
            booking_id: result.booking_id,
            ...allocationBody,
          },
          PAYOUT_V2_EARNING_CALCULATION_VERSION
        ),
      };
    });
  }
}

function distributeBatchDeduction(results, field, totalPence, availableField) {
  const included = results.filter(
    (result) => result.included && !result.blocked && result[availableField] > 0
  );
  const allocated = allocatePence(totalPence, included.map((result) => ({
    key: result.booking_id,
    weight: result[availableField],
  })));
  included.forEach((result, index) => {
    result[field] = allocated[index];
    result[availableField] -= allocated[index];
  });
}

function applyBatchDeductions(results, normalized) {
  const included = results.filter((result) => result.included && !result.blocked);
  for (const result of included) {
    result.net_shadow_transfer_pence = result.instructor_earning_pence;
  }
  let available = included.reduce(
    (total, result) => total + result.instructor_earning_pence,
    0
  );
  const depositDeducted = 0;
  let shortfallDeducted = 0;
  let outstandingShortfall = 0;

  if (normalized.policy.kind === 'franchise') {
    if (normalized.policy.prior_shortfall_pence > 0) {
      if (available >= normalized.policy.prior_shortfall_pence) {
        shortfallDeducted = normalized.policy.prior_shortfall_pence;
        available -= shortfallDeducted;
      } else {
        outstandingShortfall += normalized.policy.prior_shortfall_pence;
      }
    }
    const appliedFranchise = included.reduce(
      (total, result) => total + result.franchise_fee_pence,
      0
    );
    outstandingShortfall +=
      normalized.policy.weekly_franchise_fee_pence - appliedFranchise;
    distributeBatchDeduction(
      included,
      'shortfall_deducted_pence',
      shortfallDeducted,
      'net_shadow_transfer_pence'
    );
  }

  let recoveryPlan = {
    availableBeforeRecoveryPence: available,
    recoveryDeductedPence: 0,
    instructorTransferPence: available,
    outstandingBeforePence: 0,
    outstandingAfterPence: 0,
    allocations: [],
    planFingerprint: fingerprintPayoutPlan(
      {
        availableBeforeRecoveryPence: available,
        recoveries: [],
      },
      PAYOUT_V2_EARNING_CALCULATION_VERSION
    ),
  };
  if (normalized.payout_route === 'instructor_direct') {
    recoveryPlan = planFullOffsetRecovery({
      availablePence: available,
      recoveries: normalized.recoveries,
    });
    distributeBatchDeduction(
      included,
      'recovery_deducted_pence',
      recoveryPlan.recoveryDeductedPence,
      'net_shadow_transfer_pence'
    );
  }

  return {
    deposit_deducted_pence: depositDeducted,
    shortfall_deducted_pence: shortfallDeducted,
    outstanding_shortfall_pence: outstandingShortfall,
    recovery: recoveryPlan,
  };
}

function finalizeBooking(result, normalized) {
  delete result._sources;
  delete result._net_pence;
  const calculationBody = {
    school_id: result.school_id,
    booking_id: result.booking_id,
    instructor_id: result.instructor_id,
    payout_route: result.payout_route,
    booking_status: result.booking_status,
    earned_at: result.earned_at,
    included: result.included,
    blocked: result.blocked,
    blocker_reason: result.blocker_reason,
    gross_snapshot_pence: result.gross_snapshot_pence,
    stripe_fee_pence: result.stripe_fee_pence,
    instructor_earning_pence: result.instructor_earning_pence,
    platform_fee_pence: result.platform_fee_pence,
    franchise_fee_pence: result.franchise_fee_pence,
    deposit_deducted_pence: result.deposit_deducted_pence,
    shortfall_deducted_pence: result.shortfall_deducted_pence,
    recovery_deducted_pence: result.recovery_deducted_pence,
    net_shadow_transfer_pence: result.net_shadow_transfer_pence,
    policy: normalized.policy,
    funding_allocations: result.funding_allocations,
  };
  result.calculation_version = PAYOUT_V2_EARNING_CALCULATION_VERSION;
  result.calculation_fingerprint = fingerprintPayoutPlan(
    calculationBody,
    PAYOUT_V2_EARNING_CALCULATION_VERSION
  );
  result.calculation_json = calculationBody;
  return result;
}

function planPayoutV2Earnings(input) {
  const normalized = normalizeInput(input);
  const inputFingerprint = fingerprintPayoutPlan(
    normalized,
    PAYOUT_V2_EARNING_CALCULATION_VERSION
  );
  const results = normalized.bookings.map(
    (booking) => planBookingFunding(booking, normalized)
  );
  applyCommercialPolicy(results, normalized);
  const deductions = applyBatchDeductions(results, normalized);
  const bookings = results.map((result) => finalizeBooking(result, normalized));
  const included = bookings.filter((booking) => booking.included && !booking.blocked);
  const totals = {
    gross_pence: included.reduce((total, booking) => total + booking.gross_snapshot_pence, 0),
    stripe_fees_pence: included.reduce((total, booking) => total + booking.stripe_fee_pence, 0),
    platform_fee_pence: included.reduce((total, booking) => total + booking.platform_fee_pence, 0),
    franchise_fee_pence: included.reduce((total, booking) => total + booking.franchise_fee_pence, 0),
    deposit_deducted_pence: deductions.deposit_deducted_pence,
    shortfall_deducted_pence: deductions.shortfall_deducted_pence,
    recovery_deducted_pence: deductions.recovery.recoveryDeductedPence,
    net_shadow_transfer_pence: deductions.recovery.instructorTransferPence,
    outstanding_shortfall_pence: deductions.outstanding_shortfall_pence,
    remaining_recovery_pence: deductions.recovery.outstandingAfterPence,
  };
  const conserved =
    totals.gross_pence ===
      totals.stripe_fees_pence +
      totals.platform_fee_pence +
      totals.franchise_fee_pence +
      totals.deposit_deducted_pence +
      totals.shortfall_deducted_pence +
      totals.recovery_deducted_pence +
      totals.net_shadow_transfer_pence;
  if (!conserved) throw new Error('Payout v2 plan failed exact pence conservation');

  const body = {
    calculation_version: PAYOUT_V2_EARNING_CALCULATION_VERSION,
    input_fingerprint: inputFingerprint,
    school_id: normalized.school_id,
    payout_route: normalized.payout_route,
    destination_instructor_id: normalized.destination_instructor_id,
    destination_school_id: normalized.destination_school_id,
    period_start: normalized.period_start,
    period_end: normalized.period_end,
    policy: normalized.policy,
    totals,
    recovery_plan_fingerprint: deductions.recovery.planFingerprint,
    recovery_allocations: deductions.recovery.allocations,
    bookings,
  };
  return {
    ...body,
    plan_fingerprint: fingerprintPayoutPlan(
      body,
      PAYOUT_V2_EARNING_CALCULATION_VERSION
    ),
    blocked_booking_count: bookings.filter((booking) => booking.blocked).length,
    included_booking_count: included.length,
    exact_pence_conservation: conserved,
    normalized_input: normalized,
  };
}

module.exports = {
  PAYOUT_V2_EARNING_CALCULATION_VERSION,
  PAYOUT_ROUTES,
  POLICY_KINDS,
  roundBasisPoints,
  allocatePence,
  planPayoutV2Earnings,
};
