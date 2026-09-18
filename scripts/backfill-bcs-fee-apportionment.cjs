#!/usr/bin/env node
/**
 * Backfill booking_credit_sources.stripe_fee_pence from the funding
 * credit_transaction, apportioned by minutes_drawn.
 *
 * WHY: scripts/backfill-stripe-fee-evidence.cjs recovered the real Stripe fee
 * onto credit_transactions, but the per-booking attribution lives on
 * booking_credit_sources, and 86 draw rows still carry 0. The payout path reads
 * BCS first (api/_payout-helpers.js getEligibleBookings), so a credit-funded
 * lesson currently computes as though no fee was ever paid: two identical
 * 90-minute Shannon Savage lessons on 15 Sep pay £72.95 and £74.25 purely
 * because one has fee evidence and the other does not.
 *
 * Apportionment uses api/_pence-allocator.js — the same Hamilton
 * largest-remainder allocator that api/_bcs-fifo.js::allocateFeeForDraw uses for
 * new bookings — so backfilled rows are indistinguishable from live ones and the
 * allocated pence sum exactly to the source fee. Never recomputes a fee from a
 * percentage; the only input is what Stripe actually charged.
 *
 * Usage:
 *   node scripts/backfill-bcs-fee-apportionment.cjs          # dry run (default)
 *   node scripts/backfill-bcs-fee-apportionment.cjs --apply  # write
 *
 * Per feedback_dry_run_is_a_safety_check_not_a_progress_bar: if the dry run
 * diverges from expectation, STOP and investigate per row.
 */
'use strict';

const fs = require('fs');
const path = require('path');

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
const { allocate } = require('../api/_pence-allocator');

const APPLY = process.argv.includes('--apply');
const sql = neon(process.env.POSTGRES_URL);

/**
 * Split a credit transaction's fee across its draws.
 *
 * Weights are minutes_drawn, plus a trailing "undrawn" weight for any minutes of
 * the purchase not yet consumed, so a partly-used purchase only attributes the
 * fee share its drawn minutes earned. The undrawn remainder stays unallocated
 * and is picked up by a later draw through the normal FIFO path.
 */
function apportion(ct, draws) {
  const drawnMinutes = draws.reduce((sum, d) => sum + d.minutes_drawn, 0);
  const purchaseMinutes = Number(ct.minutes);

  // Guard: a draw total exceeding the purchase means the ledger is inconsistent
  // and we must not invent an allocation over it.
  if (!Number.isSafeInteger(purchaseMinutes) || purchaseMinutes <= 0 || drawnMinutes > purchaseMinutes) {
    return { ok: false, reason: `MINUTES_INCONSISTENT purchase=${purchaseMinutes} drawn=${drawnMinutes}` };
  }

  const undrawn = purchaseMinutes - drawnMinutes;
  const weights = draws.map((d) => d.minutes_drawn);
  if (undrawn > 0) weights.push(undrawn);

  const shares = allocate(ct.stripe_fee_pence, weights);
  const allocations = draws.map((d, i) => ({ bcs_id: d.id, booking_id: d.booking_id, minutes: d.minutes_drawn, fee: shares[i] }));
  const allocatedTotal = allocations.reduce((sum, a) => sum + a.fee, 0);

  // allocate() guarantees sum(shares) === total exactly; assert the slice we
  // are writing never exceeds the source fee.
  if (allocatedTotal > ct.stripe_fee_pence) {
    return { ok: false, reason: `OVER_ALLOCATED ${allocatedTotal} > ${ct.stripe_fee_pence}` };
  }
  return { ok: true, allocations, allocatedTotal, undrawnMinutes: undrawn };
}

