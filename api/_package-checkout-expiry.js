'use strict';

const STRIPE_SAFE_MINIMUM_SECONDS = 31 * 60;

function discountedCheckoutExpiresAt(attempt, now = new Date()) {
  const metadata = attempt?.post_trial_quote?.metadata;
  if (!metadata?.post_trial_quote_id) return null;
  const quoteExpiry = new Date(metadata.post_trial_checkout_expires_at);
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(quoteExpiry.getTime()) || Number.isNaN(current.getTime()) || quoteExpiry <= current) {
    const error = new Error('Post-trial package quote has expired');
    error.code = 'POST_TRIAL_QUOTE_EXPIRED';
    throw error;
  }
  // Stripe requires Checkout expiry at least 30 minutes in the future. The
  // frozen server deadline remains authoritative; this only prevents a live
  // provider link lingering for Stripe's default 24 hours.
  return Math.ceil((current.getTime() + STRIPE_SAFE_MINIMUM_SECONDS * 1000) / 1000);
}

module.exports = { discountedCheckoutExpiresAt, STRIPE_SAFE_MINIMUM_SECONDS };
