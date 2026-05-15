// Flip past lessons to chargeable — runs hourly
//
// GET /api/cron-auto-complete
//   Authorization: Bearer ${CRON_SECRET}  (Vercel Cron sends this automatically)
//   or ?key=${CRON_SECRET} for manual trigger
//
// Flips scheduled bookings to chargeable once their end_time has passed by
// at least 1 hour. The 1-hour buffer absorbs clock skew and last-minute
// reschedule races, and gives admin a small window to flip a disputed
// lesson to refunded before payout sees it. Silent housekeeping —
// no notifications.
//
// Late-cancel under 48h leaves status=scheduled with credit_forfeited=TRUE
// (see api/slots.js cancel path). This cron flips those too, which is
// exactly what we want — the instructor is paid for late-cancelled lessons.

const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { verifyCronAuth } = require('./_auth');
const { SCHEDULED, CHARGEABLE } = require('./_booking-status');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // No school_id filter needed — same logic applies to all tenants,
    // no cross-tenant data is returned. Matches cron-retention.js pattern.
    const result = await sql`
      UPDATE lesson_bookings
      SET status = ${CHARGEABLE}
      WHERE status = ${SCHEDULED}
        AND (scheduled_date + end_time) < (NOW() - INTERVAL '1 hour')
    `;

    const flipped = result.length ?? 0;
    return res.status(200).json({ ok: true, flipped });
  } catch (err) {
    reportError('/api/cron-auto-complete', err);
    return res.status(500).json({ error: 'Flip-chargeable cron failed' });
  }
};
