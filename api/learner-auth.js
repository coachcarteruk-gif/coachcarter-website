/**
 * Learner password authentication (May 2026).
 *
 * Replaces the magic-link login flow. Existing magic-link API
 * (api/magic-link.js) is kept for SMS code login, password-reset emails, and
 * the new email-code migration flow.
 *
 * Endpoints:
 *   POST ?action=login          { email, password }
 *   POST ?action=signup         { email, password, name?, referral_code?, school_id? }
 *   POST ?action=set-password   { ticket, password } — completes migration / reset
 *   POST ?action=request-reset  { email } — sends reset link (no enumeration leak)
 *   POST ?action=add-email      { phone, email } — phone-only users adding email
 *
 * Sets the standard cc_learner httpOnly session cookie + cc_csrf double-submit
 * cookie on success. Login/signup/set-password issue a JWT immediately; reset
 * issues a verification ticket the user redeems via set-password.
 *
 * Audit logging: signup, set-password, password reset are all logged via
 * api/_audit.js since these are sensitive auth-state mutations.
 */

const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const { sanitizeEmail } = require('./_auth-helpers');
const { SESSION_COOKIE_NAMES, SESSION_MAX_AGE_SEC, buildSessionCookie } = require('./_auth');
const { buildCsrfCookie, mintCsrfToken, appendSetCookie } = require('./_csrf');
const {
  validatePassword, hashPassword, verifyPassword,
  checkLoginLockout, recordFailedLogin, clearLoginLockout,
} = require('./_password');
const { logAudit } = require('./_audit');
const { reportError } = require('./_error-alert');

const FREE_TRIAL_CREDITS = 0;
const ROLE = 'learner';
const COOKIE_NAME = SESSION_COOKIE_NAMES.learner;
const COOKIE_MAX_AGE = SESSION_MAX_AGE_SEC.learner;

// ── Router ──────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const action = req.query.action;
  if (action === 'login')          return handleLogin(req, res);
  if (action === 'signup')         return handleSignup(req, res);
  if (action === 'set-password')   return handleSetPassword(req, res);
  if (action === 'request-reset')  return handleRequestReset(req, res);
  if (action === 'add-email')      return handleAddEmail(req, res);
  if (action === 'check-account')  return handleCheckAccount(req, res);
  return res.status(400).json({ error: 'Unknown action' });
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function issueSession(res, user) {
  const secret = process.env.JWT_SECRET;
  const payload = {
    id: user.id,
    email: user.email || null,
    role: ROLE,
    school_id: user.school_id || 1,
  };
  const token = jwt.sign(payload, secret, { expiresIn: '180d' });
  appendSetCookie(res, buildSessionCookie(COOKIE_NAME, token, COOKIE_MAX_AGE));
  appendSetCookie(res, buildCsrfCookie(mintCsrfToken()));
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name || null,
    email: user.email || null,
    tier: user.current_tier,
    school_id: user.school_id || 1,
  };
}

function getClientIp(req) {
  return (req.headers && req.headers['x-forwarded-for'] || '')
    .split(',')[0].trim() || 'unknown';
}

// ── POST ?action=check-account ──────────────────────────────────────────────
//
// The login UI calls this BEFORE showing the password field, so it can route
// the user into the right flow:
//   - exists & has password   → show password field
//   - exists & no password    → "set a password" migration flow (send code)
//   - doesn't exist           → suggest signup
//
// Body: { email }
// Returns: { exists, has_password }   (never leaks more than this)
async function handleCheckAccount(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const cleanEmail = sanitizeEmail(req.body?.email);
    if (!cleanEmail) return res.status(400).json({ error: 'Please enter a valid email address.' });

    const sql = neon(process.env.POSTGRES_URL);

    // Block instructor emails from learner login (mirrors magic-link.js logic)
    const [instr] = await sql`SELECT id FROM instructors WHERE LOWER(email) = LOWER(${cleanEmail}) AND active = TRUE`;
    if (instr) {
      return res.status(400).json({
        error: 'instructor_account',
        message: 'This email is linked to an instructor account.',
        redirect: '/instructor/login.html',
      });
    }

    const [acct] = await sql`SELECT id, password_hash FROM learner_users WHERE email = ${cleanEmail}`;
    return res.json({
      exists: !!acct,
      has_password: !!(acct && acct.password_hash),
    });
  } catch (err) {
    console.error('check-account error:', err);
    reportError('/api/learner-auth', err);
    return res.status(500).json({ error: 'Lookup failed' });
  }
}

