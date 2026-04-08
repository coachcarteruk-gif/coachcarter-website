const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { reportError } = require('./_error-alert');

module.exports = async (req, res) => {

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { session_id } = req.query;

    if (!session_id) {
      return res.status(400).json({ success: false, error: 'Missing session_id' });
    }

    // Retrieve session from Stripe with line items expanded
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items']
    });

    if (session.payment_status !== 'paid') {
      return res.json({ success: false, error: 'Payment not completed' });
    }

    // Get metadata from session
    const metadata = session.metadata || {};
    const packageType = metadata.package_type || 'standard';
    
    // Determine package name based on metadata
    let packageName;
    if (packageType === 'payg') {
      packageName = 'Pay As You Go — Single Lesson';
    } else if (packageType === 'bulk') {
      const hours = metadata.hours || 'Custom';
      packageName = `${hours} Hour Package`;
    } else if (packageType === 'pass_guarantee') {
      packageName = '18-Week Test Ready Guarantee';
    } else if (packageType === 'core_only') {
      packageName = 'Core Programme — 18 Week Guarantee';
    } else if (packageType === 'core_plus_1') {
      packageName = 'Core + 1 Retake Cover';
    } else if (packageType === 'core_plus_2') {
      packageName = 'Core + 2 Retake Cover';
    } else if (packageType === 'core_plus_lifetime') {
      packageName = 'Core + Lifetime Cover';
    } else {
      packageName = metadata.package_name || 'Driving Package';
    }

    // Calculate amount
    const amount = (session.amount_total / 100).toFixed(2);

    // Return the data your frontend expects
    res.json({
      success: true,
      booking_ref: session.id.slice(-8).toUpperCase(),
      package_name: packageName,
      package_type: packageType,
      amount: amount
    });
    
  } catch (err) {
    console.error('Error verifying session:', err);
    reportError('/api/verify-session', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
