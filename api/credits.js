const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { requireAuth } = require('./_auth');
const { calcBulkTotal, getBulkPricing, MAX_HOURS_PER_PURCHASE } = require('./_pricing-helpers');
const { grantCredits } = require('./_credit-grant');

const STANDARD_LESSON_MINUTES = 90;

function verifyAuth(req) {
  return requireAuth(req, { roles: ['learner', 'admin'] });
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const action = req.query.action;

  if (action === 'balance') return handleBalance(req, res);
  if (action === 'checkout') return handleCheckout(req, res);
  if (action === 'verify') return handleVerify(req, res);
  if (action === 'bulk-pricing') return handleBulkPricing(req, res);

  return res.status(400).json({ error: 'Unknown action. Use ?action=balance, ?action=checkout, ?action=verify, or ?action=bulk-pricing' });
};

// ── GET /api/credits?action=bulk-pricing ─────────────────────────────────────
// Returns the school's current bulk-credit hourly rate and discount tiers.
// Public (no auth) — same data the buy-credits page uses to render prices.
// The buy-credits page MUST use these values verbatim so what's displayed
// matches what handleCheckout will charge — no client-side recalculation.
async function handleBulkPricing(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const schoolId = parseInt(req.query.school_id) || 1;
    const { hourlyPence, discountTiers, source } = await getBulkPricing(sql, schoolId);
    return res.json({
      ok: true,
      hourly_pence: hourlyPence,
      discount_tiers: discountTiers, // sorted descending by min_hours; first match wins
      max_hours: MAX_HOURS_PER_PURCHASE,
      _source: source
    });
  } catch (err) {
    console.error('credits bulk-pricing error:', err);
    reportError('/api/credits?action=bulk-pricing', err);
    return res.status(500).json({ error: 'Failed to load bulk pricing' });
  }
}

// ── GET /api/credits?action=balance ──────────────────────────────────────────
// Returns the authenticated learner's current balance and recent transactions.
async function handleBalance(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  const schoolId = user.school_id || 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Step 4 / Phase 2A: profile-balance read sums learner_credit_balances
    // across instructors instead of reading learner_users.balance_minutes
    // directly. The sync_pooled_balance trigger keeps the pooled column in
    // sync, but reading LCB directly is defence-in-depth — if the trigger
    // is ever missing or wrong, the UI still shows the real balance.
    //
    // credit_balance (legacy cosmetic counter) is still read from
    // learner_users; LCB doesn't materialise that column.
    const [balanceRow] = await sql`
      SELECT lu.credit_balance,
             COALESCE((
               SELECT SUM(lcb.balance_minutes)::int
                 FROM learner_credit_balances lcb
                WHERE lcb.learner_id = lu.id
                  AND lcb.school_id = ${schoolId}
             ), lu.balance_minutes, 0) AS balance_minutes
        FROM learner_users lu
       WHERE lu.id = ${user.id}
         AND lu.school_id = ${schoolId}
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

  // Step 4 / Phase 2A: scope credits to a specific instructor at purchase
  // time. Accept instructor_id from the request body when provided (future
  // multi-instructor learner UI); default to 1 (Fraser) when missing so
  // current buy-credits.html callers continue to work without change. The
  // webhook reads metadata.instructor_id and routes the LCB upsert there.
  const instructorIdRaw = parseInt(req.body.instructor_id, 10);
  const instructorId = Number.isFinite(instructorIdRaw) && instructorIdRaw > 0
    ? instructorIdRaw
    : 1;

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const { fullPence, discountPct, discountAmt, totalPence, pricePerHourPence } = await calcBulkTotal(sql, schoolId, hours);
    const origin = req.headers.origin || 'https://coachcarter.uk';

    const productName = discountPct > 0
      ? `${hours} Hours of Driving Lessons (${discountPct}% off)`
      : `${hours} Hour${hours !== 1 ? 's' : ''} of Driving Lessons`;
    const description = discountPct > 0
      ? `${hours} hours at £${(pricePerHourPence / 100).toFixed(2)}/hr. You save £${(discountAmt / 100).toFixed(2)} with the ${discountPct}% package discount.`
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
        school_id:         String(schoolId),
        // Step 4 / Phase 2A: scope LCB upsert in the webhook.
        // effective_rate_pence_per_minute is derivable from the Stripe
        // session itself (amount_pence / minutes) per the source-of-truth
        // rule, but we also snapshot it into metadata for audit clarity
        // and to surface the discount-applied rate (vs the school list rate).
        instructor_id:                    String(instructorId),
        effective_rate_pence_per_minute:  String(Math.round(totalPence / minutes))
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

    // 1. Retrieve the Stripe checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // 2. Validate payment succeeded and metadata matches
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

    // 3. Extract purchase details from metadata
    const credits    = parseInt(metadata.credits_purchased, 10);
    const minutes    = parseInt(metadata.minutes_purchased, 10) || (credits * 90);
    const hours      = parseFloat(metadata.hours_purchased) || (minutes / 60);
    const amountPence = parseInt(metadata.amount_pence, 10);
    const paymentMethod = session.payment_method_types?.[0] || 'card';

    if (!credits || !minutes) {
      return res.status(400).json({ error: true, code: 'BAD_METADATA', message: 'Session metadata incomplete' });
    }

    // 4. Grant via the shared helper. The webhook may be running the same
    // session concurrently; the FOR UPDATE row lock in grantCredits() ensures
    // exactly one caller applies the balance increment, and the other sees
    // alreadyProcessed=true via the partial unique index. Pricing is sourced
    // from the Stripe Session metadata above — never from a live rate helper
    // (defence-in-depth against mid-flight rate changes).
    //
    // Step 4 / Phase 2A: source instructor_id + effective_rate_pence_per_minute
    // + paymentIntentId from Stripe metadata too. Without these, a verify-
    // session call that beats the webhook to the database would grandfather
    // to instructor 1, then the webhook's later INSERT would no-op on the
    // uq_credit_tx_session arbiter — locking the misroute in place. Mirrors
    // the same args handleCreditPurchase passes (api/webhook.js).
    const instructorIdMeta = parseInt(metadata.instructor_id, 10) || null;
    const effectiveRatePencePerMinute = minutes > 0
      ? Math.round(amountPence / minutes)
      : null;
    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || null;

    const grant = await grantCredits({
      sql,
      learnerId,
      schoolId,
      credits,
      minutes,
      amountPence,
      paymentMethod,
      sessionId,
      instructorId: instructorIdMeta,
      effectiveRatePencePerMinute,
      paymentIntentId,
      source: 'stripe',
    });

    if (!grant.ok) {
      // LEARNER_NOT_FOUND on the verify path means the JWT learner exists
      // but their school_id has drifted from the session's school_id (caught
      // above) OR something else removed them between auth and grant.
      // Surface 404 with the typed code rather than 500 — this isn't a
      // retry-worthy error.
      return res.status(404).json({ error: true, code: grant.code, message: grant.message });
    }

    // Referrer rewards are issued by api/cron-referral-rewards.js after each
    // qualifying lesson is completed (not at purchase time). See that file
    // for the trigger logic.

    return res.json({
      ok: true,
      granted: !grant.alreadyProcessed,
      already_processed: grant.alreadyProcessed,
      hours,
      minutes,
    });
  } catch (err) {
    console.error('credits verify error:', err);
    reportError('/api/credits', err);
    return res.status(500).json({ error: true, code: 'VERIFY_FAILED', message: 'Failed to verify checkout session' });
  }
}
