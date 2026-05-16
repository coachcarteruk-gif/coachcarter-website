// Weekly payout summary email, sent to the platform owner after each
// Friday payout cron.
//
// Reads `gross_pence` and `stripe_fees_pence` from the buildResult shape
// added by Step 4f.d (PR #135 / api/_payout-helpers.js). Also queries
// payout_line_items to count "fee treated as zero" bookings — high in
// week 1 of the Step 4f rollout, drops to near-zero by week 3.

const SUMMARY_RECIPIENT = 'coachcarteruk@gmail.com';
const FROM_ADDRESS      = 'CoachCarter <bookings@coachcarter.uk>';

// Default per-booking Stripe fee estimate when there are no real fees in
// the run to average against (UK domestic card: 1.5% × £55 + 20p ≈ 103p,
// but most current bookings are £82.50 with 144p fee, so 144 is the
// closer median for the rollout window).
const DEFAULT_FEE_ESTIMATE_PENCE = 144;

const fmt = (pence) => '£' + ((parseInt(pence) || 0) / 100).toFixed(2);

/**
 * Send the weekly payout summary email.
 * @param {object} sql - Neon SQL tag
 * @param {object} results - return value of processAllPayouts
 * @param {object} transporter - nodemailer transporter from createTransporter()
 */
async function sendPayoutSummary(sql, results, transporter) {
  // Skip if nothing happened at all this run.
  if (results.processed === 0 && results.failed === 0) return;

  const completed = results.details.filter(d => d.status === 'completed');

  // Aggregate totals across all completed payouts.
  let totalBookings = 0;
  let totalGrossPence = 0;
  let totalFeesPence  = 0;
  let totalPaidPence  = 0;
  for (const p of completed) {
    totalBookings   += parseInt(p.lesson_count) || 0;
    totalGrossPence += parseInt(p.gross_pence)  || 0;
    totalFeesPence  += parseInt(p.stripe_fees_pence) || 0;
    totalPaidPence  += parseInt(p.amount_pence) || 0;
  }

  // NULL-fee tracker: count line items with fee=0 (the cron treated NULL as
  // zero), and estimate platform-absorbed amount. Run-scoped via payout_id IN
  // (this run's payouts).
  let nullFeeCount = 0;
  let estimatedAbsorbedPence = 0;
  const payoutIds = completed.map(p => p.payout_id).filter(id => id != null);

  if (payoutIds.length > 0) {
    const [{ null_count, real_count, real_sum }] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE stripe_fee_pence = 0) AS null_count,
        COUNT(*) FILTER (WHERE stripe_fee_pence > 0) AS real_count,
        COALESCE(SUM(stripe_fee_pence) FILTER (WHERE stripe_fee_pence > 0), 0) AS real_sum
      FROM payout_line_items
      WHERE payout_id = ANY(${payoutIds}::int[])
    `;
    nullFeeCount = parseInt(null_count) || 0;
    const realCount = parseInt(real_count) || 0;
    const realSum   = parseInt(real_sum)   || 0;
    // Estimate per-booking fee from the real fees in this run; fall back to
    // the default rollout estimate when none observed yet.
    const avgRealFee = realCount > 0 ? Math.round(realSum / realCount) : DEFAULT_FEE_ESTIMATE_PENCE;
    estimatedAbsorbedPence = nullFeeCount * avgRealFee;
  }

  // Per-instructor breakdown rows.
  const rows = completed.map(p => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(p.instructor_name || '')}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${parseInt(p.lesson_count) || 0}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${fmt(p.gross_pence)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${fmt(p.stripe_fees_pence)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;"><strong>${fmt(p.amount_pence)}</strong></td>
    </tr>
  `).join('');

  const failedNote = results.failed > 0
    ? `<p style="color:#b45309;"><strong>${results.failed} payout${results.failed === 1 ? '' : 's'} failed.</strong> Check Vercel logs and the admin earnings dashboard.</p>`
    : '';

  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;color:#111;">
      <h2 style="color:#f97316;margin-bottom:4px;">Friday Payout Summary</h2>
      <p style="color:#6b7280;margin-top:0;">Run completed ${new Date().toISOString().slice(0, 10)}.</p>

      <table style="border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:4px 12px;">Total bookings paid out</td><td style="padding:4px 12px;text-align:right;"><strong>${totalBookings}</strong></td></tr>
        <tr><td style="padding:4px 12px;">Total gross</td><td style="padding:4px 12px;text-align:right;"><strong>${fmt(totalGrossPence)}</strong></td></tr>
        <tr><td style="padding:4px 12px;">Stripe fees deducted</td><td style="padding:4px 12px;text-align:right;"><strong>${fmt(totalFeesPence)}</strong></td></tr>
        <tr><td style="padding:4px 12px;">Total payout sent</td><td style="padding:4px 12px;text-align:right;"><strong>${fmt(totalPaidPence)}</strong></td></tr>
      </table>

      ${nullFeeCount > 0 ? `
        <p style="background:#fef3c7;padding:12px 16px;border-radius:6px;color:#92400e;">
          <strong>NULL-fee bookings:</strong> ${nullFeeCount} booking${nullFeeCount === 1 ? '' : 's'} had no captured Stripe fee
          and were paid in full. Estimated platform-absorbed: <strong>${fmt(estimatedAbsorbedPence)}</strong>.
          This number should drop to zero by ~3 weeks after the Step 4f rollout (2026-05-16).
        </p>
      ` : ''}

      ${failedNote}

      <h3 style="margin-top:24px;">Per-instructor</h3>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead>
          <tr style="background:#f9fafb;text-align:left;">
            <th style="padding:8px 12px;border-bottom:2px solid #ddd;">Instructor</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ddd;text-align:right;">Lessons</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ddd;text-align:right;">Gross</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ddd;text-align:right;">Stripe fees</th>
            <th style="padding:8px 12px;border-bottom:2px solid #ddd;text-align:right;">Paid</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <p style="color:#6b7280;font-size:13px;margin-top:24px;">
        Auto-generated by <code>api/cron-payouts.js</code>. Per-instructor payout emails are sent separately.
      </p>
    </div>
  `;

  const subject = `Friday payout — ${fmt(totalPaidPence)} sent, ${fmt(totalFeesPence)} fees absorbed`;

  await transporter.sendMail({
    from:    FROM_ADDRESS,
    to:      SUMMARY_RECIPIENT,
    subject,
    html
  });
}

// Minimal HTML escape for user-supplied names.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { sendPayoutSummary };
