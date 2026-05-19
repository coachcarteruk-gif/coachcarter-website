// Instructor payout cron — runs every Friday at 09:00 UTC
//
// Authentication (any one of):
//   - Authorization: Bearer ${CRON_SECRET}  (Vercel Cron sends this)
//   - ?key=${CRON_SECRET}                    (manual trigger)
//   - Admin JWT                              (manual trigger from admin portal)
//
// Calculates earnings for each onboarded instructor, creates Stripe
// transfers, and sends email notifications.

const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createTransporter } = require('./_auth-helpers');
const { reportError }       = require('./_error-alert');
const { processAllPayouts, processSchoolPayouts } = require('./_payout-helpers');
const { sendPayoutSummary } = require('./_payout-email');
const { verifyCronAuth, requireAuth } = require('./_auth');
const { withCronLock } = require('./_cron-lock');

function isAuthorized(req) {
  // Cron secret (Bearer or ?key=) — fail-closed, timing-safe
  if (verifyCronAuth(req)) return true;
  // Admin JWT fallback for manual trigger from admin portal
  const admin = requireAuth(req, { roles: ['admin'] });
  return !!admin;
}

module.exports = async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Invalid cron secret' });
  }

  // Lease 600s — payout cron creates Stripe transfers serially and emails
  // per instructor. Real-world runs <60s; the floor protects an admin
  // accidentally double-clicking the manual-trigger button in the portal.
  // Crash recovery: per-booking uq_payout_booking + uq_school_payout_booking
  // are the hard idempotency keys, lock is overlap optimisation.
  return withCronLock(req, res, 'cron-payouts', 600, async (sql) => {

    // 1. Instructor payouts (existing)
    const results = await processAllPayouts(sql, stripe);

    // Weekly summary email to platform owner — gross / fees / payout totals
    // + per-instructor breakdown + NULL-fee tracker for the Step 4f rollout.
    // Fire-and-forget: a digest failure must not block per-instructor emails.
    try {
      const summaryTransporter = createTransporter();
      await sendPayoutSummary(sql, results, summaryTransporter);
    } catch (summaryErr) {
      reportError('/api/cron-payouts (summary email)', summaryErr);
    }

    // Send notification emails to instructors who received a payout
    const completedPayouts = results.details.filter(d => d.status === 'completed');
    if (completedPayouts.length > 0) {
      try {
        const transporter = createTransporter();
        for (const payout of completedPayouts) {
          const amountStr = '£' + (payout.amount_pence / 100).toFixed(2);
          const fmt = (p) => '£' + (p / 100).toFixed(2);
          const isZero = payout.amount_pence === 0;
          const headline = isZero
            ? `<p>Your weekly statement for <strong>${payout.lesson_count} lesson${payout.lesson_count === 1 ? '' : 's'}</strong> shows <strong>£0.00</strong> sent to your bank this week — your gross has been used to cover the items below.</p>`
            : `<p>Your weekly payout of <strong>${amountStr}</strong> for <strong>${payout.lesson_count} lesson${payout.lesson_count === 1 ? '' : 's'}</strong> has been sent to your bank account.</p>
               <p>It should arrive within 1–2 working days.</p>`;
          const extraLines = [];
          if (payout.deposit_deducted_pence > 0) {
            extraLines.push(`<p style="margin:6px 0;">Vehicle deposit (week 1): <strong>−${fmt(payout.deposit_deducted_pence)}</strong> <span style="color:#6b7280;">(refundable at end of contract per clause 5.5)</span></p>`);
          }
          if (payout.prior_shortfall_recovered_pence > 0) {
            extraLines.push(`<p style="margin:6px 0;">Recovered from prior shortfall: <strong>−${fmt(payout.prior_shortfall_recovered_pence)}</strong></p>`);
          }
          if (payout.shortfall_pence > 0) {
            extraLines.push(`<p style="margin:6px 0;color:#b45309;">This week's shortfall (rolls forward): <strong>${fmt(payout.shortfall_pence)}</strong>. This will be deducted from your next positive payout.</p>`);
          }
          await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: payout.instructor_email,
            subject: `CoachCarter Payout — ${amountStr}`,
            html: `
              <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
                <h2 style="color:#f97316;">${isZero ? 'Weekly Statement' : 'Payout Sent'}</h2>
                <p>Hi ${payout.instructor_name},</p>
                ${headline}
                ${extraLines.join('\n')}
                <p style="color:#6b7280;font-size:13px;">You can view your full payout history in your <a href="https://coachcarter.uk/instructor/earnings.html">earnings dashboard</a>.</p>
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

    return {
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
    };
  });
};
