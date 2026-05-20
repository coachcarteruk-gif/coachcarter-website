// @ts-check
// Integration tests for api/migrate-step-2a.js against a real Neon test branch.
//
// What this proves:
//   1. Dry-run reports which columns would be added without writing.
//   2. The endpoint refuses to run if the Step 1c prereq marker is absent.
//   3. POST creates all six new columns on credit_transactions.
//   4. CHECK constraints reject disallowed `source` and `absorbed_by` values.
//   5. DEFAULT 'stripe' applies to existing rows via PG missing-value fast-path
//      (no UPDATE was issued, yet existing rows read 'stripe').
//   6. The instructor_id FK works (rejects bad references) and the partial
//      index is queryable.
//   7. Marker row written on success; re-run is a no-op.
//
// Why integration (not mock) tests:
//   Properties under test (information_schema visibility, CHECK enforcement,
//   PG missing-value DEFAULT semantics, FK validation) are PostgreSQL
//   semantics — cannot be honestly exercised against an in-memory mock.
//
// How to run:
//   1. Neon test branch + POSTGRES_URL_TEST in .env.local.
//   2. MIGRATION_SECRET in .env.local (any string works for tests).
//   3. CC_TEST_DB=1 npx playwright test migrate-step-2a.integration

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Inline .env.local loader — same pattern as migrate-step-1c.integration.
// ─────────────────────────────────────────────────────────────────────────────
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
    console.warn('[migrate-step-2a.integration] .env.local load failed:', err.message);
  }
})();

if (!process.env.MIGRATION_SECRET) {
  process.env.MIGRATION_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
}

let _originalPostgresUrl;

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
test.describe.configure({ mode: 'serial' });

const SCHOOL_ID = 1;
const PREREQ_MARKER_KEY = 'per_instructor_credits_step_1c_backfill';

let sql;
let handler;
let MARKER_KEY;
let NEW_COLUMNS;
let testLearnerId;
let testInstructorId;
let createdCreditTxIds = [];

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

