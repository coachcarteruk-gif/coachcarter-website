// Instructor payout cron — runs every Friday at 09:00 UTC
//
// GET /api/cron-payouts?key=CRON_SECRET
//   or via Vercel Cron with x-vercel-cron header
//   or via admin JWT (manual trigger from admin portal)
//
// Calculates earnings for each onboarded instructor, creates Stripe
// transfers, and sends email notifications.

const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { neon } = require('@neondatabase/serverless');
const { createTransporter } = require('./_auth-helpers');
const { reportError }       = require('./_error-alert');
const { processAllPayouts, processSchoolPayouts } = require('./_payout-helpers');
const jwt = require('jsonwebtoken');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function verifyCronAuth(req) {
  // Vercel Cron header
  if (req.headers['x-vercel-cron'] === '1') return true;
  // CRON_SECRET via query or bearer
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const provided = req.query.key || req.headers['authorization']?.replace('Bearer ', '');
  if (provided === secret) return true;
  // Admin JWT fallback (for manual trigger)
  try {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
      if (payload.role === 'admin' || payload.role === 'superadmin') return true;
      if (payload.role === 'instructor' && payload.isAdmin === true) return true;
    }
  } catch {}
  return false;
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (!verifyCronAuth(req)) {
    return res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Invalid cron secret' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // 1. Instructor payouts (existing)
    const results = await processAllPayouts(sql, stripe);

    // Send notification emails to instructors who received a payout
    const completedPayouts = results.details.filter(d => d.status === 'completed');
    if (completedPayouts.length > 0) {
      try {
        const transporter = createTransporter();
        for (const payout of completedPayouts) {
          const amountStr = '£' + (payout.amount_pence / 100).toFixed(2);
          await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: payout.instructor_email,
            subject: `CoachCarter Payout — ${amountStr}`,
            html: `
              <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
                <h2 style="color:#f97316;">Payout Sent</h2>
                <p>Hi ${payout.instructor_name},</p>
                <p>Your weekly payout of <strong>${amountStr}</strong> for <strong>${payout.lesson_count} lesson${payout.lesson_count === 1 ? '' : 's'}</strong> has been sent to your bank account.</p>
                <p>It should arrive within 1–2 working days.</p>
                <p style="color:#6b7280;font-size:13px;">You can view your full payout history in your <a href="https://coachcarter.co.uk/instructor/earnings.html">earnings dashboard</a>.</p>
              </div>
            `
          }).catch(() => {}); // don't let email failure block response
        }
      } catch {} // fire-and-forget
    }

    // Report any instructor payout failures
    const failedPayouts = results.details.filter(d => d.status === 'failed' || d.status === 'error');
    if (failedPayouts.length > 0) {
      reportError('/api/cron-payouts', new Error(
        `${failedPayouts.length} instructor payout(s) failed: ${failedPayouts.map(f => `${f.instructor_name}: ${f.error}`).join('; ')}`
      ));
    }

    // 2. School payouts
    let schoolResults = { processed: 0, skipped: 0, failed: 0, total_pence: 0, details: [] };
    try {
      schoolResults = await processSchoolPayouts(sql, stripe);

      // Report any school payout failures
      const failedSchool = schoolResults.details.filter(d => d.status === 'failed' || d.status === 'error');
      if (failedSchool.length > 0) {
        reportError('/api/cron-payouts', new Error(
          `${failedSchool.length} school payout(s) failed: ${failedSchool.map(f => `${f.school_name}: ${f.error}`).join('; ')}`
        ));
      }
    } catch (err) {
      reportError('/api/cron-payouts (school payouts)', err);
    }

    return res.json({
      ok: true,
      instructors: {
        processed: results.processed,
        skipped: results.skipped,
        failed: results.failed,
        total_transferred_pence: results.total_pence
      },
      schools: {
        processed: schoolResults.processed,
        skipped: schoolResults.skipped,
        failed: schoolResults.failed,
        total_transferred_pence: schoolResults.total_pence
      }
    });
  } catch (err) {
    reportError('/api/cron-payouts', err);
    return res.status(500).json({ error: true, code: 'SERVER_ERROR', message: 'Payout processing failed' });
  }
};
