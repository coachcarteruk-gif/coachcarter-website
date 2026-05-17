// Read-only verification of the refund_exposure filter fix in _platform-balance.js.
// Runs BOTH the old filter (payment_method='stripe') and the new filter
// (stripe_session_id IS NOT NULL) side-by-side and prints the resulting
// net_cash_in_pence. Expected: old=£0, new=non-zero.
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

const [old] = await sql`
  SELECT COALESCE(SUM(
    CASE WHEN ct.type IN ('purchase', 'slot_purchase') THEN ct.amount_pence
         WHEN ct.type = 'refund' THEN -ct.amount_pence
         ELSE 0 END
  ), 0)::bigint AS pence
    FROM credit_transactions ct
    JOIN learner_users lu2 ON lu2.id = ct.learner_id
   WHERE ct.payment_method = 'stripe'
     AND lu2.is_test_account = FALSE
`;
const [updated] = await sql`
  SELECT COALESCE(SUM(
    CASE WHEN ct.type IN ('purchase', 'slot_purchase') THEN ct.amount_pence
         WHEN ct.type = 'refund' THEN -ct.amount_pence
         ELSE 0 END
  ), 0)::bigint AS pence
    FROM credit_transactions ct
    JOIN learner_users lu2 ON lu2.id = ct.learner_id
   WHERE ct.stripe_session_id IS NOT NULL
     AND lu2.is_test_account = FALSE
`;
const [creditCap] = await sql`
  SELECT COALESCE(SUM(
    lu.balance_minutes
    * COALESCE((s.config -> 'pricing' ->> 'bulk_hourly_pence')::int, 5500)
    / 60.0
  ), 0)::bigint AS pence
    FROM learner_users lu
    JOIN schools s ON s.id = lu.school_id
   WHERE lu.balance_minutes > 0
     AND lu.is_test_account = FALSE
`;
const oldPence     = parseInt(old.pence)     || 0;
const updatedPence = parseInt(updated.pence) || 0;
const capPence     = parseInt(creditCap.pence) || 0;
const fmt = p => `£${(p/100).toFixed(2)}`;
console.log('net_cash_in_pence — OLD filter (payment_method=stripe):    ', fmt(oldPence), '  ← expected: £0.00');
console.log('net_cash_in_pence — NEW filter (stripe_session_id NOT NULL):', fmt(updatedPence), '  ← expected: non-zero');
console.log('live_credit_pence cap (non-test learners with balance):     ', fmt(capPence));
console.log('refund_exposure_pence (min of new + cap):                   ', fmt(Math.min(updatedPence, capPence)));

if (oldPence === 0 && updatedPence > 0) {
  console.log('\n✓ PASS — fix moves the number from £0 to a real value.');
  process.exit(0);
} else {
  console.log('\n✗ FAIL — unexpected result.');
  process.exit(1);
}
