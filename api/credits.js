const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const { reportError } = require('./_error-alert');

const LESSON_PRICE_PENCE = 8250; // £82.50 per lesson (1.5 hrs)
const MAX_LESSONS_PER_PURCHASE = 20;

// Bulk discount tiers — buy more lessons, save more
const DISCOUNT_TIERS = [
  { minLessons: 20, discountPct: 25 },
  { minLessons: 16, discountPct: 20 },
  { minLessons: 12, discountPct: 15 },
  { minLessons:  8, discountPct: 10 },
  { minLessons:  4, discountPct:  5 },
];

function getDiscount(qty) {
  const tier = DISCOUNT_TIERS.find(t => qty >= t.minLessons);
  return tier ? tier.discountPct : 0;
}

function calcTotal(qty) {
  const fullPence    = LESSON_PRICE_PENCE * qty;
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
    reportError('/api/credits', err);
    return res.status(500).json({ error: 'Failed to load balance', details: err.message });
  }
}

// ── POST /api/credits?action=checkout ────────────────────────────────────────
// Creates a Stripe checkout session for buying lessons.
// Body: { quantity: number }
async function handleCheckout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });

  const { quantity } = req.body;
  const qty = parseInt(quantity, 10);

  if (!qty || qty < 1 || qty > MAX_LESSONS_PER_PURCHASE) {
    return res.status(400).json({
      error: `Quantity must be between 1 and ${MAX_LESSONS_PER_PURCHASE}`
    });
  }

  try {
    const { fullPence, discountPct, discountAmt, totalPence } = calcTotal(qty);
    const origin = req.headers.origin || 'https://coachcarter.uk';

    const hours       = qty * 1.5;
    const productName = discountPct > 0
      ? `${qty} Driving Lessons — ${hours} hrs (${discountPct}% off)`
      : `${qty} Driving Lesson${qty > 1 ? 's' : ''} — ${hours} hrs`;
    const description = discountPct > 0
      ? `${qty} × 1.5-hour lessons at £82.50 each. You save £${(discountAmt / 100).toFixed(2)} with the ${discountPct}% package discount.`
      : `${qty} × 1.5-hour driving lesson${qty > 1 ? 's' : ''} at £82.50 each. Book online at any time.`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'klarna'],
      line_items: [
        {
          price_data: {
            currency: 'gbp',
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
      allow_promotion_codes: true,
      success_url: `${origin}/learner/?lessons_added=${qty}`,
      cancel_url:  `${origin}/learner/buy-credits.html?cancelled=true`
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('credits checkout error:', err);
    reportError('/api/credits', err);
    return res.status(500).json({ error: 'Failed to create checkout session', details: err.message });
  }
}
