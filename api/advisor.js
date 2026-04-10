const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { verifyAuth, buildLearnerContext } = require('./_shared');
const { reportError } = require('./_error-alert');

// ── Pricing config ───────────────────────────────────────────────────────────
const LESSON_PRICE_PENCE = 8250; // £82.50 per 1.5hr lesson
const MAX_LESSONS = 50;

// Fixed discount tiers
const TIERS = [
  { lessons: 4, discountPct: 5 },
  { lessons: 8, discountPct: 10 },
  { lessons: 12, discountPct: 15 },
  { lessons: 16, discountPct: 20 },
  { lessons: 20, discountPct: 25 }
];

// Interpolated discount: proportional between tiers, capped at 25%
function getDiscountPct(qty) {
  if (qty < 1) return 0;
  if (qty >= 20) return 25; // hard cap

  // Find surrounding tiers
  let lower = { lessons: 1, discountPct: 0 };
  let upper = TIERS[0];
  for (let i = 0; i < TIERS.length; i++) {
    if (qty >= TIERS[i].lessons) {
      lower = TIERS[i];
      upper = TIERS[i + 1] || TIERS[i];
    } else {
      upper = TIERS[i];
      break;
    }
  }
  if (lower.lessons === upper.lessons) return lower.discountPct;

  // Linear interpolation
  const ratio = (qty - lower.lessons) / (upper.lessons - lower.lessons);
  return Math.round((lower.discountPct + ratio * (upper.discountPct - lower.discountPct)) * 100) / 100;
}

function calcPrice(qty) {
  const discountPct = getDiscountPct(qty);
  const fullPence = LESSON_PRICE_PENCE * qty;
  const discountAmt = Math.round(fullPence * discountPct / 100);
  const totalPence = fullPence - discountAmt;
  const pricePerLesson = Math.round(totalPence / qty);
  return {
    qty, discountPct, fullPence, discountAmt, totalPence, pricePerLesson,
    totalPounds: (totalPence / 100).toFixed(2),
    perLessonPounds: (pricePerLesson / 100).toFixed(2),
    savingsPounds: (discountAmt / 100).toFixed(2)
  };
}

// ── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the Coach Carter Lesson Advisor — a friendly, knowledgeable AI assistant on the Coach Carter Driving School website. You help prospective and existing learners choose the right lesson package.

PERSONALITY AND TONE:
- Friendly, honest, and transparent — never pressuring anyone to buy.
- You always show the maths when discussing pricing.
- You speak like a helpful driving instructor, not a salesperson.
- You use British English and UK driving context.
- You guide with honesty — if someone doesn't need more lessons, say so.

PRICING — COACH CARTER DRIVING LESSONS:
Learners buy hours. Base rate: £55 per hour (£82.50 for a standard 1.5-hour lesson).
Multiple lesson types available: Standard (1.5 hrs), 2-Hour, and more.

Discount tiers (buy more hours, save more):
| Hours | Discount | Per Hour | Total     | You Save  |
|-------|----------|----------|-----------|-----------|
| 1.5–5 | 0%      | £55.00   | varies    | —         |
| 6     | 5%      | £52.25   | £313.50   | £16.50    |
| 12    | 10%     | £49.50   | £594.00   | £66.00    |
| 18    | 15%     | £46.75   | £841.50   | £148.50   |
| 24    | 20%     | £44.00   | £1,056.00 | £264.00   |
| 30    | 25%     | £41.25   | £1,237.50 | £412.50   |

- In-between quantities get proportionally interpolated discounts.
- 25% is the absolute maximum discount.
- Maximum purchase: 30 hours at a time.

ESTIMATING HOURS NEEDED:
- Complete beginners typically need 40–50 hours of professional tuition (27–33 lessons).
- Learners with some experience: 20–30 hours (13–20 lessons).
- Near test-ready learners: 5–10 hours (3–7 lessons).
- If the learner has competency data (provided below), use their readiness score and weak areas to estimate more precisely.

WHEN RECOMMENDING, OFFER 3 OPTIONS:
1. **Best Value** — The package with the best balance of lessons and discount. Ideal for the learner's estimated needs.
2. **Least Risk** — A larger package that covers extra practice and worst-case scenario hours. Better discount, peace of mind.
3. **Quick Focus** — A smaller, targeted package for specific weak areas or test prep. Lower commitment.

Always show the price breakdown for each option (per-lesson cost, total, savings).

WHEN THE LEARNER IS READY TO BUY:
- Confirm the number of lessons they want.
- Use the create_checkout tool to generate a payment link.
- Only call the tool once the learner has explicitly confirmed they want to proceed.

