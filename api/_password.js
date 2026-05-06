/**
 * Shared password helpers for learner + instructor auth.
 *
 * Admin auth (api/admin.js) predates this module and has its own bcrypt calls;
 * leave it alone — it works.
 *
 * Rules (NIST 800-63B aligned):
 *   - Min 8 characters
 *   - Max 128 characters (bcrypt's own limit is 72 bytes; we cap before hashing
 *     so users can't be silently truncated)
 *   - No complexity requirements (per NIST)
 *   - Reject a small list of trivially common passwords
 *
 * Rate limiting (failed login attempts): 5 fails per email per 15 minutes,
 * then 15-minute lockout. Reuses the existing `rate_limits` table.
 */

const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 10;
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MIN = 15;

// Trivially common passwords. Not exhaustive — deliberately small. The goal is
// to stop "password", "12345678", and similar from being accepted, not to be a
// HIBP-style blocklist (which would need a DB load).
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234',
  '12345678', '123456789', '1234567890',
  'qwerty12', 'qwerty123', 'qwertyuiop',
  'iloveyou', 'iloveyou1', 'letmein', 'letmein1',
  'football', 'football1', 'baseball', 'baseball1',
  'welcome1', 'welcome12', 'welcome123',
  'admin123', 'administrator',
  'changeme', 'changeme1',
  'monkey12', 'monkey123', 'dragon12', 'dragon123',
  'abc12345', 'abcd1234', 'asdfghjkl',
  'sunshine', 'princess', 'starwars',
  'coachcarter', 'instructorbook', 'driving123', 'drivinglesson',
]);

/**
 * Validate a password. Returns null if OK, or an error string.
 *
 * Callers should surface the error string directly to the user — they're
 * written to be human-friendly.
 */
function validatePassword(password) {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters.`;
  }
  if (password.length > MAX_LENGTH) {
    return `Password must be ${MAX_LENGTH} characters or fewer.`;
  }
  // Whitespace-only or surrounded by whitespace is almost certainly a mistake
  if (password.trim().length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} non-space characters.`;
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'That password is too common — please choose something harder to guess.';
  }
  return null;
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a stored hash. Always returns a boolean — never
 * throws on bad input, so callers don't have to wrap in try/catch.
 *
 * Note: if `hash` is null/empty (account has no password set yet), returns
 * false. The caller should check for this case separately if it wants to
 * route the user into the "set a password" migration flow.
 */
async function verifyPassword(password, hash) {
  if (!password || !hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

// ── Failed-login rate limiting ──────────────────────────────────────────────
//
// Keyed by `pwfail:<role>:<email>`. We track count + window_start in the
// existing rate_limits table. After LOCKOUT_THRESHOLD fails inside
// LOCKOUT_WINDOW_MIN minutes, the account is locked for another
// LOCKOUT_WINDOW_MIN minutes (we don't reset the window — the user has to
// wait it out).
//
// On successful login, the row is cleared so the next mistake starts fresh.

function rateLimitKey(role, email) {
  return `pwfail:${role}:${(email || '').toLowerCase()}`;
}

/**
 * Check if this email is locked out for password login.
 * Returns { locked: true, retryAfterMin } or { locked: false }.
 */
async function checkLoginLockout(sql, role, email) {
  const key = rateLimitKey(role, email);
  try {
    // Cleanup very old windows (housekeeping; the row will be replaced anyway)
    await sql`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '24 hours'`;
    // 15-minute window is hardcoded to match LOCKOUT_WINDOW_MIN. If you
    // change that constant, update the INTERVAL literal below to match.
    const [row] = await sql`
      SELECT request_count, window_start
        FROM rate_limits
       WHERE key = ${key}
         AND window_start > NOW() - INTERVAL '15 minutes'`;
    if (row && row.request_count >= LOCKOUT_THRESHOLD) {
      // Compute remaining lockout minutes
      const elapsedMs = Date.now() - new Date(row.window_start).getTime();
      const remainMs = (LOCKOUT_WINDOW_MIN * 60 * 1000) - elapsedMs;
      const retryAfterMin = Math.max(1, Math.ceil(remainMs / 60000));
      return { locked: true, retryAfterMin };
    }
    return { locked: false };
  } catch {
    // If rate-limit check fails, fail open — better than locking everyone out.
    return { locked: false };
  }
}

/**
 * Record a failed login attempt. Safe to call on bad email/role —
 * does nothing meaningful but won't error.
 */
async function recordFailedLogin(sql, role, email) {
  const key = rateLimitKey(role, email);
  try {
    // 15-minute window — matches LOCKOUT_WINDOW_MIN.
    const [existing] = await sql`
      SELECT request_count FROM rate_limits
       WHERE key = ${key}
         AND window_start > NOW() - INTERVAL '15 minutes'`;
    if (existing) {
      await sql`UPDATE rate_limits SET request_count = request_count + 1
                 WHERE key = ${key}
                   AND window_start > NOW() - INTERVAL '15 minutes'`;
    } else {
      await sql`INSERT INTO rate_limits (key, request_count, window_start)
                VALUES (${key}, 1, NOW())`;
    }
  } catch (e) {
    console.warn('recordFailedLogin failed:', e.message);
  }
}

/** Clear the failed-login counter on successful login. */
async function clearLoginLockout(sql, role, email) {
  const key = rateLimitKey(role, email);
  try {
    await sql`DELETE FROM rate_limits WHERE key = ${key}`;
  } catch {}
}

module.exports = {
  validatePassword,
  hashPassword,
  verifyPassword,
  checkLoginLockout,
  recordFailedLogin,
  clearLoginLockout,
  // Constants exported for tests / introspection
  MIN_LENGTH,
  MAX_LENGTH,
  LOCKOUT_THRESHOLD,
  LOCKOUT_WINDOW_MIN,
};
