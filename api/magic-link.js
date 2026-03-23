const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');
const { createTransporter, generateToken } = require('./_auth-helpers');

const FREE_TRIAL_CREDITS = 1;

// Normalize UK phone numbers to E.164 format for Twilio
function normalizeUKPhone(phone) {
  const digits = phone.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+44')) return digits;
  if (digits.startsWith('44') && digits.length >= 12) return '+' + digits;
  if (digits.startsWith('07') && digits.length === 11) return '+44' + digits.slice(1);
  if (digits.startsWith('7') && digits.length === 10) return '+44' + digits;
  return null; // not a valid UK mobile
}
const TOKEN_EXPIRY_MINUTES = 15;

// ── CORS + routing ──────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action = req.query.action;
  if (action === 'send-link') return handleSendLink(req, res);
  if (action === 'validate')  return handleValidate(req, res);
  if (action === 'verify')    return handleVerify(req, res);
  return res.status(400).json({ error: 'Unknown action' });
};

// ── Send magic link ─────────────────────────────────────────────────────────
async function handleSendLink(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, phone, method } = req.body;

    // Validate input based on method
    if (method === 'sms') {
      if (!phone) return res.status(400).json({ error: 'Phone number is required' });
    } else {
      if (!email) return res.status(400).json({ error: 'Email address is required' });
    }

    const sql = neon(process.env.POSTGRES_URL);

    // Ensure magic_link_tokens table exists
    await sql`
      CREATE TABLE IF NOT EXISTS magic_link_tokens (
        id SERIAL PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        email TEXT,
        phone TEXT,
        method TEXT NOT NULL DEFAULT 'email',
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`;

    // Generate a secure random token
    const token = generateToken();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

    const cleanEmail = email ? email.toLowerCase().trim() : null;
    const cleanPhone = phone ? phone.replace(/\s+/g, '').trim() : null;

    // Check if this email belongs to an instructor — redirect them early
    if (cleanEmail) {
      const instructorMatch = await sql`
        SELECT id FROM instructors
        WHERE LOWER(email) = LOWER(${cleanEmail}) AND active = TRUE`;
      if (instructorMatch.length > 0) {
        return res.status(400).json({
          error: 'instructor_account',
          message: 'This email is linked to an instructor account. Please use the instructor login instead.',
          redirect: '/instructor/login.html'
        });
      }
    }

    // Store the token
    await sql`
      INSERT INTO magic_link_tokens (token, email, phone, method, expires_at)
      VALUES (${token}, ${cleanEmail}, ${cleanPhone}, ${method || 'email'}, ${expiresAt})`;

    // Clean up expired tokens periodically
    await sql`DELETE FROM magic_link_tokens WHERE expires_at < NOW() OR used = true`;

    // Send the link
    const baseUrl = process.env.BASE_URL || 'https://coachcarter.uk';
    const magicUrl = `${baseUrl}/learner/login.html?token=${token}`;

    if (method === 'sms') {
      // SMS delivery — requires TWILIO_SID, TWILIO_AUTH, TWILIO_FROM env vars
      const hasSmsConfig = process.env.TWILIO_SID && process.env.TWILIO_AUTH && process.env.TWILIO_FROM;
      if (!hasSmsConfig) {
        return res.status(400).json({
          error: 'Text message login is not available yet. Please use email instead.'
        });
      }

      const e164Phone = normalizeUKPhone(cleanPhone);
      if (!e164Phone) {
        return res.status(400).json({
          error: 'Please enter a valid UK mobile number (e.g. 07700 900000).'
        });
      }

      const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
      await client.messages.create({
        body: `Your CoachCarter login link (expires in 15 min): ${magicUrl}`,
        from: process.env.TWILIO_FROM,
        to: e164Phone
      });

      return res.json({
        success: true,
        message: 'A login link has been sent to your phone.',
        method: 'sms'
      });
    } else {
      // Email delivery
      await sendMagicLinkEmail(cleanEmail, magicUrl);
      return res.json({
        success: true,
        message: 'A login link has been sent to your email.',
        method: 'email'
      });
    }
  } catch (err) {
    console.error('send-link error:', err);
    return res.status(500).json({ error: 'Failed to send login link' });
  }
}

