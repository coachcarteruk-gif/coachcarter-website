// Step 2b — defensive `source` backfill + NOT NULL constraint on
// credit_transactions.source. Per PER-INSTRUCTOR-CREDITS-PLAN.md §Step 2
// sub-phase 2b (L441-466) — with the historical Stripe-ID backfill
// INTENTIONALLY OMITTED (see Step 2a commit message; the stripe_metadata
// column doesn't exist, plan L460 authorises the fallback).
//
// Usage:
//   GET  /api/migrate-step-2b?secret=...           → count NULL rows, no writes
//   POST /api/migrate-step-2b?secret=...           → backfill + add NOT NULL + marker
//
// What this does:
//   1. UPDATE credit_transactions SET source = 'stripe' WHERE source IS NULL.
//      Defensive — sub-phase 2a's DEFAULT 'stripe' already applies to existing
//      rows via the PG11+ missing-value fast-path, so this UPDATE typically
//      touches zero rows on prod. It exists to handle any rows inserted via a
//      path that explicitly sets source = NULL (none today, but belt-and-braces).
//   2. ALTER COLUMN source SET NOT NULL. This is the load-bearing change —
//      Phase 2A code (Step 4) assumes source is never NULL.
//
// Marker contract:
//   - Refuses to run unless 'per_instructor_credits_step_2a' is present.
//   - Writes 'per_instructor_credits_step_2b' on success. Sub-phase 2c gates on this.
//
// What this does NOT do:
//   - Does NOT backfill stripe_payment_intent_id or stripe_charge_id (see
//     plan §Step 2 decision A; columns stay NULL on historical rows;
//     reconciliation in Step 5.5 falls back to stripe_session_id).
//   - Does NOT touch any other column or table.
//   - Does NOT flip PHASE_2A_IMPLEMENTED.

const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { safeEqual } = require('./_auth');

const PREREQ_MARKER_KEY = 'per_instructor_credits_step_2a';
const MARKER_KEY = 'per_instructor_credits_step_2b';

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
        error: `Step 2b requires ${PREREQ_MARKER_KEY} marker. Run /api/migrate-step-2a first.`,
      });
    }

    // ── Sanity: the source column must exist (sub-phase 2a). If not, the
    // operator is invoking this in the wrong order even though the marker is
    // present (e.g. marker manually inserted, or branch divergence). Fail
    // loudly rather than producing a confusing SQL error.
    const [{ exists: sourceExists }] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'credit_transactions'
           AND column_name = 'source'
      ) AS exists
    `;
    if (!sourceExists) {
      return res.status(500).json({
        ok: false,
        error: 'credit_transactions.source column missing — Step 2a DDL did not run despite marker present.',
      });
    }

    // ── Probe: is source already NOT NULL? (Re-runnability) ─────────────────
    const [{ is_nullable: sourceNullable }] = await sql`
      SELECT is_nullable
        FROM information_schema.columns
       WHERE table_name = 'credit_transactions'
         AND column_name = 'source'
    `;
    const alreadyNotNull = sourceNullable === 'NO';

    // ── Count NULL rows ─────────────────────────────────────────────────────
    const [{ count: nullCount }] = await sql`
      SELECT COUNT(*)::int AS count
        FROM credit_transactions
       WHERE source IS NULL
    `;

    const result = {
      dry_run: isDryRun,
      prereq_marker: prereqRow,
      source_already_not_null: alreadyNotNull,
      rows_with_null_source: nullCount,
      rows_updated: 0,
      not_null_applied: false,
      marker_written: false,
    };

    if (isDryRun) {
      return res.json({ ok: true, ...result });
    }

    // ── 1. Defensive backfill ───────────────────────────────────────────────
    // The UPDATE is unconditional on source IS NULL; if zero rows match it
    // returns 0 rows affected. No-op when the DEFAULT fast-path already
    // covered everything (the typical case).
    const updated = await sql`
      UPDATE credit_transactions
         SET source = 'stripe'
       WHERE source IS NULL
      RETURNING id
    `;
    result.rows_updated = updated.length;

    // ── 2. Re-verify zero NULL rows before applying NOT NULL ────────────────
    // Belt-and-braces against a concurrent INSERT that sneaks in between the
    // UPDATE and the ALTER. Unlikely on the low-write credit_transactions
    // table but the cost is one COUNT.
    const [{ count: stillNull }] = await sql`
      SELECT COUNT(*)::int AS count
        FROM credit_transactions
       WHERE source IS NULL
    `;
    if (stillNull > 0) {
      const msg = `Backfill incomplete: ${stillNull} rows still have source IS NULL after UPDATE. Marker NOT written, NOT NULL NOT applied.`;
      console.error('[step-2b]', msg);
      return res.status(500).json({ ok: false, error: msg, result });
    }

    // ── 3. Apply NOT NULL ───────────────────────────────────────────────────
    // Idempotent: re-running on an already-NOT-NULL column is a no-op in
    // Postgres (no error, no change).
    if (!alreadyNotNull) {
      await sql`ALTER TABLE credit_transactions ALTER COLUMN source SET NOT NULL`;
      result.not_null_applied = true;
    } else {
      result.not_null_applied = false; // was already
    }

    // ── 4. Verify NOT NULL took effect ──────────────────────────────────────
    const [{ is_nullable: postNullable }] = await sql`
      SELECT is_nullable
        FROM information_schema.columns
       WHERE table_name = 'credit_transactions'
         AND column_name = 'source'
    `;
    if (postNullable !== 'NO') {
      const msg = 'ALTER COLUMN source SET NOT NULL did not take effect. Marker NOT written.';
      console.error('[step-2b]', msg);
      return res.status(500).json({ ok: false, error: msg, result });
    }

    // ── 5. Marker write ─────────────────────────────────────────────────────
    const markerRows = await sql`
      INSERT INTO migration_markers (key, notes)
      VALUES (${MARKER_KEY}, 'credit_transactions.source backfilled + NOT NULL')
      ON CONFLICT (key) DO NOTHING
      RETURNING key, completed_at::text AS completed_at
    `;
    result.marker_written = markerRows.length > 0;
    result.marker_already_present = markerRows.length === 0;

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[step-2b] migration failed:', err);
    reportError('/api/migrate-step-2b', err);
    return res.status(500).json({ ok: false, error: 'Migration failed', details: err.message });
  }
};

module.exports.MARKER_KEY = MARKER_KEY;
module.exports.PREREQ_MARKER_KEY = PREREQ_MARKER_KEY;
