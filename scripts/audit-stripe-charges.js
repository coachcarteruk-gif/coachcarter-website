#!/usr/bin/env node
//
// Stripe payment-data completeness audit (INSTRUCTOR-PAYMENTS-PLAN Step 4f.0)
//
// Reconciles every paid Stripe Checkout session over a configurable window
// against `credit_transactions`. Classifies each session into one of three
// buckets:
//
//   matched    - session.id found in credit_transactions.stripe_session_id
//   excluded   - paid session whose metadata.payment_type is NOT in the
//                tracked set (currently legacy package flow uses none /
//                pass_guarantee, handled by handleCheckoutComplete which
//                writes to an in-memory Map by deliberate design)
//   suspicious - paid session whose metadata.payment_type IS tracked
//                (credit_purchase, slot_booking, lesson_offer) but no
//                credit_transactions row exists. These are the real gaps.
//
// For every session, also resolves the underlying PaymentIntent and pulls
// `latest_charge.balance_transaction.fee` so the script doubles as a fee
// snapshot rehearsal for Step 4f (per-booking fee_pence column).
//
// Output: TSV to stdout, summary table to stderr. Pipe stdout to a file:
//   node scripts/audit-stripe-charges.js --days 90 > audit-90d.tsv
//
// Reads STRIPE_SECRET_KEY and POSTGRES_URL from .env.local in repo root.
//
// Usage:
//   node scripts/audit-stripe-charges.js [--days N] [--env path/to/.env.local]
//
// Read-only. Touches Stripe and Neon over the network; performs no writes.

const fs   = require('fs');
const path = require('path');

const args = parseArgs(process.argv.slice(2));
const DAYS    = Number.isFinite(+args.days) ? +args.days : 90;
const ENVPATH = args.env || path.resolve(__dirname, '..', '.env.local');

loadEnvFile(ENVPATH);

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const POSTGRES_URL      = process.env.POSTGRES_URL;
if (!STRIPE_SECRET_KEY) die(`STRIPE_SECRET_KEY missing (looked in ${ENVPATH})`);
if (!POSTGRES_URL)      die(`POSTGRES_URL missing (looked in ${ENVPATH})`);

const stripe = require('stripe')(STRIPE_SECRET_KEY);
const { neon } = require('@neondatabase/serverless');
const sql = neon(POSTGRES_URL);

// Must match TRACKED_PAYMENT_TYPES in api/cron-reconcile-payments.js
const TRACKED_PAYMENT_TYPES = new Set([
  'credit_purchase',
  'slot_booking',
  'lesson_offer',
]);

main().catch(err => {
  console.error('FATAL:', err.stack || err.message);
  process.exit(1);
});