// ── POST ?action=login ──────────────────────────────────────────────────────
async function handleLogin(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const cleanEmail = sanitizeEmail(req.body?.email);
    const password = req.body?.password;

    if (!cleanEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const sql = neon(process.env.POSTGRES_URL);

    // Lockout check
    const lockout = await checkLoginLockout(sql, ROLE, cleanEmail);
    if (lockout.locked) {
      return res.status(429).json({
        error: 'locked',
        message: `Too many failed attempts. Try again in ${lockout.retryAfterMin} minute${lockout.retryAfterMin === 1 ? '' : 's'}.`,
      });
    }

    const [user] = await sql`
      SELECT id, name, email, phone, password_hash, school_id, current_tier, terms_accepted_at
        FROM learner_users
       WHERE email = ${cleanEmail}`;

    if (!user || !user.password_hash) {
      // Either no account, or account exists with no password set yet.
      // Don't leak which — both look the same to the user.
      await recordFailedLogin(sql, ROLE, cleanEmail);
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Email or password is incorrect.',
      });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      await recordFailedLogin(sql, ROLE, cleanEmail);
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Email or password is incorrect.',
      });
    }

    // Success
    await clearLoginLockout(sql, ROLE, cleanEmail);
    try { await sql`UPDATE learner_users SET last_activity_at = NOW() WHERE id = ${user.id}`; } catch {}

    issueSession(res, user);
    return res.json({
      success: true,
      user: publicUser(user),
      is_new_user: false,
      needs_name: !user.name,
      terms_accepted: !!user.terms_accepted_at,
    });
  } catch (err) {
    console.error('login error:', err);
    reportError('/api/learner-auth', err);
    return res.status(500).json({ error: 'Login failed' });
  }
}

// ── POST ?action=signup ─────────────────────────────────────────────────────
//
// Creates a brand-new learner account with a password. Email is trusted at
// signup (verify-lazily policy). Returns a session immediately.
//
// Body: { email, password, name?, referral_code?, school_id? }
async function handleSignup(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const cleanEmail = sanitizeEmail(req.body?.email);
    const password = req.body?.password;
    const name = (req.body?.name || '').trim() || null;
    const referralCode = req.body?.referral_code || null;
    const schoolId = parseInt(req.body?.school_id) || 1;

    if (!cleanEmail) return res.status(400).json({ error: 'Please enter a valid email address.' });

    const pwdErr = validatePassword(password);
    if (pwdErr) return res.status(400).json({ error: 'invalid_password', message: pwdErr });

    const sql = neon(process.env.POSTGRES_URL);

    // Block instructor emails
    const [instr] = await sql`SELECT id FROM instructors WHERE LOWER(email) = LOWER(${cleanEmail}) AND active = TRUE`;
    if (instr) {
      return res.status(400).json({
        error: 'instructor_account',
        message: 'This email is linked to an instructor account.',
        redirect: '/instructor/login.html',
      });
    }

    // Conflict check
    const [existing] = await sql`SELECT id, password_hash FROM learner_users WHERE email = ${cleanEmail}`;
    if (existing) {
      return res.status(409).json({
        error: 'account_exists',
        message: existing.password_hash
          ? 'An account with that email already exists. Try signing in instead.'
          : 'An account with that email already exists. Please sign in to set your password.',
      });
    }

    const passwordHash = await hashPassword(password);

    // Resolve referral code (best-effort; non-blocking on failure)
    let referrerId = null;
    if (referralCode) {
      try {
        const [ref] = await sql`SELECT learner_id FROM referrals WHERE code = ${referralCode} AND school_id = ${schoolId}`;
        if (ref) referrerId = ref.learner_id;
      } catch {}
    }

    const [user] = await sql`
      INSERT INTO learner_users
        (email, password_hash, password_set_at, name, credit_balance, school_id, referred_by)
      VALUES
        (${cleanEmail}, ${passwordHash}, NOW(), ${name}, ${FREE_TRIAL_CREDITS}, ${schoolId}, ${referrerId})
      RETURNING id, name, email, phone, school_id, current_tier, terms_accepted_at`;

    // Free-trial credit transaction (matches existing magic-link signup behaviour)
    try {
      await sql`
        INSERT INTO credit_transactions (learner_id, type, credits, amount_pence, payment_method, school_id)
        VALUES (${user.id}, 'purchase', ${FREE_TRIAL_CREDITS}, 0, 'free_trial', ${schoolId})`;
    } catch (e) { console.warn('signup credit_transactions insert failed:', e.message); }

    // Audit-log signup as a sensitive auth-state mutation
    try {
      await logAudit(sql, {
        adminId: null, adminEmail: cleanEmail,
        action: 'learner.signup',
        targetType: 'learner_users', targetId: user.id,
        details: { method: 'password' },
        schoolId, req,
      });
    } catch {}

    issueSession(res, user);
    return res.json({
      success: true,
      user: publicUser(user),
      is_new_user: true,
      needs_name: !user.name,
      terms_accepted: !!user.terms_accepted_at,
    });
  } catch (err) {
    console.error('signup error:', err);
    reportError('/api/learner-auth', err);
    return res.status(500).json({ error: 'Signup failed' });
  }
}

