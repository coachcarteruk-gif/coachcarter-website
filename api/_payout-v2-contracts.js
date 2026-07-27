const crypto = require('crypto');

const PAYOUT_V2_CALCULATION_VERSION = 'payout-v2-ledger-foundation-v1';
const PAYOUT_V2_SOURCE_INGESTION_VERSION = 'payout-v2-source-ingestion-v1';

const FUNDING_CLASSES = Object.freeze([
  'stripe_backed',
  'legacy_pre_connect_settled',
  'platform_goodwill',
  'instructor_goodwill',
  'external_cash_payable',
  'external_cash_settled',
  'free',
  'manual_review',
]);

const ZERO_PAYOUT_FUNDING_CLASSES = new Set([
  'legacy_pre_connect_settled',
  'instructor_goodwill',
  'external_cash_settled',
  'free',
]);

function canonicalize(value, path = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must not contain a non-finite number`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError(`${path} contains an invalid Date`);
    }
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  }
  if (typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) {
        throw new TypeError(`${path}.${key} must not be undefined`);
      }
      output[key] = canonicalize(value[key], `${path}.${key}`);
    }
    return output;
  }
  throw new TypeError(`${path} contains unsupported type ${typeof value}`);
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function fingerprintPayoutPlan(plan, calculationVersion = PAYOUT_V2_CALCULATION_VERSION) {
  if (!calculationVersion || typeof calculationVersion !== 'string') {
    throw new TypeError('calculationVersion must be a non-empty string');
  }
  const payload = canonicalJson({
    calculation_version: calculationVersion,
    plan,
  });
  return `sha256:${crypto.createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

function requirePence(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer in pence`);
  }
}

function hasStripeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return false;
  return [
    evidence.stripe_checkout_session_id,
    evidence.stripe_payment_intent_id,
    evidence.stripe_charge_id,
    evidence.stripe_balance_transaction_id,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
}

/**
 * Resolve the maximum source-backed instructor contribution.
 *
 * This contract deliberately has no lesson-price input. A current/live lesson
 * price is never funding evidence and cannot turn an unknown or settled source
 * into a positive payout.
 */
function resolveFundingContribution({
  fundingClass,
  payablePoolPence,
  requestedPence,
  evidence = {},
}) {
  requirePence(payablePoolPence, 'payablePoolPence');
  requirePence(requestedPence, 'requestedPence');

  if (!FUNDING_CLASSES.includes(fundingClass)) {
    return {
      contributionPence: 0,
      blocked: true,
      reason: 'unknown_funding_class',
    };
  }

  if (ZERO_PAYOUT_FUNDING_CLASSES.has(fundingClass)) {
    return {
      contributionPence: 0,
      blocked: false,
      reason: 'settled_or_zero_funded_source',
    };
  }

  if (fundingClass === 'manual_review') {
    return {
      contributionPence: 0,
      blocked: true,
      reason: 'manual_review_required',
    };
  }

  if (fundingClass === 'stripe_backed' && !hasStripeEvidence(evidence)) {
    return {
      contributionPence: 0,
      blocked: true,
      reason: 'missing_stripe_funding_evidence',
    };
  }

  if (
    (fundingClass === 'platform_goodwill' || fundingClass === 'external_cash_payable') &&
    (evidence.explicitly_funded !== true ||
      typeof evidence.evidence_reference !== 'string' ||
      evidence.evidence_reference.trim().length === 0)
  ) {
    return {
      contributionPence: 0,
      blocked: true,
      reason: 'missing_explicit_funding_evidence',
    };
  }

  if (requestedPence > payablePoolPence) {
    return {
      contributionPence: 0,
      blocked: true,
      reason: 'source_payable_pool_exceeded',
    };
  }

  return {
    contributionPence: requestedPence,
    blocked: false,
    reason: null,
  };
}

module.exports = {
  PAYOUT_V2_CALCULATION_VERSION,
  PAYOUT_V2_SOURCE_INGESTION_VERSION,
  FUNDING_CLASSES,
  ZERO_PAYOUT_FUNDING_CLASSES,
  canonicalJson,
  fingerprintPayoutPlan,
  resolveFundingContribution,
};
