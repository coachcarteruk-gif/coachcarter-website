// @ts-check
// Integration tests for api/migrate-step-2-5.js against a real Neon test branch.
//
// What this proves:
//   1. Refuses to run without the Step 2c prereq marker.
//   2. Dry-run reports the current constraint definition + whether already widened.
//   3. POST widens the CHECK constraint to include 'free_trial' + writes marker.
//   4. After widening, INSERT with type='free_trial' succeeds.
//   5. Before widening (and after rollback), INSERT with type='free_trial' fails
//      with a CHECK violation.
//   6. Re-running is idempotent (marker_already_present, no exception).
//
// How to run:
//   CC_TEST_DB=1 npx playwright test migrate-step-2-5.integration

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
    console.warn('[migrate-step-2-5.integration] .env.local load failed:', err.message);
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

// Helper: reset the CHECK constraint to its pre-Step-2.5 (8-value) state.
// Used in beforeAll to put the test branch into the "Step 2c done, 2.5 not
// yet run" shape, regardless of whether prior test runs left it widened.
async function setConstraintToPreStep25State() {
  await sql`ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_type_check`;
  await sql`
    ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_type_check
      CHECK (type IN (
        'purchase',
        'refund',
        'slot_purchase',
        'edit_adjustment',
        'admin_add',
        'admin_remove',
        'referral_bonus',
        'referral_reward'
      ))
  `;
}