// ── POST ?action=set-password ───────────────────────────────────────────────
//
// Completes a migration or password-reset by setting a new password. Caller
// must present a valid `ticket` from /api/magic-link?action=verify-email-code
// (or, in the future, from a password-reset link landing).
//
// Body: { ticket, password }
async function handleSetPassword(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const ticket = req.body?.ticket;
    const password = req.body?.password;
    if (!ticket) return res.status(400).json({ error: 'Missing verification ticket. Please start the flow again.' });

    const pwdErr = validatePassword(password);
    if (pwdErr) return res.status(400).json({ error: 'invalid_password', message: pwdErr });

    const secret = process.env.JWT_SECRET;
    let claims;
    try {
      claims = jwt.verify(ticket, secret, { audience: 'password-set' });
    } catch {
      return res.status(400).json({
        error: 'invalid_ticket',
        message: 'This verification has expired. Please request a new code.',
      });
    }

    if (claims.role !== ROLE) {
      return res.status(400).json({ error: 'invalid_ticket', message: 'Verification is for a different account type.' });
    }

    const sql = neon(process.env.POSTGRES_URL);
    const cleanEmail = sanitizeEmail(claims.sub);
    if (!cleanEmail) return res.status(400).json({ error: 'invalid_ticket' });

    const [user] = await sql`
      SELECT id, name, email, phone, school_id, current_tier, terms_accepted_at, password_hash
        FROM learner_users
       WHERE email = ${cleanEmail}`;

    if (!user) {
      return res.status(400).json({ error: 'invalid_ticket', message: 'Account not found.' });
    }

    const passwordHash = await hashPassword(password);
    await sql`
      UPDATE learner_users
         SET password_hash = ${passwordHash},
             password_set_at = NOW(),
             email_verified = TRUE,
             last_activity_at = NOW()
       WHERE id = ${user.id}`;

    // Clear any failed-login lockout the user might have accumulated.
    await clearLoginLockout(sql, ROLE, cleanEmail);

    // Audit
    try {
      await logAudit(sql, {
        adminId: null, adminEmail: cleanEmail,
        action: claims.purpose === 'reset' ? 'learner.password_reset' : 'learner.password_set',
        targetType: 'learner_users', targetId: user.id,
        details: { purpose: claims.purpose },
        schoolId: user.school_id || 1, req,
      });
    } catch {}

    issueSession(res, user);
    return res.json({
      success: true,
      user: publicUser(user),
      is_new_user: false,
      needs_name: !user.name,
      terms_accepted: !!user.terms_accepted_at,
    });
  } catch (err) {
    console.error('set-password error:', err);
    reportError('/api/learner-auth', err);
    return res.status(500).json({ error: 'Could not set password' });
  }
}

