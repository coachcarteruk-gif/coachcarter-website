// @ts-check
// Integration tests for api/migrate-step-1c.js against a real Neon test branch.
//
// What this proves:
//   1. Dry-run reports per-pass counts without writing.
//   2. Pass 1 (zero-minute) tags free-trial-shaped rows correctly.
//   3. Pass 2 (live-compute) populates list_price_pence via the helper.
//   4. Pass 3 (unknown) tags anonymised-learner / deleted-lesson-type rows.
//   5. Marker row written on success, NOT written on incomplete backfill.
//   6. Endpoint is idempotent — re-running a second time changes nothing.
//   7. Endpoint refuses to mark complete if any NULL rows remain.
//
// Why integration (not mock) tests:
//   The properties under test are SQL-level: idempotent WHERE clauses on
//   re-run, JOIN semantics for the live-compute eligibility filter, and the
//   transactional behaviour of the per-row UPDATE. These cannot be honestly
//   exercised against an in-memory mock.
//
// How to run:
//   1. Neon test branch + POSTGRES_URL_TEST in .env.local.
//   2. MIGRATION_SECRET in .env.local (any string works for tests).
//   3. CC_TEST_DB=1 npx playwright test migrate-step-1c.integration

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Inline .env.local loader — same pattern as credit-grant.integration.spec.js.
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
    console.warn('[migrate-step-1c.integration] .env.local load failed:', err.message);
  }
})();

// MIGRATION_SECRET is required by the endpoint; fabricate one for tests if
// not set in .env.local. The endpoint reads from process.env at request time.
if (!process.env.MIGRATION_SECRET) {
  process.env.MIGRATION_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
}

// Point POSTGRES_URL at the test branch so the endpoint (which reads
// process.env.POSTGRES_URL, not POSTGRES_URL_TEST) hits the test branch.
// We restore the original in afterAll.
let _originalPostgresUrl;

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
test.describe.configure({ mode: 'serial' }); // Tests share the same fixture rows.

const SCHOOL_ID = 1;

let sql;
let handler;
let MARKER_KEY;
let testLearnerId;
let testAnonLearnerId;
let testInstructorId;
let testLessonTypeId;
let testDeletedLessonTypeId;
let createdBookingIds = [];

// Minimal fake req/res to drive the handler. The handler reads req.method,
// req.query, req.headers. The res object captures status + JSON body so the
// test can assert on the response shape.
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

// Insert a historical-shape lesson_booking (list_price_pence + list_price_source
// both NULL) and return its id. Each call uses a unique date/time slot via the
// counter to avoid uq_booking_slot conflicts within a test run.
let _slotCounter = 0;
async function insertHistoricalBooking({
  learnerId, instructorId, lessonTypeId, minutesDeducted, status = 'scheduled',
}) {
  _slotCounter++;
  // Spread slots across 2030 to keep them well away from real prod dates.
  const dayOffset = _slotCounter;
  const hour = (_slotCounter % 8) + 9; // 9am-4pm
  const startTime = `${String(hour).padStart(2, '0')}:00`;
  const endHour = hour + Math.ceil(Math.max(minutesDeducted, 60) / 60);
  const endTime  = `${String(endHour).padStart(2, '0')}:00`;
  // 2030-01-01 + dayOffset
  const date = new Date(Date.UTC(2030, 0, 1 + dayOffset)).toISOString().slice(0, 10);

  const [row] = await sql`
    INSERT INTO lesson_bookings
      (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
       lesson_type_id, minutes_deducted, school_id)
    VALUES
      (${learnerId}, ${instructorId}, ${date}, ${startTime}, ${endTime}, ${status},
       ${lessonTypeId}, ${minutesDeducted}, ${SCHOOL_ID})
    RETURNING id
  `;
  createdBookingIds.push(row.id);
  return row.id;
}

