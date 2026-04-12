const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { requireAuth } = require('./_auth');

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

function verifyAuth(req) {
  return requireAuth(req, { roles: ['learner', 'admin'] });
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const action = req.query.action;

  if (action === 'balance') return handleBalance(req, res);
  if (action === 'checkout') return handleCheckout(req, res);
  if (action === 'verify') return handleVerify(req, res);

  return res.status(400).json({ error: 'Unknown action. Use ?action=balance, ?action=checkout, or ?action=verify' });
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
    return res.status(500).json({ error: 'Failed to load balance', details: 'Internal server error' });
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

  // SMS-only learners can have no email on their account. Stripe rejects
  // blank/invalid values passed to customer_email with an opaque 500, so we
  // only pre-fill the field when we have a valid email. Otherwise Stripe's
  // hosted checkout page will prompt for it. The webhook already falls back
  // to session.customer_email (see webhook.js:107).
  const emailValid = user.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(user.email).trim());

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
        learner_email:     emailValid ? user.email : '',
        credits_purchased: String(lessonEquiv),
        minutes_purchased: String(minutes),
        hours_purchased:   String(hours),
        discount_pct:      String(discountPct),
        amount_pence:      String(totalPence),
        school_id:         String(schoolId)
      },
      ...(emailValid ? { customer_email: user.email } : {}),
      billing_address_collection: 'required',
      allow_promotion_codes: true,
      success_url: `${origin}/learner/?hours_added=${hours}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/learner/buy-credits.html?cancelled=true`
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('credits checkout error:', err);
    reportError('/api/credits', err);
    return res.status(500).json({ error: 'Failed to create checkout session', details: 'Internal server error' });
  }
}

// ── GET /api/credits?action=verify&session_id=cs_xxx ─────────────────────────
// Post-checkout safety net: if the webhook failed silently, this verifies
// the Stripe session and grants credits idempotently via stripe_session_id.
async function handleVerify(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  const sessionId = req.query.session_id;
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return res.status(400).json({ error: true, code: 'INVALID_SESSION', message: 'Missing or invalid session_id' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // 1. Already processed? Return early (idempotent)
    const [existing] = await sql`
      SELECT id FROM credit_transactions WHERE stripe_session_id = ${sessionId} AND school_id = ${schoolId}
    `;
    if (existing) {
      return res.json({ ok: true, already_processed: true });
    }

    // 2. Retrieve the Stripe checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // 3. Validate payment succeeded and metadata matches
    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: true, code: 'NOT_PAID', message: 'Payment not completed' });
    }

    const metadata = session.metadata || {};
    if (metadata.payment_type !== 'credit_purchase') {
      return res.status(400).json({ error: true, code: 'WRONG_TYPE', message: 'Session is not a credit purchase' });
    }

    const learnerId = parseInt(metadata.learner_id, 10);
    if (learnerId !== user.id) {
      return res.status(403).json({ error: true, code: 'LEARNER_MISMATCH', message: 'Session does not belong to this user' });
    }

    const metaSchoolId = parseInt(metadata.school_id, 10) || 1;
    if (metaSchoolId !== schoolId) {
      return res.status(403).json({ error: true, code: 'SCHOOL_MISMATCH', message: 'Session does not belong to this school' });
    }

    // 4. Extract purchase details from metadata
    const credits    = parseInt(metadata.credits_purchased, 10);
    const minutes    = parseInt(metadata.minutes_purchased, 10) || (credits * 90);
    const hours      = parseFloat(metadata.hours_purchased) || (minutes / 60);
    const amountPence = parseInt(metadata.amount_pence, 10);
    const paymentMethod = session.payment_method_types?.[0] || 'card';

    if (!credits || !minutes) {
      return res.status(400).json({ error: true, code: 'BAD_METADATA', message: 'Session metadata incomplete' });
    }

    // 5. Double-check idempotency (race condition guard)
    const [recheck] = await sql`
      SELECT id FROM credit_transactions WHERE stripe_session_id = ${sessionId}
    `;
    if (recheck) {
      return res.json({ ok: true, already_processed: true });
    }

    // 6. Record the transaction
    await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, payment_method, stripe_session_id, minutes, school_id)
      VALUES
        (${learnerId}, 'purchase', ${credits}, ${amountPence}, ${paymentMethod}, ${sessionId}, ${minutes}, ${schoolId})
    `;

    // 7. Increment the learner's balance atomically
    await sql`
      UPDATE learner_users
      SET credit_balance = credit_balance + ${credits},
          balance_minutes = balance_minutes + ${minutes}
      WHERE id = ${learnerId} AND school_id = ${schoolId}
    `;

    return res.json({ ok: true, granted: true, hours, minutes });
  } catch (err) {
    console.error('credits verify error:', err);
    reportError('/api/credits', err);
    return res.status(500).json({ error: true, code: 'VERIFY_FAILED', message: 'Failed to verify checkout session' });
  }
}
