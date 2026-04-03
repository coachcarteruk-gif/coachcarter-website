const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const { reportError } = require('./_error-alert');

const PRICE_PER_STANDARD_LESSON_PENCE = 8250; // £82.50 per 1.5 hrs
const STANDARD_LESSON_MINUTES = 90;
const MAX_HOURS_PER_PURCHASE = 30;

// Bulk discount tiers — buy more hours, save more
// Mapped from old lesson-based tiers: 4 lessons = 6hrs, 8 = 12hrs, etc.
const DISCOUNT_TIERS = [
  { minHours: 30, discountPct: 25 },
  { minHours: 24, discountPct: 20 },
  { minHours: 18, discountPct: 15 },
  { minHours: 12, discountPct: 10 },
  { minHours:  6, discountPct:  5 },
];

function getDiscount(hours) {
  const tier = DISCOUNT_TIERS.find(t => hours >= t.minHours);
  return tier ? tier.discountPct : 0;
}

function calcTotal(hours) {
  // Price is based on the standard lesson rate: £82.50 per 1.5 hours = £55/hr
  const pricePerHourPence = Math.round(PRICE_PER_STANDARD_LESSON_PENCE / 1.5);
  const fullPence    = Math.round(pricePerHourPence * hours);
  const discountPct  = getDiscount(hours);
  const discountAmt  = Math.round(fullPence * discountPct / 100);
  return { fullPence, discountPct, discountAmt, totalPence: fullPence - discountAmt, pricePerHourPence };
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
// Returns the authenticated learner's current balance and recent transactions.
async function handleBalance(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [balanceRow] = await sql`
      SELECT credit_balance, balance_minutes FROM learner_users WHERE id = ${user.id} AND school_id = ${schoolId}
    `;

    if (!balanceRow) return res.status(404).json({ error: 'Learner not found' });

    const transactions = await sql`
      SELECT id, type, credits, minutes, amount_pence, payment_method, created_at
      FROM credit_transactions
      WHERE learner_id = ${user.id} AND school_id = ${schoolId}
      ORDER BY created_at DESC
      LIMIT 20
    `;

    return res.json({
      credit_balance:  balanceRow.credit_balance,
      balance_minutes: balanceRow.balance_minutes || 0,
      balance_hours:   ((balanceRow.balance_minutes || 0) / 60).toFixed(1),
      transactions
    });
  } catch (err) {
    console.error('credits balance error:', err);
    reportError('/api/credits', err);
    return res.status(500).json({ error: 'Failed to load balance', details: err.message });
  }
}

// ── POST /api/credits?action=checkout ────────────────────────────────────────
// Creates a Stripe checkout session for buying hours.
// Body: { hours: number } — hours to purchase (e.g., 1.5, 3, 6, 12, etc.)
// Also accepts { quantity: number } for backwards compatibility (treats as lessons, converts to hours)
async function handleCheckout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  let hours;
  if (req.body.hours) {
    hours = parseFloat(req.body.hours);
  } else if (req.body.quantity) {
    // Backwards compat: quantity = number of standard lessons
    hours = parseInt(req.body.quantity, 10) * 1.5;
  }

  if (!hours || hours < 1.5 || hours > MAX_HOURS_PER_PURCHASE) {
    return res.status(400).json({
      error: `Hours must be between 1.5 and ${MAX_HOURS_PER_PURCHASE}`
    });
  }

  // Round to nearest 0.5 hours
  hours = Math.round(hours * 2) / 2;
  const minutes = Math.round(hours * 60);
  const lessonEquiv = Math.round(hours / 1.5); // for backwards compat metadata

  try {
    const { fullPence, discountPct, discountAmt, totalPence } = calcTotal(hours);
    const origin = req.headers.origin || 'https://coachcarter.uk';

    const productName = discountPct > 0
      ? `${hours} Hours of Driving Lessons (${discountPct}% off)`
      : `${hours} Hour${hours !== 1 ? 's' : ''} of Driving Lessons`;
    const description = discountPct > 0
      ? `${hours} hours at £${(PRICE_PER_STANDARD_LESSON_PENCE / 150).toFixed(2)}/hr. You save £${(discountAmt / 100).toFixed(2)} with the ${discountPct}% package discount.`
      : `${hours} hours of driving lessons. Book online at any time.`;

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
        credits_purchased: String(lessonEquiv),
        minutes_purchased: String(minutes),
        hours_purchased:   String(hours),
        discount_pct:      String(discountPct),
        amount_pence:      String(totalPence),
        school_id:         String(schoolId)
      },
      customer_email: user.email,
      billing_address_collection: 'required',
      allow_promotion_codes: true,
      success_url: `${origin}/learner/?hours_added=${hours}`,
      cancel_url:  `${origin}/learner/buy-credits.html?cancelled=true`
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('credits checkout error:', err);
    reportError('/api/credits', err);
    return res.status(500).json({ error: 'Failed to create checkout session', details: err.message });
  }
}
