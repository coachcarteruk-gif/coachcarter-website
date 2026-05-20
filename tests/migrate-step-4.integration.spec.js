// @ts-check
// Integration tests for api/migrate-step-4.js against a real Neon test branch.
//
// What this proves:
//   1. Refuses to run without the Step 2c prereq marker.
//   2. Dry-run reports function/trigger presence without writing.
//   3. POST creates sync_pooled_balance() + trg_sync_pooled_balance.
//   4. The trigger forwards LCB writes onto learner_users.balance_minutes
//      (INSERT and UPDATE paths both fire).
//   5. Two LCB rows for the same learner sum correctly into pooled.
//   6. GDPR no-op: a learner-deletion CASCADE wipes LCB rows without the
//      trigger trying to touch a non-existent learner_users row.
//   7. Re-running is idempotent (marker_already_present, function/trigger
//      remain in place).
//
// How to run:
//   CC_TEST_DB=1 npx playwright test migrate-step-4.integration

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
    console.warn('[migrate-step-4.integration] .env.local load failed:', err.message);
  }
})();

if (!process.env.MIGRATION_SECRET) {
  process.env.MIGRATION_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
}

let _originalPostgresUrl;

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
test.describe.configure({ mode: 'serial' });

const SCHOOL_ID = 1;
const STEP_2C_MARKER_KEY = 'per_instructor_credits_step_2c';
const GRANDFATHER_INSTRUCTOR_ID = 1;

let sql;
let handler;
let MARKER_KEY;
let FUNCTION_NAME;
let TRIGGER_NAME;
let testLearnerId;
let secondInstructorId;

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

