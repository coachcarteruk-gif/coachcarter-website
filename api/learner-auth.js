/**
 * Learner authentication (email-code primary; legacy password compatibility).
 *
 * The primary learner UI uses email codes for sign-in and account creation.
 * Password endpoints remain available only for older clients and account
 * migration/reset compatibility.
 *
 * Endpoints:
 *   POST ?action=login          { email, password }
 *   POST ?action=signup         { email, password, name?, referral_code?, school_id? } (legacy)
 *   POST ?action=signup-with-code { ticket, name, referral_code? }
 *   POST ?action=set-password   { ticket, password } — completes migration / reset
 *   POST ?action=request-reset  { email } — sends reset link (no enumeration leak)
 *   POST ?action=add-email      { email } — authenticated phone-only users adding email
 *
 * Sets the standard cc_learner httpOnly session cookie + cc_csrf double-submit
 * cookie on success. Login/legacy signup/signup-with-code/set-password issue a
 * JWT immediately; reset issues a verification ticket redeemed via set-password.
 *
 * Audit logging: signup, set-password, password reset are all logged via
 * api/_audit.js since these are sensitive auth-state mutations.
 */

const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const { sanitizeEmail } = require('./_auth-helpers');
const { SESSION_COOKIE_NAMES, SESSION_MAX_AGE_SEC, buildSessionCookie, requireAuth } = require('./_auth');
const { buildCsrfCookie, mintCsrfToken, appendSetCookie } = require('./_csrf');
const {
  validatePassword, hashPassword, verifyPassword,
  checkLoginLockout, recordFailedLogin, clearLoginLockout,
} = require('./_password');
const { logAudit } = require('./_audit');
const { reportError } = require('./_error-alert');
const { checkRateLimit, getClientIp: getRateLimitClientIp } = require('./_rate-limit');
const { resolveSchoolFromRequest } = require('./_tenant');

const FREE_TRIAL_CREDITS = 0;
const ROLE = 'learner';
const COOKIE_NAME = SESSION_COOKIE_NAMES.learner;
const COOKIE_MAX_AGE = SESSION_MAX_AGE_SEC.learner;

// ── Router ──────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const action = req.query.action;
  if (action === 'login')                    return handleLogin(req, res);
  if (action === 'signup')                   return handleSignup(req, res);
  if (action === 'signup-with-code')         return handleSignupWithCode(req, res);
  if (action === 'set-password')             return handleSetPassword(req, res);
  if (action === 'set-password-from-offer')  return handleSetPasswordFromOffer(req, res);
  if (action === 'request-reset')            return handleRequestReset(req, res);
  if (action === 'add-email')                return handleAddEmail(req, res);
  if (action === 'check-account')            return handleCheckAccount(req, res);
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

