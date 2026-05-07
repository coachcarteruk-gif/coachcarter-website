/**
 * Instructor password authentication (May 2026).
 *
 * Differs from learner auth in three ways:
 *   1. No self-signup — instructors are created by admins via api/instructors.js
 *      or seeded via SQL. The login endpoint is the only entry point.
 *   2. No self-serve forgot-password — only an admin can reset an
 *      instructor's password (api/instructors.js?action=set-password).
 *   3. First-login force-change — when an admin sets a password, the row
 *      gets must_change_password=true. The login endpoint signals this
 *      via {must_change_password: true} so the UI can route to a
 *      change-password screen before the dashboard.
 *
 * Magic-link login (api/instructor.js) is retained for in-flight tokens
 * during deploy + as an admin emergency fallback. New code should not use it.
 *
 * Endpoints:
 *   POST ?action=login            { email, password }
 *   POST ?action=change-password  { current_password, new_password }   (authed)
 *   POST ?action=logout           (mirrors api/instructor.js logout)
 */

const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const { sanitizeEmail } = require('./_auth-helpers');
const {
  SESSION_COOKIE_NAMES, SESSION_MAX_AGE_SEC,
  buildSessionCookie, buildSessionClearCookie, requireAuth,
} = require('./_auth');
const {
  buildCsrfCookie, buildCsrfClearCookie, mintCsrfToken, appendSetCookie,
} = require('./_csrf');
const {
  validatePassword, hashPassword, verifyPassword,
  checkLoginLockout, recordFailedLogin, clearLoginLockout,
} = require('./_password');
const { logAudit } = require('./_audit');
const { reportError } = require('./_error-alert');

const ROLE = 'instructor';
const COOKIE_NAME = SESSION_COOKIE_NAMES.instructor;
const COOKIE_MAX_AGE = SESSION_MAX_AGE_SEC.instructor;

module.exports = async (req, res) => {
  const action = req.query.action;
  if (action === 'login')           return handleLogin(req, res);
  if (action === 'change-password') return handleChangePassword(req, res);
  if (action === 'logout')          return handleLogout(req, res);
  return res.status(400).json({ error: 'Unknown action' });
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function issueSession(res, instructor) {
  const secret = process.env.JWT_SECRET;
  const payload = {
    id: instructor.id,
    email: instructor.email,
    role: ROLE,
    school_id: instructor.school_id || 1,
  };
  if (instructor.is_admin) payload.isAdmin = true;
  const token = jwt.sign(payload, secret, { expiresIn: '180d' });
  appendSetCookie(res, buildSessionCookie(COOKIE_NAME, token, COOKIE_MAX_AGE));
  appendSetCookie(res, buildCsrfCookie(mintCsrfToken()));
}

function publicInstructor(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    photo_url: row.photo_url,
    is_admin: !!row.is_admin,
    school_id: row.school_id || 1,
    onboarding_complete: !!row.onboarding_complete,
  };
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

    const lockout = await checkLoginLockout(sql, ROLE, cleanEmail);
    if (lockout.locked) {
      return res.status(429).json({
        error: 'locked',
        message: `Too many failed attempts. Try again in ${lockout.retryAfterMin} minute${lockout.retryAfterMin === 1 ? '' : 's'}.`,
      });
    }

    const [row] = await sql`
      SELECT id, name, email, photo_url, password_hash, school_id,
             onboarding_complete, must_change_password,
             COALESCE(is_admin, FALSE) AS is_admin,
             active
        FROM instructors
       WHERE LOWER(email) = LOWER(${cleanEmail})`;

    if (!row || !row.active || !row.password_hash) {
      // No account, deactivated, or no password set yet — same opaque response.
      // (Admin must set a password before instructor can log in.)
      await recordFailedLogin(sql, ROLE, cleanEmail);
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Email or password is incorrect.',
      });
    }

    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) {
      await recordFailedLogin(sql, ROLE, cleanEmail);
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Email or password is incorrect.',
      });
    }

    await clearLoginLockout(sql, ROLE, cleanEmail);

    issueSession(res, row);
    return res.json({
      success: true,
      instructor: publicInstructor(row),
      must_change_password: !!row.must_change_password,
    });
  } catch (err) {
    console.error('instructor login error:', err);
    reportError('/api/instructor-auth', err);
    return res.status(500).json({ error: 'Login failed' });
  }
}

// ── POST ?action=change-password ────────────────────────────────────────────
//
// Authenticated. Used by:
//   - Forced first-login flow (when must_change_password = TRUE)
//   - Voluntary change from instructor profile page
//
// Body: { current_password, new_password }
//
// On forced-change, we still require the current password (which is the
// admin-set one the instructor just used to log in). This prevents an
// authenticated session from being used to silently change the password
// without re-proving identity.
async function handleChangePassword(req, res) {
  const auth = requireAuth(req, { roles: ['instructor'] });
  if (!auth) return res.status(401).json({ error: 'Unauthorised' });

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const currentPassword = req.body?.current_password;
    const newPassword = req.body?.new_password;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both current and new password are required.' });
    }

    const pwdErr = validatePassword(newPassword);
    if (pwdErr) return res.status(400).json({ error: 'invalid_password', message: pwdErr });

    if (currentPassword === newPassword) {
      return res.status(400).json({
        error: 'same_password',
        message: 'New password must be different from your current password.',
      });
    }

    const sql = neon(process.env.POSTGRES_URL);

    const [row] = await sql`
      SELECT id, password_hash, school_id
        FROM instructors
       WHERE id = ${auth.id}`;
    if (!row || !row.password_hash) {
      return res.status(401).json({ error: 'Unauthorised' });
    }

    const ok = await verifyPassword(currentPassword, row.password_hash);
    if (!ok) {
      return res.status(401).json({
        error: 'invalid_current_password',
        message: 'Your current password is incorrect.',
      });
    }

    const newHash = await hashPassword(newPassword);
    await sql`
      UPDATE instructors
         SET password_hash = ${newHash},
             password_set_at = NOW(),
             must_change_password = FALSE
       WHERE id = ${row.id}`;

    try {
      await logAudit(sql, {
        adminId: null, adminEmail: auth.email,
        action: 'instructor.password_change',
        targetType: 'instructors', targetId: row.id,
        details: { self: true },
        schoolId: row.school_id || 1, req,
      });
    } catch {}

    return res.json({ success: true });
  } catch (err) {
    console.error('instructor change-password error:', err);
    reportError('/api/instructor-auth', err);
    return res.status(500).json({ error: 'Could not change password' });
  }
}

// ── POST ?action=logout ─────────────────────────────────────────────────────
async function handleLogout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  appendSetCookie(res, buildSessionClearCookie(COOKIE_NAME));
  appendSetCookie(res, buildCsrfClearCookie());
  return res.json({ ok: true });
}
