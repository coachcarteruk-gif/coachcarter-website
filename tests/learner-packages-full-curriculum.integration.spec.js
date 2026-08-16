// Disposable-schema integration coverage for the revised Full Curriculum
// matching and programme-start workflow.
//
// Run only against an explicitly confirmed non-production database:
//   CC_TEST_DB=1 CC_TEST_DB_CONFIRMED_NON_PRODUCTION=1 \
//     CC_TEST_DB_EXPECTED_HOSTNAME=<confirmed-disposable-endpoint> npm.cmd test -- \
//     tests/learner-packages-full-curriculum.integration.spec.js

'use strict';

const { test, expect } = require('@playwright/test');
const neonServerless = require('@neondatabase/serverless');
const { Client, neonConfig } = neonServerless;
const crypto = require('crypto');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { deleteLearnerCascade } = require('../api/_gdpr');
const { requestProgrammeTermination } = require('../api/_full-curriculum-refunds');

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

function normaliseConnectionString(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

const testDatabaseUrl = normaliseConnectionString(process.env.POSTGRES_URL_TEST);
const configuredAppUrl = normaliseConnectionString(process.env.POSTGRES_URL);
const ENABLED = process.env.CC_TEST_DB === '1'
  && !!testDatabaseUrl
  && process.env.CC_TEST_DB_CONFIRMED_NON_PRODUCTION === '1';
const EXPECTED_TEST_HOSTNAME = String(
  process.env.CC_TEST_DB_EXPECTED_HOSTNAME
  || 'ep-royal-dream-abnzo838.eu-west-2.aws.neon.tech'
).trim();

if (ENABLED && new URL(testDatabaseUrl).hostname !== EXPECTED_TEST_HOSTNAME) {
  throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST is not the confirmed disposable Neon test branch.');
}

if (ENABLED && configuredAppUrl && configuredAppUrl === testDatabaseUrl) {
  throw new Error(
    'REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL. '
    + 'Point POSTGRES_URL_TEST at an isolated non-production database.'
  );
}

process.env.JWT_SECRET = process.env.JWT_SECRET || 'full-curriculum-integration-secret';

const aggregateMigrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'migration.sql'),
  'utf8'
);
const packageMigrationMarker = '-- Learner Packages Phase 1: inert, versioned catalogue only.';
const packageMigrationIndex = aggregateMigrationSql.indexOf(packageMigrationMarker);
if (packageMigrationIndex === -1) {
  throw new Error('Learner Packages migration marker is missing from db/migration.sql');
}
const baseMigrationSql = aggregateMigrationSql.slice(0, packageMigrationIndex);
const packageMigrationFiles = [
  '044_learner_packages_catalogue.sql',
  '045_learner_packages_payment_foundation.sql',
  '046_full_curriculum_foundation.sql',
  '047_full_curriculum_matching.sql',
  '048_full_curriculum_consumer_rights.sql',
  '049_full_curriculum_controlled_pilot.sql',
];
const packageMigrations = packageMigrationFiles.map((file) => ({
  file,
  sql: fs.readFileSync(path.resolve(__dirname, '..', 'db', 'migrations', file), 'utf8'),
}));

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function createClientSqlTag(client) {
  return async (strings, ...values) => {
    const text = strings.reduce(
      (query, part, index) => query + (index === 0 ? '' : `$${index}`) + part,
      ''
    );
    const result = await client.query(text, values);
    return result.rows;
  };
}

function createTransactionalGdprSqlTag(client) {
  const execute = async ({ text, values }) => {
    if (/has_refund_events/.test(text)) {
      return [{ has_refund_events: true, has_refund_event_lines: true }];
    }
    if (/has_learner_broadcast_recipients/.test(text)) {
      return [{ has_learner_broadcast_recipients: true }];
    }
    if (/has_package_purchase_attempts/.test(text)) {
      return [{ has_package_purchase_attempts: true }];
    }
    if (/has_purchases/.test(text)) {
      return [{ has_purchases: true, has_enrolments: true, has_test_bookings: true }];
    }
    if (/has_matching/.test(text)) {
      return [{ has_matching: true, has_assignments: true, has_availability: true, has_windows: true }];
    }
    return (await client.query(text, values)).rows;
  };
  const sql = (strings, ...values) => {
    const text = strings.reduce(
      (query, part, index) => query + (index === 0 ? '' : `$${index}`) + part,
      ''
    );
    const query = { text, values };
    query.then = (resolve, reject) => execute(query).then(resolve, reject);
    return query;
  };
  sql.transaction = async (queries) => {
    await client.query('BEGIN');
    try {
      const results = [];
      for (const query of queries) results.push((await client.query(query.text, query.values)).rows);
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  };
  return sql;
}

function createResponse() {
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
  };
}