// Creates a zero-credit account for someone whose lesson or trial was handled
// outside the booking system. The email-code ticket proves ownership; no
// password is created and no additional free-trial entitlement is granted.
async function handleSignupWithCode(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const ticket = typeof req.body?.ticket === 'string' ? req.body.ticket.trim() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const referralCode = typeof req.body?.referral_code === 'string'
      ? req.body.referral_code.trim()
      : '';

    if (!ticket) {
      return res.status(400).json({
        error: 'invalid_ticket',
        message: 'Email verification is required. Please request a new code.'
      });
    }
    if (!name || name.length > 200) {
      return res.status(400).json({ error: 'invalid_name', message: 'Please enter your name.' });
    }

    const secret = process.env.JWT_SECRET;
    let claims;
    try {
      claims = jwt.verify(ticket, secret, { audience: 'learner-signup' });
    } catch {
      return res.status(400).json({
        error: 'invalid_ticket',
        message: 'This verification has expired. Please request a new code.'
      });
    }

    if (claims.role !== ROLE || claims.purpose !== 'signup') {
      return res.status(400).json({
        error: 'invalid_ticket',
        message: 'Verification is for a different account action.'
      });
    }

    const cleanEmail = sanitizeEmail(claims.sub);
    const schoolId = parseInt(claims.school_id, 10) || 1;
    if (!cleanEmail) return res.status(400).json({ error: 'invalid_ticket' });

    const sql = neon(process.env.POSTGRES_URL);

    const [instr] = await sql`
      SELECT id FROM instructors
       WHERE LOWER(email) = LOWER(${cleanEmail})
         AND school_id = ${schoolId}
         AND active = TRUE`;
    if (instr) {
      return res.status(400).json({
        error: 'instructor_account',
        message: 'This email is linked to an instructor account.',
        redirect: '/instructor/login.html'
      });
    }

    const [existing] = await sql`
      SELECT id FROM learner_users
       WHERE LOWER(email) = LOWER(${cleanEmail})
         AND school_id = ${schoolId}`;
    if (existing) {
      return res.status(409).json({
        error: 'account_exists',
        message: 'A learner account with that email already exists. Sign in instead.'
      });
    }

    let referrerId = null;
    if (referralCode) {
      try {
        const [ref] = await sql`
          SELECT learner_id FROM referrals
           WHERE code = ${referralCode}
             AND school_id = ${schoolId}`;
        if (ref) referrerId = ref.learner_id;
      } catch {}
    }

    const [user] = await sql`
      INSERT INTO learner_users
        (email, name, credit_balance, school_id, referred_by, email_verified, last_activity_at)
      VALUES
        (${cleanEmail}, ${name}, 0, ${schoolId}, ${referrerId}, TRUE, NOW())
      RETURNING id, name, email, phone, school_id, current_tier, terms_accepted_at`;

    try {
      await logAudit(sql, {
        adminId: null, adminEmail: cleanEmail,
        action: 'learner.signup',
        targetType: 'learner_users', targetId: user.id,
        details: {
          method: 'email_code',
          source: 'offline_lesson_or_trial',
          free_trial_credit_minutes: 0
        },
        schoolId, req
      });
    } catch {}

    issueSession(res, user);
    return res.json({
      success: true,
      user: publicUser(user),
      is_new_user: true,
      needs_name: false,
      terms_accepted: !!user.terms_accepted_at
    });
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({
        error: 'account_exists',
        message: 'A learner account with that email already exists. Sign in instead.'
      });
    }
    console.error('signup-with-code error:', err);
    reportError('/api/learner-auth', err);
    return res.status(500).json({ error: 'Could not create account' });
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

    if (claims.role !== ROLE || (claims.purpose !== 'migration' && claims.purpose !== 'reset')) {
      return res.status(400).json({ error: 'invalid_ticket', message: 'Verification is for a different account type.' });
    }

    const sql = neon(process.env.POSTGRES_URL);
    const cleanEmail = sanitizeEmail(claims.sub);
    const schoolId = Number.parseInt(claims.school_id, 10);
    if (!cleanEmail || !Number.isInteger(schoolId) || schoolId <= 0) {
      return res.status(400).json({ error: 'invalid_ticket' });
    }

    const passwordHash = await hashPassword(password);
    let user;
    if (claims.purpose === 'migration') {
      const learnerId = Number.parseInt(claims.learner_id, 10);
      if (!Number.isInteger(learnerId) || learnerId <= 0) {
        return res.status(400).json({ error: 'invalid_ticket' });
      }
      [user] = await sql`
        UPDATE learner_users
           SET email = ${cleanEmail},
               password_hash = ${passwordHash},
               password_set_at = NOW(),
               email_verified = TRUE,
               last_activity_at = NOW()
         WHERE id = ${learnerId}
           AND school_id = ${schoolId}
           AND password_hash IS NULL
        RETURNING id, name, email, phone, school_id, current_tier, terms_accepted_at, password_hash`;
    } else {
      [user] = await sql`
        UPDATE learner_users
           SET password_hash = ${passwordHash},
               password_set_at = NOW(),
               email_verified = TRUE,
               last_activity_at = NOW()
         WHERE LOWER(email) = LOWER(${cleanEmail})
           AND school_id = ${schoolId}
           AND password_hash IS NOT NULL
        RETURNING id, name, email, phone, school_id, current_tier, terms_accepted_at, password_hash`;
    }

    if (!user) {
      return res.status(400).json({ error: 'invalid_ticket', message: 'Account not found.' });
    }

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
    if (err?.code === '23505') {
      return res.status(409).json({
        error: 'email_in_use',
        message: 'That email is already linked to a different account.',
      });
    }
    console.error('set-password error:', err);
    reportError('/api/learner-auth', err);
    return res.status(500).json({ error: 'Could not set password' });
  }
}

