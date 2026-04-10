/**
 * Centralised authentication module for multi-tenant CoachCarter platform.
 *
 * Replaces the duplicated verifyAuth / verifyAdminJWT / verifyInstructorAuth
 * patterns scattered across ~7 API files.
 *
 * JWT payloads now include school_id:
 *   Learner:    { id, email, school_id, role: 'learner' }
 *   Instructor: { id, email, school_id, role: 'instructor', isAdmin? }
 *   Admin:      { id, email, school_id, role: 'admin'|'superadmin', isAdmin }
 *
 * Backwards compat: JWTs without school_id are treated as school_id = 1.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { parseCookies, verifyCsrf } = require('./_csrf');

const DEFAULT_SCHOOL_ID = 1; // CoachCarter — backwards compat for old tokens

// ── Session cookie helpers ──────────────────────────────────────────────────
//
// Three session cookies, one per role, so a browser can be logged in as
// multiple roles at once (matching the old localStorage behaviour):
//
//   cc_learner     — 30d  (matches magic-link JWT expiry)
//   cc_instructor  —  7d
//   cc_admin       —  7d
//
// Attributes: HttpOnly; Secure; SameSite=Lax; Path=/; no Domain.
// Host-only by design — each hostname gets its own jar, so coachcarter.uk /
// coachcarter.co.uk / per-school custom domains / *.vercel.app / localhost
// don't leak into each other. See project_security_hardening memory.

const SESSION_COOKIE_NAMES = {
  learner:    'cc_learner',
  instructor: 'cc_instructor',
  admin:      'cc_admin',
};

const SESSION_MAX_AGE_SEC = {
  learner:    60 * 60 * 24 * 30, // 30 days
  instructor: 60 * 60 * 24 * 7,  //  7 days
  admin:      60 * 60 * 24 * 7,  //  7 days
};

/**
 * Build a Set-Cookie string for a session JWT.
 *
 *   HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<expiry>
 *
 * No Domain attribute. Logout MUST clear with the same attributes or the
 * browser will not match the cookie to remove.
 */
function buildSessionCookie(name, token, maxAgeSeconds) {
  return `${name}=${token}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

/** Clear-cookie variant — Max-Age=0 with identical attributes. */
function buildSessionClearCookie(name) {
  return `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

// ── Low-level decode ────────────────────────────────────────────────────────

/**
 * Decode + verify a JWT from the request.
 *
 * Reads session cookies only. A browser can be logged in as multiple
 * roles at once (cc_learner + cc_instructor), so the caller (requireAuth)
 * passes the role-matching cookie name first via `preferredCookies`.
 * Cookies that don't match the preferred role are still tried as a
 * fallback so direct callers (decodeToken with no opts) still work.
 *
 * The `Authorization: Bearer` header used to be a fallback here during
 * the cookie migration. Removed once the frontend rollout was complete —
 * see the commit history for `fix/security-M1-cookies`.
 *
 * @param {object} req
 * @param {object} [opts]
 * @param {string[]} [opts.preferredCookies] - session cookie names to try
 *   first, in order. Others are tried after. Omit to try all in default
 *   order.
 * @returns {object|null} verified JWT payload or null
 */
function decodeToken(req, opts = {}) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  const cookies = parseCookies(req);
  const allCookies = Object.values(SESSION_COOKIE_NAMES);
  const preferred = Array.isArray(opts.preferredCookies) ? opts.preferredCookies : [];
  const order = [...new Set([...preferred, ...allCookies])];

  for (const name of order) {
    const token = cookies[name];
    if (!token) continue;
    try {
      return jwt.verify(token, secret);
    } catch {
      // Bad cookie — keep trying the rest
    }
  }

  return null;
}

/**
 * Map a list of allowed roles to the session cookies that could hold a
 * matching token. Used by requireAuth to tell decodeToken which cookie to
 * prefer.
 *
 *   roles: ['learner']    -> ['cc_learner']
 *   roles: ['instructor'] -> ['cc_instructor']
 *   roles: ['admin']      -> ['cc_admin', 'cc_instructor']  (instructor+isAdmin is valid)
 *   roles: ['superadmin'] -> ['cc_admin']
 *   roles: []             -> []  (any)
 */
function cookiesForRoles(roles) {
  if (!roles || roles.length === 0) return [];
  const out = [];
  for (const r of roles) {
    if (r === 'learner')                    out.push(SESSION_COOKIE_NAMES.learner);
    else if (r === 'instructor')            out.push(SESSION_COOKIE_NAMES.instructor);
    else if (r === 'admin')                 { out.push(SESSION_COOKIE_NAMES.admin); out.push(SESSION_COOKIE_NAMES.instructor); }
    else if (r === 'superadmin')            out.push(SESSION_COOKIE_NAMES.admin);
  }
  return [...new Set(out)];
}

// ── Role-based auth ─────────────────────────────────────────────────────────

/**
 * Verify the request has a valid JWT matching the required roles.
 *
 * @param {object}   req
 * @param {object}   opts
 * @param {string[]} opts.roles  - Allowed roles, e.g. ['admin'] or ['instructor','admin']
 *                                 'admin' also accepts instructors with isAdmin=true
 *                                 and superadmin role.
 * @param {boolean}  opts.requireSchool - If true, reject tokens with no school_id
 *                                        (superadmins can override via ?school_id=)
 * @returns {object|null} The JWT payload (with school_id normalised) or null
 */