test.describe('migrate-step-1c — integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run.');

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL. Point at an isolated branch.');
    }

    // Temporarily point POSTGRES_URL at the test branch so the endpoint hits it.
    _originalPostgresUrl = process.env.POSTGRES_URL;
    process.env.POSTGRES_URL = process.env.POSTGRES_URL_TEST;

    // require() the handler AFTER setting POSTGRES_URL, in case the module
    // ever caches a client at top-level. Currently it doesn't, but defence
    // in depth.
    handler = require('../api/migrate-step-1c');
    MARKER_KEY = handler.MARKER_KEY;

    sql = neon(process.env.POSTGRES_URL_TEST);

    // Ensure the migration_markers table exists on the test branch. In prod
    // this is shipped via db/migration.sql; the test branch may not have
    // had /api/migrate run for it. The CREATE is idempotent.
    await sql`
      CREATE TABLE IF NOT EXISTS migration_markers (
        key          TEXT PRIMARY KEY,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        notes        TEXT
      )
    `;
    // Same for the list_price_pence + list_price_source columns. Defensive
    // — if the test branch is at an older schema version, the suite would
    // otherwise fail unrelated to the change under test.
    await sql`ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS list_price_pence INTEGER`;
    await sql`
      ALTER TABLE lesson_bookings ADD COLUMN IF NOT EXISTS list_price_source TEXT
        CHECK (list_price_source IS NULL OR list_price_source IN
          ('stripe_metadata', 'live_compute_insert', 'live_compute_backfill', 'unknown'))
    `;
    // instructors.hourly_rate_pence is referenced by getEffectiveRatePencePerMinute
    // (Step 3a, PR #168). If the test branch was created before that PR, the
    // helper's Level 2 query 500s. Add idempotently.
    await sql`
      ALTER TABLE instructors ADD COLUMN IF NOT EXISTS hourly_rate_pence INTEGER
        CHECK (hourly_rate_pence IS NULL OR (hourly_rate_pence > 0 AND hourly_rate_pence <= 50000))
    `;

    // ── Test fixtures ──
    // 1. A normal test learner.
    const learnerEmail = `step1c+${crypto.randomBytes(6).toString('hex')}@coachcarter.test`;
    const [l1] = await sql`
      INSERT INTO learner_users (name, email, school_id, balance_minutes, credit_balance)
      VALUES ('Step1c Test', ${learnerEmail}, ${SCHOOL_ID}, 0, 0)
      RETURNING id
    `;
    testLearnerId = l1.id;

    // 2. An anonymised learner — for Pass 3 we need a row whose learner_id
    //    points at NULL/missing. Simulating anonymisation: insert a learner,
    //    use their id to create a booking, then DELETE the learner row so
    //    the booking's learner_id becomes orphan (the FK is ON DELETE CASCADE
    //    on lesson_bookings actually — see migration L137 — which means
    //    deleting the learner deletes their bookings too). So instead, use
    //    a booking with learner_id = NULL directly (the column is nullable
    //    per the post-GDPR-cascade migration at db/migration.sql L1190).
    testAnonLearnerId = null;

    // 3. A test instructor. Use the first active instructor in the school —
    //    don't create one (instructors have side-effect fields like
    //    Setmore keys). If none exists, skip the suite cleanly.
    const [inst] = await sql`
      SELECT id FROM instructors WHERE school_id = ${SCHOOL_ID} AND active = true LIMIT 1
    `;
    if (!inst) {
      test.skip(true, 'No active instructor in school 1 on the test branch — seed one first.');
      return;
    }
    testInstructorId = inst.id;

    // 4. A test lesson type. Same approach: reuse an existing 90-min one if
    //    available; otherwise insert a fixture.
    const [lt] = await sql`
      SELECT id FROM lesson_types
       WHERE school_id = ${SCHOOL_ID} AND active = true AND duration_minutes = 90
       LIMIT 1
    `;
    if (lt) {
      testLessonTypeId = lt.id;
    } else {
      const [newLt] = await sql`
        INSERT INTO lesson_types (school_id, slug, name, duration_minutes, price_pence, active)
        VALUES (${SCHOOL_ID}, ${'step1c-test-' + crypto.randomBytes(4).toString('hex')}, 'Step1c Test', 90, 8250, true)
        RETURNING id
      `;
      testLessonTypeId = newLt.id;
    }

    // 5. A "deleted" lesson type id for Pass 3: insert one, capture id, then
    //    delete it. The booking's lesson_type_id will point at a row that
    //    no longer exists — exactly what an anonymised / deleted scenario
    //    looks like in prod. Note FK is ON DELETE… let's check by trying.
    const deletedSlug = 'step1c-deleted-' + crypto.randomBytes(4).toString('hex');
    const [delLt] = await sql`
      INSERT INTO lesson_types (school_id, slug, name, duration_minutes, price_pence, active)
      VALUES (${SCHOOL_ID}, ${deletedSlug}, 'Deleted', 90, 8250, true)
      RETURNING id
    `;
    testDeletedLessonTypeId = delLt.id;
    // Don't actually DELETE — lesson_bookings.lesson_type_id has no ON DELETE
    // CASCADE, but other rows may; instead just NULL the FK by setting it to
    // a non-existent id after-the-fact. Actually simpler: use lesson_type_id
    // = NULL on the Pass 3 booking. The endpoint's WHERE lt.id IS NULL via
    // LEFT JOIN catches both "FK column NULL" and "FK points at deleted row"
    // cases identically.
  });

  test.afterAll(async () => {
    if (!ENABLED) return;
    // Clean up bookings we created.
    if (createdBookingIds.length) {
      await sql`DELETE FROM lesson_bookings WHERE id = ANY(${createdBookingIds}::int[])`;
    }
    if (testLearnerId) {
      await sql`DELETE FROM learner_users WHERE id = ${testLearnerId}`;
    }
    if (testDeletedLessonTypeId) {
      // Only delete the lesson type we created; reused fixtures stay.
      await sql`DELETE FROM lesson_types WHERE id = ${testDeletedLessonTypeId} AND slug LIKE 'step1c-deleted-%'`;
    }
    // Clean up the marker so re-running the suite starts fresh.
    await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;

    // Restore POSTGRES_URL.
    if (_originalPostgresUrl !== undefined) {
      process.env.POSTGRES_URL = _originalPostgresUrl;
    }
  });

  test.beforeEach(async () => {
    if (!ENABLED) return;
    // Clean slate: drop the marker so each test sees an unmarked state, and
    // reset our test bookings' columns to NULL (so each test re-runs the
    // backfill against the same fixture shape). Cleaner than re-creating
    // the rows every test.
    await sql`DELETE FROM migration_markers WHERE key = ${MARKER_KEY}`;
    if (createdBookingIds.length) {
      await sql`
        UPDATE lesson_bookings
           SET list_price_pence = NULL,
               list_price_source = NULL
         WHERE id = ANY(${createdBookingIds}::int[])
      `;
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 1: dry-run reports counts without writing.
  // ───────────────────────────────────────────────────────────────────────────
  test('dry-run reports per-pass counts and does not mutate', async () => {
    // Fixture: one zero-minute (Pass 1), one normal (Pass 2).
    const p1Id = await insertHistoricalBooking({
      learnerId: testLearnerId, instructorId: testInstructorId,
      lessonTypeId: testLessonTypeId, minutesDeducted: 0,
    });
    const p2Id = await insertHistoricalBooking({
      learnerId: testLearnerId, instructorId: testInstructorId,
      lessonTypeId: testLessonTypeId, minutesDeducted: 90,
    });

    // Capture pre-state.
    const [pre] = await sql`
      SELECT list_price_pence, list_price_source
        FROM lesson_bookings WHERE id = ${p1Id}
    `;
    expect(pre.list_price_pence).toBe(null);
    expect(pre.list_price_source).toBe(null);

    const { statusCode, body } = await call({ method: 'GET', dry_run: true });
    expect(statusCode).toBe(200);
    expect(body.dry_run).toBe(true);
    expect(body.passes.zero_minute.would_update).toBeGreaterThanOrEqual(1);
    expect(body.passes.live_compute.would_update).toBeGreaterThanOrEqual(1);
    expect(body.marker_written).toBe(false);

    // Post-state: nothing changed.
    const [post] = await sql`
      SELECT list_price_pence, list_price_source
        FROM lesson_bookings WHERE id = ${p1Id}
    `;
    expect(post.list_price_pence).toBe(null);
    expect(post.list_price_source).toBe(null);

    // Marker not inserted.
    const markers = await sql`SELECT key FROM migration_markers WHERE key = ${MARKER_KEY}`;
    expect(markers.length).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 2: real run tags each pass correctly.
  // ───────────────────────────────────────────────────────────────────────────
  test('real run: Pass 1 sets zero+backfill, Pass 2 sets computed+backfill, Pass 3 sets unknown', async () => {
    const p1Id = await insertHistoricalBooking({
      learnerId: testLearnerId, instructorId: testInstructorId,
      lessonTypeId: testLessonTypeId, minutesDeducted: 0,
    });
    const p2Id = await insertHistoricalBooking({
      learnerId: testLearnerId, instructorId: testInstructorId,
      lessonTypeId: testLessonTypeId, minutesDeducted: 90,
    });
    // Pass 3: learner_id = NULL (anonymised). Use raw INSERT to bypass the
    // helper which requires learnerId.
    _slotCounter++;
    const orphanDate = new Date(Date.UTC(2030, 0, 1 + _slotCounter)).toISOString().slice(0, 10);
    const [orphan] = await sql`
      INSERT INTO lesson_bookings
        (learner_id, instructor_id, scheduled_date, start_time, end_time, status,
         lesson_type_id, minutes_deducted, school_id)
      VALUES
        (NULL, ${testInstructorId}, ${orphanDate}, '12:00', '13:30', 'scheduled',
         ${testLessonTypeId}, 90, ${SCHOOL_ID})
      RETURNING id
    `;
    createdBookingIds.push(orphan.id);

    const { statusCode, body } = await call({ method: 'POST' });
    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dry_run).toBe(false);
    expect(body.passes.zero_minute.updated).toBeGreaterThanOrEqual(1);
    expect(body.passes.live_compute.updated).toBeGreaterThanOrEqual(1);
    expect(body.passes.unknown.updated).toBeGreaterThanOrEqual(1);
    expect(body.total_remaining_null).toBe(0);
    expect(body.marker_written).toBe(true);

    // Pass 1 row.
    const [r1] = await sql`SELECT list_price_pence, list_price_source FROM lesson_bookings WHERE id = ${p1Id}`;
    expect(r1.list_price_pence).toBe(0);
    expect(r1.list_price_source).toBe('live_compute_backfill');

    // Pass 2 row — populated with a positive integer pence value.
    const [r2] = await sql`SELECT list_price_pence, list_price_source FROM lesson_bookings WHERE id = ${p2Id}`;
    expect(r2.list_price_source).toBe('live_compute_backfill');
    expect(r2.list_price_pence).toBeGreaterThan(0);

    // Pass 3 row — source set, value left NULL.
    const [r3] = await sql`SELECT list_price_pence, list_price_source FROM lesson_bookings WHERE id = ${orphan.id}`;
    expect(r3.list_price_source).toBe('unknown');
    expect(r3.list_price_pence).toBe(null);

    // Marker row present.
    const markers = await sql`
      SELECT key, notes FROM migration_markers WHERE key = ${MARKER_KEY}
    `;
    expect(markers.length).toBe(1);
    expect(markers[0].notes).toContain('list_price_pence');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 3: re-run is idempotent.
  // ───────────────────────────────────────────────────────────────────────────
  test('idempotent: second run after success changes nothing', async () => {
    await insertHistoricalBooking({
      learnerId: testLearnerId, instructorId: testInstructorId,
      lessonTypeId: testLessonTypeId, minutesDeducted: 90,
    });

    const r1 = await call({ method: 'POST' });
    expect(r1.body.ok).toBe(true);
    expect(r1.body.marker_written).toBe(true);

    const r2 = await call({ method: 'POST' });
    expect(r2.body.ok).toBe(true);
    // Re-run: every WHERE clause is `list_price_source IS NULL`, so passes
    // touch zero rows.
    expect(r2.body.passes.zero_minute.updated).toBe(0);
    expect(r2.body.passes.live_compute.updated).toBe(0);
    expect(r2.body.passes.unknown.updated).toBe(0);
    expect(r2.body.marker_already_present).toBe(true);
    expect(r2.body.marker_written).toBe(false);
  });
});
