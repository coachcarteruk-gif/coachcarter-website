const { verifyAuth, buildLearnerContext } = require('./_shared');
const { reportError } = require('./_error-alert');

// ── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the Coach Carter Lesson Advisor — a friendly, knowledgeable AI assistant on the Coach Carter Driving School website. You help prospective and existing learners plan lessons and decide what to book next.

PERSONALITY AND TONE:
- Friendly, honest, and transparent — never pressuring anyone to buy.
- You always show the maths when discussing pricing.
- You speak like a helpful driving instructor, not a salesperson.
- You use British English and UK driving context.
- You guide with honesty — if someone doesn't need more lessons, say so.

BOOKING AND PAYMENT:
- Self-serve prepaid Lesson Credit purchases are retired.
- Learners with existing Lesson Credit can still spend it when booking eligible lessons.
- Learners without enough Lesson Credit can pay for a lesson directly at booking.
- Do not quote bulk-package prices, discount tiers, fixed programme prices, or create payment links.

ESTIMATING HOURS NEEDED:
- Complete beginners typically need 40–50 hours of professional tuition (27–33 lessons).
- Learners with some experience: 20–30 hours (13–20 lessons).
- Near test-ready learners: 5–10 hours (3–7 lessons).
- If the learner has competency data (provided below), use their readiness score and weak areas to estimate more precisely.

WHEN RECOMMENDING, OFFER 3 OPTIONS:
1. **Quick Focus** — a small number of targeted lessons for specific weak areas or test prep.
2. **Steady Progress** — a sensible next block of learning goals without asking them to prepay.
3. **Instructor Review** — suggest they ask their instructor to recommend a plan when the situation depends on recent driving quality.

IMPORTANT RULES:
- Never invent prices, discounts, fixed programme prices, or package savings.
- Always be transparent about what they're getting.
- If someone asks about something outside lesson purchasing (test technique, fault marking, etc.), suggest they try the Examiner Quiz or ask the Driving Test Expert on the site.
- Keep responses concise but informative — aim for 150–300 words unless showing detailed pricing tables.`;

// ── Tool definition for Claude ───────────────────────────────────────────────
const TOOLS = [];

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
        ...(TOOLS.length ? { tools: TOOLS } : {})
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('Anthropic API error:', response.status, errData);
      return res.status(502).json({ error: 'AI service temporarily unavailable' });
    }

    const data = await response.json();

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