// ── Validate token (lightweight, does NOT consume it) ────────────────────────
// Used by the verify page to check if the token is still valid before consuming.
// This prevents email-client link prefetchers from burning the token.
async function handleValidate(req, res) {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Token is required' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`
      SELECT id FROM magic_link_tokens
      WHERE token = ${token} AND used = false AND expires_at > NOW()`;

    if (rows.length === 0) {
      return res.status(400).json({ error: 'expired', message: 'This link has expired or has already been used. Please request a new one.' });
    }

    return res.json({ valid: true });
  } catch (err) {
    console.error('validate error:', err);
    return res.status(500).json({ error: 'Validation failed' });
  }
}

// ── Verify token and issue JWT ──────────────────────────────────────────────
async function handleVerify(req, res) {
  // Only accept POST — prevents email prefetchers from consuming the token
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.body?.token;
  if (!token) return res.status(400).json({ error: 'Token is required' });

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'JWT_SECRET not configured' });

    const sql = neon(process.env.POSTGRES_URL);

    // Look up the token
    const rows = await sql`
      SELECT * FROM magic_link_tokens
      WHERE token = ${token} AND used = false AND expires_at > NOW()`;

    if (rows.length === 0) {
      return res.status(400).json({ error: 'expired', message: 'This link has expired or has already been used. Please request a new one.' });
    }

    const linkRecord = rows[0];
    const identifier = linkRecord.email || linkRecord.phone;

    // Mark token as used immediately (prevents reuse)
    await sql`UPDATE magic_link_tokens SET used = true WHERE id = ${linkRecord.id}`;

    // Ensure learner_users table exists (with optional password_hash for legacy)
    await sql`
      CREATE TABLE IF NOT EXISTS learner_users (
        id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE,
        phone TEXT, password_hash TEXT,
        current_tier INTEGER DEFAULT 1,
        credit_balance INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`;

    // Add phone column if it doesn't exist (for existing databases)
    await sql`ALTER TABLE learner_users ADD COLUMN IF NOT EXISTS phone TEXT`;
    // Ensure phone uniqueness (ignore error if constraint already exists)
    try { await sql`ALTER TABLE learner_users ADD CONSTRAINT learner_users_phone_unique UNIQUE (phone)`; } catch {};
    // Drop NOT NULL constraints that conflict with magic link signup (name + password collected later or not at all)
    try { await sql`ALTER TABLE learner_users ALTER COLUMN name DROP NOT NULL`; } catch {};
    try { await sql`ALTER TABLE learner_users ALTER COLUMN password_hash DROP NOT NULL`; } catch {};

    // Look up or create the user
    let user;
    let isNewUser = false;

    if (linkRecord.email) {
      const existing = await sql`SELECT * FROM learner_users WHERE email = ${linkRecord.email}`;
      if (existing.length > 0) {
        user = existing[0];
      } else {
        // Check if this email belongs to an instructor
        const instructorMatch = await sql`
          SELECT id FROM instructors
          WHERE LOWER(email) = LOWER(${linkRecord.email}) AND active = TRUE`;
        if (instructorMatch.length > 0) {
          return res.status(400).json({
            error: 'instructor_account',
            message: 'This email is linked to an instructor account. Please use the instructor login instead.',
            redirect: '/instructor/login.html'
          });
        }

        // Auto-create new learner account
        isNewUser = true;
        const newRows = await sql`
          INSERT INTO learner_users (email, credit_balance)
          VALUES (${linkRecord.email}, ${FREE_TRIAL_CREDITS})
          RETURNING *`;
        user = newRows[0];

        // Record the free trial credit
        await sql`
          INSERT INTO credit_transactions
            (learner_id, type, credits, amount_pence, payment_method)
          VALUES
            (${user.id}, 'purchase', ${FREE_TRIAL_CREDITS}, 0, 'free_trial')`;
      }
    } else if (linkRecord.phone) {
      const existing = await sql`SELECT * FROM learner_users WHERE phone = ${linkRecord.phone}`;
      if (existing.length > 0) {
        user = existing[0];
      } else {
        isNewUser = true;
        const newRows = await sql`
          INSERT INTO learner_users (phone, credit_balance)
          VALUES (${linkRecord.phone}, ${FREE_TRIAL_CREDITS})
          RETURNING *`;
        user = newRows[0];

        await sql`
          INSERT INTO credit_transactions
            (learner_id, type, credits, amount_pence, payment_method)
          VALUES
            (${user.id}, 'purchase', ${FREE_TRIAL_CREDITS}, 0, 'free_trial')`;
      }
    }

    // Issue JWT
    const jwtPayload = { id: user.id, email: user.email || null };
    const jwtToken = jwt.sign(jwtPayload, secret, { expiresIn: '30d' });

    // Send welcome email to new users
    if (isNewUser && linkRecord.email) {
      try {
        await sendWelcomeEmail(linkRecord.email);
      } catch (emailErr) {
        console.error('welcome email error:', emailErr);
      }
    }

    return res.json({
      success: true,
      token: jwtToken,
      user: {
        id: user.id,
        name: user.name || null,
        email: user.email || null,
        tier: user.current_tier
      },
      is_new_user: isNewUser,
      needs_name: !user.name
    });
  } catch (err) {
    console.error('verify error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}

// ── Email helpers ───────────────────────────────────────────────────────────
async function sendMagicLinkEmail(email, magicUrl) {
  const mailer = createTransporter();
  await mailer.sendMail({
    from:    'CoachCarter <bookings@coachcarter.uk>',
    to:      email,
    subject: 'Your CoachCarter login link',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="font-size: 1.3rem; color: #262626; margin: 0;">Sign in to CoachCarter</h1>
        </div>
        <p style="color: #555; font-size: 0.95rem; line-height: 1.6;">
          Tap the button below to sign in. This link expires in ${TOKEN_EXPIRY_MINUTES} minutes.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${magicUrl}"
             style="background: #f58321; color: white; padding: 14px 36px; text-decoration: none;
                    border-radius: 8px; display: inline-block; font-weight: 600; font-size: 1rem;">
            Sign in to CoachCarter
          </a>
        </div>
        <p style="color: #999; font-size: 0.8rem; line-height: 1.5;">
          If you didn't request this, you can safely ignore this email.<br>
          This link can only be used once.
        </p>
      </div>
    `
  });
}