function requireAuth(req, opts = {}) {
  const { roles, requireSchool } = opts;

  // Cookie-first decode, preferring cookies that could hold a token
  // matching the allowed roles.
  const payload = decodeToken(req, { preferredCookies: cookiesForRoles(roles) });
  if (!payload) return null;

  // CSRF double-submit check on mutating requests. verifyCsrf is a no-op
  // for GET/HEAD/OPTIONS. In log-only mode (CSRF_ENFORCE !== 'true') it
  // always returns true but emits a console.warn for mismatches so we can
  // see which pages still need migrating. In enforce mode, a mismatch
  // fails the request the same way a bad token does.
  if (!verifyCsrf(req)) return null;

  if (roles && roles.length > 0) {
    const role = payload.role || 'learner'; // legacy learner tokens have no role
    let allowed = false;

    for (const r of roles) {
      if (r === role) { allowed = true; break; }
      // 'admin' role also accepts superadmin and instructor-admins
      if (r === 'admin') {
        if (role === 'superadmin') { allowed = true; break; }
        if (role === 'instructor' && payload.isAdmin === true) { allowed = true; break; }
      }
    }

    if (!allowed) return null;
  }
  // Note: when roles is empty/undefined, no role check is applied. This
  // matches the pre-consolidation behaviour of several local wrappers
  // (learner.js verifyAuth, _shared.js verifyAuth, calendar.js verifyAuth)
  // which accepted any valid JWT. Those wrappers now call requireAuth(req)
  // with no roles option and get the same semantics.

  // Normalise school_id.
  // Grace period: legacy learner tokens (pre-multi-tenancy, no `role` field)
  // still default to CoachCarter. Admin/instructor tokens without school_id
  // are rejected outright — they must re-auth.
  if (!payload.school_id && payload.school_id !== 0) {
    const role = payload.role || 'learner';
    if (role === 'learner') {
      payload.school_id = DEFAULT_SCHOOL_ID;
    } else if (role !== 'superadmin') {
      console.warn('[auth] rejecting token with no school_id, role=' + role);
      return null;
    }
    // Superadmin with no school_id is valid (platform-level operator).
  }

  if (requireSchool && !getSchoolId(payload, req)) return null;

  return payload;
}

// ── School resolution ───────────────────────────────────────────────────────

/**
 * Get the effective school_id for a request.
 *
 * - Regular users: school_id from their JWT
 * - Superadmins: can override via ?school_id= query param to act on any school
 *
 * @returns {number|null}
 */
function getSchoolId(payload, req) {
  if (!payload) return null;

  const role = payload.role || 'learner';

  // Superadmins can target any school via query param
  if (role === 'superadmin') {
    const override = req.query?.school_id || req.body?.school_id;
    if (override) return parseInt(override, 10);
    // If no override, return their own school_id (may be null for platform-level)
    return payload.school_id || null;
  }

  // Non-superadmin: return their school_id, or null if missing.
  // After requireAuth, this will only be null for non-learner tokens that
  // somehow bypassed the fallback logic — callers must handle that case.
  return payload.school_id || null;
}

/**
 * Verify cron endpoint authentication using CRON_SECRET.
 *
 * Accepts the secret via:
 *   - Authorization: Bearer <secret>   (Vercel Cron sends this when CRON_SECRET is set)
 *   - ?key=<secret>                    (manual trigger)
 *
 * FAIL-CLOSED: if CRON_SECRET is not configured, ALL requests are rejected.
 * Uses timingSafeEqual to prevent timing attacks.
 *
 * NOTE: The `x-vercel-cron` header is deliberately NOT accepted — it is
 * spoofable by external callers (Vercel does not strip it from inbound
 * requests). Use Authorization: Bearer instead.
 *
 * @returns {boolean}
 */
function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed

  const auth = req.headers.authorization;
  const bearer = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const provided = bearer || req.query?.key || req.query?.secret;
  if (!provided || typeof provided !== 'string') return false;

  // Lengths must match before timingSafeEqual, otherwise it throws.
  if (provided.length !== secret.length) return false;

  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch {
    return false;
  }
}

/**
 * Constant-time string comparison for secrets.
 * Returns false on non-string inputs and length mismatch. Callers should use
 * this wherever a client-supplied value is compared against a server-side
 * secret (env vars, tokens, etc.) instead of `===` / `!==`.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Verify the legacy ADMIN_SECRET header/body.
 * Used for bootstrapping the first admin account.
 */
function verifyAdminSecret(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return safeEqual(req.body?.admin_secret, secret) ||
         safeEqual(req.headers['x-admin-secret'], secret);
}

/**
 * Check if payload belongs to a superadmin (platform-level).
 */
function isSuperAdmin(payload) {
  return payload && payload.role === 'superadmin';
}

module.exports = {
  decodeToken,
  requireAuth,
  getSchoolId,
  safeEqual,
  verifyAdminSecret,
  verifyCronAuth,
  isSuperAdmin,
  DEFAULT_SCHOOL_ID,
  SESSION_COOKIE_NAMES,
  SESSION_MAX_AGE_SEC,
  buildSessionCookie,
  buildSessionClearCookie,
};
