// Short referral URL handler.
//
// GET /r/<code>  →  rewritten by vercel.json to /api/r?code=<code>
//
// Behaviour:
//   1. Validate the code exists. If not, redirect to the marketing home with
//      no attribution — fail open, never break the friend's experience.
//   2. Log a click row (best-effort, non-blocking failures).
//   3. Rate-limit clicks per IP+code so abusive scripts can't pad a referrer's
//      stats. 30 clicks per IP per code per hour is well above any honest use.
//   4. 302 to /learner/login.html?ref=<code>. The existing login flow already
//      knows how to consume the ref param and carry it through magic-link
//      and free-trial signup.
//
// We deliberately do NOT set a cookie — the existing ref-param flow already
// works, and a cookie would add a GDPR consent surface. Using the URL
// query string keeps attribution explicit and consent-free.

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { checkRateLimit, getClientIp } = require('./_rate-limit');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawCode = (req.query.code || '').trim();
  // Codes are alphanumeric + hyphen; reject anything else cheaply.
  if (!rawCode || !/^[A-Za-z0-9_-]{3,32}$/.test(rawCode)) {
    res.setHeader('Location', '/');
    return res.status(302).end();
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    const [row] = await sql`
      SELECT code, school_id FROM referrals WHERE code = ${rawCode} LIMIT 1
    `;

    if (!row) {
      // Unknown code — bounce to marketing home with no attribution.
      // Don't 404; the friend who clicked the link did nothing wrong.
      res.setHeader('Location', '/');
      return res.status(302).end();
    }

    const ip = getClientIp(req);
    const ipCodeKey = `referral_click:${ip}:${rawCode}`;
    const rl = await checkRateLimit(sql, { key: ipCodeKey, max: 30, windowSeconds: 3600 });

    if (rl.allowed) {
      // Hash the IP — we want abuse signal without storing PII.
      const ipHash = ip
        ? crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16)
        : null;
      const ua = (req.headers['user-agent'] || '').slice(0, 500) || null;
      const ref = (req.headers.referer || '').slice(0, 500) || null;

      try {
        await sql`
          INSERT INTO referral_clicks (referral_code, school_id, ip_hash, user_agent, referer)
          VALUES (${rawCode}, ${row.school_id}, ${ipHash}, ${ua}, ${ref})
        `;
      } catch (logErr) {
        // Click logging is best-effort. A failed log row must NOT block the
        // redirect — the friend's experience matters more than telemetry.
        console.warn('referral click log failed', logErr.message);
      }
    }

    res.setHeader('Location', `/learner/login.html?ref=${encodeURIComponent(rawCode)}`);
    return res.status(302).end();
  } catch (err) {
    reportError('/api/r', err);
    // On any unexpected error, still redirect to the login page with the
    // code attached. Worst case attribution still works, just no click log.
    res.setHeader('Location', `/learner/login.html?ref=${encodeURIComponent(rawCode)}`);
    return res.status(302).end();
  }
};