async function main() {
  const cutoffSeconds = Math.floor(Date.now() / 1000) - DAYS * 86400;
  log(`Window: last ${DAYS} days (since ${new Date(cutoffSeconds * 1000).toISOString()})`);

  log('Listing Stripe checkout sessions...');
  const sessions = await listAllPaidSessions(cutoffSeconds);
  log(`  ${sessions.length} paid+complete sessions found`);

  log('Resolving PaymentIntents + balance transactions for fee data...');
  const piByPiId = await fetchPaymentIntentsForSessions(sessions);
  log(`  ${piByPiId.size} payment intents resolved`);

  log('Querying credit_transactions for matches...');
  const sessionIds = sessions.map(s => s.id);
  const rows = sessionIds.length === 0 ? [] : await sql`
    SELECT stripe_session_id, id, amount_pence, type, created_at, learner_id
      FROM credit_transactions
     WHERE stripe_session_id = ANY(${sessionIds})
  `;
  const dbBySessionId = new Map(rows.map(r => [r.stripe_session_id, r]));
  log(`  ${rows.length} matching credit_transactions rows`);

  // TSV header
  const headers = [
    'session_id', 'created_utc', 'amount_pence', 'currency', 'payment_type',
    'tracked', 'db_match', 'db_credit_tx_id', 'db_amount_pence', 'db_type',
    'amount_matches', 'payment_intent_id', 'stripe_fee_pence', 'net_pence',
    'learner_email', 'bucket',
  ];
  console.log(headers.join('\t'));

  const buckets = { matched: 0, excluded: 0, suspicious: 0 };
  const gapTotals = { excluded_pence: 0, suspicious_pence: 0 };
  const suspicious = [];

  for (const s of sessions) {
    const paymentType = s.metadata?.payment_type || '';
    const tracked     = TRACKED_PAYMENT_TYPES.has(paymentType);
    const dbRow       = dbBySessionId.get(s.id);
    const matched     = !!dbRow;

    let bucket;
    if (matched) bucket = 'matched';
    else if (tracked) bucket = 'suspicious';
    else bucket = 'excluded';
    buckets[bucket]++;

    if (!matched && bucket === 'excluded') gapTotals.excluded_pence += s.amount_total || 0;
    if (!matched && bucket === 'suspicious') {
      gapTotals.suspicious_pence += s.amount_total || 0;
      suspicious.push(s);
    }

    const amountMatches = matched && dbRow.amount_pence === s.amount_total ? 'Y' : matched ? 'N' : '';

    const pi  = s.payment_intent ? piByPiId.get(s.payment_intent) : null;
    const fee = pi?.latest_charge?.balance_transaction?.fee ?? '';
    const net = pi?.latest_charge?.balance_transaction?.net ?? '';

    const row = [
      s.id,
      new Date(s.created * 1000).toISOString().replace('T', ' ').slice(0, 19),
      s.amount_total ?? '',
      s.currency || '',
      paymentType,
      tracked ? 'Y' : 'N',
      matched ? 'Y' : 'N',
      dbRow?.id ?? '',
      dbRow?.amount_pence ?? '',
      dbRow?.type ?? '',
      amountMatches,
      s.payment_intent || '',
      fee,
      net,
      (s.customer_details?.email || s.metadata?.learner_email || '').toLowerCase(),
      bucket,
    ];
    console.log(row.join('\t'));
  }

  log('');
  log('=== SUMMARY ===');
  log(`Window:           last ${DAYS} days`);
  log(`Total sessions:   ${sessions.length}`);
  log(`Matched:          ${buckets.matched}`);
  log(`Excluded (legacy):${buckets.excluded}   total £${(gapTotals.excluded_pence / 100).toFixed(2)}`);
  log(`Suspicious GAP:   ${buckets.suspicious}   total £${(gapTotals.suspicious_pence / 100).toFixed(2)}`);
  log('');
  if (suspicious.length > 0) {
    log('Suspicious sessions (tracked payment_type, no credit_transactions row):');
    for (const s of suspicious) {
      log(`  ${s.id}  £${((s.amount_total || 0) / 100).toFixed(2)}  ${s.metadata?.payment_type}  ${new Date(s.created * 1000).toISOString().slice(0, 10)}  ${s.customer_details?.email || s.metadata?.learner_email || ''}`);
    }
  }

  // Quick payment_type breakdown
  const byType = {};
  for (const s of sessions) {
    const t = s.metadata?.payment_type || '(none)';
    if (!byType[t]) byType[t] = { count: 0, pence: 0, matched: 0 };
    byType[t].count++;
    byType[t].pence += s.amount_total || 0;
    if (dbBySessionId.has(s.id)) byType[t].matched++;
  }
  log('');
  log('Breakdown by metadata.payment_type:');
  for (const [t, v] of Object.entries(byType).sort((a, b) => b[1].pence - a[1].pence)) {
    log(`  ${t.padEnd(20)} count=${String(v.count).padStart(3)}  matched=${String(v.matched).padStart(3)}  £${(v.pence / 100).toFixed(2).padStart(10)}`);
  }
}

async function listAllPaidSessions(cutoffSeconds) {
  const out = [];
  let startingAfter;
  while (true) {
    const page = await stripe.checkout.sessions.list({
      limit: 100,
      created: { gte: cutoffSeconds },
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const s of page.data) {
      if (s.status !== 'complete') continue;
      if (s.payment_status !== 'paid') continue;
      out.push(s);
    }
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return out;
}

// For every session with a payment_intent, retrieve the PI with the
// balance_transaction expanded so we can pull the actual fee Stripe charged.
// Done as individual retrieves (one per session) rather than list+filter
// because the list endpoint can't expand nested fields to depth 3.
async function fetchPaymentIntentsForSessions(sessions) {
  const map = new Map();
  const piIds = [...new Set(sessions.map(s => s.payment_intent).filter(Boolean))];
  for (let i = 0; i < piIds.length; i++) {
    const id = piIds[i];
    try {
      const pi = await stripe.paymentIntents.retrieve(id, {
        expand: ['latest_charge.balance_transaction'],
      });
      map.set(id, pi);
    } catch (err) {
      log(`  ! PI retrieve failed for ${id}: ${err.message}`);
    }
    if ((i + 1) % 25 === 0) log(`  ...${i + 1}/${piIds.length} PIs`);
  }
  return map;
}

// --- tiny utils ---

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    }
  }
  return out;
}

function loadEnvFile(p) {
  if (!fs.existsSync(p)) die(`env file not found: ${p}`);
  const txt = fs.readFileSync(p, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

function log(msg) { process.stderr.write(msg + '\n'); }
function die(msg) { log('ERROR: ' + msg); process.exit(2); }
