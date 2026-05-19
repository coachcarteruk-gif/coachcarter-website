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

const { verifyCronAuth } = require('./_auth');
const { SCHEDULED, CHARGEABLE } = require('./_booking-status');
const { withCronLock } = require('./_cron-lock');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  // Lease 120s — single UPDATE, completes in <1s normally. Lock is belt-and-
  // braces; the UPDATE itself is idempotent (status filter), but the lock
  // saves the wasted query on overlap.
  return withCronLock(req, res, 'cron-auto-complete', 120, async (sql) => {
    // No school_id filter needed — same logic applies to all tenants,
    // no cross-tenant data is returned. Matches cron-retention.js pattern.
    const result = await sql`
      UPDATE lesson_bookings
      SET status = ${CHARGEABLE}
      WHERE status = ${SCHEDULED}
        AND (scheduled_date + end_time) < (NOW() - INTERVAL '1 hour')
    `;

    const flipped = result.length ?? 0;
    return { ok: true, flipped };
  });
};
