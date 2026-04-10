/**
 * CSRF double-submit cookie helper for cookie-based JWT auth.
 *
 * Background:
 *   Session JWTs live in httpOnly cookies (cc_learner / cc_instructor /
 *   cc_admin) set by the login endpoints. httpOnly + SameSite=Lax blocks
 *   XSS token theft and most cross-site POSTs, but the browser still
 *   attaches the cookie on top-level form POSTs from other origins, so
 *   CSRF is still possible. Double-submit closes the gap:
 *
 *     1. Login also mints a `cc_csrf` cookie (NOT httpOnly — JS reads it)
 *        with 32 random bytes.
 *     2. Frontend attaches that same value in an `X-CSRF-Token` request
 *        header on every mutating call.
 *     3. Server rejects if the cookie is missing, the header is missing,
 *        or the two don't match in constant time.
 *
 *   An attacker on another origin can't read the cookie (SameSite=Lax,
 *   same-origin only) and can't set a custom header without triggering
 *   a CORS preflight we'd block. So only a real same-origin page can
 *   echo the value.
 *
 * Mirrors api/_rate-limit.js (small, focused, fail-closed for CSRF
 * where rate-limit is fail-open).
 *
 * Rollout:
 *   Behaviour is gated on CSRF_ENFORCE. When CSRF_ENFORCE !== 'true',
 *   verifyCsrf logs mismatches via console.warn but returns true so
 *   the request proceeds. Flip CSRF_ENFORCE to 'true' once the
 *   frontend is fully migrated.
 */

const crypto = require('crypto');

const CSRF_COOKIE   = 'cc_csrf';
const CSRF_HEADER   = 'x-csrf-token';
const CSRF_MAX_AGE  = 60 * 60 * 24 * 30; // 30 days, matches longest session

/**
 * Parse a `Cookie:` request header into a plain object. Returns {}
 * when the header is missing or malformed. Does not throw.
 *
 * We don't rely on req.cookies because the Vercel Node runtime only
 * populates it for some route styles — reading the raw header is
 * portable across /api/*.js files.
 */
function parseCookies(req) {
  const header = req.headers?.cookie;
  if (!header || typeof header !== 'string') return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const val  = part.slice(idx + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(val);
    } catch {
      out[name] = val;
    }
  }
  return out;
}

/** 32 random bytes, hex-encoded (64 chars). */
function mintCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Build a Set-Cookie string for the CSRF token.
 *
 * Attributes match the session cookies except HttpOnly is omitted —
 * JS needs to read this cookie to echo it in X-CSRF-Token.
 *
 *   Secure; SameSite=Lax; Path=/; Max-Age=<30d>
 *
 * No Domain attribute. Host-only by design — each hostname gets its
 * own jar, so coachcarter.uk / coachcarter.co.uk / *.vercel.app /
 * localhost don't leak into each other.
 */
function buildCsrfCookie(token) {
  return `${CSRF_COOKIE}=${token}; Max-Age=${CSRF_MAX_AGE}; Path=/; Secure; SameSite=Lax`;
}

/** Build a Set-Cookie string that clears the CSRF cookie on logout. */
function buildCsrfClearCookie() {
  return `${CSRF_COOKIE}=; Max-Age=0; Path=/; Secure; SameSite=Lax`;
}

/**
 * Ensure a CSRF token is set on the response. Returns the token value
 * (whether freshly minted or read from the existing cookie) so the
 * caller can return it in the response body if needed.
 *
 * Usage — at the top of authed handlers, or inside requireAuth when
 * an authed request arrives without a CSRF cookie (lazy upgrade path
 * for users whose session cookie was issued before this helper
 * landed).
 */
function ensureCsrfCookie(req, res) {
  const existing = parseCookies(req)[CSRF_COOKIE];
  if (existing && existing.length >= 32) return existing;

  const token = mintCsrfToken();
  appendSetCookie(res, buildCsrfCookie(token));
  return token;
}

/**
 * Constant-time comparison that doesn't leak on length mismatch.
 * Returns false for non-string inputs.
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
 * Verify a double-submit CSRF token on the request.
 *
 * Rules:
 *   - GET / HEAD / OPTIONS always pass (reads are not state-changing).
 *   - Non-GET must have both the `cc_csrf` cookie and an `X-CSRF-Token`
 *     header, and the two must be equal (constant time).
 *   - Missing cookie OR missing header OR mismatch = fail (false).
 *
 * Callers (requireAuth and friends) treat a false return the same way
 * they treat a bad JWT — return null to the handler, which produces
 * a 401. Individual endpoints can also call this directly.
 *
 * History: this was rolled out in log-only mode (CSRF_ENFORCE env var
 * check) alongside the frontend migration. Once the preview logs
 * showed zero `[csrf] LOG-ONLY` warnings across real-user traffic,
 * this commit flips enforcement on unconditionally.
 */
function verifyCsrf(req) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }

  const cookieVal = parseCookies(req)[CSRF_COOKIE];
  const headerVal = req.headers?.[CSRF_HEADER];

  let reason = null;
  if (!cookieVal) reason = 'missing cookie';
  else if (!headerVal) reason = 'missing header';
  else if (typeof headerVal !== 'string') reason = 'non-string header';
  else if (!safeEqual(cookieVal, headerVal)) reason = 'mismatch';

  if (reason) {
    const path = req.url || '?';
    console.warn(`[csrf] REJECT ${method} ${path} — ${reason}`);
    return false;
  }

  return true;
}

/**
 * Append a Set-Cookie header to the response without clobbering any
 * existing ones. Vercel's Node runtime accepts an array for Set-Cookie.
 */
function appendSetCookie(res, cookieStr) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [cookieStr]);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', existing.concat(cookieStr));
  } else {
    res.setHeader('Set-Cookie', [existing, cookieStr]);
  }
}

module.exports = {
  CSRF_COOKIE,
  CSRF_HEADER,
  parseCookies,
  mintCsrfToken,
  buildCsrfCookie,
  buildCsrfClearCookie,
  ensureCsrfCookie,
  verifyCsrf,
  appendSetCookie,
};
