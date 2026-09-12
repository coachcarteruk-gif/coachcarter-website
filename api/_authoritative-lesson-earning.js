'use strict';

const CALCULATION_VERSION = 'authoritative-lesson-earning/1';

function integer(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function roundBasisPoints(amountPence, basisPoints) {
  const amount = integer(amountPence);
  const bps = integer(basisPoints);
  if (amount == null || amount < 0) throw new TypeError('amountPence must be non-negative integer pence');
  if (bps == null || bps < 0 || bps > 10000) throw new TypeError('basisPoints must be between 0 and 10000');
  return Number((BigInt(amount) * BigInt(bps) + 5000n) / 10000n);
}

// Unit ordinal zero receives the first remainder penny. This makes the split
// independent of query order and guarantees that all immutable units sum to
// the source total exactly.
function allocatePenceToUnitRange(totalPence, totalUnits, startUnit, unitCount) {
  const total = integer(totalPence);
  const units = integer(totalUnits);
  const start = integer(startUnit);
  const count = integer(unitCount);
  if (total == null || total < 0 || units == null || units <= 0
      || start == null || start < 0 || count == null || count < 0
      || start + count > units) {
    throw new TypeError('Invalid immutable unit allocation');
  }
  const base = Math.floor(total / units);
  const remainder = total % units;
  const bonusStart = Math.min(start, remainder);
  const bonusEnd = Math.min(start + count, remainder);
  return base * count + Math.max(0, bonusEnd - bonusStart);
}

function commissionBasisPoints(instructor) {
  if (instructor?.commission_rate === null || instructor?.commission_rate === undefined
      || instructor?.commission_rate === '') return null;
  const raw = Number(instructor?.commission_rate);
  const bps = Math.round(raw * 10000);
  if (!Number.isFinite(raw) || bps < 0 || bps > 10000) return null;
  return bps;
}

function validInstant(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function earningFromValueBasis(basis, commissionBps) {
  if (!basis || typeof basis !== 'object') return { ok: false, reason: 'FUNDING_BASIS_MISSING' };
  const semantics = basis.value_semantics;
  if (semantics === 'gross_customer_revenue') {
    const gross = integer(basis.gross_pence);
    const fee = integer(basis.actual_processing_fee_pence);
    if (gross == null || gross < 0 || fee == null || fee < 0 || fee > gross) {
      return { ok: false, reason: 'AUDITED_GROSS_BASIS_INVALID' };
    }
    if ((basis.payment_processor === 'stripe' || fee > 0)
        && !basis.processing_fee_evidence_reference) {
      return { ok: false, reason: 'ACTUAL_PROCESSING_FEE_EVIDENCE_MISSING' };
    }
    if (basis.payment_processor === 'none' && fee !== 0) {
      return { ok: false, reason: 'NON_STRIPE_FEE_REQUIRES_PROCESSOR_EVIDENCE' };
    }
    const net = gross - fee;
    return {
      ok: true,
      gross_pence: gross,
      processing_fee_pence: fee,
      net_attributable_revenue_pence: net,
      instructor_amount_pence: roundBasisPoints(net, commissionBps),
      value_semantics: semantics,
    };
  }
  if (semantics === 'net_after_processing') {
    const net = integer(basis.net_pence);
    if (net == null || net < 0) return { ok: false, reason: 'AUDITED_NET_BASIS_INVALID' };
    return {
      ok: true,
      gross_pence: null,
      processing_fee_pence: null,
      net_attributable_revenue_pence: net,
      instructor_amount_pence: roundBasisPoints(net, commissionBps),
      value_semantics: semantics,
    };
  }
  if (semantics === 'final_instructor_payable') {
    const finalAmount = integer(basis.final_instructor_payable_pence);
    if (finalAmount == null || finalAmount < 0) {
      return { ok: false, reason: 'AUDITED_FINAL_PAYABLE_BASIS_INVALID' };
    }
    return {
      ok: true,
      gross_pence: null,
      processing_fee_pence: null,
      net_attributable_revenue_pence: null,
      instructor_amount_pence: finalAmount,
      value_semantics: semantics,
      commission_already_applied: true,
    };
  }
  return { ok: false, reason: 'LEGACY_VALUE_CLASSIFICATION_REQUIRED' };
}

function packageEvidence(entry) {
  const evidence = entry?.evidence_json;
  const gross = integer(entry?.original_value_pence);
  const fee = integer(evidence?.feePence);
  const legacyChargeChain = typeof evidence?.chargeId === 'string'
    && evidence.chargeId.startsWith('ch_')
    && evidence.balanceTransactionType === 'charge';
  const paymentObjectChain = evidence?.evidenceSchema === 'payout-flexible-source-evidence/2'
    && evidence.paymentObjectType === 'payment'
    && typeof evidence.chargeId === 'string'
    && evidence.chargeId.startsWith('py_')
    && evidence.balanceTransactionType === 'payment';
  if (entry?.legacy_conversion) return { ok: false, reason: 'LEGACY_VALUE_CLASSIFICATION_REQUIRED' };
  if (entry?.evidence_status !== 'complete') {
    return { ok: false, reason: entry?.evidence_status === 'contradictory'
      ? 'FLEXIBLE_SOURCE_EVIDENCE_CONTRADICTORY' : 'FLEXIBLE_SOURCE_EVIDENCE_INCOMPLETE' };
  }
  if (!evidence || evidence.source !== 'balance_transaction'
      || evidence.currency !== 'gbp' || gross == null || gross <= 0
      || integer(evidence.amountPence) !== gross || fee == null || fee < 0 || fee > gross
      || evidence.providerLivemode !== true
      || evidence.paymentIntentStatus !== 'succeeded'
      || evidence.chargePaid !== true || evidence.chargeCaptured !== true
      || evidence.chargePaymentIntentId !== evidence.paymentIntentId
      || (!legacyChargeChain && !paymentObjectChain)
      || typeof evidence.balanceTransactionId !== 'string'
      || !evidence.balanceTransactionId.startsWith('txn_')
      || evidence.balanceTransactionSourceId !== evidence.chargeId
      || integer(evidence.balanceTransactionAmountPence) !== gross
      || evidence.balanceTransactionCurrency !== 'gbp'
      || !['available', 'pending'].includes(evidence.balanceTransactionStatus)
      || !validInstant(evidence.fundsAvailableAt)) {
    return { ok: false, reason: 'FLEXIBLE_SOURCE_EVIDENCE_INVALID' };
  }
  return { ok: true, gross_pence: gross, fee_pence: fee, funds_available_at: evidence.fundsAvailableAt };
}

function calculateFlexibleFunding(entries, expectedDurationMinutes, commissionBps, now = new Date()) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, reason: 'FLEXIBLE_ALLOCATION_MISSING' };
  }
  let allocatedMinutes = 0;
  let gross = 0;
  let fee = 0;
  const fundingLines = [];
  for (const entry of entries) {
    const units = integer(entry.units_allocated);
    const unitMinutes = integer(entry.unit_minutes);
    const totalUnits = integer(entry.initial_units);
    const startUnit = integer(entry.preceding_active_units);
    if (units == null || units <= 0 || unitMinutes == null || unitMinutes <= 0
        || totalUnits == null || totalUnits <= 0 || startUnit == null || startUnit < 0
        || startUnit + units > totalUnits) {
      return { ok: false, reason: 'FLEXIBLE_UNIT_ALLOCATION_INVALID' };
    }
    const exact = packageEvidence(entry);
    if (!exact.ok) return exact;
    if (validInstant(exact.funds_available_at) > now) {
      return { ok: false, reason: 'FUNDS_NOT_AVAILABLE' };
    }
    const allocatedGross = allocatePenceToUnitRange(exact.gross_pence, totalUnits, startUnit, units);
    const allocatedFee = allocatePenceToUnitRange(exact.fee_pence, totalUnits, startUnit, units);
    const contribution = integer(entry.contribution_pence);
    if (contribution == null || contribution !== allocatedGross) {
      return { ok: false, reason: 'FLEXIBLE_GROSS_ALLOCATION_CONTRADICTORY' };
    }
    allocatedMinutes += units * unitMinutes;
    gross += allocatedGross;
    fee += allocatedFee;
    fundingLines.push({
      funding_class: 'flexible_package_stripe',
      source_id: Number(entry.source_id),
      allocation_id: Number(entry.allocation_id),
      start_unit: startUnit,
      units,
      gross_pence: allocatedGross,
      processing_fee_pence: allocatedFee,
      source_evidence_id: entry.source_evidence_id || null,
    });
  }
  if (allocatedMinutes !== expectedDurationMinutes) {
    return { ok: false, reason: 'FLEXIBLE_ALLOCATION_DURATION_MISMATCH' };
  }
  const net = gross - fee;
  return {
    ok: true,
    gross_pence: gross,
    processing_fee_pence: fee,
    net_attributable_revenue_pence: net,
    instructor_amount_pence: roundBasisPoints(net, commissionBps),
    value_semantics: 'gross_customer_revenue',
    funding_lines: fundingLines,
  };
}

