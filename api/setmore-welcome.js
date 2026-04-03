// Setmore Welcome Emails — cron job
//
// GET /api/setmore-welcome  (CRON_SECRET auth)
//
// Sends a one-time welcome email to learners who were auto-created by
// the Setmore sync but have never logged in. Includes a magic link so
// they can access their lessons/progress on CoachCarter.
//
// Processes up to 10 learners per invocation to stay within Vercel limits.

const { neon } = require('@neondatabase/serverless');
const { createTransporter, generateToken } = require('./_auth-helpers');
const { reportError } = require('./_error-alert');

const BATCH_SIZE = 10;
const TOKEN_EXPIRY_MINUTES = 60 * 24 * 7; // 7-day magic link for welcome emails
const BASE_URL = process.env.BASE_URL || 'https://coachcarter.uk';

function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const provided = req.query.key || req.headers['authorization']?.replace('Bearer ', '');
  return provided === secret;
}

function setCors(res) {
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  const sql = neon(process.env.POSTGRES_URL);

  try {
    // Find Setmore-created learners who:
    // 1. Have a setmore_customer_key (created by sync)
    // 2. Have an email address (can't send welcome without one)
    // 3. Haven't received a welcome email yet
    // 4. Were created in the last 30 days (don't spam old accounts)
    const learners = await sql`
      SELECT id, name, email
      FROM learner_users
      WHERE setmore_customer_key IS NOT NULL
        AND email IS NOT NULL
        AND welcome_email_sent_at IS NULL
        AND created_at > NOW() - INTERVAL '30 days'
      ORDER BY created_at ASC
      LIMIT ${BATCH_SIZE}
    `;

    if (learners.length === 0) {
      return res.json({ ok: true, message: 'No welcome emails to send', sent: 0 });
    }

    const mailer = createTransporter();
    let sent = 0;
    let failed = 0;

    for (const learner of learners) {
      try {
        // Generate a long-lived magic link token (7 days)
        const token = generateToken();
        const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

        await sql`
          INSERT INTO magic_link_tokens (token, email, method, expires_at)
          VALUES (${token}, ${learner.email}, 'email', ${expiresAt.toISOString()})
        `;

        const magicUrl = `${BASE_URL}/learner/verify.html?token=${token}`;
        const firstName = (learner.name || '').split(' ')[0] || 'there';

        await mailer.sendMail({
          from: 'CoachCarter <bookings@coachcarter.uk>',
          to: learner.email,
          subject: `${firstName}, your driving lessons are now on CoachCarter`,
          html: buildWelcomeHtml(firstName, magicUrl)
        });

        // Mark as sent so we never re-send
        await sql`
          UPDATE learner_users
          SET welcome_email_sent_at = NOW()
          WHERE id = ${learner.id}
        `;

        sent++;
      } catch (err) {
        // Mark as sent even on failure to avoid retry-bombing a bad email
        await sql`
          UPDATE learner_users
          SET welcome_email_sent_at = NOW()
          WHERE id = ${learner.id}
        `;
        failed++;
      }
    }

    return res.json({ ok: true, sent, failed, checked: learners.length });

  } catch (err) {
    reportError('/api/setmore-welcome', err);
    return res.status(500).json({ error: 'Welcome emails failed' });
  }
};

function buildWelcomeHtml(firstName, magicUrl) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h1 style="font-size: 1.4rem; color: #262626;">Hi ${firstName}, welcome to CoachCarter!</h1>
      <p style="color: #555; font-size: 0.95rem; line-height: 1.6;">
        We've upgraded how we manage your driving lessons. You now have your own
        CoachCarter account where you can:
      </p>
      <ul style="color: #555; font-size: 0.95rem; line-height: 1.8; padding-left: 20px;">
        <li><strong>See your upcoming lessons</strong> at a glance</li>
        <li><strong>Track your progress</strong> across all 17 driving skills</li>
        <li><strong>Book and manage lessons</strong> directly online</li>
        <li><strong>Access videos and quizzes</strong> to help you prepare</li>
      </ul>
      <p style="color: #555; font-size: 0.95rem; line-height: 1.6;">
        Your existing bookings are already in the system — just sign in to see everything.
      </p>
      <div style="text-align: center; margin: 28px 0;">
        <a href="${magicUrl}"
           style="background: #f58321; color: white; padding: 14px 36px; text-decoration: none;
                  border-radius: 8px; display: inline-block; font-weight: 600; font-size: 1rem;">
          Sign in to your account
        </a>
      </div>
      <p style="color: #999; font-size: 0.8rem; line-height: 1.5;">
        This link is valid for 7 days. After that, you can request a new sign-in
        link from the <a href="${magicUrl.split('/learner/')[0]}/learner/login.html" style="color: #f58321;">login page</a>.
      </p>
      <p style="color: #999; font-size: 0.8rem; margin-top: 16px;">
        Questions? Just reply to this email — we're here to help.
      </p>
    </div>
  `;
}
