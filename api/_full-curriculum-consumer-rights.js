'use strict';

const crypto = require('crypto');
const { zonedDateTimeToDate } = require('./_full-curriculum');

const CONSUMER_RIGHTS_POLICY_VERSION = 'full-curriculum-consumer-rights-v1';
const CONSUMER_RIGHTS_DISCLOSURE_VERSION = 'full-curriculum-checkout-disclosure-v1';
const REFUND_CALCULATION_VERSION = 'full-curriculum-refund-v1';
const PILOT_CERTIFICATION_VERSION = 'full-curriculum-owner-self-certification-v1';
const OWNER_CERTIFIED_TERMS_VERSION = 'full-curriculum-owner-certified-v1';
const COOLING_OFF_DAYS = 14;

const CHECKOUT_ACKNOWLEDGEMENT = 'I have read the Full Curriculum terms, cancellation policy and withdrawal calculation supplied at checkout.';
const EARLY_START_REQUEST = 'I expressly ask CoachCarter to begin matching and, if arranged, provide teaching and assessment services during my 14-day cancellation period. I understand that if I cancel after services have been supplied, CoachCarter may deduct the proportionate value of those services using the values in my purchased terms. Matching, administration and Stripe fees have no deductible value. I lose my cancellation right only if the entire programme is fully performed during that period.';
const DEFERRED_START_REQUEST = 'I want matching to begin after my 14-day cancellation period. The seven-day matching deadline will run from that date.';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function localDateParts(value, timezone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const mapped = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { year: Number(mapped.year), month: Number(mapped.month), day: Number(mapped.day) };
}

// Exclusive boundary. A contract formed at any time on 1 August can be
// cancelled through the end of 15 August; service may begin at local midnight
// on 16 August when early start was not requested.
function coolingOffExpiresAt(contractFormedAt, timezone = 'Europe/London') {
  const local = localDateParts(contractFormedAt, timezone);
  if (!local) return null;
  const target = new Date(Date.UTC(local.year, local.month - 1, local.day + COOLING_OFF_DAYS + 1));
  const date = target.toISOString().slice(0, 10);
  return zonedDateTimeToDate(date, '00:00', timezone);
}

function normaliseConsumerRightsConfig(content, amountPence) {
  const rights = content?.consumer_rights;
  const amount = positiveInteger(amountPence);
  if (!rights || typeof rights !== 'object' || Array.isArray(rights) || !amount) {
    return { ok: false, code: 'CONSUMER_RIGHTS_CONFIG_MISSING' };
  }
  const teaching = rights.teaching_deductions;
  const assessment = rights.assessment_deductions;
  const base90 = positiveInteger(teaching?.base_90_minutes_pence);
  const baseCap = positiveInteger(teaching?.base_cap_pence);
  const retake90 = positiveInteger(teaching?.retake_90_minutes_pence);
  const retake120 = positiveInteger(teaching?.retake_120_minutes_pence);
  const retakeCap = positiveInteger(teaching?.retake_cap_pence);
  const assessmentEach = positiveInteger(assessment?.each_completed_pence);
  const assessmentCap = positiveInteger(assessment?.cap_pence);
  const matchingAdmin = nonNegativeInteger(rights.matching_admin_deduction_pence);
  const stripeFee = nonNegativeInteger(rights.stripe_fee_customer_deduction_pence);
  const caps = [baseCap, retakeCap, assessmentCap];
  if (
    rights.policy_version !== CONSUMER_RIGHTS_POLICY_VERSION
    || rights.disclosure_version !== CONSUMER_RIGHTS_DISCLOSURE_VERSION
    || rights.refund_calculation_version !== REFUND_CALCULATION_VERSION
    || rights.valuation_basis !== 'purchase_price_allocation'
    || rights.rounding_rule !== 'whole_pence_deductions_down'
    || Number(rights.cooling_off_days) !== COOLING_OFF_DAYS
    || matchingAdmin !== 0
    || stripeFee !== 0
    || !base90 || !baseCap || !retake90 || !retake120 || !retakeCap
    || !assessmentEach || !assessmentCap
    || base90 > baseCap || retake90 > retakeCap || retake120 > retakeCap
    || assessmentEach > assessmentCap
    || caps.some(value => value > amount)
    || caps.reduce((sum, value) => sum + value, 0) > amount
  ) {
    return { ok: false, code: 'CONSUMER_RIGHTS_CONFIG_INVALID' };
  }
  return {
    ok: true,
    config: {
      policyVersion: rights.policy_version,
      disclosureVersion: rights.disclosure_version,
      refundCalculationVersion: rights.refund_calculation_version,
      coolingOffDays: COOLING_OFF_DAYS,
      valuationBasis: rights.valuation_basis,
      roundingRule: rights.rounding_rule,
      matchingAdminDeductionPence: 0,
      stripeFeeCustomerDeductionPence: 0,
      base90Pence: base90,
      baseCapPence: baseCap,
      retake90Pence: retake90,
      retake120Pence: retake120,
      retakeCapPence: retakeCap,
      assessmentEachPence: assessmentEach,
      assessmentCapPence: assessmentCap,
    },
  };
}