// ── POST ?action=set-password-from-offer ────────────────────────────────────
//
// Bridges a paid lesson_offer to an authed session for guest learners. After
// Stripe checkout the webhook creates a learner_users row but the device that
// just paid has no session cookie — the learner lands on offer-success.html
// and can't book the slot via fetchAuthed without one.
//
// Authorisation: possessing the offer token + the offer being in 'accepted'
// state (i.e. the webhook successfully ran and credited the learner). The
// token alone is unguessable (32 bytes) and the 'accepted' gate means no-one
// can use it pre-payment. We further require password_hash IS NULL on the
// learner — existing customers with passwords go through normal login. The
// 24h post-acceptance window prevents stale tokens being weaponised long
// after the booking flow has lapsed.
//
// Body: { offer_token, password }
async function handleSetPasswordFromOffer(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const offerToken = typeof req.body?.offer_token === 'string' ? req.body.offer_token.trim() : '';
    const password = req.body?.password;
    if (!offerToken) return res.status(400).json({ error: 'Missing offer token.' });

    const pwdErr = validatePassword(password);
    if (pwdErr) return res.status(400).json({ error: 'invalid_password', message: pwdErr });

    const sql = neon(process.env.POSTGRES_URL);

    const [offer] = await sql`
      SELECT id, learner_id, school_id, accepted_at, status
        FROM lesson_offers
       WHERE token = ${offerToken}`;

    if (!offer || offer.status !== 'accepted' || !offer.learner_id) {
      return res.status(400).json({ error: 'invalid_offer', message: 'This offer is no longer valid.' });
    }

    // Reject stale tokens — the post-payment "set a password" window is short.
    if (!offer.accepted_at || (Date.now() - new Date(offer.accepted_at).getTime()) > 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'expired', message: 'This setup link has expired. Please use the login page instead.' });
    }

    const [user] = await sql`
      SELECT id, name, email, phone, school_id, current_tier, terms_accepted_at, password_hash
        FROM learner_users
       WHERE id = ${offer.learner_id}
         AND school_id = ${offer.school_id}`;

    if (!user) {
      return res.status(400).json({ error: 'invalid_offer', message: 'Account not found.' });
    }

    // Refuse to overwrite an existing password — existing customers must use login.
    if (user.password_hash) {
      return res.status(409).json({
        error: 'password_already_set',
        message: 'This account already has a password. Please sign in instead.',
      });
    }

    const passwordHash = await hashPassword(password);
    await sql`
      UPDATE learner_users
         SET password_hash = ${passwordHash},
             password_set_at = NOW(),
             email_verified = TRUE,
             last_activity_at = NOW()
       WHERE id = ${user.id}
         AND school_id = ${offer.school_id}`;

    await clearLoginLockout(sql, ROLE, user.email);

    try {
      await logAudit(sql, {
        adminId: null, adminEmail: user.email,
        action: 'learner.password_set',
        targetType: 'learner_users', targetId: user.id,
        details: { purpose: 'offer_signup', offer_id: offer.id },
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
    console.error('set-password-from-offer error:', err);
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
    const tenant = await resolveSchoolFromRequest(req, { sql, allowLegacySchoolIdQuery: true });
    const schoolId = tenant?.schoolId || 1;
    const [acct] = await sql`
      SELECT id, password_hash, school_id
        FROM learner_users
       WHERE LOWER(email) = LOWER(${cleanEmail})
         AND school_id = ${schoolId}`;
    const shouldSend = !!(acct && acct.password_hash);

    if (shouldSend) {
      // Generate code + token via the magic-link infrastructure
      const crypto = require('crypto');
      const emailCode = crypto.randomInt(100000, 999999).toString();
      const longToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      // Invalidate older unused reset rows
      await sql`UPDATE magic_link_tokens SET used = true
                 WHERE email = ${cleanEmail}
                   AND school_id = ${schoolId}
                   AND purpose = 'reset'
                   AND role = 'learner'
                   AND used = false`;

      await sql`
        INSERT INTO magic_link_tokens (token, email_code, email, method, expires_at, school_id, purpose, role)
        VALUES (${longToken}, ${emailCode}, ${cleanEmail}, 'email', ${expiresAt}, ${schoolId}, 'reset', 'learner')`;

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
// For phone-only learners migrating to password auth. The caller must already
// hold the learner session issued after successful SMS verification. The new
// email remains only on the short-lived verification token until its code is
// verified; set-password then attaches the email and password atomically.
//
// Body: { email }
async function handleAddEmail(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const auth = requireAuth(req, { roles: ['learner'], requireSchool: true });
    if (!auth) return res.status(401).json({ error: 'Unauthorised' });

    const cleanEmail = sanitizeEmail(req.body?.email);
    if (!cleanEmail) {
      return res.status(400).json({ error: 'A valid email is required.' });
    }

    const sql = neon(process.env.POSTGRES_URL);
    const schoolId = Number(auth.school_id);
    const learnerId = Number(auth.id);

    const accountLimit = await checkRateLimit(sql, {
      key: `learner_add_email:${schoolId}:${learnerId}`,
      max: 5,
      windowSeconds: 3600,
    });
    const ipLimit = await checkRateLimit(sql, {
      key: `learner_add_email_ip:${getRateLimitClientIp(req)}`,
      max: 20,
      windowSeconds: 3600,
    });
    if (!accountLimit.allowed || !ipLimit.allowed) {
      return res.status(429).json({ error: 'Too many code requests. Please try again in an hour.' });
    }

    const [user] = await sql`
      SELECT id, school_id, phone, email, password_hash
        FROM learner_users
       WHERE id = ${learnerId}
         AND school_id = ${schoolId}`;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorised' });
    }
    if (!user.phone || user.password_hash || user.email) {
      // User already migrated. Don't overwrite.
      return res.status(409).json({
        error: 'already_migrated',
        message: 'This account already has an email or password. Please sign in normally.',
      });
    }

    // Conflict check: is the email already used by a different account?
    const [emailConflict] = await sql`
      SELECT id FROM learner_users
       WHERE LOWER(email) = LOWER(${cleanEmail})
         AND school_id = ${schoolId}
         AND id != ${user.id}`;
    if (emailConflict) {
      return res.status(409).json({
        error: 'email_in_use',
        message: 'That email is already linked to a different account.',
      });
    }

    // Generate + store + send the migration code (mirrors send-email-code)
    const crypto = require('crypto');
    const emailCode = crypto.randomInt(100000, 999999).toString();
    const longToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await sql`UPDATE magic_link_tokens SET used = true
               WHERE phone = ${user.phone}
                 AND school_id = ${schoolId}
                 AND purpose = 'migration'
                 AND role = 'learner'
                 AND used = false`;

    await sql`
      INSERT INTO magic_link_tokens (token, email_code, email, phone, method, expires_at, school_id, purpose, role)
      VALUES (${longToken}, ${emailCode}, ${cleanEmail}, ${user.phone}, 'email', ${expiresAt}, ${schoolId}, 'migration', 'learner')`;

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
