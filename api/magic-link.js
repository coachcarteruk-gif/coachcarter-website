const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const twilio = require('twilio');
const { createTransporter, generateToken, sanitizeEmail } = require('./_auth-helpers');
const { SESSION_COOKIE_NAMES, SESSION_MAX_AGE_SEC,
        buildSessionCookie, buildSessionClearCookie } = require('./_auth');
const { buildCsrfCookie, buildCsrfClearCookie, mintCsrfToken, appendSetCookie } = require('./_csrf');
const { reportError } = require('./_error-alert');
const { lockBalanceAndMutate } = require('./_credit-grant');

const FREE_TRIAL_CREDITS = 0;

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

// Generate a 6-digit numeric code for SMS verification
function generateSmsCode() {
  return crypto.randomInt(100000, 999999).toString();
}

// ── CORS + routing ──────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const action = req.query.action;
  if (action === 'send-link')         return handleSendLink(req, res);
  if (action === 'verify-code')       return handleVerifyCode(req, res);
  if (action === 'send-email-code')   return handleSendEmailCode(req, res);
  if (action === 'verify-email-code') return handleVerifyEmailCode(req, res);
  if (action === 'logout')            return handleLogout(req, res);
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

    const cleanEmail = email ? sanitizeEmail(email) : null;
    const cleanPhone = phone ? phone.replace(/\s+/g, '').trim() : null;

    if (method !== 'sms' && !cleanEmail) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    // Rate limiting: max 5 magic link sends per email/phone per hour
    const rateLimitKey = method === 'sms' ? `magic_sms:${cleanPhone}` : `magic_email:${cleanEmail}`;
    try {
      // Clean up old windows and check current count
      await sql`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour'`;
      const [existing] = await sql`SELECT request_count FROM rate_limits WHERE key = ${rateLimitKey} AND window_start > NOW() - INTERVAL '1 hour'`;
      if (existing && existing.request_count >= 5) {
        return res.status(429).json({ error: 'Too many login requests. Please try again in an hour.' });
      }
      if (existing) {
        await sql`UPDATE rate_limits SET request_count = request_count + 1 WHERE key = ${rateLimitKey} AND window_start > NOW() - INTERVAL '1 hour'`;
      } else {
        await sql`INSERT INTO rate_limits (key, request_count, window_start) VALUES (${rateLimitKey}, 1, NOW())`;
      }
    } catch (e) { /* rate limit check failed — allow request through */ }

    // Generate a secure random token
    const token = generateToken();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

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

    // Derive school_id from request (login pages pass it as a query/body param)
    const schoolId = parseInt(req.body.school_id || req.query.school_id) || 1;
    const referralCode = req.body.referral_code || null;

    // Store the token
    await sql`
      INSERT INTO magic_link_tokens (token, email, phone, method, expires_at, school_id, referral_code)
      VALUES (${token}, ${cleanEmail}, ${cleanPhone}, ${method || 'email'}, ${expiresAt}, ${schoolId}, ${referralCode})`;

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

      // Generate a 6-digit code and store it alongside the token
      const smsCode = generateSmsCode();
      await sql`UPDATE magic_link_tokens SET token = ${smsCode} WHERE token = ${token}`;

      const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);
      await client.messages.create({
        body: `Your CoachCarter sign-in code is: ${smsCode}\n\nExpires in 15 minutes. Don't share this code.`,
        from: process.env.TWILIO_FROM,
        to: e164Phone
      });

      return res.json({
        success: true,
        message: 'A sign-in code has been sent to your phone.',
        method: 'sms'
      });
    } else {
      // Email magic-link login was retired in May 2026 — learners now use
      // email + password (api/learner-auth.js). This branch is left in
      // place returning a clear error in case any old client still calls it.
      return res.status(410).json({
        error: 'magic_link_retired',
        message: 'Email login links have been retired. Please use email + password to sign in.'
      });
    }
  } catch (err) {
    console.error('send-link error:', err);
    reportError('/api/magic-link', err);
    return res.status(500).json({ error: 'Failed to send login link' });
  }
}

// (handleValidate + handleVerify removed in May 2026 — magic-link login was
// retired in favour of email + password. SMS code flow lives below in
// handleVerifyCode. The applyReferralWelcomeBonus + sendWelcomeEmail helpers
// are still used by the SMS path and by api/learner-auth signup.)

// ── POST /api/magic-link?action=logout ───────────────────────────────────────
// Clear the cc_learner + cc_csrf cookies. No auth required.
async function handleLogout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  appendSetCookie(res, buildSessionClearCookie(SESSION_COOKIE_NAMES.learner));
  appendSetCookie(res, buildCsrfClearCookie());
  return res.json({ ok: true });
}

