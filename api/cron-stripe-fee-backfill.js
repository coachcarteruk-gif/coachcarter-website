// Hourly Stripe fee-evidence backfill cron — runs at :45 past the hour.
//
// GET /api/cron-stripe-fee-backfill
//   Authorization: Bearer ${CRON_SECRET}   (Vercel Cron sends this automatically)
//
// PURPOSE
// ──────────────────────────────────────────────────────────────────────────────
// This is the cron that api/webhook.js#L877 has always claimed exists:
//
//   // Snapshot the Stripe processing fee (Step 4f.b). NULL on failure; the
//   // reconcile cron (4f.e) backfills, and the payout pipeline treats NULL
//   // as zero in the meantime.
//
// It was never built. Step 4f.e was planned and skipped, so every fee the
// webhook failed to capture stayed NULL permanently. By September 2026 that was
// 92 of 166 Stripe-funded credit_transactions rows — and the second half of that
// comment had also gone stale: assertPayoutEvidenceComplete() now BLOCKS on a
// NULL fee rather than treating it as zero, which is correct (treating NULL as
// zero overpays 93p on a £55 hour) but means a missed fee silently blocks a
// payout instead of silently inflating one.
//
// The webhook's fetch is deliberately best-effort: fetchSessionFundingEvidence
// catches its own errors and returns empty evidence rather than failing the
// whole fulfilment, because a learner's credit must not be lost to a transient
// Stripe timeout. That trade-off is right, but it only works if something later
// repairs the gap. This is that something.
//
// WHAT IT DOES
// ──────────────────────────────────────────────────────────────────────────────
// For each credit_transactions row that is Stripe-funded, has money on it, and
// has no fee recorded, ask Stripe for the immutable balance transaction and
// store the fee it actually charged.
//
//   - The fee is NEVER computed from a percentage. UK cards are 1.5% + 20p, but
//     PayPal passthrough legitimately costs ~3.9% and Flexible Hours packages
//     ~0.54%. Only what Stripe reports is written.
//   - The recorded amount must match ours exactly, or the row is left alone:
//     a mismatch means we are looking at a different payment.
//   - Anything unverifiable stays NULL and stays blocked. A wrong fee mis-pays
//     an instructor; a missing fee only delays a payout.
//
// Writes are guarded on stripe_fee_pence IS NULL, so this is idempotent and a
// concurrent webhook always wins.
//
// WHY HOURLY
// ──────────────────────────────────────────────────────────────────────────────
// The Friday payout cron runs at 09:00. An hourly repair means any fee the
// webhook misses is recovered long before it can block a payout, and the gap is
// never more than an hour wide. Rows are capped per run so one bad backlog
// cannot exhaust the function's time budget.
//
// This cron only fills in what Stripe already charged. It does not create,
// modify or reverse any credit, booking, payout or transfer.

'use strict';

const { sendAlertEmail } = require('./_error-alert');
const { verifyCronAuth } = require('./_auth');
const { withCronLock } = require('./_cron-lock');
const { fetchSessionFundingEvidence } = require('./_stripe-fee');
const { reportError } = require('./_error-alert');

// Stripe rate limits at 100 req/s in live mode; we are nowhere near that, but
// each row costs 1-2 API calls and the function has a finite budget. 200 rows
// clears any realistic hourly backlog with room to spare.
const MAX_ROWS_PER_RUN = 200;

// Alert if a row has been unrepairable for longer than this. A single failure is
// usually a transient Stripe blip that the next run fixes; a row still missing
// after a day means something structural (a deleted session, a mode mismatch)
// that a human needs to look at.
const STALE_HOURS = 24;

/**
 * Resolve the PaymentIntent for a transaction.
 *
 * fetchSessionFundingEvidence deliberately refuses an identity-less candidate:
 * with no payment_intent it returns empty without expanding the session. Some
 * legacy rows carry only a Checkout Session id, so resolve the PI from the
 * session first rather than letting those rows fail forever.
 */
async function resolvePaymentIntentId(row, stripe) {
  if (row.stripe_payment_intent_id) return row.stripe_payment_intent_id;
  if (!row.stripe_session_id) return null;
  const session = await stripe.checkout.sessions.retrieve(row.stripe_session_id);
  return typeof session.payment_intent === 'object'
    ? session.payment_intent?.id || null
    : session.payment_intent || null;
}

/**
 * Decide whether Stripe's evidence is good enough to write.
 *
 * Deliberately strict: the amount must match, the fee must come from a balance
 * transaction, and the PaymentIntent must have succeeded. Anything less and we
 * leave the row NULL for a human, because a plausible-but-wrong fee is worse
 * than an absent one.
 */