IMPORTANT RULES:
- Never invent prices — use the pricing table above and the interpolation rules.
- Always be transparent about what they're getting.
- If someone asks about something outside lesson purchasing (test technique, fault marking, etc.), suggest they try the Examiner Quiz or ask the Driving Test Expert on the site.
- Keep responses concise but informative — aim for 150–300 words unless showing detailed pricing tables.`;

// ── Tool definition for Claude ───────────────────────────────────────────────
const TOOLS = [
  {
    name: 'create_checkout',
    description: 'Create a Stripe checkout session for lesson purchase. Only call this when the learner has confirmed they want to proceed with a specific number of lessons.',
    input_schema: {
      type: 'object',
      properties: {
        lessons: {
          type: 'integer',
          description: 'Number of lessons to purchase (1-50)'
        },
        summary: {
          type: 'string',
          description: "Brief description of what the learner is buying, e.g. '10 lessons — best value package'"
        }
      },
      required: ['lessons', 'summary']
    }
  }
];

// ── Handle create_checkout tool call ─────────────────────────────────────────
async function handleCreateCheckout(toolInput, user, origin) {
  const qty = parseInt(toolInput.lessons, 10);

  if (!qty || qty < 1 || qty > MAX_LESSONS) {
    return { error: `Quantity must be between 1 and ${MAX_LESSONS}` };
  }

  // SMS-only learners can have no email. Only pre-fill Stripe's customer_email
  // when we have a valid value — otherwise Stripe collects it at checkout.
  const emailValid = user.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(user.email).trim());

  const price = calcPrice(qty);

  const hours = qty * 1.5;
  const productName = price.discountPct > 0
    ? `${hours} Hours of Driving Lessons (${price.discountPct}% off)`
    : `${hours} Hour${hours !== 1 ? 's' : ''} of Driving Lessons`;
  const description = price.discountPct > 0
    ? `${hours} hours at £55/hr. You save £${price.savingsPounds} with the ${price.discountPct}% package discount.`
    : `${hours} hours of driving lessons at £55/hr. Book online at any time.`;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card', 'klarna'],
    line_items: [
      {
        price_data: {
          currency: 'gbp',
          unit_amount: price.totalPence,
          product_data: { name: productName, description }
        },
        quantity: 1
      }
    ],
    metadata: {
      payment_type:      'credit_purchase',
      learner_id:        String(user.id),
      learner_email:     emailValid ? user.email : '',
      credits_purchased: String(qty),
      discount_pct:      String(price.discountPct),
      amount_pence:      String(price.totalPence)
    },
    ...(emailValid ? { customer_email: user.email } : {}),
    billing_address_collection: 'required',
    allow_promotion_codes: true,
    success_url: `${origin}/learner/?lessons_added=${qty}`,
    cancel_url:  `${origin}/learner/advisor.html?cancelled=true`
  });

  return {
    checkout_url: session.url,
    price_summary: {
      qty,
      perLessonPounds: price.perLessonPounds,
      totalPounds: price.totalPounds,
      discountPct: price.discountPct,
      savingsPounds: price.savingsPounds
    }
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, learner_id } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages array required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'AI service not configured' });
  }

  // Auth is optional — visitors can chat without an account
  const user = verifyAuth(req);

  try {
    // Build personalised context if we have an authenticated learner
    let learnerContext = '';
    if (user) {
      learnerContext = await buildLearnerContext(user.id);
    }
    const personalizedPrompt = SYSTEM_PROMPT + learnerContext;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: personalizedPrompt,
        messages: messages.slice(-20),
        tools: TOOLS
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('Anthropic API error:', response.status, errData);
      return res.status(502).json({ error: 'AI service temporarily unavailable' });
    }

    const data = await response.json();

    // Check if Claude wants to use a tool
    const toolUseBlock = data.content.find(block => block.type === 'tool_use');

    if (toolUseBlock && toolUseBlock.name === 'create_checkout') {
      // Extract any text the AI sent alongside the tool call
      const textReply = data.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      // Auth is required for purchasing
      if (!user) {
        return res.json({
          type: 'auth_required',
          reply: textReply || 'To complete your purchase, please sign in or create an account first. Your conversation will be saved.',
          message: 'Please sign in to complete your purchase'
        });
      }

      try {
        const origin = req.headers.origin || 'https://coachcarter.uk';
        const result = await handleCreateCheckout(toolUseBlock.input, user, origin);

        if (result.error) {
          return res.status(400).json({ error: result.error });
        }

        return res.json({
          type: 'checkout',
          reply: textReply || "Great choice! Here's your secure checkout link:",
          checkout_url: result.checkout_url,
          price_summary: result.price_summary
        });
      } catch (err) {
        console.error('Stripe checkout error:', err);
        reportError('/api/advisor', err);
        return res.status(500).json({ error: 'Failed to create checkout session', details: 'Internal server error' });
      }
    }

    // Regular text response
    const reply = data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    return res.json({ type: 'message', reply });
  } catch (err) {
    console.error('Advisor error:', err);
    reportError('/api/advisor', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