function directStripeFunding(row, commissionBps) {
  if (!row.evidence_id) {
    if (Number(row.bcs_count) === 0) return { ok: false, reason: 'NO_FUNDING_SOURCE' };
    return { ok: false, reason: 'EXACT_STRIPE_EVIDENCE_MISSING' };
  }
  if (row.evidence_status === 'pending') return { ok: false, reason: 'STRIPE_EVIDENCE_PENDING' };
  if (row.evidence_status === 'contradictory') return { ok: false, reason: 'STRIPE_EVIDENCE_CONTRADICTORY' };
  if (row.evidence_status !== 'complete') return { ok: false, reason: 'STRIPE_EVIDENCE_INCOMPLETE' };
  if (row.payment_origin !== 'direct_slot') return { ok: false, reason: 'UNAPPROVED_PAYMENT_ORIGIN' };
  if (row.provider_livemode !== true) return { ok: false, reason: 'TEST_MODE_STRIPE_SOURCE' };
  if (Number(row.bcs_count) !== 1) return { ok: false, reason: 'FUNDING_SOURCE_NOT_ONE_TO_ONE' };
  if (row.bcs_refunded_at) return { ok: false, reason: 'FUNDING_SOURCE_REFUNDED' };
  if (row.ct_type !== 'slot_purchase' || row.ct_source !== 'stripe' || row.ct_payment_method !== 'card') {
    return { ok: false, reason: 'UNAPPROVED_LEDGER_SOURCE' };
  }
  if ((row.ct_instructor_id != null || row.ct_learner_id != null)
      && (Number(row.ct_instructor_id) !== Number(row.instructor_id)
        || Number(row.ct_learner_id) !== Number(row.learner_id))) {
    return { ok: false, reason: 'FUNDING_SCOPE_MISMATCH' };
  }
  const sessionId = typeof row.stripe_checkout_session_id === 'string' && row.stripe_checkout_session_id.startsWith('cs_');
  const paymentIntentId = typeof row.stripe_payment_intent_id === 'string' && row.stripe_payment_intent_id.startsWith('pi_');
  const chargeId = typeof row.stripe_charge_id === 'string' && row.stripe_charge_id.startsWith('ch_');
  const balanceId = typeof row.stripe_balance_transaction_id === 'string' && row.stripe_balance_transaction_id.startsWith('txn_');
  if (!sessionId || !paymentIntentId || !chargeId || !balanceId) {
    return { ok: false, reason: 'STRIPE_IDENTITY_INCOMPLETE' };
  }
  if (row.stripe_payment_intent_status !== 'succeeded' || row.stripe_charge_paid !== true
      || row.stripe_charge_captured !== true
      || row.stripe_charge_payment_intent_id !== row.stripe_payment_intent_id
      || row.stripe_balance_transaction_source_id !== row.stripe_charge_id
      || row.stripe_balance_transaction_type !== 'charge'
      || !['available', 'pending'].includes(row.stripe_balance_transaction_status)) {
    return { ok: false, reason: 'STRIPE_PAYMENT_CHAIN_MISMATCH' };
  }
  const gross = integer(row.gross_collected_pence);
  const fee = integer(row.stripe_fee_pence);
  if (gross == null || gross <= 0 || fee == null || fee < 0 || fee > gross) {
    return { ok: false, reason: 'AMOUNT_EVIDENCE_INVALID' };
  }
  if (row.currency !== 'gbp'
      || integer(row.stripe_balance_transaction_amount_pence) !== gross
      || row.stripe_balance_transaction_currency !== 'gbp') {
    return { ok: false, reason: 'BALANCE_TRANSACTION_MISMATCH' };
  }
  if (integer(row.ct_amount_pence) !== gross || integer(row.bcs_contribution_pence) !== gross) {
    return { ok: false, reason: 'GROSS_MISMATCH' };
  }
  if (integer(row.ct_stripe_fee_pence) !== fee || integer(row.bcs_stripe_fee_pence) !== fee) {
    return { ok: false, reason: 'FEE_MISMATCH' };
  }
  if (row.ct_session_id !== row.stripe_checkout_session_id
      || row.ct_payment_intent_id !== row.stripe_payment_intent_id) {
    return { ok: false, reason: 'LEDGER_IDENTITY_MISMATCH' };
  }
  if (!validInstant(row.stripe_funds_available_at)) {
    return { ok: false, reason: 'FUNDS_AVAILABILITY_EVIDENCE_MISSING' };
  }
  const net = gross - fee;
  return {
    ok: true,
    reason: 'EXACT_DIRECT_SLOT_STRIPE',
    gross_pence: gross,
    processing_fee_pence: fee,
    net_attributable_revenue_pence: net,
    instructor_amount_pence: roundBasisPoints(net, commissionBps),
    value_semantics: 'gross_customer_revenue',
    funding_lines: [{
      funding_class: 'direct_stripe',
      funding_evidence_id: row.evidence_id,
      gross_pence: gross,
      processing_fee_pence: fee,
    }],
  };
}

