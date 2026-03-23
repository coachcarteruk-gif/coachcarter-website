const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');

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

// ── Auth helper (optional — visitors can chat without an account) ────────────
function verifyAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try { return jwt.verify(auth.slice(7), secret); } catch { return null; }
}

// ── Skill labels for readable AI context ─────────────────────────────────────
const SKILL_LABELS = {
  accelerator_12a: 'Accelerator', clutch_12b: 'Clutch', gears_12c: 'Gears',
  footbrake_12d: 'Footbrake', parking_brake_12e: 'Parking Brake', steering_12f: 'Steering',
  mirrors_14: 'Use of Mirrors', signals_15: 'Signals', awareness_26: 'Awareness & Planning',
  signs_signals_17: 'Signs & Signals', positioning_23: 'Positioning', clearance_16: 'Clearance',
  following_19: 'Following Distance', junctions_21: 'Junctions', judgement_22: 'Judgement',
  speed_18: 'Use of Speed', pedestrians_24: 'Pedestrian Crossings', progress_20: 'Progress',
  controlled_stop_2: 'Controlled Stop', reverse_right_4: 'Reverse Right',
  reverse_park_5: 'Reverse Park', forward_park_8: 'Forward Park', move_off_13: 'Move Off'
};
const RATING_LABELS = { struggled: 'Needs work (weak)', ok: 'Getting there (developing)', nailed: 'Confident (strong)' };

// ── Build personalised learner context for AI ────────────────────────────────
async function buildLearnerContext(userId) {
  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Onboarding data
    const [onboarding] = await sql`SELECT * FROM learner_onboarding WHERE learner_id = ${userId}`;

    // Latest lesson rating per skill
    const lessonData = await sql`
      SELECT DISTINCT ON (skill_key) skill_key, rating, driving_faults, serious_faults, dangerous_faults, created_at
      FROM skill_ratings WHERE user_id = ${userId}
      ORDER BY skill_key, created_at DESC`;

    // Quiz accuracy per skill
    const quizData = await sql`
      SELECT skill_key, COUNT(*)::int AS attempts, COUNT(*) FILTER (WHERE correct)::int AS correct_count
      FROM quiz_results WHERE learner_id = ${userId}
      GROUP BY skill_key`;

    // Mock test summary
    const [mockData] = await sql`
      SELECT COUNT(*)::int AS total_tests, COUNT(*) FILTER (WHERE result = 'pass')::int AS passes
      FROM mock_tests WHERE learner_id = ${userId} AND completed_at IS NOT NULL`;

    // Session stats
    const [stats] = await sql`
      SELECT COUNT(*)::int AS total_sessions, COALESCE(SUM(duration_minutes), 0)::int AS total_minutes
      FROM driving_sessions WHERE user_id = ${userId} AND session_type != 'onboarding'`;

    // Learner name
    const [learner] = await sql`SELECT name FROM learner_users WHERE id = ${userId}`;

    const hasData = (lessonData?.length > 0) || (quizData?.length > 0) || (mockData?.total_tests > 0) || onboarding;

    if (!hasData) {
      return learner?.name
        ? `\n\nLEARNER CONTEXT:\nThis learner's name is ${learner.name}. They haven't completed their profile, logged any sessions, or taken any quizzes yet. Be encouraging and suggest they start with a lesson to build their profile.`
        : '';
    }

    let ctx = `\n\nLEARNER CONTEXT (use this to personalise your recommendations — reference specific areas when relevant):\n`;
    if (learner?.name) ctx += `Name: ${learner.name}\n`;

    // Onboarding info
    if (onboarding) {
      const totalPrior = (onboarding.prior_hours_pro || 0) + (onboarding.prior_hours_private || 0);
      ctx += `Prior experience: ${onboarding.prior_hours_pro || 0} hours professional lessons, ${onboarding.prior_hours_private || 0} hours private practice (${totalPrior} total)\n`;
      ctx += `Previous tests taken: ${onboarding.previous_tests || 0}\n`;
      ctx += `Transmission: ${onboarding.transmission || 'manual'}\n`;
      if (onboarding.test_booked && onboarding.test_date) {
        const testDate = new Date(onboarding.test_date);
        const daysUntil = Math.ceil((testDate - new Date()) / (1000 * 60 * 60 * 24));
        ctx += `Test booked: ${onboarding.test_date} (${daysUntil > 0 ? daysUntil + ' days away' : 'in the past'})\n`;
      }
      if (onboarding.main_concerns) ctx += `Main concerns: "${onboarding.main_concerns}"\n`;
    }

    // Session stats
    ctx += `Sessions logged with CoachCarter: ${stats?.total_sessions || 0} (${Math.round((stats?.total_minutes || 0) / 60 * 10) / 10} hours)\n`;
    if (mockData?.total_tests > 0) ctx += `Mock tests: ${mockData.passes}/${mockData.total_tests} passed\n`;

    // Lesson ratings grouped by strength
    if (lessonData.length > 0) {
      ctx += `\nLatest skill self-assessment:\n`;
      const weak = [], developing = [], strong = [];
      for (const r of lessonData) {
        const label = SKILL_LABELS[r.skill_key] || r.skill_key;
        const ratingLabel = RATING_LABELS[r.rating] || r.rating;
        const faultNote = (r.driving_faults > 0 || r.serious_faults > 0 || r.dangerous_faults > 0)
          ? ` [${r.driving_faults}D ${r.serious_faults}S ${r.dangerous_faults}✕ faults logged]` : '';
        if (r.rating === 'struggled') weak.push(`  - ${label}: ${ratingLabel}${faultNote}`);
        else if (r.rating === 'ok') developing.push(`  - ${label}: ${ratingLabel}${faultNote}`);
        else strong.push(`  - ${label}: ${ratingLabel}${faultNote}`);
      }
      if (weak.length > 0) ctx += `WEAK areas:\n${weak.join('\n')}\n`;
      if (developing.length > 0) ctx += `DEVELOPING areas:\n${developing.join('\n')}\n`;
      if (strong.length > 0) ctx += `STRONG areas:\n${strong.join('\n')}\n`;
    }

    // Quiz weak areas
    if (quizData.length > 0) {
      const lowAccuracy = quizData
        .map(q => ({ ...q, pct: Math.round(100 * q.correct_count / q.attempts) }))
        .filter(q => q.pct < 70)
        .sort((a, b) => a.pct - b.pct);
      if (lowAccuracy.length > 0) {
        ctx += `\nExaminer Quiz weak areas (below 70% accuracy):\n`;
        for (const q of lowAccuracy.slice(0, 5)) {
          ctx += `  - ${SKILL_LABELS[q.skill_key] || q.skill_key}: ${q.correct_count}/${q.attempts} correct (${q.pct}%)\n`;
        }
      }
    }

    // Readiness estimate
    if (lessonData.length > 0) {
      const totalSkills = Object.keys(SKILL_LABELS).length;
      const strongCount = lessonData.filter(r => r.rating === 'nailed').length;
      const readinessPct = Math.round(100 * strongCount / totalSkills);
      ctx += `\nReadiness estimate: ${readinessPct}% (${strongCount}/${totalSkills} skills rated as strong)\n`;
    }

    ctx += `\nUse this data to give personalised lesson recommendations. Reference their weak areas, experience level, and test date when estimating how many lessons they need.`;
    return ctx;
  } catch (err) {
    console.error('Failed to build learner context:', err);
    return '';
  }
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
Each lesson is 1.5 hours. Base price: £82.50 per lesson.