async function sendWelcomeEmail(email) {
  const mailer = createTransporter();
  await mailer.sendMail({
    from:    'CoachCarter <bookings@coachcarter.uk>',
    to:      email,
    subject: 'Welcome to CoachCarter — your free lesson is ready',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 1.4rem; color: #262626;">Welcome to CoachCarter!</h1>
        <p style="color: #555; font-size: 0.95rem; line-height: 1.6;">
          Your account is set up and we've added <strong style="color: #f58321;">1 free lesson</strong> to get you started.
          That's a full 1.5-hour lesson — no payment needed.
        </p>
        <h2 style="font-size: 1rem; color: #262626; margin-top: 24px;">What to do next:</h2>
        <ol style="color: #555; font-size: 0.95rem; line-height: 1.8; padding-left: 20px;">
          <li><strong>Pick a slot</strong> — Browse available times and book your free lesson</li>
          <li><strong>Turn up and drive</strong> — Meet your instructor and get behind the wheel</li>
          <li><strong>Decide what's next</strong> — No pressure, no auto-billing</li>
        </ol>
        <div style="text-align: center; margin: 28px 0;">
          <a href="https://coachcarter.uk/learner/book.html"
             style="background: #f58321; color: white; padding: 14px 28px; text-decoration: none;
                    border-radius: 8px; display: inline-block; font-weight: 600;">
            Book your free lesson →
          </a>
        </div>
        <p style="color: #999; font-size: 0.8rem; margin-top: 20px;">
          Questions? Just reply to this email — we're here to help.
        </p>
      </div>
    `
  });
}
