// Step 2.5 — widen credit_transactions_type_check to allow 'free_trial'. Per
// PER-INSTRUCTOR-CREDITS-PLAN.md §Step 2 (free-trial writer + CHECK widening),
// captured in MEMORY.md project_next_session_plans_ready.md.
//
// Usage:
//   GET  /api/migrate-step-2-5?secret=...           → preview what would change
//   POST /api/migrate-step-2-5?secret=...           → run + marker
//
// What this does:
//   1. DROP + ADD the credit_transactions_type_check constraint to include
//      'free_trial' alongside the existing 8 values.
//   2. Write 'per_instructor_credits_step_2_5' marker.
//
// Marker contract:
//   - Refuses to run unless 'per_instructor_credits_step_2c' is present.
//   - Writes 'per_instructor_credits_step_2_5' on success.
//
// Why schema-then-code is load-bearing here:
//   The slots.js handleBookFreeTrial writer that inserts type='free_trial'
//   ships in the same PR but the migration MUST run on prod before the code
//   deploys. Otherwise the first free-trial booking after deploy 500s on the
//   CHECK violation. Same schema-then-code discipline as Step 2.

const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { safeEqual } = require('./_auth');

const PREREQ_MARKER_KEY = 'per_instructor_credits_step_2c';
const MARKER_KEY = 'per_instructor_credits_step_2_5';

// The new allowed-values set. Existing 8 + 'free_trial'.
const ALLOWED_TYPES = [
  'purchase',
  'refund',
  'slot_purchase',
  'edit_adjustment',
  'admin_add',
  'admin_remove',
  'referral_bonus',
  'referral_reward',
  'free_trial',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.query.secret || req.headers['x-migration-secret'];
  if (!safeEqual(secret, process.env.MIGRATION_SECRET)) {
    return res.status(401).json({ error: 'Invalid or missing migration secret' });
  }

  const isDryRun = req.method === 'GET' || req.query.dry_run === '1';

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // ── Prereq marker check ─────────────────────────────────────────────────
    const [prereqRow] = await sql`
      SELECT key, completed_at::text AS completed_at
        FROM migration_markers
       WHERE key = ${PREREQ_MARKER_KEY}
       LIMIT 1
    `;
    if (!prereqRow) {
      return res.status(409).json({
        ok: false,
        error: `Step 2.5 requires ${PREREQ_MARKER_KEY} marker. Run /api/migrate-step-2c first.`,
      });
    }

    // ── Probe: is the constraint already widened? ───────────────────────────
    const [constraintRow] = await sql`
      SELECT pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
        JOIN pg_class      t ON t.oid = c.conrelid
       WHERE t.relname = 'credit_transactions'
         AND c.conname = 'credit_transactions_type_check'
       LIMIT 1
    `;
    const currentDef = constraintRow?.def || null;
    const alreadyWidened = currentDef ? currentDef.includes("'free_trial'") : false;

    // Sanity: no existing rows of the new type (would be impossible under the
    // old constraint, but we surface it in case anyone manually bypassed).
    const [{ count: existingFreeTrialCount }] = await sql`
      SELECT COUNT(*)::int AS count
        FROM credit_transactions
       WHERE type = 'free_trial'
    `;

    const result = {
      dry_run: isDryRun,
      prereq_marker: prereqRow,
      current_constraint_def: currentDef,
      already_widened: alreadyWidened,
      existing_free_trial_rows: existingFreeTrialCount,
      constraint_updated: false,
      marker_written: false,
    };

    if (isDryRun) {
      return res.json({ ok: true, ...result });
    }

    // ── DROP + ADD constraint (idempotent via DROP IF EXISTS) ───────────────
    // We could short-circuit if alreadyWidened === true, but DROP + ADD is
    // cheap and gives us a single canonical write path. The new constraint
    // value list is the source of truth; ALLOWED_TYPES above mirrors it for
    // reference / tests.
    await sql`
      ALTER TABLE credit_transactions
        DROP CONSTRAINT IF EXISTS credit_transactions_type_check
    `;
    await sql`
      ALTER TABLE credit_transactions
        ADD CONSTRAINT credit_transactions_type_check
        CHECK (type IN (
          'purchase',
          'refund',
          'slot_purchase',
          'edit_adjustment',
          'admin_add',
          'admin_remove',
          'referral_bonus',
          'referral_reward',
          'free_trial'
        ))
    `;
    result.constraint_updated = true;

    // ── Verify: re-fetch the constraint and confirm 'free_trial' is in it ───
    const [verifyRow] = await sql`
      SELECT pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
        JOIN pg_class      t ON t.oid = c.conrelid
       WHERE t.relname = 'credit_transactions'
         AND c.conname = 'credit_transactions_type_check'
       LIMIT 1
    `;
    result.new_constraint_def = verifyRow?.def || null;
    if (!verifyRow?.def?.includes("'free_trial'")) {
      return res.status(500).json({
        ok: false,
        error: 'Constraint widening verification failed — free_trial not present after ALTER',
        result,
      });
    }

    // ── Marker write ────────────────────────────────────────────────────────
    const markerRows = await sql`
      INSERT INTO migration_markers (key, notes)
      VALUES (${MARKER_KEY}, 'credit_transactions_type_check widened to include free_trial')
      ON CONFLICT (key) DO NOTHING
      RETURNING key, completed_at::text AS completed_at
    `;
    result.marker_written = markerRows.length > 0;
    result.marker_already_present = markerRows.length === 0;

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[step-2-5] migration failed:', err);
    reportError('/api/migrate-step-2-5', err);
    return res.status(500).json({ ok: false, error: 'Migration failed', details: err.message });
  }
};

module.exports.MARKER_KEY = MARKER_KEY;
module.exports.PREREQ_MARKER_KEY = PREREQ_MARKER_KEY;
module.exports.ALLOWED_TYPES = ALLOWED_TYPES;