function buildConsumerContractSnapshot({
  amountPence,
  currency = 'GBP',
  customerTermsVersion,
  config,
  earlyStartRequested,
  adultAgeConfirmed,
}) {
  if (typeof earlyStartRequested !== 'boolean' || adultAgeConfirmed !== true) return null;
  const snapshot = {
    policy_version: config.policyVersion,
    disclosure_version: config.disclosureVersion,
    refund_calculation_version: config.refundCalculationVersion,
    customer_terms_version: String(customerTermsVersion),
    amount_pence: Number(amountPence),
    currency: String(currency).toUpperCase(),
    cooling_off_days: COOLING_OFF_DAYS,
    matching_admin_deduction_pence: 0,
    stripe_fee_customer_deduction_pence: 0,
    checkout_acknowledgement: CHECKOUT_ACKNOWLEDGEMENT,
    adult_age_confirmed: true,
    early_start_requested: earlyStartRequested,
    start_request_text: earlyStartRequested ? EARLY_START_REQUEST : DEFERRED_START_REQUEST,
    valuation: {
      basis: config.valuationBasis,
      rounding_rule: config.roundingRule,
      teaching_deductions: {
        base_90_minutes_pence: config.base90Pence,
        base_cap_pence: config.baseCapPence,
        retake_90_minutes_pence: config.retake90Pence,
        retake_120_minutes_pence: config.retake120Pence,
        retake_cap_pence: config.retakeCapPence,
      },
      assessment_deductions: {
        each_completed_pence: config.assessmentEachPence,
        cap_pence: config.assessmentCapPence,
      },
    },
  };
  const encoded = JSON.stringify(snapshot);
  return {
    snapshot,
    snapshotSha256: sha256(encoded),
    acknowledgementSha256: sha256(CHECKOUT_ACKNOWLEDGEMENT),
    startRequestSha256: sha256(snapshot.start_request_text),
  };
}

function cappedLine({ type, units, unitPence, capPence }) {
  const safeUnits = nonNegativeInteger(units) || 0;
  const gross = safeUnits * unitPence;
  return {
    line_type: type,
    quantity: safeUnits,
    unit_value_pence: unitPence,
    cap_pence: capPence,
    deduction_pence: Math.min(gross, capPence),
  };
}

function calculateRefund(input) {
  const amountPence = positiveInteger(input.amountPence);
  const previousRefundPence = nonNegativeInteger(input.previousRefundPence);
  if (!amountPence || previousRefundPence == null || previousRefundPence > amountPence || !input.config) {
    return { ok: false, blocked: true, code: 'REFUND_INPUT_INVALID' };
  }
  const remainingCashPence = amountPence - previousRefundPence;
  const statutoryCancellation = input.classification === 'cooling_off_cancellation';
  const fullRefund = input.classification === 'matching_failure'
    || (statutoryCancellation && input.validEarlyStartRequest !== true);
  const includeLateCancellation = input.classification === 'voluntary_withdrawal';
  const lines = [];

  if (!fullRefund) {
    lines.push(cappedLine({
      type: 'base_teaching',
      units: (nonNegativeInteger(input.baseDeliveredCount) || 0)
        + (includeLateCancellation ? (nonNegativeInteger(input.baseLateCancelledCount) || 0) : 0),
      unitPence: input.config.base90Pence,
      capPence: input.config.baseCapPence,
    }));
    const retake90 = cappedLine({
      type: 'retake_teaching_90',
      units: input.retake90DeliveredCount,
      unitPence: input.config.retake90Pence,
      capPence: input.config.retakeCapPence,
    });
    const retake120 = cappedLine({
      type: 'retake_teaching_120',
      units: input.retake120DeliveredCount,
      unitPence: input.config.retake120Pence,
      capPence: input.config.retakeCapPence,
    });
    const combinedRetake = Math.min(
      retake90.deduction_pence + retake120.deduction_pence,
      input.config.retakeCapPence
    );
    lines.push({
      line_type: 'retake_teaching',
      quantity: retake90.quantity + retake120.quantity,
      unit_value_pence: null,
      cap_pence: input.config.retakeCapPence,
      deduction_pence: combinedRetake,
      detail: {
        ninety_minute_count: retake90.quantity,
        ninety_minute_value_pence: input.config.retake90Pence,
        one_hundred_twenty_minute_count: retake120.quantity,
        one_hundred_twenty_minute_value_pence: input.config.retake120Pence,
      },
    });
    lines.push(cappedLine({
      type: 'completed_assessment',
      units: input.assessmentCompletedCount,
      unitPence: input.config.assessmentEachPence,
      capPence: input.config.assessmentCapPence,
    }));
  }

  lines.push({
    line_type: 'matching_admin', quantity: 1, unit_value_pence: 0,
    cap_pence: 0, deduction_pence: 0,
  });
  lines.push({
    line_type: 'stripe_fee', quantity: 1, unit_value_pence: 0,
    cap_pence: 0, deduction_pence: 0,
  });
  const uncappedDeductionPence = lines.reduce((sum, line) => sum + line.deduction_pence, 0);
  const deductionPence = Math.min(remainingCashPence, uncappedDeductionPence);
  return {
    ok: true,
    blocked: false,
    calculation_version: input.config.refundCalculationVersion,
    classification: input.classification,
    original_payment_pence: amountPence,
    previous_refund_pence: previousRefundPence,
    remaining_cash_pence: remainingCashPence,
    deduction_pence: deductionPence,
    refund_due_pence: remainingCashPence - deductionPence,
    original_stripe_fee_customer_deduction_pence: 0,
    lines,
  };
}

module.exports = {
  CHECKOUT_ACKNOWLEDGEMENT,
  CONSUMER_RIGHTS_DISCLOSURE_VERSION,
  CONSUMER_RIGHTS_POLICY_VERSION,
  COOLING_OFF_DAYS,
  DEFERRED_START_REQUEST,
  EARLY_START_REQUEST,
  REFUND_CALCULATION_VERSION,
  PILOT_CERTIFICATION_VERSION,
  OWNER_CERTIFIED_TERMS_VERSION,
  buildConsumerContractSnapshot,
  calculateRefund,
  coolingOffExpiresAt,
  normaliseConsumerRightsConfig,
  sha256,
};
