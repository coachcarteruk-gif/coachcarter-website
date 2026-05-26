// Stripe lookup choreography for admin credit reconciliation.
//
// This module is intentionally dependency-injected: callers must pass a Stripe
// client. The Step 5.5 endpoint remains a 501 stub until the writer ships.

class ReconciliationStripeLookupError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'ReconciliationStripeLookupError';
    this.code = code;
    this.status = status;
  }
}

function lookupError(code, message, status) {
  return new ReconciliationStripeLookupError(code, message, status);
}

function objectId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return typeof value.id === 'string' ? value.id : '';
}

function asObject(value) {
  return value && typeof value === 'object' ? value : null;
}

function firstChargeFromPaymentIntent(paymentIntent) {
  const charge = asObject(paymentIntent && paymentIntent.latest_charge);
  if (charge) return charge;

  const charges = paymentIntent && paymentIntent.charges && Array.isArray(paymentIntent.charges.data)
    ? paymentIntent.charges.data
    : [];
  return asObject(charges[0]);
}

async function retrievePaymentIntent(stripe, paymentIntentId) {
  if (!paymentIntentId) return null;
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ['latest_charge.balance_transaction'],
  });
  if (!paymentIntent) {
    throw lookupError('PAYMENT_INTENT_NOT_FOUND', 'PaymentIntent could not be resolved.');
  }
  return paymentIntent;
}

async function retrieveCheckoutSession(stripe, sessionId) {
  if (!sessionId) return null;
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent', 'payment_intent.latest_charge.balance_transaction'],
  });
  if (!session) {
    throw lookupError('CHECKOUT_SESSION_NOT_FOUND', 'Checkout Session could not be resolved.');
  }
  return session;
}

async function retrieveCharge(stripe, chargeId) {
  if (!chargeId) return null;
  const charge = await stripe.charges.retrieve(chargeId, {
    expand: ['payment_intent', 'balance_transaction'],
  });
  if (!charge) {
    throw lookupError('CHARGE_NOT_FOUND', 'Charge could not be resolved.');
  }
  return charge;
}

async function discoverCheckoutSessionForPaymentIntent(stripe, paymentIntentId) {
  if (!paymentIntentId) return null;
  const page = await stripe.checkout.sessions.list({
    payment_intent: paymentIntentId,
    limit: 1,
  });
  return page && Array.isArray(page.data) ? (page.data[0] || null) : null;
}

async function resolvePaymentIntentFromSession(stripe, session) {
  const embedded = asObject(session && session.payment_intent);
  if (embedded) {
    return retrievePaymentIntent(stripe, embedded.id || null);
  }

  const paymentIntentId = objectId(session && session.payment_intent);
  return retrievePaymentIntent(stripe, paymentIntentId);
}

async function resolvePaymentIntentFromCharge(stripe, charge) {
  const embedded = asObject(charge && charge.payment_intent);
  if (embedded) {
    return retrievePaymentIntent(stripe, embedded.id || null);
  }

  const paymentIntentId = objectId(charge && charge.payment_intent);
  return retrievePaymentIntent(stripe, paymentIntentId);
}

async function resolveLatestCharge(stripe, paymentIntent, suppliedCharge = null) {
  const paymentIntentChargeId = objectId(paymentIntent && paymentIntent.latest_charge)
    || objectId(paymentIntent && paymentIntent.charges && Array.isArray(paymentIntent.charges.data)
      ? paymentIntent.charges.data[0]
      : null);

  if (suppliedCharge) {
    if (paymentIntentChargeId && suppliedCharge.id !== paymentIntentChargeId) {
      throw lookupError('CHARGE_PAYMENT_INTENT_MISMATCH', 'Charge does not match the resolved PaymentIntent.');
    }
    if (suppliedCharge.balance_transaction) return suppliedCharge;
  }

  const expandedCharge = firstChargeFromPaymentIntent(paymentIntent);
  if (expandedCharge && expandedCharge.balance_transaction) return expandedCharge;

  if (paymentIntentChargeId) {
    return retrieveCharge(stripe, paymentIntentChargeId);
  }

  return null;
}

function stripeFeeFromCharge(charge) {
  const fee = charge && charge.balance_transaction && charge.balance_transaction.fee;
  return typeof fee === 'number' ? fee : null;
}

/**
 * Resolve Stripe objects for a future admin credit-reconciliation writer.
 *
 * @param {object} args
 * @param {object} args.stripe mocked or real Stripe client
 * @param {string=} args.paymentIntentId
 * @param {string=} args.sessionId
 * @param {string=} args.chargeId
 */
async function inspectReconciliationStripePayment({
  stripe,
  paymentIntentId = '',
  sessionId = '',
  chargeId = '',
} = {}) {
  if (!stripe) {
    throw lookupError('STRIPE_CLIENT_REQUIRED', 'Stripe client is required.', 500);
  }

  const identities = [paymentIntentId, sessionId, chargeId].filter(Boolean);
  if (identities.length === 0) {
    throw lookupError('STRIPE_IDENTITY_REQUIRED', 'Provide a payment_intent_id, session_id, or charge_id.', 400);
  }

  let paymentIntent = null;
  let checkoutSession = null;
  let charge = null;

  if (paymentIntentId) {
    paymentIntent = await retrievePaymentIntent(stripe, paymentIntentId);
  }

  if (sessionId) {
    checkoutSession = await retrieveCheckoutSession(stripe, sessionId);
    if (!paymentIntent) paymentIntent = await resolvePaymentIntentFromSession(stripe, checkoutSession);
  }

  if (chargeId) {
    charge = await retrieveCharge(stripe, chargeId);
    if (!paymentIntent) paymentIntent = await resolvePaymentIntentFromCharge(stripe, charge);
  }

  if (!paymentIntent) {
    throw lookupError('PAYMENT_INTENT_NOT_FOUND', 'PaymentIntent could not be resolved.');
  }

  if (checkoutSession) {
    const sessionPaymentIntentId = objectId(checkoutSession.payment_intent);
    if (sessionPaymentIntentId && sessionPaymentIntentId !== paymentIntent.id) {
      throw lookupError('CHECKOUT_SESSION_PAYMENT_INTENT_MISMATCH', 'Checkout Session does not match the resolved PaymentIntent.');
    }
  } else {
    checkoutSession = await discoverCheckoutSessionForPaymentIntent(stripe, paymentIntent.id);
  }

  if (!checkoutSession) {
    throw lookupError('CHECKOUT_SESSION_NOT_FOUND', 'Checkout Session could not be resolved for the PaymentIntent.');
  }

  charge = await resolveLatestCharge(stripe, paymentIntent, charge);

  return {
    paymentIntent,
    checkoutSession,
    latestCharge: charge,
    stripeFeePence: stripeFeeFromCharge(charge),
    paymentIntentId: paymentIntent.id,
    sessionId: checkoutSession.id,
    chargeId: charge ? charge.id : null,
    stripePaymentIntentId: paymentIntent.id,
    stripeSessionId: checkoutSession.id,
    stripeChargeId: charge ? charge.id : null,
  };
}

module.exports = {
  ReconciliationStripeLookupError,
  inspectReconciliationStripePayment,
};
