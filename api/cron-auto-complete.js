// Auto-complete lessons cron — runs hourly
//
// GET /api/cron-auto-complete
//   Authorization: Bearer ${CRON_SECRET}  (Vercel Cron sends this automatically)
//   or ?key=${CRON_SECRET} for manual trigger
//
// Marks confirmed bookings as completed once their scheduled_date + end_time
// has passed. Silent housekeeping — no notifications sent.

const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { verifyCronAuth } = require('./_auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // No school_id filter needed — same logic applies to all tenants,
    // no cross-tenant data is returned. Matches cron-retention.js pattern.
    const result = await sql`
      UPDATE lesson_bookings
      SET status = 'completed'
      WHERE status = 'confirmed'
        AND (scheduled_date + end_time) < NOW()
    `;

    const completed = result.length ?? 0;
    return res.status(200).json({ ok: true, completed });
  } catch (err) {
    reportError('/api/cron-auto-complete', err);
    return res.status(500).json({ error: 'Auto-complete failed' });
  }
};
