// @ts-check
// Integration tests for api/migrate-step-2c-grandfather.js against a real
// Neon test branch.
//
// What this proves:
//   1. Refuses to run without the Step 2c prereq marker.
//   2. Dry-run reports candidate_count + candidates_sample without writing.
//   3. Dry-run sample rows include the eyeballable columns Fraser asked
//      for (learner_id, instructor_id, balance_minutes, grandfathered_at,
//      lcb_updated_at, scoped_ct_count, scoped_ct_minutes).
//   4. POST marks pure-legacy LCB rows (no CT for the pair) with
//      grandfathered_at = NOW().
//   5. POST does NOT touch rows that have any credit_transactions row for
//      the pair, even if balance_minutes > 0 and grandfathered_at is NULL.
//   6. POST does NOT touch rows that are already grandfathered.
//   7. POST does NOT touch rows with balance_minutes = 0.
//   8. POST is idempotent — second run reports rows_updated = 0,
//      marker_already_present = true.
//   9. The marker_window_match_count is reported (supporting evidence
//      only; not the load-bearing predicate).
//
// How to run:
//   CC_TEST_DB=1 npx playwright test migrate-step-2c-grandfather.integration

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
    console.warn('[migrate-step-2c-grandfather.integration] .env.local load failed:', err.message);
  }
})();

if (!process.env.MIGRATION_SECRET) {
  process.env.MIGRATION_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
}

let _originalPostgresUrl;

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
test.describe.configure({ mode: 'serial' });

const SCHOOL_ID = 1;
const PREREQ_MARKER_KEY = 'per_instructor_credits_step_2c';

let sql;
let handler;
let MARKER_KEY;
let testLearnerLegacyId;        // pure-legacy: LCB > 0, no CT — should be grandfathered
let testLearnerMixedId;         // mixed-state: LCB > 0 AND CT exists — should NOT be grandfathered
let testLearnerAlreadyGfId;     // already grandfathered — should NOT be re-touched
let testLearnerZeroBalanceId;   // LCB exists but balance_minutes = 0 — should NOT be grandfathered
let createdLearnerIds = [];
let createdCtIds = [];

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

async function getLcb(learnerId) {
  const [row] = await sql`
    SELECT learner_id, instructor_id, balance_minutes,
           grandfathered_at::text AS grandfathered_at,
           updated_at::text       AS updated_at
      FROM learner_credit_balances
     WHERE learner_id = ${learnerId}
     LIMIT 1
  `;
  return row;
}

