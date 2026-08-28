// Rollback-only bootstrap regression for the monolithic migration.
//
// This suite creates a unique, genuinely empty Postgres schema, applies the
// complete db/migration.sql aggregate, re-applies the moved school foundation,
// and rolls the schema back. It is triple-gated so it can run only against an
// explicitly confirmed non-production test database.

const { test, expect } = require('@playwright/test');
const neonServerless = require('@neondatabase/serverless');
const { Client, neonConfig } = neonServerless;
const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');

(function loadDatabaseEnv() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const allowed = new Set(['POSTGRES_URL', 'POSTGRES_URL_TEST']);
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || !allowed.has(match[1]) || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
})();

const ENABLED = process.env.CC_TEST_DB === '1'
  && !!process.env.POSTGRES_URL_TEST
  && process.env.CC_TEST_DB_CONFIRMED_NON_PRODUCTION === '1';
const EXPECTED_TEST_HOSTNAME = String(
  process.env.CC_TEST_DB_EXPECTED_HOSTNAME
  || 'ep-shy-mode-za3r7anf.c-2.eu-west-2.aws.neon.tech'
).trim();
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'migration.sql'),
  'utf8'
);
const curriculumMigrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'migrations', '054_curriculum_progress_beta.sql'),
  'utf8'
);
const schoolFoundationStart = '-- MULTI-TENANT: SCHOOLS (must precede the first school-scoped FK)';
const schoolFoundationEnd = '-- End multi-tenant school foundation.';
if (
  migrationSql.indexOf(schoolFoundationStart) === -1
  || migrationSql.indexOf(schoolFoundationEnd) === -1
) throw new Error('School foundation markers are missing from db/migration.sql');
const schoolFoundationSql = migrationSql.slice(
  migrationSql.indexOf(schoolFoundationStart),
  migrationSql.indexOf(schoolFoundationEnd) + schoolFoundationEnd.length
);