function verdictFor(row, evidence) {
  if (!evidence) return { ok: false, reason: 'NO_EVIDENCE' };
  const fee = Number.isSafeInteger(evidence.feePence) ? evidence.feePence : null;
  if (fee === null) return { ok: false, reason: 'NO_BALANCE_TRANSACTION_FEE' };
  if (evidence.source !== 'balance_transaction') return { ok: false, reason: 'FEE_NOT_FROM_BALANCE_TRANSACTION' };
  if (evidence.paymentIntentStatus !== 'succeeded') return { ok: false, reason: `PI_STATUS_${evidence.paymentIntentStatus}` };
  if (evidence.amountPence !== row.amount_pence) {
    return { ok: false, reason: `AMOUNT_MISMATCH_db_${row.amount_pence}_stripe_${evidence.amountPence}` };
  }
  if (fee < 0 || fee > row.amount_pence) return { ok: false, reason: 'FEE_OUT_OF_RANGE' };
  return { ok: true, fee };
}

async function runFeeBackfill(sql, { stripe, maxRows = MAX_ROWS_PER_RUN } = {}) {
  const client = stripe || require('./_stripe-clients').createPlatformStripeClient({
    purpose: require('./_stripe-clients').STRIPE_CLIENT_PURPOSES.RECONCILIATION,
  });

  const rows = await sql`
    SELECT id, type, amount_pence, learner_id,
           stripe_session_id, stripe_payment_intent_id,
           created_at,
           EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS age_hours
      FROM credit_transactions
     WHERE stripe_fee_pence IS NULL
       AND amount_pence > 0
       AND source = 'stripe'
       AND (stripe_session_id IS NOT NULL OR stripe_payment_intent_id IS NOT NULL)
     ORDER BY created_at
     LIMIT ${maxRows}
  `;

  const repaired = [];
  const failed = [];

  for (const row of rows) {
    try {
      const paymentIntentId = await resolvePaymentIntentId(row, client);
      const evidence = await fetchSessionFundingEvidence({
        id: row.stripe_session_id,
        payment_intent: paymentIntentId,
      }, client);
      const verdict = verdictFor(row, evidence);
      if (!verdict.ok) {
        failed.push({ id: row.id, age_hours: Number(row.age_hours), reason: verdict.reason });
        continue;
      }
      const updated = await sql`
        UPDATE credit_transactions
           SET stripe_fee_pence = ${verdict.fee}
         WHERE id = ${row.id}
           AND stripe_fee_pence IS NULL
        RETURNING id
      `;
      // A concurrent webhook may have filled it between our SELECT and UPDATE.
      // That is the desired outcome, not a failure — the webhook's value is as
      // authoritative as ours and came from the same balance transaction.
      if (updated.length) repaired.push({ id: row.id, fee_pence: verdict.fee, amount_pence: row.amount_pence });
    } catch (err) {
      failed.push({ id: row.id, age_hours: Number(row.age_hours), reason: `ERROR_${err.message}`.slice(0, 200) });
    }
  }

  // Only alert on rows old enough that a transient failure has been ruled out.
  // Alerting on every first-attempt miss would train the operator to ignore it.
  const stale = failed.filter((f) => f.age_hours >= STALE_HOURS);
  if (stale.length) {
    const lines = stale.slice(0, 20).map((f) => `  ct#${f.id}  ${Math.round(f.age_hours)}h old  ${f.reason}`);
    const text = [
      `${stale.length} Stripe-funded credit_transactions row(s) have been missing`,
      `processing-fee evidence for more than ${STALE_HOURS}h and could not be repaired.`,
      ``,
      `These block instructor payout (ACTUAL_PROCESSING_FEE_EVIDENCE_MISSING) until`,
      `resolved. They are NOT treated as zero-fee — that would overpay.`,
      ``,
      ...lines,
      stale.length > 20 ? `  ...and ${stale.length - 20} more` : '',
    ].join('\n');
    // MUST await — Vercel freezes the instance once the response returns, so a
    // fire-and-forget send would tear down SMTP mid-flight.
    await sendAlertEmail({
      subject: `⚠️ ${stale.length} Stripe fee evidence row(s) unrepaired after ${STALE_HOURS}h`,
      text,
      html: `<pre>${text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>`,
    });
  }

  const result = {
    ok: true,
    candidates: rows.length,
    repaired: repaired.length,
    repaired_fee_pence: repaired.reduce((sum, r) => sum + r.fee_pence, 0),
    failed: failed.length,
    stale_alerted: stale.length,
    // Truncated so a large backlog cannot bloat the cron log line.
    failures: failed.slice(0, 20),
  };
  console.log('[cron-stripe-fee-backfill]', JSON.stringify(result));
  return result;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Unauthorised' });

  // Lease 300s. Each row costs 1-2 Stripe round trips, so a full 200-row run is
  // well inside this; the lease mainly gives crash-recovery headroom.
  return withCronLock(req, res, 'cron-stripe-fee-backfill', 300, async (sql) => {
    try {
      return await runFeeBackfill(sql);
    } catch (err) {
      reportError('/api/cron-stripe-fee-backfill', err);
      throw err;
    }
  });
};

// Test hooks.
module.exports.runFeeBackfill = runFeeBackfill;
module.exports.verdictFor = verdictFor;
module.exports.MAX_ROWS_PER_RUN = MAX_ROWS_PER_RUN;
module.exports.STALE_HOURS = STALE_HOURS;