Discount tiers (buy more, save more):
| Lessons | Discount | Per Lesson | Total     | You Save  |
|---------|----------|------------|-----------|-----------|
| 1–3     | 0%       | £82.50     | varies    | —         |
| 4       | 5%       | £78.38     | £313.50   | £16.50    |
| 8       | 10%      | £74.25     | £594.00   | £66.00    |
| 12      | 15%      | £70.13     | £841.50   | £148.50   |
| 16      | 20%      | £66.00     | £1,056.00 | £264.00   |
| 20      | 25%      | £61.88     | £1,237.50 | £412.50   |

- In-between quantities get proportionally interpolated discounts (e.g. 6 lessons = ~7.5% off, 10 lessons = ~12.5% off).
- 25% is the absolute maximum discount, even for 50 lessons.
- Maximum purchase: 50 lessons at a time.

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

  const price = calcPrice(qty);

  const hours = qty * 1.5;
  const productName = price.discountPct > 0
    ? `${qty} Driving Lessons — ${hours} hrs (${price.discountPct}% off)`
    : `${qty} Driving Lesson${qty > 1 ? 's' : ''} — ${hours} hrs`;
  const description = price.discountPct > 0
    ? `${qty} × 1.5-hour lessons at £82.50 each. You save £${price.savingsPounds} with the ${price.discountPct}% package discount.`
    : `${qty} × 1.5-hour driving lesson${qty > 1 ? 's' : ''} at £82.50 each. Book online at any time.`;

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
      learner_email:     user.email,
      credits_purchased: String(qty),
      discount_pct:      String(price.discountPct),
      amount_pence:      String(price.totalPence)
    },
    customer_email: user.email,
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
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
        return res.status(500).json({ error: 'Failed to create checkout session', details: err.message });
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
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
