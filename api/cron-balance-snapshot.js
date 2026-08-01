// Daily platform-balance snapshot cron — runs ~08:00 UTC.
//
// GET /api/cron-balance-snapshot
//   Authorization: Bearer ${CRON_SECRET}  (Vercel Cron sends this automatically)
//
// Purpose: capture the Next Payout Preview widget's state into
// platform_balance_snapshots, then run the trailing-30d Stripe-inflow vs
// payout-outflow comparison (Trigger B). The row also acts as the lookup
// target for Trigger A (failure-path alert in api/_payout-helpers.js).
// The stored refund_exposure_pence is the widget's advisory legacy aggregate
// signal, not an exact per-instructor refund liability.
//
// Why this exists: the widget (api/admin.js handlePlatformBalance) is a
// dashboard gauge. Without a daily snapshot, two failure modes are silent:
//   A) Friday cron fails on a payout that the widget said was safe → no signal
//      that the dashboard was lying.
//   B) Trailing payout outflow drifts above trailing Stripe inflow → the
//      platform is bleeding the float (likely the credit-funded-default bias
//      tracked in project_credit_funded_default.md, closed structurally by
//      Step 4 + 4g) without any per-row symptom.
//
// Both triggers email ERROR_ALERT_EMAIL via _error-alert.js sendAlertEmail.

const { createPlatformStripeClient, STRIPE_CLIENT_PURPOSES } = require('./_stripe-clients');
const stripe = createPlatformStripeClient({ purpose: STRIPE_CLIENT_PURPOSES.RECONCILIATION });
const { sendAlertEmail } = require('./_error-alert');
const { verifyCronAuth } = require('./_auth');
const { computePlatformBalance } = require('./_platform-balance');
const { withCronLock } = require('./_cron-lock');

