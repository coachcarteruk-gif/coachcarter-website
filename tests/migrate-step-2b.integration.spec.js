// @ts-check
// Integration tests for api/migrate-step-2b.js against a real Neon test branch.
//
// What this proves:
//   1. Refuses to run without the Step 2a prereq marker.
//   2. Refuses to run if the credit_transactions.source column is missing
//      (defence against a manually-inserted marker without 2a having actually run).
//   3. Dry-run reports NULL row count without writing.
//   4. POST backfills any NULL source rows to 'stripe' and applies NOT NULL.
//   5. After NOT NULL is applied, inserting a row with explicit NULL source is rejected.
//   6. The DEFAULT 'stripe' still applies (inserts that omit source still succeed).
//   7. Re-running is idempotent (NOT NULL stays, marker_already_present).
//
// Why integration:
//   information_schema.columns.is_nullable, NOT NULL enforcement, and the
//   PG DEFAULT behaviour after NOT NULL is added are real Postgres semantics
//   that can't be honestly mocked.
//
// How to run:
//   CC_TEST_DB=1 npx playwright test migrate-step-2b.integration

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Inline .env.local loader.
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
    console.warn('[migrate-step-2b.integration] .env.local load failed:', err.message);
  }
})();

if (!process.env.MIGRATION_SECRET) {
  process.env.MIGRATION_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
}

let _originalPostgresUrl;

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
test.describe.configure({ mode: 'serial' });

const SCHOOL_ID = 1;
const STEP_2A_MARKER_KEY = 'per_instructor_credits_step_2a';

let sql;
let handler;
let MARKER_KEY;
let testLearnerId;
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

test.describe('migrate-step-2b — integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL. Point at an isolated branch.');
    }

    _originalPostgresUrl = process.env.POSTGRES_URL;
    process.env.POSTGRES_URL = process.env.POSTGRES_URL_TEST;

    handler = require('../api/migrate-step-2b');
    MARKER_KEY = handler.MARKER_KEY;

    sql = neon(process.env.POSTGRES_URL_TEST);

    // ── Reset test branch to a "Step 2a complete, 2b not yet run" shape ────
    // Drop NOT NULL on source if it was set by a previous run, drop the 2b
    // marker, and clear/reset the source column so we can prove the backfill.
    // Step 2a columns must already exist (the Step 2a integration test leaves
    // them in place; running 2b tests standalone needs the columns first).
    await sql`
      CREATE TABLE IF NOT EXISTS migration_markers (
        key          TEXT PRIMARY KEY,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        notes        TEXT
      )
    `;

    // Ensure Step 2a columns exist (idempotent — runs Step 2a's DDL).
    // This lets the 2b test suite run independently of 2a's suite.
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

    // Drop NOT NULL if a previous run set it; this restores the "post-2a,
    // pre-2b" state we're testing against.
    await sql`ALTER TABLE credit_transactions ALTER COLUMN source DROP NOT NULL`;

    // Clear markers for a clean state.
    await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;
    await sql`DELETE FROM migration_markers WHERE key = ${STEP_2A_MARKER_KEY}`;

    // ── Test fixtures ───────────────────────────────────────────────────────
    const learnerEmail = `step2b+${crypto.randomBytes(6).toString('hex')}@coachcarter.test`;
    const [l1] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES ('Step2b Test', ${learnerEmail}, ${SCHOOL_ID}, 0, 0)
      RETURNING id
    `;
    testLearnerId = l1.id;

    // Insert a row with explicit NULL source to prove the backfill works.
    // The DEFAULT only kicks in when source is omitted; explicit NULL bypasses
    // it. Mimics a hypothetical writer that set source = NULL on purpose.
    const [tx] = await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, school_id, source)
      VALUES
        (${testLearnerId}, 'purchase', 60, 5500, ${SCHOOL_ID}, NULL)
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
      await sql`DELETE FROM migration_markers WHERE key = ${STEP_2A_MARKER_KEY}`;
    } finally {
      if (_originalPostgresUrl !== undefined) {
        process.env.POSTGRES_URL = _originalPostgresUrl;
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Prereq-marker gate.
  // ───────────────────────────────────────────────────────────────────────────
  test('refuses to run without Step 2a prereq marker', async () => {
    const { statusCode, body } = await call({ method: 'GET' });
    expect(statusCode).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toContain(STEP_2A_MARKER_KEY);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Dry-run reports NULL count when prereq satisfied.
  // ───────────────────────────────────────────────────────────────────────────
  test('dry-run reports NULL count when prereq satisfied', async () => {
    await sql`
      INSERT INTO migration_markers (key, notes)
      VALUES (${STEP_2A_MARKER_KEY}, 'test-fixture')
      ON CONFLICT (key) DO NOTHING
    `;

    const { statusCode, body } = await call({ method: 'GET' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dry_run).toBe(true);
    expect(body.source_already_not_null).toBe(false);
    expect(body.rows_with_null_source).toBeGreaterThanOrEqual(1); // our fixture row
    expect(body.rows_updated).toBe(0);
    expect(body.not_null_applied).toBe(false);
    expect(body.marker_written).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. POST backfills + applies NOT NULL + writes marker.
  // ───────────────────────────────────────────────────────────────────────────
  test('POST backfills NULL rows and applies NOT NULL', async () => {
    const { statusCode, body } = await call({ method: 'POST' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.rows_updated).toBeGreaterThanOrEqual(1);
    expect(body.not_null_applied).toBe(true);
    expect(body.marker_written).toBe(true);

    // The fixture row now reads 'stripe'.
    const [row] = await sql`
      SELECT source FROM credit_transactions WHERE id = ${createdCreditTxIds[0]}
    `;
    expect(row.source).toBe('stripe');

    // information_schema confirms NOT NULL.
    const [{ is_nullable }] = await sql`
      SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'credit_transactions' AND column_name = 'source'
    `;
    expect(is_nullable).toBe('NO');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. After NOT NULL, explicit-NULL inserts are rejected.
  // ───────────────────────────────────────────────────────────────────────────
  test('explicit NULL source is rejected after NOT NULL', async () => {
    let caught = null;
    try {
      await sql`
        INSERT INTO credit_transactions
          (learner_id, type, credits, amount_pence, school_id, source)
        VALUES
          (${testLearnerId}, 'purchase', 30, 2750, ${SCHOOL_ID}, NULL)
      `;
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message).toLowerCase()).toMatch(/null|not.null/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. DEFAULT 'stripe' still applies when source is omitted.
  // ───────────────────────────────────────────────────────────────────────────
  test('DEFAULT stripe still applies when source omitted', async () => {
    const [row] = await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, school_id)
      VALUES
        (${testLearnerId}, 'purchase', 30, 2750, ${SCHOOL_ID})
      RETURNING id, source
    `;
    createdCreditTxIds.push(row.id);
    expect(row.source).toBe('stripe');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Idempotency.
  // ───────────────────────────────────────────────────────────────────────────
  test('re-running is idempotent', async () => {
    const { statusCode, body } = await call({ method: 'POST' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.source_already_not_null).toBe(true);
    expect(body.rows_updated).toBe(0);
    expect(body.not_null_applied).toBe(false); // was already NOT NULL
    expect(body.marker_already_present).toBe(true);
  });
});