test.describe('migrate-step-2a — integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL. Point at an isolated branch.');
    }

    _originalPostgresUrl = process.env.POSTGRES_URL;
    process.env.POSTGRES_URL = process.env.POSTGRES_URL_TEST;

    handler = require('../api/migrate-step-2a');
    MARKER_KEY = handler.MARKER_KEY;
    NEW_COLUMNS = handler.NEW_COLUMNS;

    sql = neon(process.env.POSTGRES_URL_TEST);

    // ── Reset test branch to a pre-Step-2a shape ────────────────────────────
    // Drop the columns and indexes this PR adds, so the test exercises the
    // forward migration honestly. Also drop the markers so the prereq-gate
    // test can fail fast then succeed once we re-insert the prereq.
    await sql`ALTER TABLE credit_transactions DROP COLUMN IF EXISTS instructor_id`;
    await sql`ALTER TABLE credit_transactions DROP COLUMN IF EXISTS effective_rate_pence_per_minute`;
    await sql`ALTER TABLE credit_transactions DROP COLUMN IF EXISTS source`;
    await sql`ALTER TABLE credit_transactions DROP COLUMN IF EXISTS absorbed_by`;
    await sql`ALTER TABLE credit_transactions DROP COLUMN IF EXISTS stripe_payment_intent_id`;
    await sql`ALTER TABLE credit_transactions DROP COLUMN IF EXISTS stripe_charge_id`;
    await sql`DROP INDEX IF EXISTS idx_credit_tx_instructor`;

    // Ensure migration_markers exists (test branch may pre-date Step 1c).
    await sql`
      CREATE TABLE IF NOT EXISTS migration_markers (
        key          TEXT PRIMARY KEY,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        notes        TEXT
      )
    `;
    // Wipe both markers for a clean slate.
    await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;
    await sql`DELETE FROM migration_markers WHERE key = ${PREREQ_MARKER_KEY}`;

    // ── Test fixtures ───────────────────────────────────────────────────────
    // A learner + instructor + one historical credit_transactions row, so we
    // can prove the DEFAULT 'stripe' fast-path applies to existing rows.
    const learnerEmail = `step2a+${crypto.randomBytes(6).toString('hex')}@coachcarter.test`;
    const [l1] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES ('Step2a Test', ${learnerEmail}, ${SCHOOL_ID}, 0, 0)
      RETURNING id
    `;
    testLearnerId = l1.id;

    // Find any existing instructor on the test branch; this PR doesn't need
    // a fresh one, only a valid id for FK tests.
    const [inst] = await sql`SELECT id FROM instructors LIMIT 1`;
    if (!inst) {
      throw new Error('Test branch has no instructors; seed one before running step-2a tests.');
    }
    testInstructorId = inst.id;

    // Pre-existing credit_transactions row (pre-Step-2a shape, no `source` yet).
    const [tx] = await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, payment_method, school_id)
      VALUES
        (${testLearnerId}, 'purchase', 60, 5500, 'card', ${SCHOOL_ID})
      RETURNING id
    `;
    createdCreditTxIds.push(tx.id);
  });

  test.afterAll(async () => {
    if (!ENABLED) return;
    try {
      if (createdCreditTxIds.length) {
        await sql`DELETE FROM credit_transactions WHERE id = ANY(${createdCreditTxIds})`;
      }
      if (testLearnerId) {
        await sql`DELETE FROM learner_users WHERE id = ${testLearnerId}`;
      }
      await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;
      await sql`DELETE FROM migration_markers WHERE key = ${PREREQ_MARKER_KEY}`;
    } finally {
      if (_originalPostgresUrl !== undefined) {
        process.env.POSTGRES_URL = _originalPostgresUrl;
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Prereq-marker gate — refuses to run if Step 1c marker is missing.
  // ───────────────────────────────────────────────────────────────────────────
  test('refuses to run without Step 1c prereq marker', async () => {
    // Marker was deleted in beforeAll. Dry-run still fires the gate.
    const { statusCode, body } = await call({ method: 'GET' });
    expect(statusCode).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toContain(PREREQ_MARKER_KEY);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Insert the prereq marker; dry-run should now report all six columns as
  //    pending-to-add.
  // ───────────────────────────────────────────────────────────────────────────
  test('dry-run reports columns_to_add when prereq satisfied', async () => {
    await sql`
      INSERT INTO migration_markers (key, notes)
      VALUES (${PREREQ_MARKER_KEY}, 'test-fixture')
      ON CONFLICT (key) DO NOTHING
    `;

    const { statusCode, body } = await call({ method: 'GET' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dry_run).toBe(true);
    expect(body.marker_written).toBe(false);
    expect(body.columns_to_add.sort()).toEqual([...NEW_COLUMNS].sort());
    expect(body.columns_already_present).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. POST runs the DDL; all six columns are present afterwards.
  // ───────────────────────────────────────────────────────────────────────────
  test('POST adds all six columns and writes marker', async () => {
    const { statusCode, body } = await call({ method: 'POST' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.marker_written).toBe(true);
    expect(body.columns_added.sort()).toEqual([...NEW_COLUMNS].sort());

    // Verify each column is present in information_schema.
    const rows = await sql`
      SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_name = 'credit_transactions'
         AND column_name = ANY(${NEW_COLUMNS})
       ORDER BY column_name
    `;
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(Object.keys(byName).sort()).toEqual([...NEW_COLUMNS].sort());

    // instructor_id is INTEGER, nullable, no default.
    expect(byName.instructor_id.data_type).toBe('integer');
    expect(byName.instructor_id.is_nullable).toBe('YES');

    // source is TEXT, nullable (until 2b), default 'stripe'.
    expect(byName.source.data_type).toBe('text');
    expect(byName.source.is_nullable).toBe('YES');
    expect(byName.source.column_default).toContain('stripe');

    // FK index exists.
    const idxRows = await sql`
      SELECT indexname FROM pg_indexes
       WHERE tablename = 'credit_transactions'
         AND indexname = 'idx_credit_tx_instructor'
    `;
    expect(idxRows.length).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. DEFAULT 'stripe' applies to the pre-existing row via fast-path.
  //    No UPDATE was issued; existing row should read 'stripe'.
  // ───────────────────────────────────────────────────────────────────────────
  test('existing rows read source = stripe via missing-value fast-path', async () => {
    const [row] = await sql`
      SELECT source FROM credit_transactions WHERE id = ${createdCreditTxIds[0]}
    `;
    expect(row.source).toBe('stripe');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. CHECK constraint rejects disallowed source values.
  // ───────────────────────────────────────────────────────────────────────────
  test('source CHECK constraint rejects disallowed values', async () => {
    let caught = null;
    try {
      await sql`
        INSERT INTO credit_transactions
          (learner_id, type, credits, amount_pence, school_id, source)
        VALUES
          (${testLearnerId}, 'purchase', 30, 2750, ${SCHOOL_ID}, 'gift_card')
      `;
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message).toLowerCase()).toMatch(/check|constraint/);
  });

  test('source CHECK accepts free_trial and goodwill', async () => {
    const [a] = await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, school_id, source)
      VALUES (${testLearnerId}, 'purchase', 0, 0, ${SCHOOL_ID}, 'free_trial')
      RETURNING id
    `;
    const [b] = await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, school_id, source, absorbed_by)
      VALUES (${testLearnerId}, 'admin_add', 60, 0, ${SCHOOL_ID}, 'goodwill', 'platform')
      RETURNING id
    `;
    createdCreditTxIds.push(a.id, b.id);
    expect(a.id).toBeGreaterThan(0);
    expect(b.id).toBeGreaterThan(0);
  });

  test('absorbed_by CHECK constraint rejects disallowed values', async () => {
    let caught = null;
    try {
      await sql`
        INSERT INTO credit_transactions
          (learner_id, type, credits, amount_pence, school_id, source, absorbed_by)
        VALUES
          (${testLearnerId}, 'admin_add', 0, 0, ${SCHOOL_ID}, 'goodwill', 'sky')
      `;
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message).toLowerCase()).toMatch(/check|constraint/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. FK enforcement on instructor_id.
  // ───────────────────────────────────────────────────────────────────────────
  test('instructor_id FK rejects non-existent instructor', async () => {
    let caught = null;
    try {
      await sql`
        INSERT INTO credit_transactions
          (learner_id, type, credits, amount_pence, school_id, instructor_id)
        VALUES
          (${testLearnerId}, 'purchase', 30, 2750, ${SCHOOL_ID}, 99999999)
      `;
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message).toLowerCase()).toMatch(/foreign|fkey|violates/);
  });

  test('instructor_id FK accepts a real instructor', async () => {
    const [row] = await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, school_id, instructor_id, source)
      VALUES (${testLearnerId}, 'purchase', 60, 5500, ${SCHOOL_ID}, ${testInstructorId}, 'stripe')
      RETURNING id, instructor_id
    `;
    createdCreditTxIds.push(row.id);
    expect(row.instructor_id).toBe(testInstructorId);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Idempotency — second POST is a no-op, marker_already_present.
  // ───────────────────────────────────────────────────────────────────────────
  test('re-running is idempotent', async () => {
    const { statusCode, body } = await call({ method: 'POST' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.marker_written).toBe(false);
    expect(body.marker_already_present).toBe(true);
    expect(body.columns_already_present.sort()).toEqual([...NEW_COLUMNS].sort());
    expect(body.columns_to_add).toEqual([]);
  });
});