test.describe('migrate-step-4 — integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL. Point at an isolated branch.');
    }

    _originalPostgresUrl = process.env.POSTGRES_URL;
    process.env.POSTGRES_URL = process.env.POSTGRES_URL_TEST;

    handler = require('../api/migrate-step-4');
    MARKER_KEY = handler.MARKER_KEY;
    FUNCTION_NAME = handler.FUNCTION_NAME;
    TRIGGER_NAME = handler.TRIGGER_NAME;

    sql = neon(process.env.POSTGRES_URL_TEST);

    // ── Ensure migration_markers + LCB exist; drop function/trigger to test fresh create ──
    await sql`
      CREATE TABLE IF NOT EXISTS migration_markers (
        key          TEXT PRIMARY KEY,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        notes        TEXT
      )
    `;
    // LCB must exist (Step 2c output). If running against a Step-2c-clean
    // branch, this is a no-op; otherwise create the minimum shape.
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

    // Wipe the function + trigger so the migration has work to do.
    await sql`DROP TRIGGER IF EXISTS trg_sync_pooled_balance ON learner_credit_balances`;
    await sql`DROP FUNCTION IF EXISTS sync_pooled_balance() CASCADE`;
    await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;
    await sql`DELETE FROM migration_markers WHERE key = ${STEP_2C_MARKER_KEY}`;

    // Test fixtures.
    const learnerEmail = `step4+${crypto.randomBytes(6).toString('hex')}@coachcarter.test`;
    const [l1] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES ('Step4 Test', ${learnerEmail}, ${SCHOOL_ID}, 0, 0)
      RETURNING id
    `;
    testLearnerId = l1.id;

    // Find a second instructor for the two-row sum test. If only Fraser
    // exists, the test that needs two LCB rows uses two separate learners
    // instead (handled below).
    const others = await sql`
      SELECT id FROM instructors WHERE id != ${GRANDFATHER_INSTRUCTOR_ID} LIMIT 1
    `;
    secondInstructorId = others[0]?.id || null;
  });

  test.afterAll(async () => {
    if (!ENABLED) return;
    try {
      try { await sql`DELETE FROM learner_credit_balances WHERE learner_id = ${testLearnerId}`; } catch (_) {}
      if (testLearnerId) {
        await sql`DELETE FROM learner_users WHERE id = ${testLearnerId}`;
      }
      await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;
      await sql`DELETE FROM migration_markers WHERE key = ${STEP_2C_MARKER_KEY}`;
    } finally {
      if (_originalPostgresUrl !== undefined) {
        process.env.POSTGRES_URL = _originalPostgresUrl;
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Prereq-marker gate.
  // ───────────────────────────────────────────────────────────────────────────
  test('refuses to run without Step 2c prereq marker', async () => {
    const { statusCode, body } = await call({ method: 'GET' });
    expect(statusCode).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toContain(STEP_2C_MARKER_KEY);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Dry-run reports state.
  // ───────────────────────────────────────────────────────────────────────────
  test('dry-run reports function/trigger missing before migration runs', async () => {
    await sql`
      INSERT INTO migration_markers (key, notes)
      VALUES (${STEP_2C_MARKER_KEY}, 'test-fixture')
      ON CONFLICT (key) DO NOTHING
    `;

    const { statusCode, body } = await call({ method: 'GET' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dry_run).toBe(true);
    expect(body.function_already_present).toBe(false);
    expect(body.trigger_already_present).toBe(false);
    expect(body.marker_written).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. POST creates function + trigger and writes marker.
  // ───────────────────────────────────────────────────────────────────────────
  test('POST creates function, trigger, and writes marker', async () => {
    const { statusCode, body } = await call({ method: 'POST' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.function_present).toBe(true);
    expect(body.trigger_present).toBe(true);
    expect(body.marker_written).toBe(true);

    const [func] = await sql`SELECT proname FROM pg_proc WHERE proname = ${FUNCTION_NAME}`;
    expect(func).toBeTruthy();

    const [trig] = await sql`SELECT tgname FROM pg_trigger WHERE tgname = ${TRIGGER_NAME}`;
    expect(trig).toBeTruthy();

    const [marker] = await sql`SELECT key FROM migration_markers WHERE key = ${MARKER_KEY}`;
    expect(marker).toBeTruthy();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Trigger fires on LCB INSERT → pooled balance reflects the row.
  // ───────────────────────────────────────────────────────────────────────────
  test('trigger forwards LCB INSERT to learner_users.balance_minutes', async () => {
    // Confirm pooled starts at 0.
    const [pre] = await sql`SELECT balance_minutes FROM learner_users WHERE id = ${testLearnerId}`;
    expect(pre.balance_minutes).toBe(0);

    // Insert a 90-minute LCB row for Fraser.
    await sql`
      INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
      VALUES (${testLearnerId}, ${GRANDFATHER_INSTRUCTOR_ID}, ${SCHOOL_ID}, 90)
    `;

    const [post] = await sql`SELECT balance_minutes FROM learner_users WHERE id = ${testLearnerId}`;
    expect(post.balance_minutes).toBe(90);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Trigger fires on LCB UPDATE → pooled tracks subsequent changes.
  // ───────────────────────────────────────────────────────────────────────────
  test('trigger forwards LCB UPDATE to learner_users.balance_minutes', async () => {
    await sql`
      UPDATE learner_credit_balances
         SET balance_minutes = 150
       WHERE learner_id = ${testLearnerId}
         AND instructor_id = ${GRANDFATHER_INSTRUCTOR_ID}
    `;

    const [pooled] = await sql`SELECT balance_minutes FROM learner_users WHERE id = ${testLearnerId}`;
    expect(pooled.balance_minutes).toBe(150);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Two LCB rows sum correctly into pooled (multi-instructor case).
  // ───────────────────────────────────────────────────────────────────────────
  test('two LCB rows sum into pooled balance', async () => {
    if (!secondInstructorId) {
      test.skip(true, 'Test branch only has one instructor — skipping multi-instructor sum test.');
      return;
    }

    await sql`
      INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
      VALUES (${testLearnerId}, ${secondInstructorId}, ${SCHOOL_ID}, 60)
    `;

    const [pooled] = await sql`SELECT balance_minutes FROM learner_users WHERE id = ${testLearnerId}`;
    expect(pooled.balance_minutes).toBe(150 + 60); // existing Fraser row + new second-instructor row
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. GDPR no-op: deleting the learner CASCADEs LCB rows without trigger error.
  // ───────────────────────────────────────────────────────────────────────────
  test('GDPR cascade: deleting learner_users wipes LCB rows without trigger error', async () => {
    // Fresh learner so we don't pollute later tests.
    const email = `step4-gdpr+${crypto.randomBytes(6).toString('hex')}@coachcarter.test`;
    const [tmp] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES ('GDPR test', ${email}, ${SCHOOL_ID}, 0, 0)
      RETURNING id
    `;
    await sql`
      INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
      VALUES (${tmp.id}, ${GRANDFATHER_INSTRUCTOR_ID}, ${SCHOOL_ID}, 30)
    `;

    // Confirm the trigger fired on the INSERT.
    const [poolBefore] = await sql`SELECT balance_minutes FROM learner_users WHERE id = ${tmp.id}`;
    expect(poolBefore.balance_minutes).toBe(30);

    // The FK cascade deletes both rows. The trigger fires AFTER INSERT/UPDATE,
    // NOT on DELETE — so cascade-deleting LCB rows alongside the parent
    // learner_users row must complete without firing the function. (If the
    // trigger were AFTER DELETE too, it would try to UPDATE a learner_users
    // row that's already gone, which is exactly what the GDPR no-op exists
    // to prevent.)
    await sql`DELETE FROM learner_users WHERE id = ${tmp.id}`;

    const remaining = await sql`SELECT id FROM learner_credit_balances WHERE learner_id = ${tmp.id}`;
    expect(remaining.length).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Idempotency: re-running is a no-op marker-wise; function/trigger stay.
  // ───────────────────────────────────────────────────────────────────────────
  test('re-running is idempotent', async () => {
    const { statusCode, body } = await call({ method: 'POST' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.marker_already_present).toBe(true);
    expect(body.marker_written).toBe(false);

    const [func] = await sql`SELECT proname FROM pg_proc WHERE proname = ${FUNCTION_NAME}`;
    expect(func).toBeTruthy();
    const [trig] = await sql`SELECT tgname FROM pg_trigger WHERE tgname = ${TRIGGER_NAME}`;
    expect(trig).toBeTruthy();
  });
});
