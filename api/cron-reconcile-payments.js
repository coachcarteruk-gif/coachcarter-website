// Stripe payment reconciliation cron — runs hourly
//
// GET /api/cron-reconcile-payments
//   Authorization: Bearer ${CRON_SECRET}  (Vercel Cron sends this automatically)
//
// Catches silent webhook delivery failures (e.g. TLS error on the configured
// endpoint URL, Stripe outage, signature mismatch). For every checkout session
// that completed in the last 25 hours and is in a paid state, we check that a
// matching row exists in credit_transactions. Any session with a tracked
// payment_type that is missing from the DB is reported via email so it can be
// replayed manually from the Stripe dashboard.
//
// Alert-only by design — does not auto-replay handlers, to avoid the risk of
// re-running a buggy or partial handler against an already-mutated DB.
//
// Background: 2026-04-26 incident — Stripe webhook URL was misconfigured to
// coachcarter.co.uk (a domain we don't own). Three checkout.session.completed
// retries failed with TLS errors and the customer never received a
// confirmation email. See DEVELOPMENT-ROADMAP.md entry 2.88.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { verifyCronAuth } = require('./_auth');
const { createTransporter } = require('./_auth-helpers');

// payment_type values that the webhook persists to credit_transactions.
// The legacy pass_guarantee/calculator flow uses an in-memory Map and is
// intentionally not reconciled here.
const TRACKED_PAYMENT_TYPES = new Set([
  'credit_purchase',
  'slot_booking',
  'lesson_offer',
]);

const LOOKBACK_SECONDS = 25 * 60 * 60; // 25h overlap with hourly schedule

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const cutoff = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS;

    // Page through completed sessions in the lookback window.
    const candidateSessions = [];
    let startingAfter;
    while (true) {
      const page = await stripe.checkout.sessions.list({
        limit: 100,
        created: { gte: cutoff },
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const s of page.data) {
        if (s.status !== 'complete') continue;
        if (s.payment_status !== 'paid') continue;
        const paymentType = s.metadata?.payment_type;
        if (!TRACKED_PAYMENT_TYPES.has(paymentType)) continue;
        candidateSessions.push(s);
      }
      if (!page.has_more) break;
      startingAfter = page.data[page.data.length - 1].id;
    }

    const checked = candidateSessions.length;
    if (checked === 0) {
      return res.status(200).json({ ok: true, checked: 0, missing: 0 });
    }

    // Bulk lookup — single round-trip rather than one query per session.
    const sessionIds = candidateSessions.map(s => s.id);
    const rows = await sql`
      SELECT stripe_session_id
        FROM credit_transactions
       WHERE stripe_session_id = ANY(${sessionIds})
    `;
    const seen = new Set(rows.map(r => r.stripe_session_id));

    const missing = candidateSessions.filter(s => !seen.has(s.id));

    if (missing.length > 0) {
      await sendAlert(missing);
    }

    return res.status(200).json({
      ok: true,
      checked,
      missing: missing.length,
      missing_session_ids: missing.map(s => s.id),
    });
  } catch (err) {
    reportError('/api/cron-reconcile-payments', err);
    return res.status(500).json({ error: 'Reconciliation failed' });
  }
};

async function sendAlert(missing) {
  const to = process.env.ERROR_ALERT_EMAIL || process.env.STAFF_EMAIL;
  if (!to) return;

  const rows = missing.map(s => {
    const m = s.metadata || {};
    const amount = s.amount_total != null ? `£${(s.amount_total / 100).toFixed(2)}` : '—';
    const created = new Date(s.created * 1000).toISOString().replace('T', ' ').slice(0, 16);
    const email = escapeHtml(s.customer_details?.email || m.learner_email || '—');
    const type = escapeHtml(m.payment_type || '—');
    const sid = escapeHtml(s.id);
    return `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;">${sid}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${type}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${amount}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${email}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${created}</td>
      </tr>
    `;
  }).join('');

  const transporter = createTransporter();
  await transporter.sendMail({
    from: 'CoachCarter System <system@coachcarter.uk>',
    to,
    subject: `[ACTION REQUIRED] ${missing.length} paid Stripe session${missing.length === 1 ? '' : 's'} missing webhook processing`,
    html: `
      <h2 style="color:#ef4444;">Webhook reconciliation: ${missing.length} unprocessed payment${missing.length === 1 ? '' : 's'}</h2>
      <p>The hourly reconciliation cron found Stripe checkout sessions that completed and were paid, but have no matching <code>credit_transactions</code> row. The webhook either didn't fire or failed silently.</p>
      <p><strong>Action:</strong> open each session in Stripe Dashboard → Events → find the matching <code>checkout.session.completed</code> event → click <strong>Resend</strong>. The webhook handler is idempotent so resending is safe.</p>
      <table style="border-collapse:collapse;font-size:14px;margin-top:12px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="padding:8px 12px;text-align:left;">Session ID</th>
            <th style="padding:8px 12px;text-align:left;">Type</th>
            <th style="padding:8px 12px;text-align:left;">Amount</th>
            <th style="padding:8px 12px;text-align:left;">Email</th>
            <th style="padding:8px 12px;text-align:left;">Created (UTC)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `,
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}
