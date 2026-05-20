// Step 2a — additive columns on credit_transactions (no constraints, no
// behavioural change). Per PER-INSTRUCTOR-CREDITS-PLAN.md §Step 2 sub-phase 2a
// (L425-439).
//
// Usage:
//   GET  /api/migrate-step-2a?secret=...           → preview which columns would
//                                                    be added, no writes
//   POST /api/migrate-step-2a?secret=...           → run the DDL + insert marker
//
// What this does:
//
//   ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS:
//     - instructor_id INTEGER REFERENCES instructors(id)
//     - effective_rate_pence_per_minute INTEGER
//     - source TEXT DEFAULT 'stripe' CHECK (source IN ('stripe','free_trial',
//                                                      'reconciliation','goodwill'))
//     - absorbed_by TEXT CHECK (absorbed_by IN ('platform','instructor'))
//     - stripe_payment_intent_id TEXT
//     - stripe_charge_id TEXT
//
// All nullable; the source DEFAULT applies to existing rows via the PG11+
// missing-value fast-path, so existing rows read as 'stripe' without a UPDATE.
// Sub-phase 2b enforces NOT NULL on source after a defensive backfill.
//
// Marker contract:
//   - Refuses to run unless 'per_instructor_credits_step_1c_backfill' is
//     present in migration_markers (Step 1c gate, already on prod 2026-05-20).
//   - Writes 'per_instructor_credits_step_2a' on success. Sub-phase 2b refuses
//     to run without this row.
//
// What this does NOT do (out of scope, defended against scope creep):
//   - Does NOT create learner_credit_balances, booking_credit_sources, or
//     credit_source_adjustments (sub-phase 2c).
//   - Does NOT enforce NOT NULL on source (sub-phase 2b).
//   - Does NOT create unique indexes on payment_intent_id / charge_id (2c).
//   - Does NOT touch any writer in the codebase.
//   - Does NOT widen credit_transactions_type_check for 'free_trial' (Step 2.5).
//   - Does NOT flip PHASE_2A_IMPLEMENTED (Step 4).

const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { safeEqual } = require('./_auth');

const PREREQ_MARKER_KEY = 'per_instructor_credits_step_1c_backfill';
const MARKER_KEY = 'per_instructor_credits_step_2a';

// Columns this sub-phase adds. Used for both the dry-run preview and the
// post-migration verification step.
const NEW_COLUMNS = [
  'instructor_id',
  'effective_rate_pence_per_minute',
  'source',
  'absorbed_by',
  'stripe_payment_intent_id',
  'stripe_charge_id',
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
    // Step 1c backfill must be complete before any of these columns are added.
    // The actual ordering risk here is small (the columns are additive and
    // nullable), but the marker chain is the operational discipline that
    // prevents skipping sub-phases later.
    const [prereqRow] = await sql`
      SELECT key, completed_at::text AS completed_at
        FROM migration_markers
       WHERE key = ${PREREQ_MARKER_KEY}
       LIMIT 1
    `;
    if (!prereqRow) {
      return res.status(409).json({
        ok: false,
        error: `Step 2a requires ${PREREQ_MARKER_KEY} marker. Run /api/migrate-step-1c first.`,
      });
    }

    // ── Existing-column probe ───────────────────────────────────────────────
    // Powers both the dry-run preview and the post-DDL verification. Honest
    // dry-run: report which columns would actually be added vs which already
    // exist (so re-running shows "all six already present").
    const existing = await sql`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_name = 'credit_transactions'
         AND column_name = ANY(${NEW_COLUMNS})
    `;
    const existingSet = new Set(existing.map((r) => r.column_name));
    const toAdd      = NEW_COLUMNS.filter((c) => !existingSet.has(c));
    const alreadyHas = NEW_COLUMNS.filter((c) =>  existingSet.has(c));

    const result = {
      dry_run: isDryRun,
      prereq_marker: prereqRow,
      columns_already_present: alreadyHas,
      columns_to_add: toAdd,
      marker_written: false,
    };

    if (isDryRun) {
      return res.json({ ok: true, ...result });
    }

    // ── Apply the DDL ───────────────────────────────────────────────────────
    // ADD COLUMN IF NOT EXISTS is idempotent; running a second time is a no-op.
    // CHECK constraints inline with the ADD COLUMN: PG attaches them to the
    // column at creation, no separate ALTER. The NULL guards in the CHECK
    // predicates are deliberate — sub-phase 2a leaves these columns nullable
    // so the predicates must accept NULL.
    await sql`
      ALTER TABLE credit_transactions
        ADD COLUMN IF NOT EXISTS instructor_id INTEGER REFERENCES instructors(id)
    `;
    await sql`
      ALTER TABLE credit_transactions
        ADD COLUMN IF NOT EXISTS effective_rate_pence_per_minute INTEGER
    `;
    await sql`
      ALTER TABLE credit_transactions
        ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'stripe'
          CHECK (source IS NULL OR source IN ('stripe', 'free_trial', 'reconciliation', 'goodwill'))
    `;
    await sql`
      ALTER TABLE credit_transactions
        ADD COLUMN IF NOT EXISTS absorbed_by TEXT
          CHECK (absorbed_by IS NULL OR absorbed_by IN ('platform', 'instructor'))
    `;
    await sql`
      ALTER TABLE credit_transactions
        ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT
    `;
    await sql`
      ALTER TABLE credit_transactions
        ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT
    `;

    // ── Index the FK column (CLAUDE.md security rule #6) ────────────────────
    // Every new FK column needs an index. This is partial because most
    // historical rows will have instructor_id NULL until Step 4 backfills.
    await sql`
      CREATE INDEX IF NOT EXISTS idx_credit_tx_instructor
        ON credit_transactions(instructor_id)
        WHERE instructor_id IS NOT NULL
    `;

    // ── Post-DDL verification ───────────────────────────────────────────────
    // Re-probe; refuse to write the marker if any column is missing.
    const verifyRows = await sql`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_name = 'credit_transactions'
         AND column_name = ANY(${NEW_COLUMNS})
    `;
    const verifySet = new Set(verifyRows.map((r) => r.column_name));
    const stillMissing = NEW_COLUMNS.filter((c) => !verifySet.has(c));

    if (stillMissing.length > 0) {
      const msg = `Step 2a DDL incomplete: missing columns ${stillMissing.join(', ')}. Marker NOT written.`;
      console.error('[step-2a]', msg);
      return res.status(500).json({ ok: false, error: msg, result });
    }

    // ── Marker write ────────────────────────────────────────────────────────
    const markerRows = await sql`
      INSERT INTO migration_markers (key, notes)
      VALUES (${MARKER_KEY}, 'credit_transactions Phase 1 columns added (instructor_id, source, etc.)')
      ON CONFLICT (key) DO NOTHING
      RETURNING key, completed_at::text AS completed_at
    `;
    result.marker_written = markerRows.length > 0;
    result.marker_already_present = markerRows.length === 0;
    result.columns_added = toAdd;

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[step-2a] migration failed:', err);
    reportError('/api/migrate-step-2a', err);
    return res.status(500).json({ ok: false, error: 'Migration failed', details: err.message });
  }
};

module.exports.MARKER_KEY = MARKER_KEY;
module.exports.PREREQ_MARKER_KEY = PREREQ_MARKER_KEY;
module.exports.NEW_COLUMNS = NEW_COLUMNS;
