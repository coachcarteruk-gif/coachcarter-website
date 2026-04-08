const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { reportError } = require('./_error-alert');
const { requireAuth } = require('./_auth');

module.exports = async (req, res) => {
  // CORS handled centrally by middleware.js
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = requireAuth(req, { roles: ['learner', 'admin'] });
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

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
    res.status(500).json({ error: 'Internal server error' });
  }
};
