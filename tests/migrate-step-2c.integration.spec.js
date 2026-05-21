// @ts-check
// Integration tests for api/migrate-step-2c.js against a real Neon test branch.
//
// What this proves:
//   1. Refuses to run without the Step 2b prereq marker.
//   2. Dry-run reports tables_to_create / indexes_to_create / lcb_backfill_candidates
//      without writing.
//   3. POST creates the three new tables and all nine new indexes.
//   4. CHECK constraints on the new tables enforce correctly (BCS minutes_drawn,
//      CSA kind, absorbed_by).
//   5. UNIQUE constraints enforce idempotency (LCB learner_id+instructor_id,
//      BCS booking_id+credit_transaction_id, CSA stripe_refund_id).
//   6. LCB backfill copies learner_users.balance_minutes for instructor_id = 1.
//   7. ON CONFLICT DO NOTHING makes the backfill re-runnable without duplicates.
//   8. The divergence check passes after backfill (pooled == SUM(scoped)).
//   9. Re-running is idempotent (marker_already_present, lcb_rows_inserted = 0).
//
// How to run:
//   CC_TEST_DB=1 npx playwright test migrate-step-2c.integration

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

(function loadEnvLocal() {
  try {
    const envPath = path.resolve(__dirname, '..', '.env.local');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      if (key.startsWith('#')) continue;
      if (process.env[key] !== undefined) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch (err) {
    console.warn('[migrate-step-2c.integration] .env.local load failed:', err.message);
  }
})();

if (!process.env.MIGRATION_SECRET) {
  process.env.MIGRATION_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
}

let _originalPostgresUrl;

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
test.describe.configure({ mode: 'serial' });

const SCHOOL_ID = 1;
const STEP_2B_MARKER_KEY = 'per_instructor_credits_step_2b';

let sql;
let handler;
let MARKER_KEY;
let NEW_TABLES;
let NEW_INDEXES;
let GRANDFATHER_INSTRUCTOR_ID;
let testLearnerId;
let testInstructorId;
let testBookingId;
let testCreditTxId;
let createdCreditTxIds = [];
let createdBookingIds = [];

function fakeReq({ method = 'GET', query = {}, headers = {} } = {}) {
  return { method, query, headers };
}
function fakeRes() {
  const r = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return r;
}

async function call({ method, dry_run } = {}) {
  const req = fakeReq({
    method: method || 'POST',
    query: {
      secret: process.env.MIGRATION_SECRET,
      ...(dry_run ? { dry_run: '1' } : {}),
    },
  });
  const res = fakeRes();
  await handler(req, res);
  return { statusCode: res.statusCode, body: res.body };
}

test.describe('migrate-step-2c — integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL. Point at an isolated branch.');
    }

    _originalPostgresUrl = process.env.POSTGRES_URL;
    process.env.POSTGRES_URL = process.env.POSTGRES_URL_TEST;

    handler = require('../api/migrate-step-2c');
    MARKER_KEY = handler.MARKER_KEY;
    NEW_TABLES = handler.NEW_TABLES;
    NEW_INDEXES = handler.NEW_INDEXES;
    GRANDFATHER_INSTRUCTOR_ID = handler.GRANDFATHER_INSTRUCTOR_ID;

    sql = neon(process.env.POSTGRES_URL_TEST);

    // ── Reset test branch to a "Step 2b complete, 2c not yet run" shape ────
    await sql`
      CREATE TABLE IF NOT EXISTS migration_markers (
        key          TEXT PRIMARY KEY,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        notes        TEXT
      )
    `;

    // Ensure Step 2a+2b state: columns present + source NOT NULL.
    await sql`
      ALTER TABLE credit_transactions
        ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'stripe'
          CHECK (source IS NULL OR source IN ('stripe', 'free_trial', 'reconciliation', 'goodwill'))
    `;
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
    // Make sure no NULL rows exist before NOT NULL.
    await sql`UPDATE credit_transactions SET source = 'stripe' WHERE source IS NULL`;
    await sql`ALTER TABLE credit_transactions ALTER COLUMN source SET NOT NULL`;

    // Drop the three new tables + the two unique indexes so the forward
    // migration has something to do. The three tables auto-drop their own
    // indexes; idx_lcb_*, idx_bcs_*, idx_csa_* go with them.
    await sql`DROP TABLE IF EXISTS booking_credit_sources CASCADE`;
    await sql`DROP TABLE IF EXISTS credit_source_adjustments CASCADE`;
    await sql`DROP TABLE IF EXISTS learner_credit_balances CASCADE`;
    await sql`DROP INDEX IF EXISTS uq_credit_tx_payment_intent`;
    await sql`DROP INDEX IF EXISTS uq_credit_tx_charge`;

    // Wipe markers.
    await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;
    await sql`DELETE FROM migration_markers WHERE key = ${STEP_2B_MARKER_KEY}`;

    // ── Fixtures ────────────────────────────────────────────────────────────
    // Learner with a positive balance to drive the LCB backfill.
    const learnerEmail = `step2c+${crypto.randomBytes(6).toString('hex')}@coachcarter.test`;
    const [l1] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES ('Step2c Test', ${learnerEmail}, ${SCHOOL_ID}, 120, 11000)
      RETURNING id
    `;
    testLearnerId = l1.id;

    // We need instructor_id = 1 (Fraser, grandfather) to exist for the LCB
    // backfill FK to satisfy. On the test branch this should already exist
    // (prod-shaped) but if not we error out — fixtures shouldn't fabricate it.
    const [fraser] = await sql`SELECT id FROM instructors WHERE id = ${GRANDFATHER_INSTRUCTOR_ID}`;
    if (!fraser) {
      throw new Error(`Test branch lacks instructors.id = ${GRANDFATHER_INSTRUCTOR_ID} — required for LCB backfill.`);
    }
    testInstructorId = fraser.id;

    // A booking + a credit_transaction for the BCS / CSA constraint tests.
    // Use a far-future date to avoid uq_booking_slot collisions with real data.
    const date = new Date(Date.UTC(2031, 0, 1)).toISOString().slice(0, 10);
    // Find any lesson_type on the test branch.
    const [lt] = await sql`SELECT id FROM lesson_types LIMIT 1`;
    if (!lt) throw new Error('Test branch has no lesson_types.');

    const [b] = await sql`
      INSERT INTO lesson_bookings
        (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
         lesson_type_id, minutes_deducted, school_id, list_price_pence, list_price_source)
      VALUES
        (${testLearnerId}, ${testInstructorId}, ${date}, '09:00', '10:00', 'scheduled',
         ${lt.id}, 60, ${SCHOOL_ID}, 5500, 'live_compute_insert')
      RETURNING id
    `;
    testBookingId = b.id;
    createdBookingIds.push(b.id);

    const [tx] = await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, school_id, source)
      VALUES
        (${testLearnerId}, 'purchase', 60, 5500, ${SCHOOL_ID}, 'stripe')
      RETURNING id
    `;
    testCreditTxId = tx.id;
    createdCreditTxIds.push(tx.id);
  });

  test.afterAll(async () => {
    if (!ENABLED) return;
    try {
      // Children first, in case the migration created BCS rows pointing at our
      // tx (it doesn't, but defence in depth).
      try { await sql`DELETE FROM credit_source_adjustments WHERE credit_transaction_id = ANY(${createdCreditTxIds})`; } catch (_) {}
      try { await sql`DELETE FROM booking_credit_sources WHERE booking_id = ANY(${createdBookingIds})`; } catch (_) {}
      try { await sql`DELETE FROM learner_credit_balances WHERE learner_id = ${testLearnerId}`; } catch (_) {}
      if (createdBookingIds.length) {
        await sql`DELETE FROM lesson_bookings WHERE id = ANY(${createdBookingIds})`;
      }
      if (createdCreditTxIds.length) {
        await sql`DELETE FROM credit_transactions WHERE id = ANY(${createdCreditTxIds})`;
      }
      if (testLearnerId) {
        await sql`DELETE FROM learner_users WHERE id = ${testLearnerId}`;
      }
      await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;
      await sql`DELETE FROM migration_markers WHERE key = ${STEP_2B_MARKER_KEY}`;
    } finally {
      if (_originalPostgresUrl !== undefined) {
        process.env.POSTGRES_URL = _originalPostgresUrl;
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Prereq-marker gate.
  // ───────────────────────────────────────────────────────────────────────────
  test('refuses to run without Step 2b prereq marker', async () => {
    const { statusCode, body } = await call({ method: 'GET' });
    expect(statusCode).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toContain(STEP_2B_MARKER_KEY);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Dry-run reports pending work.
  // ───────────────────────────────────────────────────────────────────────────
  test('dry-run reports tables/indexes to create + backfill candidates', async () => {
    await sql`
      INSERT INTO migration_markers (key, notes)
      VALUES (${STEP_2B_MARKER_KEY}, 'test-fixture')
      ON CONFLICT (key) DO NOTHING
    `;

    const { statusCode, body } = await call({ method: 'GET' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dry_run).toBe(true);
    expect(body.tables_to_create.sort()).toEqual([...NEW_TABLES].sort());
    expect(body.indexes_to_create.sort()).toEqual([...NEW_INDEXES].sort());
    expect(body.lcb_backfill_candidates).toBeGreaterThanOrEqual(1); // our fixture learner
    expect(body.marker_written).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. POST creates everything + writes marker.
  // ───────────────────────────────────────────────────────────────────────────
  test('POST creates tables, indexes, runs backfill, writes marker', async () => {
    const { statusCode, body } = await call({ method: 'POST' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.marker_written).toBe(true);
    expect(body.lcb_rows_inserted).toBeGreaterThanOrEqual(1);

    // Verify all three tables now exist.
    const tableRows = await sql`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY(${NEW_TABLES})
    `;
    expect(tableRows.map(r => r.table_name).sort()).toEqual([...NEW_TABLES].sort());

    // All indexes present.
    const idxRows = await sql`
      SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY(${NEW_INDEXES})
    `;
    expect(idxRows.map(r => r.indexname).sort()).toEqual([...NEW_INDEXES].sort());

    // LCB backfill for our fixture: 120 minutes, instructor 1, school 1.
    const [lcb] = await sql`
      SELECT instructor_id, school_id, balance_minutes
        FROM learner_credit_balances
       WHERE learner_id = ${testLearnerId}
    `;
    expect(lcb.instructor_id).toBe(GRANDFATHER_INSTRUCTOR_ID);
    expect(lcb.balance_minutes).toBe(120);
    expect(lcb.school_id).toBe(SCHOOL_ID);

    // Divergence check should be empty.
    expect(body.divergence_sample).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. CHECK constraints — BCS minutes_drawn > 0.
  // ───────────────────────────────────────────────────────────────────────────
  test('BCS rejects minutes_drawn <= 0', async () => {
    let caught = null;
    try {
      await sql`
        INSERT INTO booking_credit_sources
          (booking_id, credit_transaction_id, minutes_drawn, rate_pence_per_minute, contribution_pence)
        VALUES
          (${testBookingId}, ${testCreditTxId}, 0, 92, 0)
      `;
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message).toLowerCase()).toMatch(/check|constraint|minutes/);
  });

  test('BCS accepts a valid attribution row', async () => {
    const [row] = await sql`
      INSERT INTO booking_credit_sources
        (booking_id, credit_transaction_id, minutes_drawn, rate_pence_per_minute, contribution_pence, absorbed_by)
      VALUES
        (${testBookingId}, ${testCreditTxId}, 60, 92, 5520, NULL)
      RETURNING id, minutes_drawn, contribution_pence, school_id
    `;
    expect(row.minutes_drawn).toBe(60);
    expect(row.contribution_pence).toBe(5520);
    expect(row.school_id).toBe(SCHOOL_ID);
  });

  test('BCS UNIQUE(booking_id, credit_transaction_id) enforces idempotency', async () => {
    let caught = null;
    try {
      // Same (booking, tx) pair as above.
      await sql`
        INSERT INTO booking_credit_sources
          (booking_id, credit_transaction_id, minutes_drawn, rate_pence_per_minute, contribution_pence)
        VALUES
          (${testBookingId}, ${testCreditTxId}, 60, 92, 5520)
      `;
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message).toLowerCase()).toMatch(/unique|duplicate/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. CSA constraints.
  // ───────────────────────────────────────────────────────────────────────────
  test('CSA rejects disallowed kind', async () => {
    let caught = null;
    try {
      await sql`
        INSERT INTO credit_source_adjustments
          (credit_transaction_id, kind, minutes_adjusted, pence_adjusted, reason)
        VALUES
          (${testCreditTxId}, 'random_kind', 30, 2750, 'test')
      `;
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message).toLowerCase()).toMatch(/check|constraint/);
  });

  test('CSA accepts cash_refund and enforces UNIQUE(stripe_refund_id)', async () => {
    const refundId = `re_test_${crypto.randomBytes(6).toString('hex')}`;
    const [row] = await sql`
      INSERT INTO credit_source_adjustments
        (credit_transaction_id, kind, minutes_adjusted, pence_adjusted, reason, stripe_refund_id)
      VALUES
        (${testCreditTxId}, 'cash_refund', 30, 2750, 'partial refund', ${refundId})
      RETURNING id
    `;
    expect(row.id).toBeGreaterThan(0);

    // Same stripe_refund_id should now collide.
    let caught = null;
    try {
      await sql`
        INSERT INTO credit_source_adjustments
          (credit_transaction_id, kind, minutes_adjusted, pence_adjusted, reason, stripe_refund_id)
        VALUES
          (${testCreditTxId}, 'cash_refund', 10, 920, 'duplicate', ${refundId})
      `;
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message).toLowerCase()).toMatch(/unique|duplicate/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. LCB UNIQUE(learner_id, instructor_id).
  // ───────────────────────────────────────────────────────────────────────────
  test('LCB UNIQUE(learner_id, instructor_id) enforces one row per pair', async () => {
    let caught = null;
    try {
      await sql`
        INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
        VALUES (${testLearnerId}, ${GRANDFATHER_INSTRUCTOR_ID}, ${SCHOOL_ID}, 60)
      `;
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message).toLowerCase()).toMatch(/unique|duplicate/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Unique partial indexes on payment_intent_id / charge_id.
  // ───────────────────────────────────────────────────────────────────────────
  test('uq_credit_tx_payment_intent rejects duplicates but allows multiple NULLs', async () => {
    const pi1 = `pi_test_${crypto.randomBytes(8).toString('hex')}`;

    const [a] = await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, school_id, source, stripe_payment_intent_id)
      VALUES (${testLearnerId}, 'purchase', 60, 5500, ${SCHOOL_ID}, 'stripe', ${pi1})
      RETURNING id
    `;
    createdCreditTxIds.push(a.id);

    let caught = null;
    try {
      await sql`
        INSERT INTO credit_transactions
          (learner_id, type, credits, amount_pence, school_id, source, stripe_payment_intent_id)
        VALUES (${testLearnerId}, 'purchase', 60, 5500, ${SCHOOL_ID}, 'stripe', ${pi1})
      `;
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message).toLowerCase()).toMatch(/unique|duplicate/);

    // Multiple NULLs OK (partial index, WHERE NOT NULL).
    const [b1] = await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, school_id, source)
      VALUES (${testLearnerId}, 'purchase', 60, 5500, ${SCHOOL_ID}, 'stripe')
      RETURNING id
    `;
    const [b2] = await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, school_id, source)
      VALUES (${testLearnerId}, 'purchase', 60, 5500, ${SCHOOL_ID}, 'stripe')
      RETURNING id
    `;
    createdCreditTxIds.push(b1.id, b2.id);
    expect(b1.id).not.toBe(b2.id);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Idempotency.
  // ───────────────────────────────────────────────────────────────────────────
  test('re-running is idempotent', async () => {
    const { statusCode, body } = await call({ method: 'POST' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.lcb_rows_inserted).toBe(0); // ON CONFLICT DO NOTHING
    expect(body.tables_to_create).toEqual([]);
    expect(body.indexes_to_create).toEqual([]);
    expect(body.marker_already_present).toBe(true);
  });
});
