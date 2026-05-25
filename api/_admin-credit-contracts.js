// Contract-only helpers for PER-INSTRUCTOR-CREDITS-PLAN Step 5.5.
//
// These functions intentionally do not write to Postgres or call Stripe. They
// pin the admin credit endpoint contract before the real writers are built.

const GOODWILL_ABSORBERS = Object.freeze(['platform', 'instructor']);

const GOODWILL_EXPECTED_WRITE_SHAPE = Object.freeze({
  creditTransaction: Object.freeze({
    source: 'goodwill',
    amount_pence: 0,
    stripe_fee_pence: 0,
    absorbed_by: 'copied_from_request',
  }),
  auditAction: 'admin.credit_goodwill_grant',
});

const RECONCILIATION_REQUIRED_METADATA = Object.freeze([
  'learner_id',
  'instructor_id',
  'minutes',
  'effective_rate_pence_per_minute',
]);

const RECONCILIATION_LOOKUP_IDENTITIES = Object.freeze([
  'stripe_session_id',
  'stripe_payment_intent_id',
  'stripe_charge_id',
]);

const RECONCILIATION_EXPECTED_WRITE_SHAPE = Object.freeze({
  creditTransaction: Object.freeze({
    source: 'reconciliation',
    absorbed_by: null,
    stripe_session_id: 'required_from_checkout_session',
    stripe_payment_intent_id: 'required_from_payment_intent',
    stripe_charge_id: 'required_from_latest_charge',
  }),
  auditAction: 'admin.credit_reconciliation',
});

const SCOPED_LOOKUP_REJECT = Object.freeze({
  status: 404,
  code: 'CREDIT_SCOPE_NOT_AVAILABLE',
  message: 'Credit action could not be applied for the requested scope.',
});

function positiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function validationError(code, message, status = 400) {
  return { ok: false, status, code, message };
}

function validateGoodwillRequest(body = {}, { schoolId } = {}) {
  if (!positiveInteger(schoolId)) {
    return validationError('SCHOOL_SCOPE_REQUIRED', 'Admin school scope is required.');
  }

  const learnerId = positiveInteger(body.learner_id);
  if (!learnerId) {
    return validationError('INVALID_LEARNER', 'learner_id must be a positive integer.');
  }

  const instructorId = positiveInteger(body.instructor_id);
  if (!instructorId) {
    return validationError('INVALID_INSTRUCTOR', 'instructor_id must be a positive integer.');
  }

  const minutes = positiveInteger(body.minutes);
  if (!minutes) {
    return validationError('INVALID_MINUTES', 'minutes must be a positive integer.');
  }

  if (!GOODWILL_ABSORBERS.includes(body.absorbed_by)) {
    return validationError('INVALID_ABSORBED_BY', "absorbed_by must be 'platform' or 'instructor'.");
  }

  return {
    ok: true,
    input: {
      learnerId,
      instructorId,
      schoolId: Number(schoolId),
      minutes,
      absorbedBy: body.absorbed_by,
      reason: typeof body.reason === 'string' ? body.reason.trim() : '',
    },
  };
}

function validateReconciliationRequest(body = {}, { schoolId } = {}) {
  if (!positiveInteger(schoolId)) {
    return validationError('SCHOOL_SCOPE_REQUIRED', 'Admin school scope is required.');
  }

  const paymentIntentId = typeof body.payment_intent_id === 'string' ? body.payment_intent_id.trim() : '';
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
  const chargeId = typeof body.charge_id === 'string' ? body.charge_id.trim() : '';

  if (!paymentIntentId && !sessionId && !chargeId) {
    return validationError(
      'STRIPE_IDENTITY_REQUIRED',
      'Provide a payment_intent_id, session_id, or charge_id.'
    );
  }

  return {
    ok: true,
    input: {
      schoolId: Number(schoolId),
      paymentIntentId,
      sessionId,
      chargeId,
      reason: typeof body.reason === 'string' ? body.reason.trim() : '',
    },
  };
}

function stripeReject(code, message) {
  return { ok: false, status: 409, code, message };
}

function getMetadata(paymentIntent, checkoutSession) {
  return {
    ...(paymentIntent && paymentIntent.metadata ? paymentIntent.metadata : {}),
    ...(checkoutSession && checkoutSession.metadata ? checkoutSession.metadata : {}),
  };
}

function latestCharge(paymentIntent) {
  const charge = paymentIntent && paymentIntent.latest_charge;
  if (charge && typeof charge === 'object') return charge;
  const charges = paymentIntent && paymentIntent.charges && Array.isArray(paymentIntent.charges.data)
    ? paymentIntent.charges.data
    : [];
  return charges[0] || null;
}

function evaluateReconciliationStripeState({
  existingCreditTransaction = null,
  paymentIntent = null,
  checkoutSession = null,
  expectedAmountPence = null,
} = {}) {
  if (existingCreditTransaction) {
    return {
      ok: true,
      noop: true,
      code: 'ALREADY_RECONCILED',
      transactionId: existingCreditTransaction.id,
      createdAt: existingCreditTransaction.created_at,
    };
  }

  if (!paymentIntent) {
    return stripeReject('PAYMENT_INTENT_REQUIRED', 'PaymentIntent could not be loaded.');
  }

  const amountReceived = Number(paymentIntent.amount_received);
  const amountExpected = expectedAmountPence == null
    ? Number(paymentIntent.amount)
    : Number(expectedAmountPence);
  if (!Number.isFinite(amountReceived) || amountReceived !== amountExpected) {
    return stripeReject('AMOUNT_MISMATCH', 'Stripe amount_received does not match the original amount.');
  }

  if (Number(paymentIntent.amount_refunded || 0) > 0) {
    return stripeReject('PAYMENT_REFUNDED', 'Payment has been refunded and cannot be reconciled.');
  }

  const charge = latestCharge(paymentIntent);
  if (charge && charge.disputed === true) {
    return stripeReject('PAYMENT_DISPUTED', 'Payment has an active dispute and cannot be reconciled.');
  }

  if (!checkoutSession) {
    return stripeReject('MISSING_CHECKOUT_SESSION', 'No matching Checkout Session found for this payment.');
  }

  const metadata = getMetadata(paymentIntent, checkoutSession);
  const missing = RECONCILIATION_REQUIRED_METADATA.filter((key) => !metadata[key]);
  if (missing.length > 0) {
    return stripeReject('MISSING_METADATA', `Stripe metadata is missing: ${missing.join(', ')}.`);
  }

  if (metadata.payment_type !== 'credit_purchase') {
    return stripeReject('WRONG_PAYMENT_TYPE', 'Stripe payment_type is not credit_purchase.');
  }

  return {
    ok: true,
    noop: false,
    input: {
      learnerId: Number(metadata.learner_id),
      instructorId: Number(metadata.instructor_id),
      minutes: Number(metadata.minutes),
      effectiveRatePencePerMinute: Number(metadata.effective_rate_pence_per_minute),
      amountPence: amountReceived,
      stripeSessionId: checkoutSession.id,
      stripePaymentIntentId: paymentIntent.id,
      stripeChargeId: charge ? charge.id : null,
    },
  };
}

module.exports = {
  GOODWILL_ABSORBERS,
  GOODWILL_EXPECTED_WRITE_SHAPE,
  RECONCILIATION_REQUIRED_METADATA,
  RECONCILIATION_LOOKUP_IDENTITIES,
  RECONCILIATION_EXPECTED_WRITE_SHAPE,
  SCOPED_LOOKUP_REJECT,
  validateGoodwillRequest,
  validateReconciliationRequest,
  evaluateReconciliationStripeState,
};