// Trigger B floor — outflow allowed to exceed inflow by up to this much
// before alerting. £100 picked as a round noise floor; revisit if the alarm
// fires spuriously once real outflow data accrues post-2026-05-22.
const TRIGGER_B_FLOOR_PENCE = 10000;

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  // Lease 300s. Stripe.balance.retrieve + a few SELECTs typically <5s; the
  // floor gives plenty of headroom while still letting a crashed run
  // recover quickly on the next daily firing.
  return withCronLock(req, res, 'cron-balance-snapshot', 300, async (sql) => {
    // 1. Compute the widget shape via the shared helper. Omitted schoolId is
    // intentional global/all-school snapshot mode, matching Friday payout
    // preview semantics rather than defaulting to school 1.
    const widget = await computePlatformBalance(sql, stripe);

    // 2. Trailing-30d Stripe inflow. Any Checkout Session, PaymentIntent, or
    // Charge id marks a Stripe-originated row regardless of payment_method
    // write-path differences.
    const [inflowRow] = await sql`
      SELECT COALESCE(SUM(
        CASE WHEN type IN ('purchase', 'slot_purchase') THEN amount_pence
             WHEN type = 'refund' THEN -amount_pence
             ELSE 0 END
      ), 0)::int AS pence
        FROM credit_transactions
       WHERE (stripe_session_id IS NOT NULL
          OR stripe_payment_intent_id IS NOT NULL
          OR stripe_charge_id IS NOT NULL)
         AND created_at > NOW() - INTERVAL '30 days'
    `;
    const trailingInflowPence = inflowRow.pence || 0;

    // 3. Trailing-30d payout outflow. Counts completed Friday-cron payouts
    // plus the Stripe fee the platform paid to make the transfer (kept in
    // instructor_payouts.stripe_fees_pence per Step 4f.d).
    const [outflowRow] = await sql`
      SELECT COALESCE(SUM(amount_pence + COALESCE(stripe_fees_pence, 0)), 0)::int AS pence
        FROM instructor_payouts
       WHERE status = 'completed'
         AND completed_at > NOW() - INTERVAL '30 days'
    `;
    const trailingOutflowPence = outflowRow.pence || 0;

    // 4. Persist the snapshot. payout_preview_json captures the per-instructor
    // breakdown so a failure-path alert can quote what was promised.
    const [snapshot] = await sql`
      INSERT INTO platform_balance_snapshots
        (status, available_pence, pending_pence, total_payout_pence,
         balance_after_payout_pence, refund_exposure_pence, payout_preview_json,
         trailing_30d_stripe_inflow_pence, trailing_30d_payout_outflow_pence)
      VALUES
        (${widget.status},
         ${widget.available_pence},
         ${widget.pending_pence},
         ${widget.total_payout_pence},
         ${widget.balance_after_payout_pence},
         ${widget.refund_exposure_pence},
         ${JSON.stringify(widget.payout_preview)}::jsonb,
         ${trailingInflowPence},
         ${trailingOutflowPence})
      RETURNING id, captured_at
    `;

    // 5. Trigger B — coarse aggregate bias detection. If outflow exceeds
    // inflow by more than the floor, the cron is paying out money the
    // platform isn't taking in. Could be the credit-funded list-rate bias
    // (Step 4 / 4g territory) or a brand-new failure mode. Either way:
    // Fraser's inbox.
    const gapPence = trailingOutflowPence - trailingInflowPence;
    let triggerBFired = false;
    if (gapPence > TRIGGER_B_FLOOR_PENCE) {
      triggerBFired = true;
      const recentPayouts = await sql`
        SELECT id, instructor_id, amount_pence, completed_at
          FROM instructor_payouts
         WHERE status = 'completed'
           AND completed_at > NOW() - INTERVAL '30 days'
         ORDER BY completed_at DESC
         LIMIT 5
      `;
      const lines = recentPayouts.map(p =>
        `  • payout #${p.id} — instructor ${p.instructor_id} — £${(p.amount_pence/100).toFixed(2)} on ${new Date(p.completed_at).toISOString().slice(0,10)}`
      ).join('\n');
      const txt = [
        `Trailing 30d payout outflow exceeds Stripe inflow by £${(gapPence/100).toFixed(2)}.`,
        ``,
        `Inflow (credit_transactions, Stripe identity present):       £${(trailingInflowPence/100).toFixed(2)}`,
        `Outflow (instructor_payouts.completed + Stripe fees):         £${(trailingOutflowPence/100).toFixed(2)}`,
        `Gap:                                                          £${(gapPence/100).toFixed(2)}  (floor £${(TRIGGER_B_FLOOR_PENCE/100).toFixed(2)})`,
        ``,
        `Snapshot id: ${snapshot.id}`,
        ``,
        `Recent payouts driving outflow:`,
        lines || '  (none)',
        ``,
        `Most likely explanation: the bulk-pack list-rate overpay bias`,
        `(project_credit_funded_default.md), or a new failure mode.`,
      ].join('\n');
      const html = `
        <h3 style="color:#b45309;">Trailing 30d payouts exceed Stripe cash inflow by £${(gapPence/100).toFixed(2)}</h3>
        <table style="border-collapse:collapse;font-family:monospace;font-size:13px;">
          <tr><td style="padding:4px 12px;">Inflow (Stripe identity present, 30d)</td><td style="padding:4px 12px;text-align:right;">£${(trailingInflowPence/100).toFixed(2)}</td></tr>
          <tr><td style="padding:4px 12px;">Outflow (completed payouts + fees, 30d)</td><td style="padding:4px 12px;text-align:right;">£${(trailingOutflowPence/100).toFixed(2)}</td></tr>
          <tr><td style="padding:4px 12px;border-top:1px solid #ccc;"><b>Gap</b></td><td style="padding:4px 12px;border-top:1px solid #ccc;text-align:right;"><b>£${(gapPence/100).toFixed(2)}</b></td></tr>
          <tr><td style="padding:4px 12px;">Floor</td><td style="padding:4px 12px;text-align:right;">£${(TRIGGER_B_FLOOR_PENCE/100).toFixed(2)}</td></tr>
        </table>
        <p>Snapshot id: <code>${snapshot.id}</code></p>
        <h4>Recent payouts driving outflow:</h4>
        <pre style="background:#f5f5f5;padding:12px;border-radius:6px;font-size:13px;">${lines || '(none)'}</pre>
        <p style="color:#666;">Most likely: bulk-pack list-rate overpay bias (see <code>project_credit_funded_default.md</code>), or a new failure mode.</p>
      `;
      // MUST await — Vercel kills the function instance after the HTTP
      // response, so fire-and-forget would tear down SMTP in flight.
      // See _error-alert.js sendAlertEmail JSDoc and the 2026-05-21
      // cron-credit-reconcile incident.
      await sendAlertEmail({
        subject: `⚠️ Trailing 30d payouts exceed Stripe inflow by £${(gapPence/100).toFixed(2)}`,
        text: txt,
        html
      });
    }

    return {
      ok: true,
      snapshot_id: snapshot.id,
      status: widget.status,
      balance_after_payout_pence: widget.balance_after_payout_pence,
      trailing_30d_stripe_inflow_pence: trailingInflowPence,
      trailing_30d_payout_outflow_pence: trailingOutflowPence,
      trigger_b_fired: triggerBFired
    };
  });
};
