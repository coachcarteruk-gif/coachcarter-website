#!/usr/bin/env node
/**
 * Backfill credit_transactions.stripe_fee_pence from Stripe balance transactions.
 *
 * WHY: 92 Stripe-funded credit_transactions rows have stripe_fee_pence IS NULL.
 * assertPayoutEvidenceComplete() in api/_payout-helpers.js correctly refuses to
 * pay out a booking whose funding lacks actual processing-fee evidence
 * (ACTUAL_PROCESSING_FEE_EVIDENCE_MISSING), so 77 of Simon's 93 chargeable
 * bookings currently cannot be paid or summarised. The fee was always charged by
 * Stripe; it just was not persisted at the time. This recovers it from the
 * immutable balance transaction.
 *
 * NEVER defaults or computes a fee. If Stripe cannot supply verified evidence
 * for a row, that row is left NULL and stays blocked. A wrong fee silently
 * over- or under-pays an instructor; a missing fee only blocks a payout.
 *
 * Usage:
 *   node scripts/backfill-stripe-fee-evidence.cjs            # dry run (default)
 *   node scripts/backfill-stripe-fee-evidence.cjs --apply    # write
 *
 * Dry run writes db/diagnostics/payout-fee-backfill-dryrun.json.
 * Per feedback_dry_run_is_a_safety_check_not_a_progress_bar: if the dry run
 * diverges from expectation, STOP and investigate per row. Do not pass --apply
 * to push through an unexplained result.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// .env.local is CRLF on this machine; split on /\r?\n/ or values keep a \r.
function loadEnv() {
  const p = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}
loadEnv();

const { neon } = require('@neondatabase/serverless');
const Stripe = require('stripe');
const { fetchSessionFundingEvidence } = require('../api/_stripe-fee.js');

const APPLY = process.argv.includes('--apply');
const sql = neon(process.env.POSTGRES_URL);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetchSessionFundingEvidence refuses an identity-less candidate: if no
 * payment_intent is supplied it returns empty without expanding the session
 * (api/_stripe-fee.js). Four legacy rows (May 2026) carry a session id but no
 * stripe_payment_intent_id, so resolve the PI from the session first.
 */
async function resolvePaymentIntentId(row) {
  if (row.stripe_payment_intent_id) {
    return { id: row.stripe_payment_intent_id, resolvedFromSession: false };
  }
  if (!row.stripe_session_id) return { id: null, resolvedFromSession: false };
  const session = await stripe.checkout.sessions.retrieve(row.stripe_session_id);
  const id = typeof session.payment_intent === 'object'
    ? session.payment_intent?.id
    : session.payment_intent;
  return { id: id || null, resolvedFromSession: Boolean(id) };
}

/**
 * A row is only recoverable when Stripe's own balance transaction confirms it.
 * The amount must match what we recorded, or we are looking at a different
 * payment and must not copy its fee across.
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

async function main() {
  const rows = await sql`
    SELECT ct.id, ct.type, ct.amount_pence, ct.learner_id,
           ct.stripe_session_id, ct.stripe_payment_intent_id,
           ct.created_at::text AS created_at,
           EXISTS(
             SELECT 1 FROM booking_credit_sources bcs
               JOIN lesson_bookings lb ON lb.id = bcs.booking_id
              WHERE bcs.credit_transaction_id = ct.id
                AND bcs.refunded_at IS NULL
                AND lb.instructor_id = 6
           ) AS funds_simon
      FROM credit_transactions ct
     WHERE ct.stripe_fee_pence IS NULL
       AND ct.amount_pence > 0
     ORDER BY ct.created_at
  `;

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${rows.length} candidate rows\n`);

  const results = [];
  for (const row of rows) {
    let evidence = null;
    let error = null;
    let resolvedFromSession = false;
    try {
      const pi = await resolvePaymentIntentId(row);
      resolvedFromSession = pi.resolvedFromSession;
      evidence = await fetchSessionFundingEvidence({
        id: row.stripe_session_id,
        payment_intent: pi.id,
      });
    } catch (err) {
      error = err.message;
    }

    const verdict = verdictFor(row, evidence);
    results.push({
      ct: row.id,
      type: row.type,
      funds_simon: row.funds_simon,
      learner: row.learner_id,
      date: row.created_at.slice(0, 10),
      amount_pence: row.amount_pence,
      fee_pence: verdict.ok ? verdict.fee : null,
      fee_pct: verdict.ok ? +(100 * verdict.fee / row.amount_pence).toFixed(3) : null,
      balance_transaction: evidence?.balanceTransactionId || null,
      pi_resolved_from_session: resolvedFromSession,
      verdict: verdict.ok ? 'OK' : 'BLOCKED',
      reason: verdict.ok ? null : verdict.reason,
      error,
    });

    if (APPLY && verdict.ok) {
      // Guarded on IS NULL so a concurrent writer wins over this backfill and
      // re-running is idempotent.
      await sql`
        UPDATE credit_transactions
           SET stripe_fee_pence = ${verdict.fee}
         WHERE id = ${row.id}
           AND stripe_fee_pence IS NULL
      `;
    }
    await sleep(60); // stay well inside Stripe's rate limit
  }

  const ok = results.filter((r) => r.verdict === 'OK');
  const blocked = results.filter((r) => r.verdict !== 'OK');

  if (!APPLY) {
    const out = path.join(__dirname, '..', 'db', 'diagnostics', 'payout-fee-backfill-dryrun.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(results, null, 1));
    console.log(`wrote ${path.relative(path.join(__dirname, '..'), out)}`);
  }

  console.log(`\nrecoverable: ${ok.length}   blocked: ${blocked.length}`);
  for (const b of blocked) console.log(`  BLOCKED ct#${b.ct} ${b.reason || b.error}`);

  // Sanity band: UK card fees are 1.5% + 20p. Anything outside it is not
  // necessarily wrong (PayPal passthrough fees are legitimately higher) but
  // must be looked at rather than waved through.
  const odd = ok.filter((r) => Math.abs(r.fee_pence - Math.round(r.amount_pence * 0.015 + 20)) > 1);
  console.log(`\nmatching 1.5%+20p: ${ok.length - odd.length} of ${ok.length}`);
  for (const r of odd) {
    console.log(`  REVIEW ct#${r.ct} ${r.date} amount=${r.amount_pence} fee=${r.fee_pence} (${r.fee_pct}%)`);
  }

  const simon = ok.filter((r) => r.funds_simon);
  console.log(`\nfunding Simon bookings: ${simon.length} rows, £${(simon.reduce((a, b) => a + b.fee_pence, 0) / 100).toFixed(2)} of fees`);
  console.log(APPLY ? '\nAPPLIED.' : '\nDry run only — re-run with --apply to write.');
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
