// Step 4 — Phase B sync_pooled_balance trigger on learner_credit_balances.
// Per PER-INSTRUCTOR-CREDITS-PLAN.md §Step 2 "Sync trigger — forward-only"
// (L547-583) and §Step 4 (L674-790).
//
// Usage:
//   GET  /api/migrate-step-4?secret=...    → preview what would be created
//   POST /api/migrate-step-4?secret=...    → create function + trigger + marker
//
// What this does:
//   1. CREATE OR REPLACE FUNCTION sync_pooled_balance() — forward-only sync
//      from learner_credit_balances → learner_users.balance_minutes. GDPR
//      no-op: returns silently if NEW.learner_id is NULL.
//   2. CREATE TRIGGER trg_sync_pooled_balance AFTER INSERT OR UPDATE ON
//      learner_credit_balances. One direction only (LCB → pooled), never
//      the reverse — a bidirectional trigger would let Sarah-credits spend
//      with Fraser on a panic rollback.
//
// Marker contract:
//   - Refuses to run unless 'per_instructor_credits_step_2c' is present
//     (the LCB/BCS/CSA tables must exist).
//   - Writes 'per_instructor_credits_step_4' on success.
//
// What this does NOT do:
//   - Does NOT touch any writer in api/credits.js, api/webhook.js,
//     api/slots.js, api/offers.js, api/admin.js, api/instructor.js,
//     api/cron-referral-rewards.js, api/magic-link.js — those cut over in
//     later commits of this PR.
//   - Does NOT flip PHASE_2A_IMPLEMENTED.
//   - Does NOT change learner_users.balance_minutes for any existing learner
//     — the trigger only fires on subsequent LCB writes. Step 2c's backfill
//     already populated LCB rows summing to the existing balance_minutes
//     values, so the divergence-check invariant holds at install time.
//
// Operational note: trigger creation is one fast DDL statement; no
// long-running locks expected. Safe to run during business hours, but the
// 6h PITR window (Neon Free tier) means deploying before 11:00 BST keeps
// the rollback window inside waking hours per docs/credits-grandfather.md.

const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { safeEqual } = require('./_auth');

const PREREQ_MARKER_KEY = 'per_instructor_credits_step_2c';
const MARKER_KEY = 'per_instructor_credits_step_4';