// ── Verify SMS code and issue JWT ─────────────────────────────────────────────
async function handleVerifyCode(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code, phone } = req.body || {};
  if (!code || !phone) return res.status(400).json({ error: 'Code and phone number are required' });

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'JWT_SECRET not configured' });

    const cleanPhone = phone.replace(/\s+/g, '').trim();
    const sql = neon(process.env.POSTGRES_URL);

    // Look up the code (stored in the token column)
    const rows = await sql`
      SELECT * FROM magic_link_tokens
      WHERE token = ${code.trim()} AND phone = ${cleanPhone} AND method = 'sms'
        AND used = false AND expires_at > NOW()`;

    if (rows.length === 0) {
      return res.status(400).json({ error: 'invalid_code', message: 'Invalid or expired code. Please try again or request a new one.' });
    }

    const linkRecord = rows[0];

    // Mark as used
    await sql`UPDATE magic_link_tokens SET used = true WHERE id = ${linkRecord.id}`;

    // Look up or create the user by phone
    let user;
    let isNewUser = false;

    const existing = await sql`
      SELECT id, name, email, phone, school_id, current_tier, terms_accepted_at
      FROM learner_users WHERE phone = ${linkRecord.phone}`;
    if (existing.length > 0) {
      user = existing[0];
    } else {
      isNewUser = true;
      const smsSchoolId = linkRecord.school_id || 1;

      // Resolve referral code if present
      let smsReferrerId = null;
      if (linkRecord.referral_code) {
        const [ref] = await sql`
          SELECT r.learner_id FROM referrals r
          WHERE r.code = ${linkRecord.referral_code} AND r.school_id = ${smsSchoolId}`;
        if (ref) smsReferrerId = ref.learner_id;
      }

      const newRows = await sql`
        INSERT INTO learner_users (phone, email, credit_balance, school_id, referred_by)
        VALUES (${linkRecord.phone}, ${linkRecord.email || null}, ${FREE_TRIAL_CREDITS}, ${smsSchoolId}, ${smsReferrerId})
        RETURNING *`;
      user = newRows[0];

      await sql`
        INSERT INTO credit_transactions
          (learner_id, type, credits, amount_pence, payment_method)
        VALUES
          (${user.id}, 'purchase', ${FREE_TRIAL_CREDITS}, 0, 'free_trial')`;

      // Apply referral welcome bonus
      if (smsReferrerId) {
        try {
          await applyReferralWelcomeBonus(sql, user.id, smsReferrerId, smsSchoolId);
        } catch (e) { console.warn('referral welcome bonus failed:', e.message); }
      }
    }

    // Issue JWT
    const jwtPayload = { id: user.id, email: user.email || null, role: 'learner', school_id: user.school_id || 1 };
    const jwtToken = jwt.sign(jwtPayload, secret, { expiresIn: '180d' });

    // Set httpOnly session cookie + CSRF double-submit cookie. See handleVerify.
    appendSetCookie(res, buildSessionCookie(SESSION_COOKIE_NAMES.learner, jwtToken, SESSION_MAX_AGE_SEC.learner));
    appendSetCookie(res, buildCsrfCookie(mintCsrfToken()));

    // GDPR: update last activity timestamp
    try { await sql`UPDATE learner_users SET last_activity_at = NOW() WHERE id = ${user.id}`; } catch (e) {}

    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name || null,
        email: user.email || null,
        tier: user.current_tier,
        school_id: user.school_id || 1
      },
      is_new_user: isNewUser,
      needs_name: !user.name,
      terms_accepted: !!user.terms_accepted_at
    });
  } catch (err) {
    console.error('verify-code error:', err);
    reportError('/api/magic-link', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}

// ── Send email code (May 2026) ──────────────────────────────────────────────
//
// Used by the new password auth flow for two purposes:
//   - 'migration': existing user with no password — verify they own the email,
//     then let them set one in the PWA (no cross-context bug).
//   - 'reset': forgot-password flow alternative for PWA users who can't tap
//     the reset link.
//
// Distinct from `send-link` which keeps the long URL token for password reset
// emails (those are tapped from desktop and don't need code entry).
//
// Body: { email, purpose: 'migration'|'reset', role?: 'learner', school_id? }
async function handleSendEmailCode(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, purpose } = req.body || {};
    const role = req.body?.role || 'learner';
    if (!email) return res.status(400).json({ error: 'Email address is required' });
    if (purpose !== 'migration' && purpose !== 'reset') {
      return res.status(400).json({ error: 'Invalid purpose' });
    }

    const cleanEmail = sanitizeEmail(email);
    if (!cleanEmail) return res.status(400).json({ error: 'Please enter a valid email address.' });

    const sql = neon(process.env.POSTGRES_URL);

    // Rate limiting: max 5 codes per email per hour. Reuses existing window.
    const rateLimitKey = `email_code:${cleanEmail}:${purpose}`;
    try {
      await sql`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour'`;
      const [existing] = await sql`SELECT request_count FROM rate_limits WHERE key = ${rateLimitKey} AND window_start > NOW() - INTERVAL '1 hour'`;
      if (existing && existing.request_count >= 5) {
        return res.status(429).json({ error: 'Too many code requests. Please try again in an hour.' });
      }
      if (existing) {
        await sql`UPDATE rate_limits SET request_count = request_count + 1 WHERE key = ${rateLimitKey} AND window_start > NOW() - INTERVAL '1 hour'`;
      } else {
        await sql`INSERT INTO rate_limits (key, request_count, window_start) VALUES (${rateLimitKey}, 1, NOW())`;
      }
    } catch { /* fail open */ }

    // For 'migration' on learner role: confirm an account actually exists with
    // this email (otherwise an attacker could probe for valid emails). We
    // *always* respond success to avoid email-enumeration leaks — but only
    // actually send the email if the account exists.
    let shouldSend = true;
    if (role === 'learner') {
      const [acct] = await sql`SELECT id, password_hash FROM learner_users WHERE email = ${cleanEmail}`;
      if (!acct) {
        // No account — silently skip sending. Same outward response.
        shouldSend = false;
      } else if (purpose === 'migration' && acct.password_hash) {
        // Account already has a password — migration code wouldn't apply.
        // Don't leak this either; just don't send.
        shouldSend = false;
      } else if (purpose === 'reset' && !acct.password_hash) {
        // Can't reset what hasn't been set. Don't leak; don't send.
        shouldSend = false;
      }
    }

    if (!shouldSend) {
      return res.json({
        success: true,
        message: 'If that email matches an account, a 6-digit code has been sent.'
      });
    }

    // Generate the 6-digit code + a long token (kept for any URL fallback).
    const emailCode = generateSmsCode();
    const longToken = generateToken();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);
    const schoolId = parseInt(req.body.school_id || req.query.school_id) || 1;

    // Invalidate any prior unused codes for this (email, purpose, role)
    await sql`UPDATE magic_link_tokens
                 SET used = true
               WHERE email = ${cleanEmail}
                 AND purpose = ${purpose}
                 AND role = ${role}
                 AND used = false`;

    await sql`
      INSERT INTO magic_link_tokens
        (token, email_code, email, method, expires_at, school_id, purpose, role)
      VALUES
        (${longToken}, ${emailCode}, ${cleanEmail}, 'email', ${expiresAt}, ${schoolId}, ${purpose}, ${role})`;

    // Cleanup
    await sql`DELETE FROM magic_link_tokens WHERE expires_at < NOW() - INTERVAL '1 day'`;

    await sendEmailCodeEmail(cleanEmail, emailCode, purpose);

    return res.json({
      success: true,
      message: 'A 6-digit code has been sent to your email.'
    });
  } catch (err) {
    console.error('send-email-code error:', err);
    reportError('/api/magic-link', err);
    return res.status(500).json({ error: 'Failed to send code' });
  }
}

