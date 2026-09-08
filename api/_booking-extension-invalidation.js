'use strict';

const { createPlatformStripeClient, STRIPE_CLIENT_PURPOSES } = require('./_stripe-clients');

async function expireExtensionCheckoutSessions(sessionIds, {
  stripeClient = null,
  logger = console,
} = {}) {
  const ids = [...new Set((sessionIds || []).filter(id => typeof id === 'string' && id.startsWith('cs_')))];
  if (ids.length === 0) return [];

  const stripe = stripeClient || createPlatformStripeClient({ purpose: STRIPE_CLIENT_PURPOSES.PAYMENTS });
  const results = [];
  for (const sessionId of ids) {
    try {
      await stripe.checkout.sessions.expire(sessionId);
      results.push({ sessionId, expired: true });
    } catch (error) {
      // A session that completed concurrently cannot be expired. Its paid
      // webhook resolves through the durable unfulfilled-extension refund.
      logger.warn('[lesson_extension] Checkout expiry did not complete', {
        session_id: sessionId,
        error_code: typeof error?.code === 'string' ? error.code : 'stripe_error',
      });
      results.push({ sessionId, expired: false });
    }
  }
  return results;
}

async function invalidatePendingBookingExtensions(sql, {
  bookingId,
  instructorId,
  schoolId,
  stripeClient = null,
  logger = console,
} = {}) {
  const invalidated = await sql`
    UPDATE lesson_offers
       SET status = 'cancelled'
     WHERE extension_booking_id = ${bookingId}
       AND instructor_id = ${instructorId}
       AND school_id = ${schoolId}
       AND status = 'pending'
    RETURNING id, stripe_session_id
  `;
  await expireExtensionCheckoutSessions(
    invalidated.map(row => row.stripe_session_id),
    { stripeClient, logger }
  );
  return invalidated;
}

module.exports = {
  expireExtensionCheckoutSessions,
  invalidatePendingBookingExtensions,
};
