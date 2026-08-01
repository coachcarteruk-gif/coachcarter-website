// Stripe charge and fee evidence used by existing v1 snapshots and the
// inactive Payout v2 funding-source writer. A failed lookup remains non-fatal
// to existing payment handling; Payout v2 classifies the source manual_review.

const { createPlatformStripeClient, STRIPE_CLIENT_PURPOSES } = require('./_stripe-clients');
const stripe = createPlatformStripeClient({ purpose: STRIPE_CLIENT_PURPOSES.RECONCILIATION });

function stripeObjectId(value) {
  if (typeof value === 'string') return value;
  return value && typeof value.id === 'string' ? value.id : null;
}

function emptyFundingEvidence({ checkoutSessionId = null, paymentIntentId = null } = {}) {
  return {
    checkoutSessionId,
    paymentIntentId,
    paymentIntentStatus: null,
    chargeId: null,
    chargePaid: null,
    chargeCaptured: null,
    chargePaymentIntentId: null,
    balanceTransactionId: null,
    balanceTransactionSourceId: null,
    balanceTransactionType: null,
    balanceTransactionAmountPence: null,
    balanceTransactionCurrency: null,
    balanceTransactionStatus: null,
    paymentCreatedAt: null,
    fundsAvailableAt: null,
    amountPence: null,
    currency: null,
    feePence: null,
    source: null,
  };
}

/**
 * Resolve immutable Stripe payment, charge, balance-transaction, amount, and
 * fee evidence for a successful Checkout Session/PaymentIntent-shaped object.
 */
async function fetchSessionFundingEvidence(session, stripeClient = stripe) {
  const checkoutSessionId = session?.object === 'checkout.session' ? session.id : null;
  const suppliedPaymentIntentId = typeof session?.payment_intent === 'string'
    ? session.payment_intent
    : session?.payment_intent?.id || null;

  if (!suppliedPaymentIntentId) {
    return emptyFundingEvidence({
      checkoutSessionId,
      paymentIntentId: null,
    });
  }

  try {
    const paymentIntent = await stripeClient.paymentIntents.retrieve(
      suppliedPaymentIntentId,
      { expand: ['latest_charge.balance_transaction'] }
    );
    let charge = paymentIntent?.latest_charge &&
      typeof paymentIntent.latest_charge === 'object'
      ? paymentIntent.latest_charge
      : null;
    if (!charge && typeof paymentIntent?.latest_charge === 'string') {
      charge = await stripeClient.charges.retrieve(
        paymentIntent.latest_charge,
        { expand: ['balance_transaction'] }
      );
    }
    // Older/non-card payment records can expose fee evidence through the
    // expanded latest payment object without a Charge-shaped `ch_` identity.
    // Ask Stripe's read-only Charge index for the immutable Charge linked to
    // this PaymentIntent instead of accepting an ambiguous object identifier.
    if (
      (!charge?.id || !charge.id.startsWith('ch_')) &&
      stripeClient.charges?.list
    ) {
      try {
        const charges = await stripeClient.charges.list({
          payment_intent: paymentIntent.id,
          limit: 10,
          expand: ['data.balance_transaction'],
        });
        charge = charges.data.find((item) => item?.paid === true) || charges.data[0] || charge;
      } catch (chargeLookupErr) {
        console.warn('fetchSessionFundingEvidence charge lookup failed:', chargeLookupErr.message);
      }
    }
    let balanceTransaction = charge?.balance_transaction &&
      typeof charge.balance_transaction === 'object'
      ? charge.balance_transaction
      : null;
    if (
      !balanceTransaction &&
      typeof charge?.balance_transaction === 'string' &&
      stripeClient.balanceTransactions?.retrieve
    ) {
      balanceTransaction = await stripeClient.balanceTransactions.retrieve(
        charge.balance_transaction
      );
    }
    const feePence = Number.isSafeInteger(balanceTransaction?.fee)
      ? balanceTransaction.fee
      : null;

    return {
      checkoutSessionId,
      paymentIntentId: paymentIntent?.id || suppliedPaymentIntentId,
      paymentIntentStatus: paymentIntent?.status || null,
      chargeId: charge?.id || null,
      chargePaid: charge?.paid === true,
      chargeCaptured: charge?.captured === true,
      chargePaymentIntentId: stripeObjectId(charge?.payment_intent),
      balanceTransactionId: balanceTransaction?.id || null,
      balanceTransactionSourceId: stripeObjectId(balanceTransaction?.source),
      balanceTransactionType: balanceTransaction?.type || null,
      balanceTransactionAmountPence:
        Number.isSafeInteger(balanceTransaction?.amount)
          ? balanceTransaction.amount
          : null,
      balanceTransactionCurrency:
        typeof balanceTransaction?.currency === 'string'
          ? balanceTransaction.currency
          : null,
      balanceTransactionStatus:
        typeof balanceTransaction?.status === 'string'
          ? balanceTransaction.status
          : null,
      paymentCreatedAt: Number.isSafeInteger(paymentIntent?.created)
        ? new Date(paymentIntent.created * 1000).toISOString()
        : null,
      fundsAvailableAt: Number.isSafeInteger(balanceTransaction?.available_on)
        ? new Date(balanceTransaction.available_on * 1000).toISOString()
        : null,
      amountPence: Number.isSafeInteger(paymentIntent?.amount_received)
        ? paymentIntent.amount_received
        : (Number.isSafeInteger(charge?.amount) ? charge.amount : null),
      currency: typeof paymentIntent?.currency === 'string'
        ? paymentIntent.currency
        : (typeof charge?.currency === 'string' ? charge.currency : null),
      feePence,
      source: feePence != null && balanceTransaction?.id
        ? 'balance_transaction'
        : null,
    };
  } catch (err) {
    console.warn('fetchSessionFundingEvidence failed:', err.message);
    return emptyFundingEvidence({
      checkoutSessionId,
      paymentIntentId: suppliedPaymentIntentId,
    });
  }
}

/**
 * Backwards-compatible fee-only wrapper for existing callers.
 */
async function fetchSessionFeePence(session) {
  const evidence = await fetchSessionFundingEvidence(session);
  return {
    feePence: evidence.feePence,
    source: evidence.source,
  };
}

module.exports = {
  emptyFundingEvidence,
  fetchSessionFeePence,
  fetchSessionFundingEvidence,
};
