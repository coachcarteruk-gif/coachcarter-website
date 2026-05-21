// Step 2c — unique indexes + three new tables + LCB backfill. Per
// PER-INSTRUCTOR-CREDITS-PLAN.md §Step 2 sub-phase 2c (L468-532, L601-611).
//
// Usage:
//   GET  /api/migrate-step-2c?secret=...           → preview what would be created
//   POST /api/migrate-step-2c?secret=...           → run DDL + backfill + marker
//
// What this does:
//   1. CREATE UNIQUE INDEX uq_credit_tx_payment_intent (partial, on NOT NULL).
//   2. CREATE UNIQUE INDEX uq_credit_tx_charge (partial, on NOT NULL).
//   3. CREATE TABLE learner_credit_balances + 2 indexes.
//   4. CREATE TABLE booking_credit_sources + 4 indexes.
//   5. CREATE TABLE credit_source_adjustments + 1 index.
//   6. Backfill learner_credit_balances from learner_users.balance_minutes
//      (hardcoded instructor_id = 1 — Fraser is the only instructor at backfill
//      time; documented as the grandfather rule, plan L611).
//
// Marker contract:
//   - Refuses to run unless 'per_instructor_credits_step_2b' is present.
//   - Writes 'per_instructor_credits_step_2c' on success. Step 4 will gate on this.
//
// What this does NOT do:
//   - Does NOT create the sync_pooled_balance trigger (Step 4 Phase B).
//   - Does NOT touch any writer in api/credits.js, api/webhook.js,
//     api/slots.js, api/offers.js (Step 4).
//   - Does NOT flip PHASE_2A_IMPLEMENTED.
//   - Does NOT widen credit_transactions_type_check for 'free_trial' (Step 2.5).

const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { safeEqual } = require('./_auth');

const PREREQ_MARKER_KEY = 'per_instructor_credits_step_2b';
const MARKER_KEY = 'per_instructor_credits_step_2c';

// Hardcoded at backfill time: Fraser is the only instructor when this runs.
// Plan L611 documents this as the grandfather rule. Future instructors get
// their own LCB rows via Step 4 writers, not via this backfill.
const GRANDFATHER_INSTRUCTOR_ID = 1;

const NEW_TABLES = [
  'learner_credit_balances',
  'booking_credit_sources',
  'credit_source_adjustments',
];

