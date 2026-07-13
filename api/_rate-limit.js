/**
 * Centralised rate limiting using the shared `rate_limits` table.
 *
 * Replaces the duplicated pattern in enquiries.js, availability.js, and
 * admin.js handleLogin. Single source of truth so new endpoints can opt in
 * with one line, and window/max/key semantics stay consistent.
 *
 * Usage:
 *   const { checkRateLimit, getClientIp } = require('./_rate-limit');
 *   const sql = neon(process.env.POSTGRES_URL);
 *   const ip  = getClientIp(req);
 *
 *   const rl = await checkRateLimit(sql, {
 *     key: `enquiry_submit:${ip}`,
 *     max: 5,
 *     windowSeconds: 3600,
 *   });
 *   if (!rl.allowed) {
 *     return res.status(429).json({ error: 'Too many requests. Try again later.' });
 *   }
 *
 * Fail-open: if the DB call throws (e.g. transient Neon outage), returns
 * `{ allowed: true }`. This matches the prior behaviour of every call site —
 * a rate-limit DB blip must not lock users out of login/enquiry/etc.
 */

/**
 * @param {ReturnType<typeof import('@neondatabase/serverless').neon>} sql
 * @param {{ key: string, max: number, windowSeconds: number }} opts
 * @returns {Promise<{ allowed: boolean, remaining: number }>}
 */
async function checkRateLimit(sql, { key, max, windowSeconds }) {
  try {
    // One statement is essential here. A SELECT followed by UPDATE/INSERT lets
    // concurrent first requests create duplicate rows or lose increments. The
    // unique key installed by db/migration.sql makes this upsert atomic.
    //
    // Window expiry is evaluated for this key only. Do not clean unrelated
    // rows using the caller's window: endpoints intentionally use different
    // windows, and a short-window request must not erase a longer limit.
    const [row] = await sql`
      INSERT INTO rate_limits (key, request_count, window_start)
      VALUES (${key}, 1, NOW())
      ON CONFLICT (key) DO UPDATE SET
        request_count = CASE
          WHEN rate_limits.window_start <= NOW() - (${windowSeconds} * INTERVAL '1 second')
            THEN 1
          ELSE rate_limits.request_count + 1
        END,
        window_start = CASE
          WHEN rate_limits.window_start <= NOW() - (${windowSeconds} * INTERVAL '1 second')
            THEN NOW()
          ELSE rate_limits.window_start
        END
      RETURNING request_count
    `;

    const used = Number(row.request_count);
    return {
      allowed: used <= max,
      remaining: Math.max(0, max - used),
    };
  } catch (e) {
    // Fail-open — a DB blip must not lock users out. Matches prior behaviour
    // of all three existing call sites before extraction.
    return { allowed: true, remaining: max };
  }
}

/**
 * Extracts client IP from a Vercel/Node request. Respects x-forwarded-for
 * (first hop), falls back to socket address, then 'unknown'.
 */
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || 'unknown';
}

module.exports = { checkRateLimit, getClientIp };