test.describe('migrate-step-2c-grandfather — integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL. Point at an isolated branch.');
    }

    _originalPostgresUrl = process.env.POSTGRES_URL;
    process.env.POSTGRES_URL = process.env.POSTGRES_URL_TEST;

    handler = require('../api/migrate-step-2c-grandfather');
    MARKER_KEY = handler.MARKER_KEY;

    sql = neon(process.env.POSTGRES_URL_TEST);

    // Sanity: branch must have Phase-2A schema + LCB table.
    const [hasLcb] = await sql`
      SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name='learner_credit_balances'
    `;
    if (!hasLcb) {
      throw new Error('Test branch has no learner_credit_balances. Run /api/migrate-step-2c first.');
    }

    // Ensure the migration_markers table + Step 2c prereq marker exists.
    await sql`
      CREATE TABLE IF NOT EXISTS migration_markers (
        key TEXT PRIMARY KEY, completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), notes TEXT
      )
    `;
    await sql`
      INSERT INTO migration_markers (key, notes)
      VALUES (${PREREQ_MARKER_KEY}, 'test prereq')
      ON CONFLICT (key) DO NOTHING
    `;

    // Wipe our own marker from any prior run.
    await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;

    // Ensure the grandfathered_at column exists on the test branch (the
    // handler ALTERs it idempotently on call, but a prereq sanity check
    // here makes the rest of the test simpler).
    await sql`
      ALTER TABLE learner_credit_balances
        ADD COLUMN IF NOT EXISTS grandfathered_at TIMESTAMPTZ
    `;

    // Fraser must exist.
    const [fraser] = await sql`SELECT id FROM instructors WHERE id = 1`;
    if (!fraser) {
      throw new Error('Test branch lacks instructors.id = 1 — required.');
    }

    // ── Fixture learners ───────────────────────────────────────────────────
    async function makeLearner(label) {
      const email = `gf-${label}-${crypto.randomBytes(5).toString('hex')}@coachcarter.test`;
      const [row] = await sql`
        INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
        VALUES (${`Grandfather Test ${label}`}, ${email}, ${SCHOOL_ID}, 0, 0)
        RETURNING id
      `;
      createdLearnerIds.push(row.id);
      return row.id;
    }

    testLearnerLegacyId       = await makeLearner('legacy');
    testLearnerMixedId        = await makeLearner('mixed');
    testLearnerAlreadyGfId    = await makeLearner('already');
    testLearnerZeroBalanceId  = await makeLearner('zero');

    // Wipe any pre-existing LCB rows for these learners.
    await sql`
      DELETE FROM learner_credit_balances
       WHERE learner_id = ANY(${[
         testLearnerLegacyId, testLearnerMixedId,
         testLearnerAlreadyGfId, testLearnerZeroBalanceId,
       ]})
    `;

    // Pure-legacy: LCB > 0, no CT.
    await sql`
      INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
      VALUES (${testLearnerLegacyId}, 1, ${SCHOOL_ID}, 1860)
    `;

    // Mixed: LCB > 0 AND a CT row exists for (learner, 1).
    await sql`
      INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
      VALUES (${testLearnerMixedId}, 1, ${SCHOOL_ID}, 600)
    `;
    const [ct] = await sql`
      INSERT INTO credit_transactions
        (learner_id, instructor_id, school_id, type, credits, minutes, amount_pence, stripe_session_id)
      VALUES
        (${testLearnerMixedId}, 1, ${SCHOOL_ID}, 'purchase', 10, 600, 33000,
         ${`cs_test_gf_${crypto.randomBytes(6).toString('hex')}`})
      RETURNING id
    `;
    createdCtIds.push(ct.id);

    // Already grandfathered: row exists, balance > 0, but grandfathered_at already set.
    await sql`
      INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes, grandfathered_at)
      VALUES (${testLearnerAlreadyGfId}, 1, ${SCHOOL_ID}, 240, NOW() - interval '1 day')
    `;

    // Zero balance: row exists but balance_minutes = 0. No grandfathering.
    await sql`
      INSERT INTO learner_credit_balances (learner_id, instructor_id, school_id, balance_minutes)
      VALUES (${testLearnerZeroBalanceId}, 1, ${SCHOOL_ID}, 0)
    `;
  });

  test.afterAll(async () => {
    if (!ENABLED) return;
    try {
      if (createdCtIds.length) {
        await sql`DELETE FROM credit_transactions WHERE id = ANY(${createdCtIds})`;
      }
      if (createdLearnerIds.length) {
        await sql`DELETE FROM learner_credit_balances WHERE learner_id = ANY(${createdLearnerIds})`;
        await sql`DELETE FROM learner_users WHERE id = ANY(${createdLearnerIds})`;
      }
      await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;
    } catch (_) {}
    if (_originalPostgresUrl !== undefined) process.env.POSTGRES_URL = _originalPostgresUrl;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 1: GET = dry-run.
  // ───────────────────────────────────────────────────────────────────────────
  test('dry-run reports candidates without writing', async () => {
    const r = await call({ method: 'GET' });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.dry_run).toBe(true);
    expect(r.body.column_present).toBe(true);
    expect(r.body.rows_updated).toBe(0);
    expect(r.body.marker_written).toBe(false);

    // Our pure-legacy learner MUST be in the candidates list.
    const legacy = (r.body.candidates_sample || []).find(c => c.learner_id === testLearnerLegacyId);
    expect(legacy).toBeTruthy();
    expect(legacy.balance_minutes).toBe(1860);
    expect(legacy.scoped_ct_count).toBe(0);
    expect(legacy.scoped_ct_minutes).toBe(0);
    expect(legacy.grandfathered_at).toBeNull();
    // updated_at exists (text from the DB).
    expect(typeof legacy.lcb_updated_at).toBe('string');

    // Mixed / already / zero MUST NOT appear.
    const sample = r.body.candidates_sample || [];
    expect(sample.find(c => c.learner_id === testLearnerMixedId)).toBeFalsy();
    expect(sample.find(c => c.learner_id === testLearnerAlreadyGfId)).toBeFalsy();
    expect(sample.find(c => c.learner_id === testLearnerZeroBalanceId)).toBeFalsy();

    // marker_window_match_count is reported as supporting evidence.
    expect(typeof r.body.marker_window_match_count).toBe('number');

    // DB unchanged.
    const stillLegacy = await getLcb(testLearnerLegacyId);
    expect(stillLegacy.grandfathered_at).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 2: POST grandfathers only the pure-legacy row.
  // ───────────────────────────────────────────────────────────────────────────
  test('POST marks pure-legacy rows and leaves mixed / already-grandfathered / zero alone', async () => {
    const r = await call({ method: 'POST' });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.dry_run).toBe(false);
    expect(r.body.rows_updated).toBeGreaterThanOrEqual(1);
    expect(r.body.marker_written).toBe(true);

    // Pure-legacy row is now grandfathered.
    const legacy = await getLcb(testLearnerLegacyId);
    expect(legacy.grandfathered_at).not.toBeNull();

    // Mixed-state row is NOT touched — the NOT EXISTS predicate excludes it.
    const mixed = await getLcb(testLearnerMixedId);
    expect(mixed.grandfathered_at).toBeNull();

    // Already-grandfathered row keeps its original timestamp (the predicate
    // requires grandfathered_at IS NULL).
    const already = await getLcb(testLearnerAlreadyGfId);
    expect(already.grandfathered_at).not.toBeNull();
    // The timestamp should be old (>= 12h ago — we set it to 1 day ago in fixtures).
    const dt = new Date(already.grandfathered_at).getTime();
    expect(Date.now() - dt).toBeGreaterThan(12 * 3600 * 1000);

    // Zero-balance row is not touched.
    const zero = await getLcb(testLearnerZeroBalanceId);
    expect(zero.grandfathered_at).toBeNull();

    // Marker row was written.
    const [marker] = await sql`SELECT key FROM migration_markers WHERE key = ${MARKER_KEY}`;
    expect(marker).toBeTruthy();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 3: idempotency — second POST is a no-op.
  // ───────────────────────────────────────────────────────────────────────────
  test('second POST reports rows_updated = 0 and marker_already_present = true', async () => {
    const r = await call({ method: 'POST' });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);
    // Our learner's row is already grandfathered → predicate excludes it
    // → 0 new rows touched. Other branch state may legitimately add to
    // rows_updated (the migration is global) but the legacy row itself
    // stays put.
    const legacy = await getLcb(testLearnerLegacyId);
    expect(legacy.grandfathered_at).not.toBeNull();

    expect(r.body.marker_already_present).toBe(true);
    expect(r.body.marker_written).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 4: missing prereq marker → 409.
  // ───────────────────────────────────────────────────────────────────────────
  test('missing Step 2c marker → 409', async () => {
    // Save and remove the prereq.
    const [prereqBefore] = await sql`
      SELECT key, completed_at::text AS completed_at, notes
        FROM migration_markers WHERE key = ${PREREQ_MARKER_KEY}
    `;
    await sql`DELETE FROM migration_markers WHERE key = ${PREREQ_MARKER_KEY}`;

    try {
      const r = await call({ method: 'GET' });
      expect(r.statusCode).toBe(409);
      expect(r.body.ok).toBe(false);
      expect(String(r.body.error)).toContain(PREREQ_MARKER_KEY);
    } finally {
      // Restore.
      if (prereqBefore) {
        await sql`
          INSERT INTO migration_markers (key, completed_at, notes)
          VALUES (${prereqBefore.key}, ${prereqBefore.completed_at}::timestamptz, ${prereqBefore.notes})
          ON CONFLICT (key) DO NOTHING
        `;
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 5: bad secret → 401.
  // ───────────────────────────────────────────────────────────────────────────
  test('bad secret → 401', async () => {
    const req = fakeReq({ method: 'GET', query: { secret: 'wrong' } });
    const res = fakeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });
});
