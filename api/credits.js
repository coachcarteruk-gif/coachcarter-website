const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');

const CREDIT_PRICE_PENCE = 8250; // £82.50
const MAX_CREDITS_PER_PURCHASE = 20;

// Bulk discount tiers — credits map to hours (1 credit = 1.5 hrs)
// { minCredits, discountPct, label }
const DISCOUNT_TIERS = [
  { minCredits: 20, discountPct: 25, label: '30 hours' },
  { minCredits: 16, discountPct: 20, label: '24 hours' },
  { minCredits: 12, discountPct: 15, label: '18 hours' },
  { minCredits:  8, discountPct: 10, label: '12 hours' },
  { minCredits:  4, discountPct:  5, label:  '6 hours' },
];

function getDiscount(qty) {
  const tier = DISCOUNT_TIERS.find(t => qty >= t.minCredits);
  return tier ? tier.discountPct : 0;
}

function calcTotal(qty) {
  const fullPence    = CREDIT_PRICE_PENCE * qty;
  const discountPct  = getDiscount(qty);
  const discountAmt  = Math.round(fullPence * discountPct / 100);
  return { fullPence, discountPct, discountAmt, totalPence: fullPence - discountAmt };
}

// ── Auth helper ───────────────────────────────────────────────────────────────
function verifyAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try { return jwt.verify(auth.slice(7), secret); } catch { return null; }
}

// ── CORS helper ───────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action = req.query.action;

  if (action === 'balance') return handleBalance(req, res);
  if (action === 'checkout') return handleCheckout(req, res);

  return res.status(400).json({ error: 'Unknown action. Use ?action=balance or ?action=checkout' });
};

// ── GET /api/credits?action=balance ──────────────────────────────────────────
// Returns the authenticated learner's current credit balance and recent transactions.
async function handleBalance(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [balanceRow] = await sql`
      SELECT credit_balance FROM learner_users WHERE id = ${user.id}
    `;

    if (!balanceRow) return res.status(404).json({ error: 'Learner not found' });

    const transactions = await sql`
      SELECT id, type, credits, amount_pence, payment_method, created_at
      FROM credit_transactions
      WHERE learner_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 20
    `;

    return res.json({
      credit_balance: balanceRow.credit_balance,
      transactions
    });
  } catch (err) {
    console.error('credits balance error:', err);
    return res.status(500).json({ error: 'Failed to load balance', details: err.message });
  }
}

// ── POST /api/credits?action=checkout ────────────────────────────────────────
// Creates a Stripe checkout session for buying credits.
// Body: { quantity: number }
async function handleCheckout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  const { quantity } = req.body;
  const qty = parseInt(quantity, 10);

  if (!qty || qty < 1 || qty > MAX_CREDITS_PER_PURCHASE) {
    return res.status(400).json({
      error: `Quantity must be between 1 and ${MAX_CREDITS_PER_PURCHASE}`
    });
  }

  try {
    const { fullPence, discountPct, discountAmt, totalPence } = calcTotal(qty);
    const origin = req.headers.origin || 'https://coachcarter.uk';

    const hours       = qty * 1.5;
    const productName = discountPct > 0
      ? `${qty} Lesson Credits — ${hours}hrs (${discountPct}% bulk discount)`
      : `${qty} Lesson Credit${qty > 1 ? 's' : ''} — ${hours}hrs`;
    const description = discountPct > 0
      ? `${qty} × 1.5-hour lessons. You save £${(discountAmt / 100).toFixed(2)} with the ${discountPct}% bulk discount.`
      : '1 credit = 1 × 1.5-hour driving lesson. Book online at any time.';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Don't restrict payment_method_types — let Stripe offer whatever's
      // enabled in the dashboard (card, Klarna, etc.) automatically.
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            // Pass the discounted total as a single amount so Stripe
            // displays the correct price (avoids fractional pence per unit).
            unit_amount: totalPence,
            product_data: { name: productName, description }
          },
          quantity: 1
        }
      ],
      metadata: {
        payment_type:      'credit_purchase',
        learner_id:        String(user.id),
        learner_email:     user.email,
        credits_purchased: String(qty),
        discount_pct:      String(discountPct),
        amount_pence:      String(totalPence)
      },
      customer_email: user.email,
      billing_address_collection: 'required',
      success_url: `${origin}/learner/dashboard.html?credits_added=${qty}`,
      cancel_url:  `${origin}/learner/buy-credits.html?cancelled=true`
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('credits checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session', details: err.message });
  }
}
