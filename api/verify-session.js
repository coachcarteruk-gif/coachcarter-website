const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

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

    // Get metadata from session (this is what you send from index.html)
    const metadata = session.metadata || {};
    const packageType = metadata.package_type || 'standard';
    
    // Get line item for display name
    const lineItem = session.line_items?.data[0];
    
    // Determine package name based on metadata
    let packageName;
    if (packageType === 'payg') {
      packageName = 'Pay As You Go — Single Lesson';
    } else if (packageType === 'bulk') {
      const hours = metadata.hours || 'Custom';
      packageName = `${hours} Hour Package`;
    } else if (packageType === 'pass_guarantee') {
      packageName = '18-Week Pass Guarantee';
    } else {
      packageName = lineItem?.description || 'Driving Package';
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
    res.status(500).json({ success: false, error: err.message });
  }
};