function calculateAuthoritativeLessonEarning(row, instructor, now = new Date()) {
  const reject = (reason) => ({ eligible: false, blocked: true, reason, calculation_version: CALCULATION_VERSION });
  if (Number(row.school_id) !== Number(instructor?.school_id)
      || Number(row.instructor_id) !== Number(instructor?.id)) return reject('PAYOUT_SCOPE_MISMATCH');
  if (row.status !== 'chargeable') return reject('BOOKING_NOT_CHARGEABLE');
  if (row.is_test_account === true) return reject('TEST_ACCOUNT');
  const bookingEnd = row.booking_ends_at ? new Date(row.booking_ends_at) : null;
  const periodStart = row.settled_before_at ? new Date(row.settled_before_at) : null;
  const periodEnd = row.first_system_period_end_at ? new Date(row.first_system_period_end_at) : null;
  if (!bookingEnd || Number.isNaN(bookingEnd.getTime())) return reject('BOOKING_END_INSTANT_MISSING');
  if (!periodStart || !periodEnd || Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return reject('MANUAL_SETTLEMENT_BOUNDARY_MISSING');
  }
  if (bookingEnd < periodStart) return reject('MANUALLY_SETTLED_BEFORE_CUTOFF');
  if (bookingEnd >= periodEnd) return reject('AFTER_FIRST_SYSTEM_PERIOD');
  if (row.claimed_payout_id) return reject('ALREADY_CLAIMED');
  const bps = commissionBasisPoints(instructor);
  if (bps == null) return reject('COMMISSION_POLICY_INVALID');

  let calculated;
  if (row.audited_basis_id) {
    calculated = earningFromValueBasis(row, bps);
    if (calculated.ok) {
      calculated.reason = 'AUDITED_FUNDING_BASIS';
      calculated.funding_lines = [{
        funding_class: row.funding_class,
        funding_basis_id: row.audited_basis_id,
        value_semantics: row.value_semantics,
        gross_pence: calculated.gross_pence,
        processing_fee_pence: calculated.processing_fee_pence,
      }];
    }
  } else if (Array.isArray(row.flexible_sources) && row.flexible_sources.length) {
    calculated = calculateFlexibleFunding(row.flexible_sources, Number(row.duration_minutes), bps, now);
    if (calculated.ok) calculated.reason = 'EXACT_FLEXIBLE_PACKAGE_ALLOCATION';
  } else if (row.bcs_absorbed_by === 'instructor') {
    calculated = { ok: false, reason: 'INSTRUCTOR_GOODWILL_REQUIRES_AUDITED_CORRECTION' };
  } else {
    calculated = directStripeFunding(row, bps);
  }
  if (!calculated.ok) return reject(calculated.reason);
  if (calculated.processing_fee_pence != null && calculated.gross_pence != null
      && calculated.processing_fee_pence > calculated.gross_pence) {
    return reject('PROCESSING_FEE_EXCEEDS_REVENUE');
  }
  if (validInstant(row.stripe_funds_available_at) > now
      && calculated.reason === 'EXACT_DIRECT_SLOT_STRIPE') return reject('FUNDS_NOT_AVAILABLE');
  return {
    eligible: true,
    blocked: false,
    reason: calculated.reason,
    calculation_version: CALCULATION_VERSION,
    commission_rate_bps: bps,
    gross_pence: calculated.gross_pence,
    stripe_fee_pence: calculated.processing_fee_pence,
    net_after_stripe_pence: calculated.net_attributable_revenue_pence,
    instructor_amount_pence: calculated.instructor_amount_pence,
    value_semantics: calculated.value_semantics,
    commission_already_applied: calculated.commission_already_applied === true,
    funding_lines: calculated.funding_lines || [],
  };
}

module.exports = {
  CALCULATION_VERSION,
  allocatePenceToUnitRange,
  calculateAuthoritativeLessonEarning,
  calculateFlexibleFunding,
  commissionBasisPoints,
  earningFromValueBasis,
  roundBasisPoints,
};