const FUNCTION_NAME = 'sync_pooled_balance';
const TRIGGER_NAME  = 'trg_sync_pooled_balance';

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
        error: `Step 4 requires ${PREREQ_MARKER_KEY} marker. Run /api/migrate-step-2c first.`,
      });
    }

    // ── Probe: is the function / trigger already in place? ─────────────────
    const [funcRow] = await sql`
      SELECT proname
        FROM pg_proc
       WHERE proname = ${FUNCTION_NAME}
       LIMIT 1
    `;
    const [trigRow] = await sql`
      SELECT tgname
        FROM pg_trigger
       WHERE tgname = ${TRIGGER_NAME}
       LIMIT 1
    `;

    const result = {
      dry_run: isDryRun,
      prereq_marker: prereqRow,
      function_already_present: Boolean(funcRow),
      trigger_already_present: Boolean(trigRow),
      marker_written: false,
    };

    if (isDryRun) {
      return res.json({ ok: true, ...result });
    }

    // ── 1. Create / replace the sync function ───────────────────────────────
    // Forward-only: writes pooled balance from the SUM of scoped balances
    // for this learner. GDPR no-op: if NEW.learner_id is somehow NULL (the
    // GDPR cascade in _gdpr.js sets credit_transactions.learner_id = NULL
    // but that doesn't propagate to LCB; this is belt-and-braces in case
    // a future code path nulls a learner_credit_balances row).
    //
    // Why we use plpgsql with NEW only (no OLD): the trigger fires on
    // INSERT OR UPDATE — DELETE isn't in scope because LCB rows are only
    // ever deleted via the FK CASCADE on learner_users, and at that point
    // the parent row is gone so the UPDATE would target nothing anyway.
    await sql`
      CREATE OR REPLACE FUNCTION sync_pooled_balance() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.learner_id IS NULL THEN
          RETURN NEW;
        END IF;

        UPDATE learner_users
           SET balance_minutes = COALESCE(
             (SELECT SUM(balance_minutes)::int
                FROM learner_credit_balances
               WHERE learner_id = NEW.learner_id),
             0
           )
         WHERE id = NEW.learner_id;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `;

    // ── 2. Create the trigger ───────────────────────────────────────────────
    // AFTER INSERT OR UPDATE per plan §L577. Using DROP+CREATE rather than
    // CREATE OR REPLACE TRIGGER because PG14 doesn't support OR REPLACE on
    // triggers; the DROP+CREATE pair is safe under DDL transactional locking.
    await sql`DROP TRIGGER IF EXISTS trg_sync_pooled_balance ON learner_credit_balances`;
    await sql`
      CREATE TRIGGER trg_sync_pooled_balance
        AFTER INSERT OR UPDATE ON learner_credit_balances
        FOR EACH ROW EXECUTE FUNCTION sync_pooled_balance()
    `;

    // ── 3. Verify the trigger is wired up ──────────────────────────────────
    const [verifyFunc] = await sql`
      SELECT proname FROM pg_proc WHERE proname = ${FUNCTION_NAME} LIMIT 1
    `;
    const [verifyTrig] = await sql`
      SELECT tgname FROM pg_trigger WHERE tgname = ${TRIGGER_NAME} LIMIT 1
    `;
    if (!verifyFunc) {
      return res.status(500).json({
        ok: false,
        error: `Step 4 DDL incomplete: function ${FUNCTION_NAME} missing after CREATE.`,
        result,
      });
    }
    if (!verifyTrig) {
      return res.status(500).json({
        ok: false,
        error: `Step 4 DDL incomplete: trigger ${TRIGGER_NAME} missing after CREATE.`,
        result,
      });
    }
    result.function_present = true;
    result.trigger_present = true;

    // ── 4. Divergence sanity check ─────────────────────────────────────────
    // The trigger only fires on subsequent writes, so it doesn't move
    // existing data — but if the divergence check is already non-empty
    // before we install the trigger, the trigger will appear to "introduce"
    // a problem on the next LCB write. Flag any pre-existing divergence
    // so the operator can investigate before turning on Phase 2A writers.
    const divergent = await sql`
      SELECT u.id AS learner_id,
             u.balance_minutes AS pooled,
             COALESCE(SUM(lcb.balance_minutes), 0)::int AS scoped_sum
        FROM learner_users u
        LEFT JOIN learner_credit_balances lcb ON lcb.learner_id = u.id
       WHERE COALESCE(u.balance_minutes, 0) > 0
       GROUP BY u.id, u.balance_minutes
      HAVING u.balance_minutes IS DISTINCT FROM COALESCE(SUM(lcb.balance_minutes), 0)
      LIMIT 5
    `;
    result.divergence_sample = divergent;
    result.divergent_pre_trigger = divergent.length > 0;
    // We do NOT block on divergence here — the trigger doesn't make it
    // worse, and the operator has the sample to investigate. Step 4.5
    // adds the nightly divergence cron that emails on any non-empty result.

    // ── 5. Marker write ─────────────────────────────────────────────────────
    const markerRows = await sql`
      INSERT INTO migration_markers (key, notes)
      VALUES (${MARKER_KEY}, 'sync_pooled_balance trigger installed on learner_credit_balances')
      ON CONFLICT (key) DO NOTHING
      RETURNING key, completed_at::text AS completed_at
    `;
    result.marker_written = markerRows.length > 0;
    result.marker_already_present = markerRows.length === 0;

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[step-4] migration failed:', err);
    reportError('/api/migrate-step-4', err);
    return res.status(500).json({ ok: false, error: 'Migration failed', details: err.message });
  }
};

module.exports.MARKER_KEY = MARKER_KEY;
module.exports.PREREQ_MARKER_KEY = PREREQ_MARKER_KEY;
module.exports.FUNCTION_NAME = FUNCTION_NAME;
module.exports.TRIGGER_NAME = TRIGGER_NAME;
