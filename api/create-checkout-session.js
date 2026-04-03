const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { reportError } = require('./_error-alert');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { line_items, metadata, custom_fields, success_url, cancel_url } = req.body;

    const session = await stripe.checkout.sessions.create({
      line_items: line_items,
      mode: 'payment',
      payment_method_types: ['card', 'klarna'],
      success_url: success_url,
      cancel_url: cancel_url,
      metadata: metadata,
      custom_fields: custom_fields,
      phone_number_collection: { enabled: true },
      billing_address_collection: 'required',
      allow_promotion_codes: true,
      custom_text: {
        submit: {
          message: 'You will receive a confirmation email within 5 minutes with next steps.'
        }
      }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Error creating checkout session:', err);
    reportError('/api/create-checkout-session', err);
    res.status(500).json({ error: err.message });
  }
};