function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function expectConstraintFailure(client, savepointName, query, values, code) {
  const quotedSavepoint = quoteIdentifier(savepointName);
  await client.query(`SAVEPOINT ${quotedSavepoint}`);
  try {
    await expect(client.query(query, values)).rejects.toMatchObject({ code });
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${quotedSavepoint}`);
    await client.query(`RELEASE SAVEPOINT ${quotedSavepoint}`);
  }
}

function createClientSqlTag(client, statements) {
  return async (strings, ...values) => {
    const text = strings.reduce(
      (query, part, index) => query + (index === 0 ? '' : `$${index}`) + part,
      ''
    );
    statements.push(text);
    const result = await client.query(text, values);
    return result.rows;
  };
}

function loadAdminHandlerWithSql(sql) {
  const neonModulePath = require.resolve('@neondatabase/serverless');
  const adminModulePath = require.resolve('../api/admin');
  const originalNeonModule = require.cache[neonModulePath];
  const originalAdminModule = require.cache[adminModulePath];

  require.cache[neonModulePath] = {
    ...originalNeonModule,
    exports: { ...neonServerless, neon: () => sql },
  };
  delete require.cache[adminModulePath];
  const handler = require(adminModulePath);

  return {
    handler,
    restore() {
      require.cache[neonModulePath] = originalNeonModule;
      if (originalAdminModule) require.cache[adminModulePath] = originalAdminModule;
      else delete require.cache[adminModulePath];
    },
  };
}

function createResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
  };
}

async function callAdminAccess(handler, { adminToken, csrfToken, instructorId }) {
  const req = {
    method: 'POST',
    url: '/api/admin?action=access-instructor-account',
    query: { action: 'access-instructor-account' },
    body: { instructor_id: instructorId },
    headers: {
      cookie: `cc_admin=${encodeURIComponent(adminToken)}; cc_csrf=${csrfToken}`,
      'x-csrf-token': csrfToken,
      'x-forwarded-for': '127.0.0.1',
    },
  };
  const res = createResponse();
  await handler(req, res);
  return res;
}

test.describe.configure({ mode: 'serial' });
test.describe('fresh-schema migration bootstrap', () => {
  test.skip(
    !ENABLED,
    'Requires CC_TEST_DB=1, POSTGRES_URL_TEST, and CC_TEST_DB_CONFIRMED_NON_PRODUCTION=1'
  );

  let client;
  const schemaName = `cc_migration_bootstrap_${process.pid}_${Date.now()}`;
  const quotedSchema = quoteIdentifier(schemaName);
  const isolatedMigrationSql = migrationSql
    .replace(/\bpublic\./g, `${quotedSchema}.`)
    .replace(
      /SET search_path = pg_catalog, public/gi,
      `SET search_path = pg_catalog, ${quotedSchema}`
    );

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (
      process.env.POSTGRES_URL
      && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL
    ) throw new Error('Refusing fresh-schema bootstrap test: test URL equals production URL');
    if (new URL(process.env.POSTGRES_URL_TEST).hostname !== EXPECTED_TEST_HOSTNAME) {
      throw new Error(
        'Refusing fresh-schema bootstrap test: test URL is not the confirmed disposable Neon endpoint'
      );
    }

    if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket === 'function') {
      neonConfig.webSocketConstructor = globalThis.WebSocket;
    }
    const candidateClient = new Client({ connectionString: process.env.POSTGRES_URL_TEST });
    try {
      await candidateClient.connect();
    } catch (error) {
      await candidateClient.end().catch(() => {});
      throw error;
    }
    client = candidateClient;
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${quotedSchema}`);
    await client.query(`SET LOCAL search_path TO ${quotedSchema}, pg_catalog`);
  });

  test.afterAll(async () => {
    if (!client) return;
    try {
      await client.query('ROLLBACK');
      const residualSchema = await client.query(`
        SELECT COUNT(*)::INTEGER AS count
        FROM pg_namespace
        WHERE nspname = $1
      `, [schemaName]);
      expect(residualSchema.rows[0].count).toBe(0);
    } finally {
      await client.end().catch(() => {});
    }
  });

  test('applies the complete aggregate to an empty schema', async () => {
    const before = await client.query(`
      SELECT COUNT(*)::INTEGER AS count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
    `, [schemaName]);
    expect(before.rows[0].count).toBe(0);

    await expect(client.query(isolatedMigrationSql)).resolves.toBeTruthy();

    const relations = await client.query(`
      SELECT
        to_regclass($1) AS schools,
        to_regclass($2) AS busy_blocks,
        to_regclass($3) AS funding_sources,
        to_regclass($4) AS payment_contracts
    `, [
      `${schemaName}.schools`,
      `${schemaName}.instructor_busy_blocks`,
      `${schemaName}.payout_funding_sources`,
      `${schemaName}.lesson_payment_contracts`,
    ]);
    expect(Object.values(relations.rows[0]).every(Boolean)).toBe(true);

    const schoolForeignKey = await client.query(`
      SELECT pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = $1
        AND r.relname = 'instructor_busy_blocks'
        AND c.contype = 'f'
        AND pg_get_constraintdef(c.oid) LIKE '%school_id%'
    `, [schemaName]);
    expect(schoolForeignKey.rowCount).toBe(1);
    expect(schoolForeignKey.rows[0].definition).toContain('REFERENCES schools(id)');

    const isAdminColumn = await client.query(`
      SELECT data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = 'instructors'
        AND column_name = 'is_admin'
    `, [schemaName]);
    expect(isAdminColumn.rowCount).toBe(1);
    expect(isAdminColumn.rows[0]).toEqual({
      data_type: 'boolean',
      column_default: 'false',
    });
  });

  test('creates migration 054 idempotently and enforces curriculum event contracts', async () => {
    const curriculumTables = await client.query(`
      SELECT
        to_regclass($1) AS submissions,
        to_regclass($2) AS ratings,
        to_regclass($3) AS completions,
        to_regclass($4) AS booking_session_uniqueness
    `, [
      `${schemaName}.curriculum_review_submissions`,
      `${schemaName}.curriculum_rating_events`,
      `${schemaName}.curriculum_completion_events`,
      `${schemaName}.uq_driving_sessions_booking`,
    ]);
    expect(Object.values(curriculumTables.rows[0]).every(Boolean)).toBe(true);

    await expect(client.query(curriculumMigrationSql)).resolves.toBeTruthy();

    const suffix = `${process.pid}-${Date.now()}`;
    await client.query(`
      INSERT INTO migration_markers (key, notes)
      VALUES (
        'public_endpoints_tenant_resolved',
        'Rollback-only curriculum constraint fixture'
      )
    `);
    const otherSchool = await client.query(`
      INSERT INTO schools (name, slug)
      VALUES ('Curriculum Constraint School', $1)
      RETURNING id
    `, [`curriculum-constraint-${suffix}`]);
    await client.query(`
      DELETE FROM migration_markers
      WHERE key = 'public_endpoints_tenant_resolved'
    `);
    const learner = await client.query(`
      INSERT INTO learner_users (name, email, school_id)
      VALUES ('Curriculum Constraint Learner', $1, 1)
      RETURNING id
    `, [`curriculum-constraint-learner-${suffix}@example.test`]);
    const instructor = await client.query(`
      INSERT INTO instructors (name, email, school_id, active)
      VALUES ('Curriculum Constraint Instructor', $1, 1, TRUE)
      RETURNING id
    `, [`curriculum-constraint-instructor-${suffix}@example.test`]);
    const otherSchoolInstructor = await client.query(`
      INSERT INTO instructors (name, email, school_id, active)
      VALUES ('Other School Curriculum Instructor', $1, $2, TRUE)
      RETURNING id
    `, [
      `curriculum-constraint-other-${suffix}@example.test`,
      otherSchool.rows[0].id,
    ]);
    const booking = await client.query(`
      INSERT INTO lesson_bookings (
        learner_id, instructor_id, scheduled_date, start_time, end_time, status, school_id
      ) VALUES ($1, $2, CURRENT_DATE + 60, '09:00', '10:00', 'scheduled', 1)
      RETURNING id
    `, [learner.rows[0].id, instructor.rows[0].id]);
    const session = await client.query(`
      INSERT INTO driving_sessions (
        user_id, session_date, duration_minutes, session_type, booking_id, school_id
      ) VALUES ($1, CURRENT_DATE + 60, 60, 'instructor', $2, 1)
      RETURNING id
    `, [learner.rows[0].id, booking.rows[0].id]);
    const submissionValues = [
      session.rows[0].id,
      booking.rows[0].id,
      learner.rows[0].id,
      instructor.rows[0].id,
    ];
    const submission = await client.query(`
      INSERT INTO curriculum_review_submissions (
        school_id, session_id, booking_id, learner_id, instructor_id,
        assessor_role, client_request_id
      ) VALUES (1, $1, $2, $3, $4, 'instructor', 'curriculum-request-1')
      RETURNING id
    `, submissionValues);

    await expectConstraintFailure(
      client,
      'curriculum_bad_submission_role',
      `INSERT INTO curriculum_review_submissions (
        school_id, session_id, booking_id, learner_id, instructor_id,
        assessor_role, client_request_id
      ) VALUES (1, $1, $2, $3, $4, 'admin', 'curriculum-request-2')`,
      submissionValues,
      '23514'
    );
    await expectConstraintFailure(
      client,
      'curriculum_duplicate_request',
      `INSERT INTO curriculum_review_submissions (
        school_id, session_id, booking_id, learner_id, instructor_id,
        assessor_role, client_request_id
      ) VALUES (1, $1, $2, $3, $4, 'instructor', 'curriculum-request-1')`,
      submissionValues,
      '23505'
    );
    await expectConstraintFailure(
      client,
      'curriculum_cross_school_submission',
      `INSERT INTO curriculum_review_submissions (
        school_id, session_id, booking_id, learner_id, instructor_id,
        assessor_role, client_request_id
      ) VALUES (1, $1, $2, $3, $4, 'instructor', 'curriculum-request-3')`,
      [
        session.rows[0].id,
        booking.rows[0].id,
        learner.rows[0].id,
        otherSchoolInstructor.rows[0].id,
      ],
      '23503'
    );

    const ratingValues = [
      submission.rows[0].id,
      session.rows[0].id,
      booking.rows[0].id,
      learner.rows[0].id,
      instructor.rows[0].id,
    ];
    await client.query(`
      INSERT INTO curriculum_rating_events (
        school_id, submission_id, session_id, booking_id, learner_id, instructor_id,
        curriculum_item_key, assessor_role, score
      ) VALUES (1, $1, $2, $3, $4, $5, 'MOVE-01', 'instructor', 2)
    `, ratingValues);
    await expectConstraintFailure(
      client,
      'curriculum_bad_score',
      `INSERT INTO curriculum_rating_events (
        school_id, submission_id, session_id, booking_id, learner_id, instructor_id,
        curriculum_item_key, assessor_role, score
      ) VALUES (1, $1, $2, $3, $4, $5, 'MOVE-02', 'instructor', 4)`,
      ratingValues,
      '23514'
    );
    await expectConstraintFailure(
      client,
      'curriculum_bad_rating_role',
      `INSERT INTO curriculum_rating_events (
        school_id, submission_id, session_id, booking_id, learner_id, instructor_id,
        curriculum_item_key, assessor_role, score
      ) VALUES (1, $1, $2, $3, $4, $5, 'MOVE-02', 'admin', 2)`,
      ratingValues,
      '23514'
    );
    await expectConstraintFailure(
      client,
      'curriculum_completion_as_rating',
      `INSERT INTO curriculum_rating_events (
        school_id, submission_id, session_id, booking_id, learner_id, instructor_id,
        curriculum_item_key, assessor_role, score
      ) VALUES (1, $1, $2, $3, $4, $5, 'SET-01', 'instructor', 2)`,
      ratingValues,
      '23514'
    );
    await expectConstraintFailure(
      client,
      'curriculum_duplicate_rating',
      `INSERT INTO curriculum_rating_events (
        school_id, submission_id, session_id, booking_id, learner_id, instructor_id,
        curriculum_item_key, assessor_role, score
      ) VALUES (1, $1, $2, $3, $4, $5, 'MOVE-01', 'instructor', 3)`,
      ratingValues,
      '23505'
    );
    await expectConstraintFailure(
      client,
      'curriculum_cross_school_rating',
      `INSERT INTO curriculum_rating_events (
        school_id, submission_id, session_id, booking_id, learner_id, instructor_id,
        curriculum_item_key, assessor_role, score
      ) VALUES ($6, $1, $2, $3, $4, $5, 'MOVE-03', 'instructor', 2)`,
      [...ratingValues, otherSchool.rows[0].id],
      '23503'
    );

    const completionValues = [
      learner.rows[0].id,
      instructor.rows[0].id,
      session.rows[0].id,
      booking.rows[0].id,
    ];
    await client.query(`
      INSERT INTO curriculum_completion_events (
        school_id, learner_id, curriculum_item_key, completed_by_instructor_id,
        session_id, booking_id
      ) VALUES (1, $1, 'SET-01', $2, $3, $4)
    `, completionValues);
    await expectConstraintFailure(
      client,
      'curriculum_rating_as_completion',
      `INSERT INTO curriculum_completion_events (
        school_id, learner_id, curriculum_item_key, completed_by_instructor_id,
        session_id, booking_id
      ) VALUES (1, $1, 'MOVE-01', $2, $3, $4)`,
      completionValues,
      '23514'
    );
    await expectConstraintFailure(
      client,
      'curriculum_duplicate_completion',
      `INSERT INTO curriculum_completion_events (
        school_id, learner_id, curriculum_item_key, completed_by_instructor_id,
        session_id, booking_id
      ) VALUES (1, $1, 'SET-01', $2, $3, $4)`,
      completionValues,
      '23505'
    );
  });

  test('creates and enforces the Flexible Hours source/allocation/return ledger', async () => {
    const products = await client.query(`
      SELECT p.slug, p.id AS product_id, v.id AS version_id, v.price_pence, v.content
        FROM package_products p
        JOIN LATERAL (
          SELECT * FROM package_product_versions candidate
           WHERE candidate.school_id = p.school_id AND candidate.product_id = p.id
           ORDER BY candidate.effective_from DESC, candidate.version_number DESC LIMIT 1
        ) v ON TRUE
       WHERE p.school_id = 1 AND p.slug IN ('flexible-10-hours','flexible-15-hours','flexible-30-hours')
       ORDER BY p.slug
    `);
    expect(products.rows.map(row => [row.slug, row.price_pence])).toEqual([
      ['flexible-10-hours', 55000], ['flexible-15-hours', 81000], ['flexible-30-hours', 159000],
    ]);
    const learner = await client.query(`
      INSERT INTO learner_users (name, email, school_id)
      VALUES ('Flexible Integration Learner', 'flexible-ledger@integration.test', 1) RETURNING id
    `);
    const instructor = await client.query(`
      INSERT INTO instructors (name, email, school_id, active)
      VALUES ('Flexible Integration Instructor', 'flexible-instructor@integration.test', 1, TRUE) RETURNING id
    `);
    const fifteen = products.rows.find(row => row.slug === 'flexible-15-hours');
    const attemptId = '018f47b0-1a2b-4c3d-8e9f-0123456789ab';
    await client.query(`
      INSERT INTO flexible_package_purchase_attempts (
        id, school_id, learner_id, product_id, product_version_id, product_slug,
        product_snapshot, amount_pence, currency, total_units, unit_minutes,
        rate_pence_per_unit, customer_terms_version, disclosure_version,
        adult_age_confirmed, terms_accepted, immediate_access_requested,
        stripe_mode, status, client_request_id, idempotency_key,
        stripe_payment_method_configuration_id, stripe_checkout_session_id,
        stripe_payment_intent_id, paid_at
      ) VALUES (
        $1::uuid,1,$2,$3,$4,'flexible-15-hours',$5::jsonb,81000,'GBP',30,30,2700,
        'flexible-hours-v1','flexible-hours-consumer-rights-v1',TRUE,TRUE,TRUE,
        'live','paid','118f47b0-1a2b-4c3d-8e9f-0123456789ab'::uuid,
        'cc-flexible-package-live-018f47b0-1a2b-4c3d-8e9f-0123456789ab',
        'pmc_FlexibleIntegration','cs_live_flexibleintegration','pi_flexibleintegration',NOW()
      )
    `, [attemptId, learner.rows[0].id, fifteen.product_id, fifteen.version_id, JSON.stringify(fifteen.content)]);
    const purchase = await client.query(`
      INSERT INTO flexible_package_purchases (
        school_id, learner_id, attempt_id, product_id, product_version_id,
        product_slug, product_snapshot, amount_pence, currency, total_units,
        unit_minutes, rate_pence_per_unit, customer_terms_version,
        stripe_checkout_session_id, stripe_payment_intent_id, paid_at
      ) VALUES (1,$1,$2::uuid,$3,$4,'flexible-15-hours',$5::jsonb,81000,'GBP',30,30,2700,
        'flexible-hours-v1','cs_live_flexibleintegration','pi_flexibleintegration',NOW()) RETURNING id
    `, [learner.rows[0].id, attemptId, fifteen.product_id, fifteen.version_id, JSON.stringify(fifteen.content)]);
    const source = await client.query(`
      INSERT INTO flexible_package_sources (
        school_id, learner_id, purchase_id, product_version_id, initial_units,
        unit_minutes, rate_pence_per_unit, original_value_pence, available_at
      ) VALUES (1,$1,$2,$3,30,30,2700,81000,NOW()) RETURNING id
    `, [learner.rows[0].id, purchase.rows[0].id, fifteen.version_id]);
    const booking = await client.query(`
      INSERT INTO lesson_bookings (
        learner_id, instructor_id, scheduled_date, start_time, end_time,
        status, school_id, payment_method, minutes_deducted,
        list_price_pence, list_price_source, stripe_fee_pence, stripe_fee_source,
        flexible_package_booking_request_id
      ) VALUES ($1,$2,CURRENT_DATE + 30,'09:00','10:00','scheduled',1,
        'flexible_package',60,5400,'flexible_package_frozen_rate',0,'platform_absorbed_package_fee',
        '218f47b0-1a2b-4c3d-8e9f-0123456789ab'::uuid)
      RETURNING id
    `, [learner.rows[0].id, instructor.rows[0].id]);
    await client.query('SAVEPOINT flexible_duplicate_booking_request');
    await expect(client.query(`
      INSERT INTO lesson_bookings (
        learner_id, instructor_id, scheduled_date, start_time, end_time,
        status, school_id, payment_method, minutes_deducted,
        list_price_pence, list_price_source, stripe_fee_pence, stripe_fee_source,
        flexible_package_booking_request_id
      ) VALUES ($1,$2,CURRENT_DATE + 31,'11:00','12:00','scheduled',1,
        'flexible_package',60,5400,'flexible_package_frozen_rate',0,'platform_absorbed_package_fee',
        '218f47b0-1a2b-4c3d-8e9f-0123456789ab'::uuid)
    `, [learner.rows[0].id, instructor.rows[0].id])).rejects.toMatchObject({ code: '23505' });
    await client.query('ROLLBACK TO SAVEPOINT flexible_duplicate_booking_request');
    const allocation = await client.query(`
      INSERT INTO flexible_package_booking_allocations (
        school_id, learner_id, source_id, booking_id, instructor_id,
        units_allocated, unit_minutes, rate_pence_per_unit, contribution_pence
      ) VALUES (1,$1,$2,$3,$4,2,30,2700,5400) RETURNING id
    `, [learner.rows[0].id, source.rows[0].id, booking.rows[0].id, instructor.rows[0].id]);
    const spent = await client.query(`SELECT remaining_units FROM flexible_package_balances WHERE school_id = 1 AND learner_id = $1`, [learner.rows[0].id]);
    expect(spent.rows[0].remaining_units).toBe(28);
    await client.query('SAVEPOINT flexible_partial_return');
    await expect(client.query(`
      INSERT INTO flexible_package_allocation_returns (
        school_id, allocation_id, booking_id, units_returned, reason
      ) VALUES (1,$1,$2,1,'learner_cancelled_48h_plus')
    `, [allocation.rows[0].id, booking.rows[0].id])).rejects.toMatchObject({ code: '23514' });
    await client.query('ROLLBACK TO SAVEPOINT flexible_partial_return');
    await client.query(`
      INSERT INTO flexible_package_allocation_returns (
        school_id, allocation_id, booking_id, units_returned, reason
      ) VALUES (1,$1,$2,2,'learner_cancelled_48h_plus')
    `, [allocation.rows[0].id, booking.rows[0].id]);
    const returned = await client.query(`SELECT remaining_units FROM flexible_package_balances WHERE school_id = 1 AND learner_id = $1`, [learner.rows[0].id]);
    expect(returned.rows[0].remaining_units).toBe(30);
    await client.query('SAVEPOINT flexible_double_return');
    await expect(client.query(`
      INSERT INTO flexible_package_allocation_returns (
        school_id, allocation_id, booking_id, units_returned, reason
      ) VALUES (1,$1,$2,2,'learner_cancelled_48h_plus')
    `, [allocation.rows[0].id, booking.rows[0].id])).rejects.toMatchObject({ code: '23505' });
    await client.query('ROLLBACK TO SAVEPOINT flexible_double_return');
  });

  test('keeps the moved school foundation idempotent', async () => {
    const before = await client.query('SELECT COUNT(*)::INTEGER AS count FROM schools');
    await expect(client.query(schoolFoundationSql)).resolves.toBeTruthy();
    const after = await client.query('SELECT COUNT(*)::INTEGER AS count FROM schools');
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  test('supports audited same-school admin access without passwords or login codes', async () => {
    const originalJwtSecret = process.env.JWT_SECRET;
    const originalStripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const originalStripeMode = process.env.STRIPE_MODE;
    const jwtSecret = 'fresh-schema-admin-access-test-secret';
    const csrfToken = 'fresh-schema-admin-access-csrf-token';
    const statements = [];
    const sql = createClientSqlTag(client, statements);
    let loadedAdmin;

    process.env.JWT_SECRET = jwtSecret;
    process.env.STRIPE_SECRET_KEY = 'sk_test_fresh_schema_admin_access_fixture';
    process.env.STRIPE_MODE = 'test';
    try {
      const suffix = `${process.pid}-${Date.now()}`;
      await client.query(`
        INSERT INTO migration_markers (key, notes)
        VALUES (
          'public_endpoints_tenant_resolved',
          'Rollback-only fresh-schema cross-school access fixture'
        )
      `);
      const secondSchool = await client.query(`
        INSERT INTO schools (name, slug)
        VALUES ('Fresh Schema Other School', $1)
        RETURNING id
      `, [`fresh-schema-other-${suffix}`]);
      const otherSchoolId = secondSchool.rows[0].id;

      const admin = await client.query(`
        INSERT INTO admin_users (name, email, password_hash, role, active, school_id)
        VALUES ('Fresh Schema Admin', $1, 'admin-password-fixture', 'admin', TRUE, 1)
        RETURNING id, email, school_id
      `, [`fresh-schema-admin-${suffix}@example.test`]);

      const sameSchoolInstructor = await client.query(`
        INSERT INTO instructors (
          name, email, active, school_id, password_hash, must_change_password
        ) VALUES (
          'Fresh Schema Instructor', $1, TRUE, 1,
          'instructor-password-fixture', TRUE
        )
        RETURNING id
      `, [`fresh-schema-instructor-${suffix}@example.test`]);
      const sameSchoolInstructorId = sameSchoolInstructor.rows[0].id;

      const otherSchoolInstructor = await client.query(`
        INSERT INTO instructors (name, email, active, school_id, password_hash)
        VALUES ('Other School Instructor', $1, TRUE, $2, 'other-password-fixture')
        RETURNING id
      `, [
        `fresh-schema-other-instructor-${suffix}@example.test`,
        otherSchoolId,
      ]);
      const otherSchoolInstructorId = otherSchoolInstructor.rows[0].id;

      await client.query(`
        INSERT INTO magic_link_tokens (
          token, email, email_code, role, purpose, school_id, expires_at
        ) VALUES (
          $1, $2, '123456', 'instructor', 'login', 1, NOW() + INTERVAL '10 minutes'
        )
      `, [
        `fresh-schema-login-token-${suffix}`,
        `fresh-schema-instructor-${suffix}@example.test`,
      ]);

      const adminToken = jwt.sign({
        id: admin.rows[0].id,
        email: admin.rows[0].email,
        role: 'admin',
        school_id: admin.rows[0].school_id,
      }, jwtSecret, { expiresIn: '10m' });

      loadedAdmin = loadAdminHandlerWithSql(sql);
      const success = await callAdminAccess(loadedAdmin.handler, {
        adminToken,
        csrfToken,
        instructorId: sameSchoolInstructorId,
      });
      expect(success.statusCode).toBe(200);
      expect(success.body.success).toBe(true);
      expect(success.body.instructor.id).toBe(sameSchoolInstructorId);
      expect(success.body.instructor.is_admin).toBe(false);
      expect(success.body.impersonation.active).toBe(true);
      expect(JSON.stringify(success.body)).not.toMatch(/password|email_code|login_code/i);
      expect(success.getHeader('Set-Cookie')).toHaveLength(2);

      const crossSchool = await callAdminAccess(loadedAdmin.handler, {
        adminToken,
        csrfToken,
        instructorId: otherSchoolInstructorId,
      });
      expect(crossSchool.statusCode).toBe(404);
      expect(crossSchool.body).toEqual({ error: 'Instructor not found' });
      expect(crossSchool.getHeader('Set-Cookie')).toBeUndefined();

      const audit = await client.query(`
        SELECT COUNT(*)::INTEGER AS count
        FROM audit_log
        WHERE school_id = 1
          AND admin_id = $1
          AND action = 'admin.instructor_access_start'
          AND target_type = 'instructor'
          AND target_id = $2
      `, [admin.rows[0].id, String(sameSchoolInstructorId)]);
      expect(audit.rows[0].count).toBe(1);

      const crossSchoolAudit = await client.query(`
        SELECT COUNT(*)::INTEGER AS count
        FROM audit_log
        WHERE action = 'admin.instructor_access_start'
          AND target_id = $1
      `, [String(otherSchoolInstructorId)]);
      expect(crossSchoolAudit.rows[0].count).toBe(0);

      const passwordState = await client.query(`
        SELECT COUNT(*)::INTEGER AS count
        FROM instructors
        WHERE id = $1
          AND password_hash = 'instructor-password-fixture'
          AND must_change_password = TRUE
      `, [sameSchoolInstructorId]);
      expect(passwordState.rows[0].count).toBe(1);

      const unusedLoginCodes = await client.query(`
        SELECT COUNT(*)::INTEGER AS count
        FROM magic_link_tokens
        WHERE role = 'instructor'
          AND purpose = 'login'
          AND school_id = 1
          AND used = FALSE
      `);
      expect(unusedLoginCodes.rows[0].count).toBe(1);

      expect(statements.join('\n')).not.toMatch(
        /password_hash|must_change_password|magic_link_tokens|email_code|instructor_login_tokens/i
      );
    } finally {
      if (loadedAdmin) loadedAdmin.restore();
      if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = originalJwtSecret;
      if (originalStripeSecretKey === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = originalStripeSecretKey;
      if (originalStripeMode === undefined) delete process.env.STRIPE_MODE;
      else process.env.STRIPE_MODE = originalStripeMode;
    }
  });
});
