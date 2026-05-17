// Validation harness for the widget falsifiability alert layer.
// Runs READ-ONLY against the configured POSTGRES_URL. Does NOT write to
// platform_balance_snapshots (the table need not exist yet — script tolerates
// the missing-table case). Asserts that:
//
//   1. computePlatformBalance(sql, stripe) returns a populated result.
//   2. The trailing-30d inflow query parses and returns a number.
//   3. The trailing-30d outflow query parses and returns a number.
//   4. The Trigger B threshold comparison would NOT fire on current prod
//      numbers (outflow ≪ inflow today).
//   5. The Trigger A snapshot lookup query parses (returns empty until table
//      exists / has rows).
//
// Each assertion logs PASS / FAIL. Exit code = 0 only on all-PASS.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import Stripe from 'stripe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env.local');
const txt = fs.readFileSync(envPath, 'utf8');
for (const line of txt.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

const sql = neon(process.env.POSTGRES_URL);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const results = [];
function assert(label, cond, detail = '') {
  results.push({ label, ok: !!cond, detail });
  console.log((cond ? '✓ PASS' : '✗ FAIL') + ' — ' + label + (detail ? '  [' + detail + ']' : ''));
}

// 1. computePlatformBalance still returns the expected shape.
try {
  const { computePlatformBalance } = await import('../api/_platform-balance.js');
  const widget = await computePlatformBalance(sql, stripe);
  const requiredKeys = ['available_pence','pending_pence','payout_preview','total_payout_pence',
    'balance_after_payout_pence','excluded_instructors','refund_exposure_pence','status'];
  const missing = requiredKeys.filter(k => !(k in widget));
  assert('computePlatformBalance returns full widget shape', missing.length === 0,
    missing.length ? 'missing keys: ' + missing.join(',') : `status=${widget.status} avail=£${(widget.available_pence/100).toFixed(2)}`);
  assert('status is binary green|red', widget.status === 'green' || widget.status === 'red', `status=${widget.status}`);
} catch (err) {
  // _platform-balance.js is a CommonJS module — dynamic import from ESM may fail in strict modes.
  // Treat that as a soft pass: the file already passed `node --check`.
  assert('computePlatformBalance importable from ESM context', false, 'soft-fail: ' + err.message.slice(0,120));
}

// 2. Trailing-30d Stripe inflow query parses.
try {
  const [row] = await sql`
    SELECT COALESCE(SUM(
      CASE WHEN type IN ('purchase', 'slot_purchase') THEN amount_pence
           WHEN type = 'refund' THEN -amount_pence
           ELSE 0 END
    ), 0)::int AS pence
      FROM credit_transactions
     WHERE stripe_session_id IS NOT NULL
       AND created_at > NOW() - INTERVAL '30 days'
  `;
  const pence = row.pence || 0;
  assert('inflow query parses and returns numeric pence', typeof pence === 'number', `£${(pence/100).toFixed(2)}`);
  globalThis.__inflow = pence;
} catch (err) {
  assert('inflow query parses', false, err.message.slice(0,200));
}

// 3. Trailing-30d outflow query parses.
try {
  const [row] = await sql`
    SELECT COALESCE(SUM(amount_pence + COALESCE(stripe_fees_pence, 0)), 0)::int AS pence
      FROM instructor_payouts
     WHERE status = 'completed'
       AND completed_at > NOW() - INTERVAL '30 days'
  `;
  const pence = row.pence || 0;
  assert('outflow query parses and returns numeric pence', typeof pence === 'number', `£${(pence/100).toFixed(2)}`);
  globalThis.__outflow = pence;
} catch (err) {
  assert('outflow query parses', false, err.message.slice(0,200));
}

// 4. Trigger B comparison — must NOT fire on current prod numbers.
const FLOOR = 10000; // £100 in pence — matches TRIGGER_B_FLOOR_PENCE in cron file
const gap = (globalThis.__outflow || 0) - (globalThis.__inflow || 0);
assert('Trigger B does NOT fire on current prod state', gap <= FLOOR,
  `gap=£${(gap/100).toFixed(2)} floor=£${(FLOOR/100).toFixed(2)} (negative gap = healthy)`);

// 5. Trigger A snapshot-lookup query parses against the new table.
//    Tolerates missing table (returns empty + structured error message).
try {
  const rows = await sql`
    SELECT id, captured_at, status, balance_after_payout_pence, total_payout_pence
      FROM platform_balance_snapshots
     WHERE captured_at > NOW() - INTERVAL '24 hours'
       AND status = 'green'
     ORDER BY captured_at DESC
     LIMIT 1
  `;
  assert('Trigger A snapshot-lookup query parses', Array.isArray(rows),
    rows.length ? `1 green snapshot found within last 24h` : `0 rows (expected pre-deploy)`);
} catch (err) {
  // Allow "table does not exist" as expected pre-migration.
  const expected = /relation .* does not exist/i.test(err.message);
  assert('Trigger A snapshot-lookup query parses (or table not yet migrated)',
    expected, err.message.slice(0,200));
}

// Summary.
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  process.exit(1);
}
