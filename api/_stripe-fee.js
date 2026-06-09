// Helper for snapshotting the Stripe processing fee on a checkout session.
//
// Step 4f of INSTRUCTOR-PAYMENTS-PLAN.md (decision A3: net-of-Stripe at the
// booking level). We write the fee onto credit_transactions.stripe_fee_pence
// at webhook time so the Friday payout cron can subtract it from the
// instructor's contribution per booking.
//
// Reliability: the balance_transaction is normally available within seconds of
// payment_intent.succeeded, but not guaranteed. Async payment methods may not
// have one at webhook time. On any failure we return
// null; the caller writes NULL into the column and the reconciliation cron
// (4f.e, not yet shipped) will backfill later.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Fetch the Stripe processing fee for a completed checkout session.
 * @param {object} session - Stripe Checkout Session object (from webhook event)
 * @returns {Promise<{feePence: number|null, source: string|null}>}
 *          feePence is the fee Stripe charged in pence (always integer).
 *          source is 'balance_transaction' when canonical, null when unavailable.
 */
async function fetchSessionFeePence(session) {
  if (!session?.payment_intent) {
    return { feePence: null, source: null };
  }

  try {
    const pi = await stripe.paymentIntents.retrieve(session.payment_intent, {
      expand: ['latest_charge.balance_transaction']
    });

    const fee = pi?.latest_charge?.balance_transaction?.fee;
    if (typeof fee === 'number') {
      return { feePence: fee, source: 'balance_transaction' };
    }
    return { feePence: null, source: null };
  } catch (err) {
    console.warn('⚠️ fetchSessionFeePence failed:', err.message);
    return { feePence: null, source: null };
  }
}

module.exports = { fetchSessionFeePence };