const NEW_INDEXES = [
  'uq_credit_tx_payment_intent',
  'uq_credit_tx_charge',
  'idx_lcb_learner',
  'idx_lcb_instructor',
  'idx_bcs_booking',
  'idx_bcs_credit_tx',
  'idx_bcs_school',
  'idx_bcs_active',
  'idx_csa_credit_tx',
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
        error: `Step 2c requires ${PREREQ_MARKER_KEY} marker. Run /api/migrate-step-2b first.`,
      });
    }

    // ── Probe: which tables / indexes already exist ─────────────────────────
    const existingTables = await sql`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY(${NEW_TABLES})
    `;
    const existingTableSet = new Set(existingTables.map((r) => r.table_name));

    const existingIndexes = await sql`
      SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = ANY(${NEW_INDEXES})
    `;
    const existingIndexSet = new Set(existingIndexes.map((r) => r.indexname));

    // Backfill candidate count: learner_users rows with positive balance that
    // don't yet have a matching LCB row for instructor 1.
    let backfillCandidates = null;
    if (existingTableSet.has('learner_credit_balances')) {
      const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count
          FROM learner_users lu
         WHERE COALESCE(lu.balance_minutes, 0) > 0
           AND NOT EXISTS (
             SELECT 1 FROM learner_credit_balances lcb
              WHERE lcb.learner_id = lu.id
                AND lcb.instructor_id = ${GRANDFATHER_INSTRUCTOR_ID}
           )
      `;
      backfillCandidates = count;
    } else {
      // Table doesn't exist yet — estimate based on learner_users alone.
      const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count
          FROM learner_users
         WHERE COALESCE(balance_minutes, 0) > 0
      `;
      backfillCandidates = count;
    }

    const result = {
      dry_run: isDryRun,
      prereq_marker: prereqRow,
      tables_already_present: Array.from(existingTableSet),
      tables_to_create: NEW_TABLES.filter((t) => !existingTableSet.has(t)),
      indexes_already_present: Array.from(existingIndexSet),
      indexes_to_create: NEW_INDEXES.filter((i) => !existingIndexSet.has(i)),
      lcb_backfill_candidates: backfillCandidates,
      lcb_rows_inserted: 0,
      marker_written: false,
    };

    if (isDryRun) {
      return res.json({ ok: true, ...result });
    }

    // ── 1. Unique partial indexes on payment_intent_id / charge_id ──────────
    // Partial WHERE clause is load-bearing: most historical rows have these
    // columns NULL (per Step 2 decision A — no historical Stripe-ID backfill).
    // A non-partial unique index would fail on the second NULL row in PG <15
    // semantics, but even with PG15 nulls-not-distinct we want only non-NULL
    // values to participate in idempotency checks.
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_tx_payment_intent
        ON credit_transactions(stripe_payment_intent_id)
        WHERE stripe_payment_intent_id IS NOT NULL
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_tx_charge
        ON credit_transactions(stripe_charge_id)
        WHERE stripe_charge_id IS NOT NULL
    `;

    // ── 2. learner_credit_balances table ────────────────────────────────────
    // Per-instructor balance ledger. Phase 2A writers will route credit grants
    // here; the sync_pooled_balance trigger (Step 4) keeps learner_users.balance_minutes
    // as a denormalised mirror until legacy readers migrate.
    await sql`
      CREATE TABLE IF NOT EXISTS learner_credit_balances (
        id              SERIAL PRIMARY KEY,
        learner_id      INTEGER NOT NULL REFERENCES learner_users(id) ON DELETE CASCADE,
        instructor_id   INTEGER NOT NULL REFERENCES instructors(id),
        school_id       INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1,
        balance_minutes INTEGER NOT NULL DEFAULT 0,
        updated_at      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (learner_id, instructor_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_lcb_learner ON learner_credit_balances(learner_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_lcb_instructor ON learner_credit_balances(instructor_id)`;

    // ── 3. booking_credit_sources table ─────────────────────────────────────
    // FIFO attribution rows: which credit_transactions row(s) funded each booking.
    // credit_transaction_id NOT NULL — free-trial / goodwill / referral grants
    // all create their own (zero-value) credit_transactions row.
    await sql`
      CREATE TABLE IF NOT EXISTS booking_credit_sources (
        id                    SERIAL PRIMARY KEY,
        booking_id            INTEGER NOT NULL REFERENCES lesson_bookings(id) ON DELETE CASCADE,
        credit_transaction_id INTEGER NOT NULL REFERENCES credit_transactions(id),
        school_id             INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1,
        minutes_drawn         INTEGER NOT NULL CHECK (minutes_drawn > 0),
        rate_pence_per_minute INTEGER NOT NULL,
        contribution_pence    INTEGER NOT NULL,
        stripe_fee_pence      INTEGER NOT NULL DEFAULT 0,
        absorbed_by           TEXT CHECK (absorbed_by IS NULL OR absorbed_by IN ('platform', 'instructor')),
        refunded_at           TIMESTAMPTZ,
        created_at            TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (booking_id, credit_transaction_id)
      )
    `;
    await sql`ALTER TABLE booking_credit_sources ADD COLUMN IF NOT EXISTS school_id INTEGER`;
    await sql`
      UPDATE booking_credit_sources bcs
         SET school_id = COALESCE(
               (SELECT lb.school_id FROM lesson_bookings lb WHERE lb.id = bcs.booking_id),
               (SELECT ct.school_id FROM credit_transactions ct WHERE ct.id = bcs.credit_transaction_id),
               1
             )
       WHERE bcs.school_id IS NULL
    `;
    await sql`ALTER TABLE booking_credit_sources ALTER COLUMN school_id SET DEFAULT 1`;
    await sql`ALTER TABLE booking_credit_sources ALTER COLUMN school_id SET NOT NULL`;
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conname = 'booking_credit_sources_school_id_fkey'
             AND conrelid = 'booking_credit_sources'::regclass
        ) THEN
          ALTER TABLE booking_credit_sources
            ADD CONSTRAINT booking_credit_sources_school_id_fkey
            FOREIGN KEY (school_id) REFERENCES schools(id);
        END IF;
      END $$
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_bcs_booking ON booking_credit_sources(booking_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_bcs_credit_tx ON booking_credit_sources(credit_transaction_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_bcs_school ON booking_credit_sources(school_id)`;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_bcs_active
        ON booking_credit_sources(credit_transaction_id)
        WHERE refunded_at IS NULL
    `;

    // ── 4. credit_source_adjustments table ──────────────────────────────────
    // Cash-refund / dispute-clawback / admin-correction ledger. Additive
    // history; never mutate credit_transactions.minutes or amount_pence
    // because BCS snapshots depend on those historical facts.
    await sql`
      CREATE TABLE IF NOT EXISTS credit_source_adjustments (
        id                    SERIAL PRIMARY KEY,
        credit_transaction_id INTEGER NOT NULL REFERENCES credit_transactions(id),
        kind                  TEXT NOT NULL CHECK (kind IN ('cash_refund', 'admin_correction', 'dispute_clawback')),
        minutes_adjusted      INTEGER NOT NULL,
        pence_adjusted        INTEGER NOT NULL,
        reason                TEXT NOT NULL,
        stripe_refund_id      TEXT,
        created_at            TIMESTAMPTZ DEFAULT NOW(),
        created_by            INTEGER REFERENCES admin_users(id),
        UNIQUE (stripe_refund_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_csa_credit_tx ON credit_source_adjustments(credit_transaction_id)`;

    // ── 5. LCB backfill ─────────────────────────────────────────────────────
    // Hardcoded instructor_id = 1 (Fraser, grandfather rule, plan L611).
    // ON CONFLICT DO NOTHING makes re-runs safe: rows already created by a
    // partial earlier run aren't disturbed, and Phase 2A writers in Step 4
    // can populate non-Fraser rows without colliding.
    const backfillRows = await sql`
      INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
      SELECT id, ${GRANDFATHER_INSTRUCTOR_ID}, school_id, COALESCE(balance_minutes, 0)
        FROM learner_users
       WHERE COALESCE(balance_minutes, 0) > 0
      ON CONFLICT (learner_id, instructor_id) DO NOTHING
      RETURNING id
    `;
    result.lcb_rows_inserted = backfillRows.length;

    // ── 6. Verify the divergence check is clean ─────────────────────────────
    // After backfill: SUM(lcb.balance_minutes) per learner should equal that
    // learner's learner_users.balance_minutes. Trigger doesn't exist yet
    // (Step 4) but the invariant should hold the moment LCB rows are
    // inserted via straight COALESCE.
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
    if (divergent.length > 0) {
      // Don't write the marker if backfill left a divergence. Operator can
      // investigate via the sample rows in result.
      const msg = `LCB backfill left ${divergent.length}+ divergent rows. Marker NOT written.`;
      console.error('[step-2c]', msg);
      return res.status(500).json({ ok: false, error: msg, result });
    }

    // ── 7. Post-DDL verification ────────────────────────────────────────────
    const verifyTables = await sql`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY(${NEW_TABLES})
    `;
    const verifyTableSet = new Set(verifyTables.map((r) => r.table_name));
    const missingTables = NEW_TABLES.filter((t) => !verifyTableSet.has(t));
    if (missingTables.length > 0) {
      return res.status(500).json({
        ok: false,
        error: `Step 2c DDL incomplete: missing tables ${missingTables.join(', ')}.`,
        result,
      });
    }

    const verifyIndexes = await sql`
      SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = ANY(${NEW_INDEXES})
    `;
    const verifyIndexSet = new Set(verifyIndexes.map((r) => r.indexname));
    const missingIndexes = NEW_INDEXES.filter((i) => !verifyIndexSet.has(i));
    if (missingIndexes.length > 0) {
      return res.status(500).json({
        ok: false,
        error: `Step 2c DDL incomplete: missing indexes ${missingIndexes.join(', ')}.`,
        result,
      });
    }

    // ── 8. Marker write ─────────────────────────────────────────────────────
    const markerRows = await sql`
      INSERT INTO migration_markers (key, notes)
      VALUES (${MARKER_KEY}, 'unique indexes + LCB/BCS/CSA tables + LCB backfill')
      ON CONFLICT (key) DO NOTHING
      RETURNING key, completed_at::text AS completed_at
    `;
    result.marker_written = markerRows.length > 0;
    result.marker_already_present = markerRows.length === 0;

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[step-2c] migration failed:', err);
    reportError('/api/migrate-step-2c', err);
    return res.status(500).json({ ok: false, error: 'Migration failed', details: err.message });
  }
};

module.exports.MARKER_KEY = MARKER_KEY;
module.exports.PREREQ_MARKER_KEY = PREREQ_MARKER_KEY;
module.exports.NEW_TABLES = NEW_TABLES;
module.exports.NEW_INDEXES = NEW_INDEXES;
module.exports.GRANDFATHER_INSTRUCTOR_ID = GRANDFATHER_INSTRUCTOR_ID;