test.describe('migrate-step-2-5 — integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL. Point at an isolated branch.');
    }

    _originalPostgresUrl = process.env.POSTGRES_URL;
    process.env.POSTGRES_URL = process.env.POSTGRES_URL_TEST;

    handler = require('../api/migrate-step-2-5');
    MARKER_KEY = handler.MARKER_KEY;

    sql = neon(process.env.POSTGRES_URL_TEST);

    // ── Reset to "Step 2c complete, 2.5 not yet run" shape ─────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS migration_markers (
        key          TEXT PRIMARY KEY,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        notes        TEXT
      )
    `;

    // Force the constraint back to the pre-Step-2.5 shape so the widening
    // has something to do, then clear our own marker. Leave the Step 2c
    // marker alone — it's the prereq we want already present in test 2+.
    await setConstraintToPreStep25State();
    await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;
    await sql`DELETE FROM migration_markers WHERE key = ${STEP_2C_MARKER_KEY}`;

    // Fixture learner for the INSERT-after-widening test.
    const learnerEmail = `step2-5+${crypto.randomBytes(6).toString('hex')}@coachcarter.test`;
    const [l1] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES ('Step2.5 Test', ${learnerEmail}, ${SCHOOL_ID}, 0, 0)
      RETURNING id
    `;
    testLearnerId = l1.id;
  });

  test.afterAll(async () => {
    if (!ENABLED) return;
    try {
      if (createdCreditTxIds.length) {
        try { await sql`DELETE FROM credit_transactions WHERE id = ANY(${createdCreditTxIds})`; } catch (_) {}
      }
      if (testLearnerId) {
        try { await sql`DELETE FROM learner_users WHERE id = ${testLearnerId}`; } catch (_) {}
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
  // 2. Sanity: type='free_trial' is rejected by the pre-Step-2.5 constraint.
  // ───────────────────────────────────────────────────────────────────────────
  test('before widening: INSERT with type=free_trial fails CHECK', async () => {
    let caught = null;
    try {
      await sql`
        INSERT INTO credit_transactions
          (learner_id, type, credits, amount_pence, school_id, source)
        VALUES
          (${testLearnerId}, 'free_trial', 0, 0, ${SCHOOL_ID}, 'free_trial')
      `;
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message).toLowerCase()).toMatch(/check|constraint/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Dry-run reports current constraint shape.
  // ───────────────────────────────────────────────────────────────────────────
  test('dry-run reports current constraint def + already_widened=false', async () => {
    await sql`
      INSERT INTO migration_markers (key, notes)
      VALUES (${STEP_2C_MARKER_KEY}, 'test-fixture')
      ON CONFLICT (key) DO NOTHING
    `;

    const { statusCode, body } = await call({ method: 'GET' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dry_run).toBe(true);
    expect(body.already_widened).toBe(false);
    expect(body.current_constraint_def).toContain('referral_reward');
    expect(body.current_constraint_def).not.toContain('free_trial');
    expect(body.constraint_updated).toBe(false);
    expect(body.marker_written).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. POST widens the constraint + writes marker.
  // ───────────────────────────────────────────────────────────────────────────
  test('POST widens constraint and writes marker', async () => {
    const { statusCode, body } = await call({ method: 'POST' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.constraint_updated).toBe(true);
    expect(body.marker_written).toBe(true);
    expect(body.new_constraint_def).toContain('free_trial');

    // Marker is persisted.
    const [marker] = await sql`
      SELECT key FROM migration_markers WHERE key = ${MARKER_KEY}
    `;
    expect(marker.key).toBe(MARKER_KEY);

    // Verify by introspecting pg_constraint directly.
    const [row] = await sql`
      SELECT pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
        JOIN pg_class      t ON t.oid = c.conrelid
       WHERE t.relname = 'credit_transactions'
         AND c.conname = 'credit_transactions_type_check'
    `;
    expect(row.def).toContain('free_trial');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. After widening: type='free_trial' INSERT succeeds.
  // ───────────────────────────────────────────────────────────────────────────
  test('after widening: INSERT with type=free_trial succeeds', async () => {
    const [tx] = await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, school_id, source, absorbed_by, minutes)
      VALUES
        (${testLearnerId}, 'free_trial', 0, 0, ${SCHOOL_ID}, 'free_trial', 'platform', 60)
      RETURNING id, type, source, amount_pence, credits, minutes, absorbed_by
    `;
    expect(tx.id).toBeGreaterThan(0);
    expect(tx.type).toBe('free_trial');
    expect(tx.source).toBe('free_trial');
    expect(tx.amount_pence).toBe(0);
    expect(tx.credits).toBe(0);
    expect(tx.minutes).toBe(60);
    expect(tx.absorbed_by).toBe('platform');
    createdCreditTxIds.push(tx.id);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5b. The exact ledger shape slots.js handleBookFreeTrial writes is valid.
  // Covers: credit_transactions row + matching booking_credit_sources row,
  // with the same fields and constraints the handler relies on. If any CHECK
  // or FK fails here, the handler would 500 the same way in prod.
  // ───────────────────────────────────────────────────────────────────────────
  test('handleBookFreeTrial ledger shape: credit_transactions + BCS round-trip', async () => {
    const date = new Date(Date.UTC(2031, 5, 15)).toISOString().slice(0, 10);
    const [lt] = await sql`SELECT id FROM lesson_types WHERE slug = 'trial' AND school_id = ${SCHOOL_ID} LIMIT 1`;
    const lessonTypeId = lt?.id || (await sql`SELECT id FROM lesson_types LIMIT 1`)[0]?.id;
    if (!lessonTypeId) throw new Error('Test branch has no lesson_types');

    // The instructor_id must exist — fall back to id=1 (Fraser, grandfather).
    const [ins] = await sql`SELECT id FROM instructors WHERE id = 1`;
    if (!ins) throw new Error('Test branch lacks instructors.id = 1');
    const instructorId = ins.id;

    const durationMins = 30; // typical trial length

    // Booking first (mirrors handler order).
    const [b] = await sql`
      INSERT INTO lesson_bookings
        (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
         created_by, payment_method, lesson_type_id, minutes_deducted,
         school_id, list_price_pence, list_price_source)
      VALUES
        (${testLearnerId}, ${instructorId}, ${date}, '14:00', '14:30', 'scheduled',
         'free_trial_self_serve', 'free', ${lessonTypeId}, 0,
         ${SCHOOL_ID}, 0, 'live_compute_insert')
      RETURNING id
    `;
    const bookingId = b.id;

    // Then the credit_transactions row — exact shape from the handler.
    const [tx] = await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, payment_method,
         minutes, school_id, stripe_fee_pence,
         instructor_id, effective_rate_pence_per_minute, source, absorbed_by)
      VALUES
        (${testLearnerId}, 'free_trial', 0, 0, 'free',
         ${durationMins}, ${SCHOOL_ID}, 0,
         ${instructorId}, 0, 'free_trial', 'platform')
      RETURNING id, type, source, amount_pence, credits, minutes, instructor_id, absorbed_by
    `;
    expect(tx.type).toBe('free_trial');
    expect(tx.source).toBe('free_trial');
    expect(tx.absorbed_by).toBe('platform');
    expect(tx.instructor_id).toBe(instructorId);
    expect(tx.minutes).toBe(durationMins);
    createdCreditTxIds.push(tx.id);

    // Then the BCS row — exact shape from the handler.
    const [bcs] = await sql`
      INSERT INTO booking_credit_sources
        (booking_id, credit_transaction_id, minutes_drawn,
         rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by)
      VALUES
        (${bookingId}, ${tx.id}, ${durationMins},
         0, 0, 0, 'platform')
      RETURNING id, minutes_drawn, contribution_pence, stripe_fee_pence, absorbed_by
    `;
    expect(bcs.minutes_drawn).toBe(durationMins);
    expect(bcs.contribution_pence).toBe(0);
    expect(bcs.stripe_fee_pence).toBe(0);
    expect(bcs.absorbed_by).toBe('platform');

    // Cleanup — BCS rows ON DELETE CASCADE with lesson_bookings, so delete
    // the booking last.
    await sql`DELETE FROM booking_credit_sources WHERE id = ${bcs.id}`;
    await sql`DELETE FROM lesson_bookings WHERE id = ${bookingId}`;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Idempotent re-run.
  // ───────────────────────────────────────────────────────────────────────────
  test('re-running is idempotent — marker_already_present, no error', async () => {
    const { statusCode, body } = await call({ method: 'POST' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.constraint_updated).toBe(true);
    expect(body.marker_already_present).toBe(true);
    expect(body.marker_written).toBe(false);
    expect(body.already_widened).toBe(true);
    expect(body.new_constraint_def).toContain('free_trial');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Other allowed values still work (no regression).
  // ───────────────────────────────────────────────────────────────────────────
  test('existing allowed types still accepted', async () => {
    const [tx] = await sql`
      INSERT INTO credit_transactions
        (learner_id, type, credits, amount_pence, school_id, source)
      VALUES
        (${testLearnerId}, 'admin_add', 1, 0, ${SCHOOL_ID}, 'stripe')
      RETURNING id, type
    `;
    expect(tx.type).toBe('admin_add');
    createdCreditTxIds.push(tx.id);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Genuinely-disallowed types still rejected.
  // ───────────────────────────────────────────────────────────────────────────
  test('still rejects nonsense types', async () => {
    let caught = null;
    try {
      await sql`
        INSERT INTO credit_transactions
          (learner_id, type, credits, amount_pence, school_id, source)
        VALUES
          (${testLearnerId}, 'nonsense_type', 0, 0, ${SCHOOL_ID}, 'stripe')
      `;
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message).toLowerCase()).toMatch(/check|constraint/);
  });
});
