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
    const cutoff = new Date(Date.now() - windowSeconds * 1000);

    // Opportunistic cleanup of rows older than the window.
    await sql`DELETE FROM rate_limits WHERE window_start < ${cutoff}`;

    const [existing] = await sql`
      SELECT request_count FROM rate_limits
      WHERE key = ${key} AND window_start > ${cutoff}
    `;

    if (existing && existing.request_count >= max) {
      return { allowed: false, remaining: 0 };
    }

    if (existing) {
      await sql`
        UPDATE rate_limits SET request_count = request_count + 1
        WHERE key = ${key} AND window_start > ${cutoff}
      `;
    } else {
      await sql`
        INSERT INTO rate_limits (key, request_count, window_start)
        VALUES (${key}, 1, NOW())
      `;
    }

    const used = (existing?.request_count || 0) + 1;
    return { allowed: true, remaining: Math.max(0, max - used) };
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
