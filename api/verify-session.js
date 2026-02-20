const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const bookings = new Map(); // Same store

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { session_id } = req.query;

    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return res.json({ success: false, error: 'Payment not completed' });
    }

    // Find booking by session ID (in production, query your DB)
    let booking = null;
    for (const [ref, b] of bookings) {
      if (b.stripe_session_id === session_id) {
        booking = b;
        break;
      }
    }

    if (!booking) {
      return res.json({ 
        success: true, 
        pending: true,
        message: 'Payment confirmed, booking being processed'
      });
    }

    const packageNames = {
      'payg': 'Pay As You Go — Single Lesson',
      'bulk': `${booking.metadata?.hours || ''} Hour Package`,
      'pass_guarantee': '18-Week Pass Guarantee'
    };

    res.json({
      success: true,
      booking_ref: booking.booking_reference,
      package_name: packageNames[booking.package_type] || booking.package_type,
      package_type: booking.package_type,
      amount: booking.amount_paid
    });
  } catch (err) {
    console.error('Error verifying session:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
