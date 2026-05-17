// Post-merge verification for the widget alert layer PR (#146).
// 1. Confirms platform_balance_snapshots table + index exist.
// 2. Counts existing snapshot rows (likely 0 unless cron already fired).
// 3. Reports next steps based on what it finds.
//
// Read-only. Safe to run any number of times.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

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

// 1. Table existence.
const [tbl] = await sql`
  SELECT to_regclass('public.platform_balance_snapshots') AS rel
`;
if (!tbl.rel) {
  console.log('✗ Table platform_balance_snapshots does NOT exist.');
  console.log('  → Run: curl "https://www.coachcarter.uk/api/migrate?secret=$MIGRATION_SECRET"');
  process.exit(1);
}
console.log('✓ Table platform_balance_snapshots exists.');

// 2. Index existence.
const idxRows = await sql`
  SELECT indexname FROM pg_indexes
   WHERE tablename = 'platform_balance_snapshots'
   ORDER BY indexname
`;
console.log('  indexes:', idxRows.map(r => r.indexname).join(', ') || '(none)');

// 3. Columns sanity-check (ordinal_position omitted for clarity).
const cols = await sql`
  SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
   WHERE table_name = 'platform_balance_snapshots'
   ORDER BY ordinal_position
`;
const expected = ['id','captured_at','status','available_pence','pending_pence','total_payout_pence',
  'balance_after_payout_pence','refund_exposure_pence','payout_preview_json',
  'trailing_30d_stripe_inflow_pence','trailing_30d_payout_outflow_pence'];
const got = cols.map(c => c.column_name);
const missing = expected.filter(c => !got.includes(c));
if (missing.length) {
  console.log('✗ Missing columns:', missing.join(', '));
  process.exit(1);
}
console.log('✓ All 11 expected columns present.');

// 4. Row count.
const [count] = await sql`SELECT COUNT(*)::int AS n FROM platform_balance_snapshots`;
console.log(`\nSnapshot row count: ${count.n}`);

if (count.n === 0) {
  console.log('  → No snapshots yet. Either wait for 08:00 UTC tomorrow,');
  console.log('    or trigger manually:');
  console.log('      curl -H "Authorization: Bearer $CRON_SECRET" \\');
  console.log('           https://www.coachcarter.uk/api/cron-balance-snapshot');
} else {
  const [latest] = await sql`
    SELECT id, captured_at, status,
           available_pence, balance_after_payout_pence,
           trailing_30d_stripe_inflow_pence,
           trailing_30d_payout_outflow_pence,
           total_payout_pence
      FROM platform_balance_snapshots
     ORDER BY id DESC LIMIT 1
  `;
  const fmt = p => `£${(p/100).toFixed(2)}`;
  console.log('\nLatest snapshot:');
  console.log('  id:                ', latest.id);
  console.log('  captured_at:       ', latest.captured_at);
  console.log('  status:            ', latest.status, latest.status === 'green' ? '(payout would succeed)' : '(payout would fail / nothing to pay)');
  console.log('  available_pence:   ', fmt(latest.available_pence));
  console.log('  total_payout_pence:', fmt(latest.total_payout_pence));
  console.log('  balance_after:     ', fmt(latest.balance_after_payout_pence));
  console.log('  30d inflow:        ', fmt(latest.trailing_30d_stripe_inflow_pence));
  console.log('  30d outflow:       ', fmt(latest.trailing_30d_payout_outflow_pence));
  const gap = latest.trailing_30d_payout_outflow_pence - latest.trailing_30d_stripe_inflow_pence;
  console.log('  outflow - inflow:  ', fmt(gap), gap > 10000 ? '⚠️ TRIGGER B WOULD FIRE' : '(healthy)');
}
