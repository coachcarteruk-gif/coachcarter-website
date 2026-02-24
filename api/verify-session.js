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

    // Extract data directly from Stripe session - no Map needed!
    const lineItem = session.line_items?.data[0];
    const packageName = lineItem?.description || 'Driving Package';
    const amount = (session.amount_total / 100).toFixed(2);
    
    // Get package type from metadata or determine from amount/description
    let packageType = session.metadata?.package_type || 'standard';
    
    // Determine package type from description if not in metadata
    if (packageName.toLowerCase().includes('pass guarantee')) {
      packageType = 'pass_guarantee';
    } else if (packageName.toLowerCase().includes('hour') || packageName.toLowerCase().includes('bulk')) {
      packageType = 'bulk';
    } else if (packageName.toLowerCase().includes('single') || packageName.toLowerCase().includes('payg')) {
      packageType = 'payg';
    }

    // Return the data your frontend expects
    res.json({
      success: true,
      booking_ref: session.id.slice(-8).toUpperCase(), // Last 8 chars of session ID
      package_name: packageName,
      package_type: packageType,
      amount: amount
    });
    
  } catch (err) {
    console.error('Error verifying session:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