function authHeaders({ role, actorId, schoolId, isAdmin = false }) {
  const csrf = 'c'.repeat(64);
  const token = jwt.sign({
    id: actorId,
    email: `${role}-${actorId}@full-curriculum.integration.test`,
    role,
    school_id: schoolId,
    isAdmin,
  }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const cookieName = role === 'instructor' ? 'cc_instructor' : 'cc_admin';
  return {
    cookie: `${cookieName}=${token}; cc_csrf=${csrf}`,
    'x-csrf-token': csrf,
    'x-forwarded-for': '127.0.0.1',
  };
}

function isoDateAfterDays(days) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

async function insertConsumerContractEvidence(client, {
  attemptId,
  schoolId,
  learnerId,
  customerTermsVersion,
  earlyStartRequested = true,
}) {
  const digest = 'a'.repeat(64);
  const startText = earlyStartRequested
    ? 'Please begin matching and programme services during my 14-day cancellation period.'
    : 'Do not begin matching or programme services until my 14-day cancellation period has ended.';
  await client.query(`
    INSERT INTO full_curriculum_consumer_contract_evidence (
      school_id, attempt_id, learner_id, customer_terms_version,
      policy_version, disclosure_version, refund_calculation_version,
      disclosure_snapshot, disclosure_sha256, checkout_acknowledgement_sha256,
      early_start_requested, start_request_text, start_request_sha256,
      adult_age_confirmed, actor_type, actor_id, acknowledged_at
    ) VALUES (
      $1, $2::uuid, $3, $4,
      'full-curriculum-consumer-rights-v1',
      'full-curriculum-checkout-disclosure-v1',
      'full-curriculum-refund-v1',
      '{"integration_fixture":true}'::jsonb, $5, $5,
      $6, $7, $5, TRUE, 'learner', $3, NOW() - INTERVAL '2 days'
    )
  `, [schoolId, attemptId, learnerId, customerTermsVersion, digest, earlyStartRequested, startText]);
}

async function insertDurableConfirmationEvent(client, { attemptId, schoolId }) {
  await client.query(`
    INSERT INTO full_curriculum_contract_events (
      school_id, attempt_id, purchase_id, enrolment_id, event_type,
      actor_type, detail, occurred_at
    )
    SELECT p.school_id, p.attempt_id, p.id, e.id,
           'durable_confirmation_delivered', 'system',
           '{"integration_fixture":true}'::jsonb, NOW()
      FROM learner_package_purchases p
      JOIN full_curriculum_enrolments e
        ON e.purchase_id = p.id AND e.school_id = p.school_id
     WHERE p.attempt_id = $1::uuid AND p.school_id = $2
    ON CONFLICT DO NOTHING
  `, [attemptId, schoolId]);
}

function loadWorkflowModules(sqlTags) {
  const neonModulePath = require.resolve('@neondatabase/serverless');
  const errorModulePath = require.resolve('../api/_error-alert');
  const apiModulePath = require.resolve('../api/_full-curriculum-api');
  const webhookModulePath = require.resolve('../api/package-webhook');
  const originalNeonModule = require.cache[neonModulePath];
  const originalErrorModule = require.cache[errorModulePath];
  const originalApiModule = require.cache[apiModulePath];
  const originalWebhookModule = require.cache[webhookModulePath];
  const reportedErrors = [];
  let nextSqlTag = 0;

  require.cache[neonModulePath] = {
    ...originalNeonModule,
    exports: {
      ...neonServerless,
      neon: () => {
        const sql = sqlTags[nextSqlTag % sqlTags.length];
        nextSqlTag += 1;
        return sql;
      },
    },
  };
  require.cache[errorModulePath] = {
    ...originalErrorModule,
    exports: {
      ...require(errorModulePath),
      reportError: (endpoint, error) => reportedErrors.push({ endpoint, error }),
    },
  };
  delete require.cache[apiModulePath];
  delete require.cache[webhookModulePath];
  const api = require(apiModulePath);
  const webhook = require(webhookModulePath);
  require.cache[neonModulePath] = originalNeonModule;

  return {
    api,
    webhook,
    reportedErrors,
    restore() {
      if (originalApiModule) require.cache[apiModulePath] = originalApiModule;
      else delete require.cache[apiModulePath];
      if (originalWebhookModule) require.cache[webhookModulePath] = originalWebhookModule;
      else delete require.cache[webhookModulePath];
      if (originalErrorModule) require.cache[errorModulePath] = originalErrorModule;
      else delete require.cache[errorModulePath];
    },
  };
}

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.describe('Full Curriculum matching/start database integration', () => {
  test.skip(
    !ENABLED,
    'Requires CC_TEST_DB=1, POSTGRES_URL_TEST, and CC_TEST_DB_CONFIRMED_NON_PRODUCTION=1'
  );

  const schemaName = `cc_full_curriculum_${process.pid}_${Date.now()}`;
  const quotedSchema = quoteIdentifier(schemaName);
  let primaryClient;
  let concurrentClient;
  let primaryConnected = false;
  let concurrentConnected = false;
  let primarySql;
  let concurrentSql;
  let workflowModules;
  let schemaCreated = false;
  let migrationsApplied = false;
  let schoolAId;
  let schoolBId;
  let learnerAId;
  let adminAId;
  let adminBId;
  let instructorAId;
  let instructorBId;
  let inactiveInstructorId;
  let otherSchoolInstructorId;
  let attemptId;
  let enrolmentId;
  let overrideEnrolmentId;
  let matchingRecordId;

  async function callAction(action, {
    body = {},
    method = 'POST',
    role = 'admin',
    actorId = adminAId,
    schoolId = schoolAId,
    isAdmin = false,
  } = {}) {
    const req = {
      method,
      url: `/api/packages?action=${action}`,
      query: { action },
      body,
      headers: authHeaders({ role, actorId, schoolId, isAdmin }),
    };
    const res = createResponse();
    await workflowModules.api.handleFullCurriculumAction(req, res);
    return res;
  }

  async function createFixtures() {
    const tenantMarker = await primaryClient.query(`
      INSERT INTO migration_markers (key, notes)
      VALUES (
        'public_endpoints_tenant_resolved',
        'temporary Full Curriculum integration fixture gate'
      )
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `);
    const schools = await primaryClient.query(`
      INSERT INTO schools (name, slug, active, config)
      VALUES
        ($1, $2, TRUE, '{"features":{"learner_packages_enabled":true,"learner_package_purchasing_test_enabled":true},"timezone":"Europe/London"}'::jsonb),
        ($3, $4, TRUE, '{"features":{"learner_packages_enabled":true,"learner_package_purchasing_test_enabled":true},"timezone":"Europe/London"}'::jsonb)
      RETURNING id
    `, [
      `Full Curriculum School A ${schemaName}`,
      `full-curriculum-a-${process.pid}-${Date.now()}`,
      `Full Curriculum School B ${schemaName}`,
      `full-curriculum-b-${process.pid}-${Date.now()}`,
    ]);
    schoolAId = Number(schools.rows[0].id);
    schoolBId = Number(schools.rows[1].id);
    if (tenantMarker.rowCount === 1) {
      await primaryClient.query(`
        DELETE FROM migration_markers
         WHERE key = 'public_endpoints_tenant_resolved'
           AND notes = 'temporary Full Curriculum integration fixture gate'
      `);
    }

    const admins = await primaryClient.query(`
      INSERT INTO admin_users (name, email, password_hash, role, active, school_id)
      VALUES
        ('Full Curriculum Admin A', $1, 'integration-only', 'admin', TRUE, $2),
        ('Full Curriculum Admin B', $3, 'integration-only', 'admin', TRUE, $4)
      RETURNING id, school_id
    `, [
      `admin-a-${schemaName}@example.test`, schoolAId,
      `admin-b-${schemaName}@example.test`, schoolBId,
    ]);
    adminAId = Number(admins.rows.find((row) => Number(row.school_id) === schoolAId).id);
    adminBId = Number(admins.rows.find((row) => Number(row.school_id) === schoolBId).id);

    const learners = await primaryClient.query(`
      INSERT INTO learner_users (name, email, school_id)
      VALUES ('Full Curriculum Learner A', $1, $2)
      RETURNING id
    `, [`learner-${schemaName}@example.test`, schoolAId]);
    learnerAId = Number(learners.rows[0].id);

    const instructors = await primaryClient.query(`
      INSERT INTO instructors (name, email, active, school_id)
      VALUES
        ('Full Curriculum Instructor A', $1, TRUE, $2),
        ('Full Curriculum Instructor B', $3, TRUE, $2),
        ('Full Curriculum Inactive', $4, FALSE, $2),
        ('Full Curriculum Other School', $5, TRUE, $6)
      RETURNING id, email
    `, [
      `instructor-a-${schemaName}@example.test`, schoolAId,
      `instructor-b-${schemaName}@example.test`,
      `instructor-inactive-${schemaName}@example.test`,
      `instructor-other-${schemaName}@example.test`, schoolBId,
    ]);
    const byEmail = new Map(instructors.rows.map((row) => [row.email, Number(row.id)]));
    instructorAId = byEmail.get(`instructor-a-${schemaName}@example.test`);
    instructorBId = byEmail.get(`instructor-b-${schemaName}@example.test`);
    inactiveInstructorId = byEmail.get(`instructor-inactive-${schemaName}@example.test`);
    otherSchoolInstructorId = byEmail.get(`instructor-other-${schemaName}@example.test`);

    const product = await primaryClient.query(`
      SELECT p.id AS product_id, v.id AS product_version_id, v.price_pence,
             v.customer_terms_version, v.content, p.slug
        FROM package_products p
        JOIN package_product_versions v
          ON v.product_id = p.id AND v.school_id = p.school_id
       WHERE p.school_id = $1 AND p.slug = 'full-curriculum'
       ORDER BY v.version_number DESC
       LIMIT 1
    `, [schoolAId]);
    expect(product.rowCount).toBe(1);

    const testBooking = await primaryClient.query(`
      INSERT INTO full_curriculum_test_bookings (
        school_id, learner_id, attempt_number, test_date, test_time, test_centre,
        verification_status, verified_by_actor_type, verified_by_admin_id,
        verified_at, verification_reason
      ) VALUES ($1, $2, 1, $3, '12:00', 'Integration Test Centre',
                'verified', 'admin', $4, NOW(), 'Verified integration fixture')
      RETURNING id
    `, [schoolAId, learnerAId, isoDateAfterDays(300), adminAId]);

    attemptId = crypto.randomUUID();
    const clientRequestId = crypto.randomUUID();
    const snapshot = {
      ...(product.rows[0].content || {}),
      slug: product.rows[0].slug,
      integration_fixture: true,
      consumer_rights: {
        policy_version: 'full-curriculum-consumer-rights-v1',
        disclosure_version: 'full-curriculum-checkout-disclosure-v1',
        refund_calculation_version: 'full-curriculum-refund-v1',
        cooling_off_days: 14,
        valuation_basis: 'purchase_price_allocation',
        rounding_rule: 'whole_pence_deductions_down',
        matching_admin_deduction_pence: 0,
        stripe_fee_customer_deduction_pence: 0,
        teaching_deductions: {
          base_90_minutes_pence: 5000,
          base_cap_pence: 120000,
          retake_90_minutes_pence: 5000,
          retake_120_minutes_pence: 6666,
          retake_cap_pence: 40000,
        },
        assessment_deductions: {
          each_completed_pence: 5000,
          cap_pence: 40000,
        },
      },
    };
    await primaryClient.query(`
      INSERT INTO package_purchase_attempts (
        id, school_id, learner_id, product_id, product_version_id,
        product_slug, product_name, product_description, product_snapshot,
        amount_pence, currency, customer_terms_version, stripe_mode, status,
        client_request_id, idempotency_key, stripe_checkout_session_id,
        stripe_payment_intent_id, paid_at, full_curriculum_test_booking_id,
        eligibility_snapshot, stripe_payment_method_configuration_id
      ) VALUES (
        $1::uuid, $2, $3, $4, $5,
        'full-curriculum', 'Full Curriculum', 'Integration fixture', $6::jsonb,
        $7, 'GBP', $8, 'test', 'paid',
        $9::uuid, $10, $11, $12, NOW() - INTERVAL '1 day', $13,
        '{"verified_first_test":true}'::jsonb, 'pmc_integrationtest'
      )
    `, [
      attemptId,
      schoolAId,
      learnerAId,
      product.rows[0].product_id,
      product.rows[0].product_version_id,
      JSON.stringify(snapshot),
      Number(product.rows[0].price_pence),
      product.rows[0].customer_terms_version,
      clientRequestId,
      `cc-package-test-checkout-${attemptId}`,
      `cs_test_full_curriculum_${attemptId.replace(/-/g, '')}`,
      `pi_fullcurriculum${attemptId.replace(/-/g, '')}`,
      testBooking.rows[0].id,
    ]);
    await insertConsumerContractEvidence(primaryClient, {
      attemptId,
      schoolId: schoolAId,
      learnerId: learnerAId,
      customerTermsVersion: product.rows[0].customer_terms_version,
    });
  }

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket === 'function') {
      neonConfig.webSocketConstructor = globalThis.WebSocket;
    }

    primaryClient = new Client({ connectionString: testDatabaseUrl });
    await primaryClient.connect();
    primaryConnected = true;
    await primaryClient.query(`CREATE SCHEMA ${quotedSchema}`);
    schemaCreated = true;
    await primaryClient.query(`SET search_path TO ${quotedSchema}, pg_catalog`);

    concurrentClient = new Client({ connectionString: testDatabaseUrl });
    await concurrentClient.connect();
    concurrentConnected = true;
    await concurrentClient.query(`SET search_path TO ${quotedSchema}, pg_catalog`);

    primarySql = createClientSqlTag(primaryClient);
    concurrentSql = createClientSqlTag(concurrentClient);
    workflowModules = loadWorkflowModules([primarySql, concurrentSql]);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    workflowModules?.restore();
    if (concurrentConnected) await concurrentClient.end().catch(() => {});
    if (primaryConnected) await primaryClient.end().catch(() => {});
    if (!schemaCreated || !/^cc_full_curriculum_[a-z0-9_]+$/.test(schemaName)) return;

    const cleanupClient = new Client({ connectionString: testDatabaseUrl });
    try {
      await cleanupClient.connect();
      await cleanupClient.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    } finally {
      await cleanupClient.end().catch(() => {});
    }
  });

  test('applies migrations 044-049 in order to a disposable schema', async () => {
    await expect(primaryClient.query(baseMigrationSql)).resolves.toBeTruthy();
    for (const migration of packageMigrations) {
      await expect(primaryClient.query(migration.sql), migration.file).resolves.toBeTruthy();
    }
    migrationsApplied = true;

    const relations = await primaryClient.query(`
      SELECT
        to_regclass($1) AS products,
        to_regclass($2) AS attempts,
        to_regclass($3) AS enrolments,
        to_regclass($4) AS matching,
        to_regclass($5) AS availability
    `, [
      `${schemaName}.package_products`,
      `${schemaName}.package_purchase_attempts`,
      `${schemaName}.full_curriculum_enrolments`,
      `${schemaName}.full_curriculum_matching_records`,
      `${schemaName}.full_curriculum_availability_versions`,
    ]);
    expect(Object.values(relations.rows[0]).every(Boolean)).toBe(true);
  });

  test('repeated webhook fulfilment creates one unstarted purchase, enrolment and pending match', async () => {
    expect(migrationsApplied).toBe(true);
    await createFixtures();
    const attempt = (await primaryClient.query(
      'SELECT * FROM package_purchase_attempts WHERE id = $1::uuid AND school_id = $2',
      [attemptId, schoolAId]
    )).rows[0];

    const retryInsert = (client) => {
      const retryAttemptId = crypto.randomUUID();
      return client.query(`
      INSERT INTO package_purchase_attempts (
        id, school_id, learner_id, product_id, product_version_id,
        product_slug, product_name, product_description, product_snapshot,
        amount_pence, currency, customer_terms_version, stripe_mode, status,
        client_request_id, idempotency_key, full_curriculum_test_booking_id,
        eligibility_snapshot, stripe_payment_method_configuration_id
      )
      SELECT $1::uuid, school_id, learner_id, product_id, product_version_id,
             product_slug, product_name, product_description, product_snapshot,
             amount_pence, currency, customer_terms_version, stripe_mode, 'created',
             $2::uuid, $3, full_curriculum_test_booking_id,
             eligibility_snapshot, stripe_payment_method_configuration_id
        FROM package_purchase_attempts
       WHERE id = $4::uuid AND school_id = $5
    `, [
      retryAttemptId, crypto.randomUUID(),
      `cc-package-test-checkout-${retryAttemptId}`,
      attemptId, schoolAId,
    ]);
    };
    const paidRetryResults = await Promise.allSettled([
      retryInsert(primaryClient), retryInsert(concurrentClient),
    ]);
    expect(paidRetryResults.every((result) => result.status === 'rejected')).toBe(true);
    expect(paidRetryResults.every(
      (result) => result.reason?.constraint === 'uq_package_attempts_active_product'
    )).toBe(true);

    const fulfilments = await Promise.all([
      workflowModules.webhook._test.fulfilFullCurriculum(primarySql, { attempt }),
      workflowModules.webhook._test.fulfilFullCurriculum(concurrentSql, { attempt }),
    ]);
    const repeated = await workflowModules.webhook._test.fulfilFullCurriculum(primarySql, { attempt });
    expect(fulfilments.filter((result) => result.created).length).toBe(1);
    expect(repeated.created).toBe(false);
    await insertDurableConfirmationEvent(primaryClient, { attemptId, schoolId: schoolAId });

    const counts = await primaryClient.query(`
      SELECT
        (SELECT COUNT(*)::INTEGER FROM learner_package_purchases WHERE attempt_id = $1::uuid) AS purchases,
        (SELECT COUNT(*)::INTEGER FROM full_curriculum_enrolments e
          JOIN learner_package_purchases p ON p.id = e.purchase_id AND p.school_id = e.school_id
         WHERE p.attempt_id = $1::uuid) AS enrolments,
        (SELECT COUNT(*)::INTEGER FROM full_curriculum_matching_records m
          JOIN full_curriculum_enrolments e ON e.id = m.enrolment_id AND e.school_id = m.school_id
          JOIN learner_package_purchases p ON p.id = e.purchase_id AND p.school_id = e.school_id
         WHERE p.attempt_id = $1::uuid) AS matching_records,
        (SELECT COUNT(*)::INTEGER FROM full_curriculum_weekly_opportunities w
          JOIN full_curriculum_enrolments e ON e.id = w.enrolment_id AND e.school_id = w.school_id
          JOIN learner_package_purchases p ON p.id = e.purchase_id AND p.school_id = e.school_id
         WHERE p.attempt_id = $1::uuid) AS weeks
    `, [attemptId]);
    expect(counts.rows[0]).toEqual({
      purchases: 1,
      enrolments: 1,
      matching_records: 1,
      weeks: 0,
    });

    const identity = await primaryClient.query(`
      SELECT e.id AS enrolment_id, e.status AS enrolment_status,
             e.programme_start_at, e.original_first_test_at,
             ((tb.test_date + tb.test_time) AT TIME ZONE 'Europe/London') AS expected_first_test_at,
             m.id AS matching_record_id, m.status AS matching_status,
             m.current_instructor_id
        FROM full_curriculum_enrolments e
        JOIN learner_package_purchases p ON p.id = e.purchase_id AND p.school_id = e.school_id
        JOIN full_curriculum_test_bookings tb
          ON tb.id = e.first_test_booking_id AND tb.school_id = e.school_id
        JOIN full_curriculum_matching_records m ON m.enrolment_id = e.id AND m.school_id = e.school_id
       WHERE p.attempt_id = $1::uuid AND e.school_id = $2
    `, [attemptId, schoolAId]);
    enrolmentId = Number(identity.rows[0].enrolment_id);
    matchingRecordId = Number(identity.rows[0].matching_record_id);
    expect(identity.rows[0]).toMatchObject({
      enrolment_status: 'paid_matching',
      programme_start_at: null,
      matching_status: 'pending',
      current_instructor_id: null,
    });
    expect(identity.rows[0].original_first_test_at.getTime())
      .toBe(identity.rows[0].expected_first_test_at.getTime());
  });

  test('retained pre-pilot enrolment does not block a separate verified pilot learner', async () => {
    const retainedTerms = (await primaryClient.query(
      'SELECT customer_terms_version FROM package_purchase_attempts WHERE id = $1::uuid AND school_id = $2',
      [attemptId, schoolAId]
    )).rows[0].customer_terms_version;
    expect(retainedTerms).not.toBe('full-curriculum-owner-certified-v1');

    const candidate = await primaryClient.query(`
      INSERT INTO learner_users (name, email, email_verified, school_id)
      VALUES ('Controlled Pilot Candidate', $1, TRUE, $2)
      RETURNING id
    `, [`pilot-candidate-${schemaName}@example.test`, schoolAId]);
    const candidateLearnerId = Number(candidate.rows[0].id);

    const listed = await callAction('programme-pilot-access', { method: 'GET' });
    expect(listed.statusCode).toBe(200);
    expect(listed.body.eligible_learners.map(learner => Number(learner.id)))
      .toContain(candidateLearnerId);
    expect(listed.body.eligible_learners.map(learner => Number(learner.id)))
      .not.toContain(learnerAId);

    const granted = await callAction('grant-programme-pilot-access', {
      body: {
        learner_id: candidateLearnerId,
        reason: 'Disposable integration proof for retained pre-pilot evidence',
      },
    });
    expect(
      granted.statusCode,
      workflowModules.reportedErrors.at(-1)?.error?.message || 'pilot grant returned no SQL diagnostic'
    ).toBe(201);
    expect(Number(granted.body.access.learner_id)).toBe(candidateLearnerId);

    const retained = await primaryClient.query(`
      SELECT attempt.status AS attempt_status, enrolment.status AS enrolment_status
        FROM package_purchase_attempts attempt
        JOIN learner_package_purchases purchase
          ON purchase.attempt_id = attempt.id AND purchase.school_id = attempt.school_id
        JOIN full_curriculum_enrolments enrolment
          ON enrolment.purchase_id = purchase.id AND enrolment.school_id = purchase.school_id
       WHERE attempt.id = $1::uuid AND attempt.school_id = $2
    `, [attemptId, schoolAId]);
    expect(retained.rows[0]).toEqual({
      attempt_status: 'paid',
      enrolment_status: 'paid_matching',
    });
  });

  test('assignment, acceptance and reassignment enforce eligibility, tenancy and append-only history', async () => {
    const assigned = await callAction('assign-instructor', {
      body: {
        enrolment_id: enrolmentId,
        instructor_id: instructorAId,
        reason: 'Initial integration assignment',
      },
    });
    expect(
      assigned.statusCode,
      workflowModules.reportedErrors.at(-1)?.error?.message || 'assignment returned no SQL diagnostic'
    ).toBe(201);

    const repeatedAssignment = await callAction('assign-instructor', {
      body: {
        enrolment_id: enrolmentId,
        instructor_id: instructorAId,
        reason: 'Repeated integration assignment',
      },
    });
    expect(repeatedAssignment.statusCode).toBe(200);
    expect(repeatedAssignment.body.idempotent).toBe(true);

    for (const instructorId of [inactiveInstructorId, otherSchoolInstructorId]) {
      const rejected = await callAction('assign-instructor', {
        body: {
          enrolment_id: enrolmentId,
          instructor_id: instructorId,
          reason: 'Ineligible integration assignment',
        },
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.body.code).toBe('ASSIGNMENT_NOT_ALLOWED');
    }

    const crossSchoolAssignment = await callAction('assign-instructor', {
      actorId: adminBId,
      schoolId: schoolBId,
      body: {
        enrolment_id: enrolmentId,
        instructor_id: otherSchoolInstructorId,
        reason: 'Cross-school integration assignment',
      },
    });
    expect(crossSchoolAssignment.statusCode).toBe(409);

    const startAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const startBeforeAcceptance = await callAction('start-programme', {
      role: 'instructor',
      actorId: instructorAId,
      body: {
        enrolment_id: enrolmentId,
        programme_start_at: startAt,
        reason: 'Start before acceptance is refused',
      },
    });
    expect(
      startBeforeAcceptance.statusCode,
      workflowModules.reportedErrors.at(-1)?.error?.message || 'start-before-acceptance returned no SQL diagnostic'
    ).toBe(409);

    const startWithoutAvailability = await callAction('start-programme', {
      body: {
        enrolment_id: enrolmentId,
        instructor_id: instructorAId,
        programme_start_at: startAt,
        reason: 'Start without availability is refused',
      },
    });
    expect(startWithoutAvailability.statusCode).toBe(409);

    const wrongAcceptance = await callAction('accept-assignment', {
      role: 'instructor',
      actorId: instructorBId,
      body: { enrolment_id: enrolmentId, reason: 'Wrong instructor acceptance' },
    });
    expect(wrongAcceptance.statusCode).toBe(409);

    const crossSchoolAcceptance = await callAction('accept-assignment', {
      role: 'instructor',
      actorId: otherSchoolInstructorId,
      schoolId: schoolBId,
      body: { enrolment_id: enrolmentId, reason: 'Cross-school acceptance' },
    });
    expect(crossSchoolAcceptance.statusCode).toBe(409);

    const accepted = await callAction('accept-assignment', {
      role: 'instructor',
      actorId: instructorAId,
      body: { enrolment_id: enrolmentId, reason: 'Accepted integration assignment' },
    });
    expect(accepted.statusCode).toBe(201);
    const repeatedAcceptance = await callAction('accept-assignment', {
      role: 'instructor',
      actorId: instructorAId,
      body: { enrolment_id: enrolmentId, reason: 'Repeated acceptance' },
    });
    expect(repeatedAcceptance.statusCode).toBe(200);
    expect(repeatedAcceptance.body.idempotent).toBe(true);

    const availabilityA = await callAction('record-programme-availability', {
      role: 'instructor',
      actorId: instructorAId,
      body: {
        enrolment_id: enrolmentId,
        timezone: 'Europe/London',
        reason: 'Initial agreed availability',
        windows: [{ weekday: 2, local_start_time: '09:00', local_end_time: '12:00' }],
      },
    });
    expect(availabilityA.statusCode).toBe(201);
    expect(Number(availabilityA.body.availability.version_number)).toBe(1);
    expect(Number(availabilityA.body.availability.window_count)).toBe(1);

    const reassigned = await callAction('assign-instructor', {
      body: {
        enrolment_id: enrolmentId,
        instructor_id: instructorBId,
        reason: 'Operational integration reassignment',
      },
    });
    expect(reassigned.statusCode).toBe(201);

    const matching = await primaryClient.query(`
      SELECT initial_instructor_id, current_instructor_id, status,
             accepted_at, accepted_by_instructor_id
        FROM full_curriculum_matching_records
       WHERE id = $1 AND school_id = $2
    `, [matchingRecordId, schoolAId]);
    expect(Number(matching.rows[0].initial_instructor_id)).toBe(instructorAId);
    expect(Number(matching.rows[0].current_instructor_id)).toBe(instructorBId);
    expect(matching.rows[0].status).toBe('assigned');
    expect(matching.rows[0].accepted_at).toBeNull();
    expect(matching.rows[0].accepted_by_instructor_id).toBeNull();

    const events = await primaryClient.query(`
      SELECT event_type, previous_instructor_id, instructor_id
        FROM full_curriculum_assignment_events
       WHERE school_id = $1 AND enrolment_id = $2
       ORDER BY id
    `, [schoolAId, enrolmentId]);
    expect(events.rows.map((row) => row.event_type)).toEqual(['assigned', 'accepted', 'reassigned']);
    expect(Number(events.rows[0].instructor_id)).toBe(instructorAId);
    expect(Number(events.rows[2].previous_instructor_id)).toBe(instructorAId);
    expect(Number(events.rows[2].instructor_id)).toBe(instructorBId);

    await expect(primaryClient.query(
      'UPDATE full_curriculum_matching_records SET initial_instructor_id = $1 WHERE id = $2 AND school_id = $3',
      [instructorBId, matchingRecordId, schoolAId]
    )).rejects.toThrow(/matching identity is immutable/i);
    await expect(primaryClient.query(
      'UPDATE full_curriculum_assignment_events SET reason = $1 WHERE school_id = $2 AND enrolment_id = $3',
      ['Mutated evidence', schoolAId, enrolmentId]
    )).rejects.toThrow(/append-only.*evidence/i);
  });

  test('availability versions follow the current instructor and start exactly once', async () => {
    const staleInstructorAvailability = await callAction('record-programme-availability', {
      role: 'instructor',
      actorId: instructorAId,
      body: {
        enrolment_id: enrolmentId,
        timezone: 'Europe/London',
        reason: 'Stale instructor availability',
        windows: [],
      },
    });
    expect(staleInstructorAvailability.statusCode).toBe(409);

    const startAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const oldAvailabilityCannotStart = await callAction('start-programme', {
      body: {
        enrolment_id: enrolmentId,
        instructor_id: instructorBId,
        programme_start_at: startAt,
        reason: 'Old instructor availability cannot start',
      },
    });
    expect(oldAvailabilityCannotStart.statusCode).toBe(409);

    const zeroWindowVersion = await callAction('record-programme-availability', {
      role: 'instructor',
      actorId: instructorBId,
      body: {
        enrolment_id: enrolmentId,
        timezone: 'Europe/London',
        reason: 'Explicitly no recurring windows',
        windows: [],
      },
    });
    expect(zeroWindowVersion.statusCode).toBe(201);
    expect(Number(zeroWindowVersion.body.availability.version_number)).toBe(2);
    expect(Number(zeroWindowVersion.body.availability.window_count)).toBe(0);

    const versions = await primaryClient.query(`
      SELECT av.id, av.version_number, av.instructor_id, av.timezone,
             COUNT(w.id)::INTEGER AS window_count
        FROM full_curriculum_availability_versions av
        LEFT JOIN full_curriculum_availability_windows w
          ON w.availability_version_id = av.id AND w.school_id = av.school_id
       WHERE av.school_id = $1 AND av.enrolment_id = $2
       GROUP BY av.id
       ORDER BY av.version_number
    `, [schoolAId, enrolmentId]);
    expect(versions.rows.map((row) => ({
      version: Number(row.version_number),
      instructor: Number(row.instructor_id),
      windows: Number(row.window_count),
    }))).toEqual([
      { version: 1, instructor: instructorAId, windows: 1 },
      { version: 2, instructor: instructorBId, windows: 0 },
    ]);

    const crossSchoolAvailability = await callAction('record-programme-availability', {
      role: 'instructor',
      actorId: otherSchoolInstructorId,
      schoolId: schoolBId,
      body: {
        enrolment_id: enrolmentId,
        timezone: 'Europe/London',
        reason: 'Cross-school availability',
        windows: [],
      },
    });
    expect(crossSchoolAvailability.statusCode).toBe(409);

    const beforeAcceptance = await callAction('start-programme', {
      role: 'instructor',
      actorId: instructorBId,
      body: {
        enrolment_id: enrolmentId,
        programme_start_at: startAt,
        reason: 'Ordinary instructor must accept first',
      },
    });
    expect(beforeAcceptance.statusCode).toBe(409);

    const adminWithoutOverride = await callAction('start-programme', {
      body: {
        enrolment_id: enrolmentId,
        instructor_id: instructorBId,
        programme_start_at: startAt,
        reason: 'Admin must explicitly override missing acceptance',
      },
    });
    expect(adminWithoutOverride.statusCode).toBe(409);
    expect(adminWithoutOverride.body.code).toBe('PROGRAMME_START_NOT_ALLOWED');

    const malformedOverride = await callAction('start-programme', {
      body: {
        enrolment_id: enrolmentId,
        instructor_id: instructorBId,
        programme_start_at: startAt,
        instructor_acceptance_override: 'true',
        reason: 'String override is refused',
      },
    });
    expect(malformedOverride.statusCode).toBe(400);
    expect(malformedOverride.body.code).toBe('INVALID_ACCEPTANCE_OVERRIDE');

    const instructorOverride = await callAction('start-programme', {
      role: 'instructor',
      actorId: instructorBId,
      body: {
        enrolment_id: enrolmentId,
        programme_start_at: startAt,
        instructor_acceptance_override: true,
        reason: 'Instructor cannot override their own acceptance',
      },
    });
    expect(instructorOverride.statusCode).toBe(403);
    expect(instructorOverride.body.code).toBe('ADMIN_ACCEPTANCE_OVERRIDE_ONLY');

    const wrongAdminInstructor = await callAction('start-programme', {
      body: {
        enrolment_id: enrolmentId,
        instructor_id: instructorAId,
        programme_start_at: startAt,
        reason: 'Admin supplied stale instructor',
      },
    });
    expect(wrongAdminInstructor.statusCode).toBe(409);

    const accepted = await callAction('accept-assignment', {
      role: 'instructor',
      actorId: instructorBId,
      body: { enrolment_id: enrolmentId, reason: 'Accepted reassigned programme' },
    });
    expect(accepted.statusCode).toBe(201);

    const crossSchoolStart = await callAction('start-programme', {
      role: 'instructor',
      actorId: otherSchoolInstructorId,
      schoolId: schoolBId,
      body: {
        enrolment_id: enrolmentId,
        programme_start_at: startAt,
        reason: 'Cross-school start',
      },
    });
    expect(crossSchoolStart.statusCode).toBe(409);

    const concurrentStarts = await Promise.all([
      callAction('start-programme', {
        role: 'instructor',
        actorId: instructorBId,
        body: {
          enrolment_id: enrolmentId,
          programme_start_at: startAt,
          reason: 'Concurrent programme start A',
        },
      }),
      callAction('start-programme', {
        role: 'instructor',
        actorId: instructorBId,
        body: {
          enrolment_id: enrolmentId,
          programme_start_at: startAt,
          reason: 'Concurrent programme start B',
        },
      }),
    ]);
    expect(concurrentStarts.map((response) => response.statusCode).sort()).toEqual([201, 409]);

    const repeatedStart = await callAction('start-programme', {
      role: 'instructor',
      actorId: instructorBId,
      body: {
        enrolment_id: enrolmentId,
        programme_start_at: startAt,
        reason: 'Repeated programme start',
      },
    });
    expect(repeatedStart.statusCode).toBe(409);

    const finalState = await primaryClient.query(`
      SELECT e.status, e.programme_start_at, e.twenty_four_week_cap_at,
             m.status AS matching_status, m.started_at,
             (SELECT COUNT(*)::INTEGER FROM full_curriculum_weekly_opportunities w
               WHERE w.school_id = e.school_id AND w.enrolment_id = e.id) AS week_count,
             (SELECT COUNT(*)::INTEGER FROM full_curriculum_progress_events pe
               WHERE pe.school_id = e.school_id AND pe.enrolment_id = e.id
                 AND pe.event_type = 'programme_started') AS start_event_count
        FROM full_curriculum_enrolments e
        JOIN full_curriculum_matching_records m
          ON m.enrolment_id = e.id AND m.school_id = e.school_id
       WHERE e.school_id = $1 AND e.id = $2
    `, [schoolAId, enrolmentId]);
    expect(finalState.rows[0].status).toBe('active');
    expect(finalState.rows[0].programme_start_at.toISOString()).toBe(startAt);
    expect(finalState.rows[0].matching_status).toBe('started');
    expect(finalState.rows[0].started_at).not.toBeNull();
    expect(Number(finalState.rows[0].week_count)).toBe(24);
    expect(Number(finalState.rows[0].start_event_count)).toBe(1);
    const localTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    expect(localTime.format(finalState.rows[0].twenty_four_week_cap_at))
      .toBe(localTime.format(finalState.rows[0].programme_start_at));

    await expect(primaryClient.query(
      'UPDATE full_curriculum_availability_versions SET reason = $1 WHERE school_id = $2 AND enrolment_id = $3',
      ['Mutated availability evidence', schoolAId, enrolmentId]
    )).rejects.toThrow(/append-only.*evidence/i);

    const crossTenantRows = await primaryClient.query(`
      SELECT
        (SELECT COUNT(*)::INTEGER FROM full_curriculum_matching_records
          WHERE school_id = $1 AND enrolment_id = $2) AS matching,
        (SELECT COUNT(*)::INTEGER FROM full_curriculum_availability_versions
          WHERE school_id = $1 AND enrolment_id = $2) AS availability,
        (SELECT COUNT(*)::INTEGER FROM full_curriculum_weekly_opportunities
          WHERE school_id = $1 AND enrolment_id = $2) AS weeks
    `, [schoolBId, enrolmentId]);
    expect(crossTenantRows.rows[0]).toEqual({ matching: 0, availability: 0, weeks: 0 });
  });

  test('explicit admin override is audited and keeps programme weeks at the same London wall-clock time', async () => {
    const learner = await primaryClient.query(`
      INSERT INTO learner_users (name, email, school_id)
      VALUES ('Full Curriculum Override Learner', $1, $2)
      RETURNING id
    `, [`override-learner-${schemaName}@example.test`, schoolAId]);
    const overrideLearnerId = Number(learner.rows[0].id);

    const testBooking = await primaryClient.query(`
      INSERT INTO full_curriculum_test_bookings (
        school_id, learner_id, attempt_number, test_date, test_time, test_centre,
        verification_status, verified_by_actor_type, verified_by_admin_id,
        verified_at, verification_reason
      ) VALUES (
        $1, $2, 1, '2027-02-18', '10:30', 'DST Integration Test Centre',
        'verified', 'admin', $3, NOW(), 'Verified DST integration fixture'
      )
      RETURNING id
    `, [schoolAId, overrideLearnerId, adminAId]);

    const overrideAttemptId = crypto.randomUUID();
    const checkoutSuffix = overrideAttemptId.replace(/-/g, '');
    await primaryClient.query(`
      INSERT INTO package_purchase_attempts (
        id, school_id, learner_id, product_id, product_version_id,
        product_slug, product_name, product_description, product_snapshot,
        amount_pence, currency, customer_terms_version, stripe_mode, status,
        client_request_id, idempotency_key, stripe_checkout_session_id,
        stripe_payment_intent_id, paid_at, full_curriculum_test_booking_id,
        eligibility_snapshot, stripe_payment_method_configuration_id
      )
      SELECT $1::uuid, school_id, $2, product_id, product_version_id,
             product_slug, product_name, product_description, product_snapshot,
             amount_pence, currency, customer_terms_version, stripe_mode, 'paid',
             $3::uuid, $4, $5, $6, '2026-08-01T10:00:00Z'::timestamptz, $7,
             eligibility_snapshot, stripe_payment_method_configuration_id
        FROM package_purchase_attempts
       WHERE id = $8::uuid AND school_id = $9
    `, [
      overrideAttemptId,
      overrideLearnerId,
      crypto.randomUUID(),
      `cc-package-test-checkout-${overrideAttemptId}`,
      `cs_test_full_curriculum_${checkoutSuffix}`,
      `pi_fullcurriculum${checkoutSuffix}`,
      testBooking.rows[0].id,
      attemptId,
      schoolAId,
    ]);
    const overrideTermsVersion = (await primaryClient.query(
      'SELECT customer_terms_version FROM package_purchase_attempts WHERE id = $1::uuid AND school_id = $2',
      [overrideAttemptId, schoolAId]
    )).rows[0].customer_terms_version;
    await insertConsumerContractEvidence(primaryClient, {
      attemptId: overrideAttemptId,
      schoolId: schoolAId,
      learnerId: overrideLearnerId,
      customerTermsVersion: overrideTermsVersion,
    });
    const overrideAttempt = (await primaryClient.query(
      'SELECT * FROM package_purchase_attempts WHERE id = $1::uuid AND school_id = $2',
      [overrideAttemptId, schoolAId]
    )).rows[0];
    const fulfilment = await workflowModules.webhook._test.fulfilFullCurriculum(primarySql, {
      attempt: overrideAttempt,
    });
    expect(fulfilment.created).toBe(true);
    await insertDurableConfirmationEvent(primaryClient, {
      attemptId: overrideAttemptId,
      schoolId: schoolAId,
    });

    const identity = await primaryClient.query(`
      SELECT e.id AS enrolment_id
        FROM full_curriculum_enrolments e
        JOIN learner_package_purchases p
          ON p.id = e.purchase_id AND p.school_id = e.school_id
       WHERE p.attempt_id = $1::uuid AND e.school_id = $2
    `, [overrideAttemptId, schoolAId]);
    overrideEnrolmentId = Number(identity.rows[0].enrolment_id);

    const assigned = await callAction('assign-instructor', {
      body: {
        enrolment_id: overrideEnrolmentId,
        instructor_id: instructorAId,
        reason: 'Assign instructor for explicit override coverage',
      },
    });
    expect(assigned.statusCode).toBe(201);
    const availability = await callAction('record-programme-availability', {
      body: {
        enrolment_id: overrideEnrolmentId,
        timezone: 'Europe/London',
        reason: 'Monday ten o clock DST coverage',
        windows: [{ weekday: 1, local_start_time: '10:00', local_end_time: '11:30' }],
      },
    });
    expect(availability.statusCode).toBe(201);

    const rejectedWithoutOverride = await callAction('start-programme', {
      body: {
        enrolment_id: overrideEnrolmentId,
        instructor_id: instructorAId,
        programme_start_at: '2026-08-24T09:00:00.000Z',
        reason: 'Missing explicit override must be rejected',
      },
    });
    expect(rejectedWithoutOverride.statusCode).toBe(409);

    const started = await callAction('start-programme', {
      body: {
        enrolment_id: overrideEnrolmentId,
        instructor_id: instructorAId,
        programme_start_at: '2026-08-24T09:00:00.000Z',
        instructor_acceptance_override: true,
        reason: 'Exceptional admin start for deterministic integration coverage',
      },
    });
    expect(
      started.statusCode,
      workflowModules.reportedErrors.at(-1)?.error?.message || 'override start returned no SQL diagnostic'
    ).toBe(201);

    const evidence = await primaryClient.query(`
      SELECT e.twenty_four_week_cap_at, m.status AS matching_status,
             m.accepted_at, m.accepted_by_instructor_id,
             pe.detail AS progress_detail,
             audit.details AS audit_details
        FROM full_curriculum_enrolments e
        JOIN full_curriculum_matching_records m
          ON m.enrolment_id = e.id AND m.school_id = e.school_id
        JOIN full_curriculum_progress_events pe
          ON pe.enrolment_id = e.id AND pe.school_id = e.school_id
         AND pe.event_type = 'programme_started'
        JOIN audit_log audit
         ON audit.school_id = e.school_id
         AND audit.action = 'package.start_programme'
         AND audit.target_id = e.id
       WHERE e.school_id = $1 AND e.id = $2
       ORDER BY audit.id DESC
       LIMIT 1
    `, [schoolAId, overrideEnrolmentId]);
    expect(evidence.rows[0].twenty_four_week_cap_at.toISOString()).toBe('2027-02-08T10:00:00.000Z');
    expect(evidence.rows[0].matching_status).toBe('started');
    expect(evidence.rows[0].accepted_at).toBeNull();
    expect(evidence.rows[0].accepted_by_instructor_id).toBeNull();
    expect(evidence.rows[0].progress_detail).toMatchObject({
      instructor_acceptance_overridden: true,
      operational_timezone: 'Europe/London',
    });
    expect(evidence.rows[0].audit_details).toMatchObject({
      instructor_acceptance_overridden: true,
      operational_timezone: 'Europe/London',
    });

    const weeks = await primaryClient.query(`
      SELECT programme_week, week_start_at, week_end_at,
             TO_CHAR(week_start_at AT TIME ZONE 'Europe/London', 'Dy HH24:MI') AS local_start,
             EXTRACT(EPOCH FROM (week_end_at - week_start_at)) / 3600 AS duration_hours
        FROM full_curriculum_weekly_opportunities
       WHERE school_id = $1 AND enrolment_id = $2
       ORDER BY programme_week
    `, [schoolAId, overrideEnrolmentId]);
    expect(weeks.rowCount).toBe(24);
    expect(weeks.rows.every((week) => week.local_start === 'Mon 10:00')).toBe(true);
    expect(weeks.rows.some((week) => Number(week.duration_hours) === 169)).toBe(true);

    const extension = await callAction('record-extension', {
      body: {
        enrolment_id: overrideEnrolmentId,
        approved_end_at: '2027-02-22T10:00:00.000Z',
        reason_type: 'coachcarter_replacement',
        reason: 'Verify extended weeks retain London wall-clock time',
      },
    });
    expect(
      extension.statusCode,
      workflowModules.reportedErrors.at(-1)?.error?.message || 'extension returned no SQL diagnostic'
    ).toBe(201);
    const extendedWeeks = await primaryClient.query(`
      SELECT programme_week,
             TO_CHAR(week_start_at AT TIME ZONE 'Europe/London', 'Dy HH24:MI') AS local_start
        FROM full_curriculum_weekly_opportunities
       WHERE school_id = $1 AND enrolment_id = $2
       ORDER BY programme_week
    `, [schoolAId, overrideEnrolmentId]);
    expect(extendedWeeks.rowCount).toBe(26);
    expect(extendedWeeks.rows.every((week) => week.local_start === 'Mon 10:00')).toBe(true);
  });

  test('manual refund evidence requires two admins and records provider outcome without executing it', async () => {
    const secondAdmin = await primaryClient.query(`
      INSERT INTO admin_users (name, email, password_hash, role, active, school_id)
      VALUES ('Full Curriculum Refund Approver', $1, 'integration-only', 'admin', TRUE, $2)
      RETURNING id
    `, [`refund-approver-${schemaName}@example.test`, schoolAId]);
    const secondAdminId = Number(secondAdmin.rows[0].id);
    const requestId = crypto.randomUUID();
    const transactionRunner = async (work) => {
      await primaryClient.query('BEGIN');
      try {
        const result = await work(primarySql);
        await primaryClient.query('COMMIT');
        return result;
      } catch (error) {
        await primaryClient.query('ROLLBACK');
        throw error;
      }
    };
    const termination = await requestProgrammeTermination({
      schoolId: schoolAId,
      actorId: adminAId,
      actorType: 'admin',
      enrolmentId: overrideEnrolmentId,
      requestId,
      requestKind: 'provider_nonfulfilment',
      channel: 'admin_recorded',
      reason: 'Provider cannot supply the remaining programme',
      receivedAt: new Date(),
      transactionRunner,
    });
    expect(termination.idempotent).toBe(false);
    expect(Number(termination.refundCase.refund_due_pence)).toBe(200000);
    expect(termination.calculation.lines.find(line => line.line_type === 'stripe_fee').deduction_pence).toBe(0);

    const repeated = await requestProgrammeTermination({
      schoolId: schoolAId,
      actorId: adminAId,
      actorType: 'admin',
      enrolmentId: overrideEnrolmentId,
      requestId,
      requestKind: 'provider_nonfulfilment',
      channel: 'admin_recorded',
      reason: 'Provider cannot supply the remaining programme',
      receivedAt: new Date(),
      transactionRunner,
    });
    expect(repeated.idempotent).toBe(true);
    expect(repeated.refundCase.id).toBe(termination.refundCase.id);

    const review = await callAction('review-programme-refund', {
      body: {
        refund_case_id: termination.refundCase.id,
        stripe_fee_absorbed_pence: 1200,
        reason: 'Matched against the original PaymentIntent and fee evidence',
      },
    });
    expect(review.statusCode).toBe(200);
    expect(review.body.stripe_refund_issued).toBe(false);

    const sameAdminApproval = await callAction('approve-programme-refund', {
      body: {
        refund_case_id: termination.refundCase.id,
        reason: 'Same reviewer must not be able to approve',
      },
    });
    expect(sameAdminApproval.statusCode).toBe(409);

    const approval = await callAction('approve-programme-refund', {
      actorId: secondAdminId,
      body: {
        refund_case_id: termination.refundCase.id,
        reason: 'Independent second-admin approval of exact amount',
      },
    });
    expect(approval.statusCode).toBe(200);
    expect(approval.body.stripe_refund_issued).toBe(false);

    const providerRefundId = `re_integration_${requestId.replace(/-/g, '')}`;
    const recorded = await callAction('record-programme-refund-result', {
      actorId: secondAdminId,
      body: {
        refund_case_id: termination.refundCase.id,
        provider_refund_id: providerRefundId,
        provider_status: 'succeeded',
        reason: 'Recorded from the manually issued Stripe Dashboard refund',
      },
    });
    expect(recorded.statusCode).toBe(200);
    expect(recorded.body.provider_call_made_by_application).toBe(false);

    const evidence = await primaryClient.query(`
      SELECT e.status AS enrolment_status, c.status AS refund_status,
             c.provider_refund_id, c.reviewed_by_admin_id, c.approved_by_admin_id,
             COUNT(events.id)::int AS event_count
        FROM full_curriculum_enrolments e
        JOIN full_curriculum_refund_cases c
          ON c.enrolment_id = e.id AND c.school_id = e.school_id
        JOIN full_curriculum_refund_case_events events
          ON events.refund_case_id = c.id AND events.school_id = c.school_id
       WHERE e.id = $1 AND e.school_id = $2
       GROUP BY e.status, c.status, c.provider_refund_id,
                c.reviewed_by_admin_id, c.approved_by_admin_id
    `, [overrideEnrolmentId, schoolAId]);
    expect(evidence.rows[0]).toMatchObject({
      enrolment_status: 'withdrawn',
      refund_status: 'provider_succeeded',
      provider_refund_id: providerRefundId,
      reviewed_by_admin_id: adminAId,
      approved_by_admin_id: secondAdminId,
      event_count: 4,
    });
    const refundAudits = await primaryClient.query(`
      SELECT COUNT(*)::int AS audit_count
        FROM audit_log
       WHERE school_id = $1
         AND target_type = 'full_curriculum_enrolment'
         AND target_id = $2
         AND action IN (
           'package.review_programme_refund',
           'package.approve_programme_refund',
           'package.record_programme_refund_result'
         )
         AND details->>'refund_case_id' = $3
    `, [schoolAId, overrideEnrolmentId, termination.refundCase.id]);
    expect(refundAudits.rows[0].audit_count).toBe(3);
  });

  test('concurrent retake allocations cannot reserve more than 600 minutes', async () => {
    const secondTestDate = isoDateAfterDays(20);
    const secondTest = await primaryClient.query(`
      INSERT INTO full_curriculum_test_bookings (
        school_id, learner_id, attempt_number, test_date, test_time, test_centre,
        verification_status, verified_by_actor_type, verified_by_admin_id,
        verified_at, verification_reason
      ) VALUES ($1, $2, 2, $3, '12:00', 'Retake Integration Centre',
                'verified', 'admin', $4, NOW(), 'Verified retake fixture')
      RETURNING id
    `, [schoolAId, learnerAId, secondTestDate, adminAId]);
    const activated = await callAction('activate-retake', {
      body: {
        enrolment_id: enrolmentId,
        second_test_booking_id: Number(secondTest.rows[0].id),
        failed_first_test_evidence: 'Failed first test integration evidence',
      },
    });
    expect(activated.statusCode).toBe(201);

    const bookingIds = [];
    for (let day = 1; day <= 6; day += 1) {
      const booking = await primaryClient.query(`
        INSERT INTO lesson_bookings (
          school_id, learner_id, instructor_id, scheduled_date,
          start_time, end_time, status, created_by, payment_method, minutes_deducted
        ) VALUES ($1, $2, $3, $4, '08:00', '10:00', 'scheduled', 'admin', 'cash', 0)
        RETURNING id
      `, [schoolAId, learnerAId, instructorBId, isoDateAfterDays(day)]);
      bookingIds.push(Number(booking.rows[0].id));
    }

    for (const bookingId of bookingIds.slice(0, 4)) {
      const allocated = await callAction('allocate-programme-booking', {
        body: {
          enrolment_id: enrolmentId,
          lesson_booking_id: bookingId,
          allocation_type: 'retake_lesson',
        },
      });
      expect(
        allocated.statusCode,
        workflowModules.reportedErrors.at(-1)?.error?.message || 'retake allocation returned no SQL diagnostic'
      ).toBe(201);
    }

    const finalConcurrent = await Promise.all(bookingIds.slice(4).map((bookingId) => (
      callAction('allocate-programme-booking', {
        body: {
          enrolment_id: enrolmentId,
          lesson_booking_id: bookingId,
          allocation_type: 'retake_lesson',
        },
      })
    )));
    expect(finalConcurrent.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(finalConcurrent.find((response) => response.statusCode === 409)?.body.code)
      .toBe('RETAKE_ALLOWANCE_EXCEEDED');

    const usage = await primaryClient.query(`
      SELECT counter.consumed_minutes,
             COALESCE(SUM(m.minutes), 0)::INTEGER AS ledger_minutes,
             COUNT(m.id)::INTEGER AS movement_count
        FROM full_curriculum_retake_allowances allowance
        JOIN full_curriculum_retake_usage_counters counter
          ON counter.allowance_id = allowance.id AND counter.school_id = allowance.school_id
        LEFT JOIN full_curriculum_retake_movements m
          ON m.allowance_id = allowance.id AND m.school_id = allowance.school_id
       WHERE allowance.school_id = $1 AND allowance.enrolment_id = $2
       GROUP BY counter.consumed_minutes
    `, [schoolAId, enrolmentId]);
    expect(usage.rows[0]).toEqual({ consumed_minutes: 600, ledger_minutes: 600, movement_count: 5 });
  });

  test('GDPR deletion anonymises referencing Full Curriculum identities before test-booking identity', async () => {
    const gdprSql = createTransactionalGdprSqlTag(primaryClient);
    await expect(deleteLearnerCascade(gdprSql, learnerAId)).resolves.toMatchObject({ ok: true, learnerId: learnerAId });

    const retained = await primaryClient.query(`
      SELECT
        (SELECT learner_id FROM package_purchase_attempts WHERE id = $1::uuid) AS attempt_learner,
        (SELECT learner_id FROM learner_package_purchases WHERE attempt_id = $1::uuid) AS purchase_learner,
        (SELECT learner_id FROM full_curriculum_enrolments WHERE id = $2) AS enrolment_learner,
        (SELECT learner_id FROM full_curriculum_matching_records WHERE enrolment_id = $2) AS matching_learner,
        (SELECT learner_id FROM full_curriculum_test_bookings
          WHERE id = (SELECT full_curriculum_test_booking_id FROM package_purchase_attempts WHERE id = $1::uuid)) AS test_booking_learner,
        (SELECT test_centre FROM full_curriculum_test_bookings
          WHERE id = (SELECT full_curriculum_test_booking_id FROM package_purchase_attempts WHERE id = $1::uuid)) AS test_centre,
        (SELECT COUNT(*)::INTEGER FROM full_curriculum_assignment_events WHERE enrolment_id = $2) AS assignment_events,
        (SELECT COUNT(*)::INTEGER FROM full_curriculum_progress_events WHERE enrolment_id = $2) AS progress_events,
        (SELECT COUNT(*)::INTEGER FROM learner_users WHERE id = $3) AS learner_rows
    `, [attemptId, enrolmentId, learnerAId]);
    expect(retained.rows[0]).toMatchObject({
      attempt_learner: null,
      purchase_learner: null,
      enrolment_learner: null,
      matching_learner: null,
      test_booking_learner: null,
      test_centre: null,
      learner_rows: 0,
    });
    expect(Number(retained.rows[0].assignment_events)).toBeGreaterThan(0);
    expect(Number(retained.rows[0].progress_events)).toBeGreaterThan(0);
  });
});