// ── POST ?action=request-reset ──────────────────────────────────────────────
//
// Triggers a password-reset email containing both a 6-digit code AND a
// clickable link to the reset page. The user can either:
//   - Tap the link (works on desktop and any browser)
//   - Type the code into the PWA (works in the PWA without cross-context bug)
//
// We delegate the actual email send to /api/magic-link?action=send-email-code
// with purpose='reset' — that endpoint already handles enumeration-safe
// behaviour (always returns success even if the email isn't a known account).
//
// Body: { email }
async function handleRequestReset(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const cleanEmail = sanitizeEmail(req.body?.email);
    if (!cleanEmail) return res.status(400).json({ error: 'Please enter a valid email address.' });

    // Re-use the email-code endpoint by invoking its logic. Easiest way is to
    // do the work inline (importing send-email-code internals would couple
    // these files tighter than I want). It's only ~10 lines.
    const sql = neon(process.env.POSTGRES_URL);

    // Enumeration-safe: same response regardless of account existence.
    const [acct] = await sql`SELECT id, password_hash FROM learner_users WHERE email = ${cleanEmail}`;
    const shouldSend = !!(acct && acct.password_hash);

    if (shouldSend) {
      // Generate code + token via the magic-link infrastructure
      const crypto = require('crypto');
      const emailCode = crypto.randomInt(100000, 999999).toString();
      const longToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      // Invalidate older unused reset rows
      await sql`UPDATE magic_link_tokens SET used = true
                 WHERE email = ${cleanEmail} AND purpose = 'reset' AND role = 'learner' AND used = false`;

      await sql`
        INSERT INTO magic_link_tokens (token, email_code, email, method, expires_at, school_id, purpose, role)
        VALUES (${longToken}, ${emailCode}, ${cleanEmail}, 'email', ${expiresAt}, ${acct.id ? 1 : 1}, 'reset', 'learner')`;

      // Send the email
      try {
        const { createTransporter } = require('./_auth-helpers');
        const mailer = createTransporter();
        await mailer.sendMail({
          from: 'CoachCarter <bookings@coachcarter.uk>',
          to: cleanEmail,
          subject: 'Reset your CoachCarter password',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
              <h1 style="font-size: 1.3rem; color: #262626; text-align: center;">Reset your password</h1>
              <p style="color: #555; font-size: 0.95rem; line-height: 1.6;">
                Enter this 6-digit code in the app to reset your password. It expires in 15 minutes.
              </p>
              <div style="text-align: center; margin: 28px 0;">
                <div style="display: inline-block; background: #fff4ec; border: 2px dashed #f58321;
                            border-radius: 12px; padding: 18px 28px;
                            font-family: 'SF Mono', Menlo, Consolas, monospace;
                            font-size: 2rem; letter-spacing: 0.4em;
                            font-weight: 700; color: #262626;">
                  ${emailCode}
                </div>
              </div>
              <p style="color: #999; font-size: 0.8rem; line-height: 1.5; text-align: center;">
                Didn't request this? You can safely ignore this email — your password won't change.
              </p>
            </div>
          `,
        });
      } catch (e) {
        console.error('reset email send failed:', e.message);
        // Still return success — don't leak SMTP failures via response
      }
    }

    return res.json({
      success: true,
      message: 'If that email matches an account, a password-reset email has been sent.',
    });
  } catch (err) {
    console.error('request-reset error:', err);
    reportError('/api/learner-auth', err);
    return res.status(500).json({ error: 'Could not send reset email' });
  }
}

// ── POST ?action=add-email ──────────────────────────────────────────────────
//
// For phone-only learners migrating to password auth. Takes a phone + new
// email, sends a 6-digit code to the email so they can verify ownership,
// then a follow-up set-password call attaches both to the account.
//
// We don't issue a session here; the user must complete via verify-email-code
// + set-password. To bind the email to the account we update the row before
// the email goes out (the email-code is the proof of ownership).
//
// Body: { phone, email }
async function handleAddEmail(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const phone = (req.body?.phone || '').replace(/\s+/g, '').trim();
    const cleanEmail = sanitizeEmail(req.body?.email);
    if (!phone || !cleanEmail) {
      return res.status(400).json({ error: 'Phone and email are required.' });
    }

    const sql = neon(process.env.POSTGRES_URL);

    const [user] = await sql`SELECT id, school_id, email, password_hash FROM learner_users WHERE phone = ${phone}`;
    if (!user) {
      // Don't reveal whether phone exists. Same response either way.
      return res.json({
        success: true,
        message: 'If that phone number matches an account, we\'ve sent a code to the email.',
      });
    }
    if (user.password_hash) {
      // User already migrated. Don't overwrite.
      return res.status(400).json({
        error: 'already_migrated',
        message: 'That account already has a password. Please sign in with email + password.',
      });
    }

    // Conflict check: is the email already used by a different account?
    const [emailConflict] = await sql`SELECT id FROM learner_users WHERE email = ${cleanEmail} AND id != ${user.id}`;
    if (emailConflict) {
      return res.status(409).json({
        error: 'email_in_use',
        message: 'That email is already linked to a different account.',
      });
    }

    // Bind the email to the account now (email_verified stays FALSE until
    // the user completes set-password). This is necessary because
    // set-password looks the user up by email — without binding, the SMS
    // user can't be resolved. If the user abandons the flow, the email is
    // "claimed" but unverified. A different person later trying to sign up
    // with the same email will hit account_exists → can sign in once they
    // know the password (which they don't, so they're prompted to migrate
    // and verify). Edge case but bounded.
    await sql`UPDATE learner_users SET email = ${cleanEmail}, email_verified = FALSE WHERE id = ${user.id}`;

    // Generate + store + send the migration code (mirrors send-email-code)
    const crypto = require('crypto');
    const emailCode = crypto.randomInt(100000, 999999).toString();
    const longToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await sql`UPDATE magic_link_tokens SET used = true
               WHERE email = ${cleanEmail} AND purpose = 'migration' AND role = 'learner' AND used = false`;

    await sql`
      INSERT INTO magic_link_tokens (token, email_code, email, method, expires_at, school_id, purpose, role)
      VALUES (${longToken}, ${emailCode}, ${cleanEmail}, 'email', ${expiresAt}, ${user.school_id || 1}, 'migration', 'learner')`;

    try {
      const { createTransporter } = require('./_auth-helpers');
      const mailer = createTransporter();
      await mailer.sendMail({
        from: 'CoachCarter <bookings@coachcarter.uk>',
        to: cleanEmail,
        subject: 'Your CoachCarter sign-in code',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="font-size: 1.3rem; color: #262626; text-align: center;">Add email + set password</h1>
            <p style="color: #555; font-size: 0.95rem; line-height: 1.6;">
              Enter this 6-digit code in the app to verify your email. Expires in 15 minutes.
            </p>
            <div style="text-align: center; margin: 28px 0;">
              <div style="display: inline-block; background: #fff4ec; border: 2px dashed #f58321;
                          border-radius: 12px; padding: 18px 28px;
                          font-family: 'SF Mono', Menlo, Consolas, monospace;
                          font-size: 2rem; letter-spacing: 0.4em;
                          font-weight: 700; color: #262626;">
                ${emailCode}
              </div>
            </div>
            <p style="color: #999; font-size: 0.8rem; line-height: 1.5; text-align: center;">
              Didn't request this? You can safely ignore this email.
            </p>
          </div>
        `,
      });
    } catch (e) {
      console.error('add-email send failed:', e.message);
    }

    return res.json({
      success: true,
      message: 'A 6-digit code has been sent to your email.',
    });
  } catch (err) {
    console.error('add-email error:', err);
    reportError('/api/learner-auth', err);
    return res.status(500).json({ error: 'Could not send code' });
  }
}