// ── Verify email code (May 2026) ────────────────────────────────────────────
//
// Verifies a 6-digit code and returns a short-lived "verification ticket" the
// caller can present to /api/learner-auth?action=set-password (for migration)
// or ?action=reset-password (for reset). Does NOT issue a session JWT — that
// happens after the password is actually set.
//
// Body: { email, code, purpose: 'migration'|'reset', role?: 'learner' }
async function handleVerifyEmailCode(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, code, purpose } = req.body || {};
    const role = req.body?.role || 'learner';
    if (!email || !code) return res.status(400).json({ error: 'Email and code are required' });
    if (purpose !== 'migration' && purpose !== 'reset') {
      return res.status(400).json({ error: 'Invalid purpose' });
    }

    const cleanEmail = sanitizeEmail(email);
    if (!cleanEmail) return res.status(400).json({ error: 'Invalid email address' });

    const sql = neon(process.env.POSTGRES_URL);

    const rows = await sql`
      SELECT id, school_id FROM magic_link_tokens
       WHERE email = ${cleanEmail}
         AND email_code = ${String(code).trim()}
         AND purpose = ${purpose}
         AND role = ${role}
         AND used = false
         AND expires_at > NOW()`;

    if (rows.length === 0) {
      return res.status(400).json({
        error: 'invalid_code',
        message: 'Invalid or expired code. Please request a new one.'
      });
    }

    const linkRecord = rows[0];

    // Mint a short-lived signed verification ticket (5 min) the caller will
    // present to set-password / reset-password. Reusing JWT for simplicity —
    // it's a one-shot, signed by the same secret.
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'JWT_SECRET not configured' });

    const ticket = jwt.sign(
      { sub: cleanEmail, role, purpose, token_id: linkRecord.id, school_id: linkRecord.school_id },
      secret,
      { expiresIn: '5m', audience: 'password-set' }
    );

    // Mark the token as used now — ticket is what authorises the next step.
    await sql`UPDATE magic_link_tokens SET used = true WHERE id = ${linkRecord.id}`;

    return res.json({ success: true, ticket });
  } catch (err) {
    console.error('verify-email-code error:', err);
    reportError('/api/magic-link', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}

// ── Referral helpers ──────────────────────────────────────────────────────
async function applyReferralWelcomeBonus(sql, newLearnerId, referrerId, schoolId) {
  // Load school config to check if referrals are enabled
  const [school] = await sql`SELECT config FROM schools WHERE id = ${schoolId}`;
  const config = school?.config || {};
  if (!config.referral_enabled) return;

  const bonusMinutes = config.referral_welcome_bonus_minutes ?? 90;
  if (bonusMinutes <= 0) return;

  // Credit the new learner with welcome bonus. Step 4 cutover: atomic
  // balance + ledger via lockBalanceAndMutate. instructor_id grandfathers
  // to 1 (Fraser) — the welcome bonus is platform-funded and isn't
  // scoped to a specific instructor today.
  await lockBalanceAndMutate(sql, {
    learnerId: newLearnerId,
    schoolId,
    instructorId: 1,
    delta: bonusMinutes,
    ledgerType: 'referral_bonus',
    reason: 'referral',
    source: 'goodwill',
    absorbedBy: 'platform',
    allowOverdraft: true,
  });

  // Notify the referrer
  try {
    const [referrer] = await sql`SELECT name, email FROM learner_users WHERE id = ${referrerId} AND school_id = ${schoolId}`;
    const [newLearner] = await sql`SELECT name FROM learner_users WHERE id = ${newLearnerId} AND school_id = ${schoolId}`;
    if (referrer?.email) {
      await sendReferralUsedEmail(referrer.email, referrer.name, newLearner?.name);
    }
  } catch (e) { console.warn('referral notification email failed:', e.message); }
}

async function sendReferralUsedEmail(referrerEmail, referrerName, newLearnerName) {
  const mailer = createTransporter();
  const firstName = (referrerName || 'there').split(' ')[0];
  const referred = newLearnerName || 'Someone';
  await mailer.sendMail({
    from:    'CoachCarter <bookings@coachcarter.uk>',
    to:      referrerEmail,
    subject: 'Someone used your referral code!',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 1.3rem; color: #262626;">Hi ${firstName}!</h1>
        <p style="color: #555; font-size: 0.95rem; line-height: 1.6;">
          ${referred} just signed up using your referral code. Thanks for spreading the word!
        </p>
        <p style="color: #555; font-size: 0.95rem; line-height: 1.6;">
          Keep sharing your code — you'll earn free lesson time when their eligible paid lessons complete.
        </p>
        <p style="color: #999; font-size: 0.8rem; margin-top: 20px;">
          Check your dashboard to see your referral stats.
        </p>
      </div>
    `
  });
}

async function sendEmailCodeEmail(email, code, purpose) {
  const mailer = createTransporter();
  const subject = purpose === 'reset'
    ? 'Your CoachCarter password reset code'
    : 'Your CoachCarter sign-in code';
  const headline = purpose === 'reset' ? 'Reset your password' : 'Sign in to CoachCarter';
  const lead = purpose === 'reset'
    ? 'Enter the code below to reset your password. It expires in 15 minutes.'
    : 'Enter the code below to sign in. It expires in 15 minutes.';
  await mailer.sendMail({
    from:    'CoachCarter <bookings@coachcarter.uk>',
    to:      email,
    subject,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="font-size: 1.3rem; color: #262626; margin: 0;">${headline}</h1>
        </div>
        <p style="color: #555; font-size: 0.95rem; line-height: 1.6;">${lead}</p>
        <div style="text-align: center; margin: 28px 0;">
          <div style="display: inline-block; background: #fff4ec; border: 2px dashed #f58321;
                      border-radius: 12px; padding: 18px 28px;
                      font-family: 'SF Mono', Menlo, Consolas, monospace;
                      font-size: 2rem; letter-spacing: 0.4em;
                      font-weight: 700; color: #262626;">
            ${code}
          </div>
        </div>
        <p style="color: #999; font-size: 0.8rem; line-height: 1.5; text-align: center;">
          If you didn't request this, you can safely ignore this email.<br>
          We'll never ask you to share this code with anyone.
        </p>
      </div>
    `
  });
}

// (sendWelcomeEmail removed in May 2026 — was only called from the retired
// magic-link verify path. New signups via api/learner-auth.js don't currently
// trigger a welcome email; if that becomes desired, add it there.)