async function main() {
  // Only CTs whose fee is known and whose active draws are not yet attributed.
  // Rows that already carry a fee are excluded entirely: re-allocating them
  // would double-count.
  const candidates = await sql`
    SELECT ct.id, ct.minutes, ct.amount_pence, ct.stripe_fee_pence
      FROM credit_transactions ct
     WHERE COALESCE(ct.stripe_fee_pence, 0) > 0
       AND EXISTS (
         SELECT 1 FROM booking_credit_sources bcs
          WHERE bcs.credit_transaction_id = ct.id
            AND bcs.refunded_at IS NULL
            AND COALESCE(bcs.stripe_fee_pence, 0) = 0
       )
       AND NOT EXISTS (
         SELECT 1 FROM booking_credit_sources bcs
          WHERE bcs.credit_transaction_id = ct.id
            AND bcs.refunded_at IS NULL
            AND COALESCE(bcs.stripe_fee_pence, 0) > 0
       )
     ORDER BY ct.id
  `;

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${candidates.length} credit transactions with unattributed fee\n`);

  const results = [];
  let written = 0;

  for (const ct of candidates) {
    const draws = await sql`
      SELECT id, booking_id, minutes_drawn
        FROM booking_credit_sources
       WHERE credit_transaction_id = ${ct.id}
         AND refunded_at IS NULL
       ORDER BY id
    `;
    const outcome = apportion(ct, draws);
    if (!outcome.ok) {
      results.push({ ct: ct.id, verdict: 'BLOCKED', reason: outcome.reason });
      continue;
    }

    results.push({
      ct: ct.id,
      verdict: 'OK',
      ct_fee_pence: ct.stripe_fee_pence,
      purchase_minutes: ct.minutes,
      undrawn_minutes: outcome.undrawnMinutes,
      allocated_pence: outcome.allocatedTotal,
      allocations: outcome.allocations,
    });

    if (APPLY) {
      for (const a of outcome.allocations) {
        if (a.fee === 0) continue;
        // Guarded on the row still being unattributed, so this is idempotent
        // and a concurrent writer wins.
        await sql`
          UPDATE booking_credit_sources
             SET stripe_fee_pence = ${a.fee}
           WHERE id = ${a.bcs_id}
             AND refunded_at IS NULL
             AND COALESCE(stripe_fee_pence, 0) = 0
        `;
        written += 1;
      }
    }
  }

  const ok = results.filter((r) => r.verdict === 'OK');
  const blocked = results.filter((r) => r.verdict !== 'OK');

  if (!APPLY) {
    const out = path.join(__dirname, '..', 'db', 'diagnostics', 'payout-bcs-fee-apportionment-dryrun.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(results, null, 1));
    console.log(`wrote ${path.relative(path.join(__dirname, '..'), out)}`);
  }

  const rowsToWrite = ok.reduce((sum, r) => sum + r.allocations.filter((a) => a.fee > 0).length, 0);
  const penceToWrite = ok.reduce((sum, r) => sum + r.allocated_pence, 0);
  const multiDraw = ok.filter((r) => r.allocations.length > 1);
  const partial = ok.filter((r) => r.undrawn_minutes > 0);

  console.log(`\nallocatable: ${ok.length}   blocked: ${blocked.length}`);
  for (const b of blocked) console.log(`  BLOCKED ct#${b.ct} ${b.reason}`);
  console.log(`\nBCS rows to update: ${rowsToWrite}   total fee attributed: £${(penceToWrite / 100).toFixed(2)}`);
  console.log(`  single full draw: ${ok.length - multiDraw.length - partial.length}`);
  console.log(`  multi-draw (fee split):  ${multiDraw.length}`);
  for (const m of multiDraw) {
    console.log(`    ct#${m.ct} fee=${m.ct_fee_pence} -> ${m.allocations.map((a) => `bk#${a.booking_id}:${a.fee}p/${a.minutes}m`).join(' + ')}`);
  }
  console.log(`  partly drawn (fee held back): ${partial.length}`);
  for (const p of partial) {
    console.log(`    ct#${p.ct} fee=${p.ct_fee_pence} purchase=${p.purchase_minutes}m undrawn=${p.undrawn_minutes}m -> attributing ${p.allocated_pence}p`);
  }
  if (APPLY) console.log(`\nAPPLIED — ${written} rows written.`);
  else console.log('\nDry run only — re-run with --apply to write.');
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
