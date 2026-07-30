// @ts-check
// Real-database Curriculum MVP coverage.
//
// Run with:
//   CC_TEST_DB=1 npm.cmd test -- tests/curriculum-mvp.integration.spec.js

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { withNeonTransaction } = require('../api/_db-transaction');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function normaliseConnectionString(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

loadEnvLocal();

const testDatabaseUrl = normaliseConnectionString(process.env.POSTGRES_URL_TEST);
const configuredAppUrl = normaliseConnectionString(process.env.POSTGRES_URL);
const shouldRun = process.env.CC_TEST_DB === '1' && !!testDatabaseUrl;

if (shouldRun && configuredAppUrl && configuredAppUrl === testDatabaseUrl) {
  throw new Error(
    'REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL. '
    + 'Point POSTGRES_URL_TEST at an isolated test branch.'
  );
}

process.env.JWT_SECRET = process.env.JWT_SECRET || 'curriculum-mvp-integration-secret';

const sql = shouldRun ? neon(testDatabaseUrl) : null;
const curriculumHandler = shouldRun ? require('../api/curriculum') : null;
const migrationSql = fs.readFileSync(
  path.join(__dirname, '..', 'db', 'migrations', '038_curriculum_mvp.sql'),
  'utf8'
);

const runKey = `${Date.now()}-${process.pid}`;
let schoolAId;
let schoolBId;
let instructorAId;
let instructorBId;
let inactiveInstructorId;
let adminId;

function authHeaders(role, id, schoolId, options = {}) {
  const csrf = 'c'.repeat(64);
  const payload = {
    id,
    email: `${role}-${id}@curriculum.test`,
    role,
    school_id: schoolId
  };
  if (options.isAdmin) payload.isAdmin = true;
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
  const cookieName = role === 'admin' ? 'cc_admin' : 'cc_instructor';
  return {
    cookie: `${cookieName}=${token}; cc_csrf=${csrf}`,
    'x-csrf-token': csrf
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    }
  };
}

async function callCurriculum(action, {
  method = 'GET',
  query = {},
  body = {},
  role = 'instructor',
  actorId = instructorAId,
  schoolId = schoolAId,
  isAdmin = false
} = {}) {
  const req = {
    method,
    query: { action, ...query },
    body,
    headers: authHeaders(role, actorId, schoolId, { isAdmin }),
    url: `/api/curriculum?action=${action}`
  };
  const res = makeRes();
  await curriculumHandler(req, res);
  return res;
}

async function createTopic(name, options = {}) {
  const response = await callCurriculum('create-topic', {
    method: 'POST',
    body: {
      name: `${name} ${runKey}`,
      description: `Curriculum integration fixture for ${name}`,
      parent_topic_id: options.parentTopicId || null
    },
    role: options.role || 'instructor',
    actorId: options.actorId || instructorAId,
    schoolId: options.schoolId || schoolAId,
    isAdmin: options.isAdmin || false
  });
  expect(response.statusCode).toBe(201);
  expect(response.body.ok).toBe(true);
  return Number(response.body.topic.id);
}

async function cleanSchool(schoolId) {
  if (!schoolId || !sql) return;
  await sql`DELETE FROM audit_log WHERE school_id = ${schoolId}`;
  await sql`DELETE FROM curriculum_topic_connections WHERE school_id = ${schoolId}`;
  await sql`DELETE FROM curriculum_contributions WHERE school_id = ${schoolId}`;
  await sql`DELETE FROM curriculum_structural_suggestions WHERE school_id = ${schoolId}`;
  await sql`
    UPDATE curriculum_topics
    SET parent_topic_id = NULL,
        merged_into_topic_id = NULL
    WHERE school_id = ${schoolId}
  `;
  await sql`DELETE FROM curriculum_topics WHERE school_id = ${schoolId}`;
  await sql`DELETE FROM admin_users WHERE school_id = ${schoolId}`;
  await sql`DELETE FROM instructors WHERE school_id = ${schoolId}`;
  await sql`DELETE FROM schools WHERE id = ${schoolId}`;
}

test.describe('Curriculum MVP database integration', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    test.skip(
      !shouldRun,
      'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run against an isolated test database.'
    );

    process.env.POSTGRES_URL = testDatabaseUrl;
    await withNeonTransaction(testDatabaseUrl, async (client) => {
      await client.query(migrationSql);
    });
    await withNeonTransaction(testDatabaseUrl, async (client) => {
      await client.query(migrationSql);
    });

    const fixtureSchools = await withNeonTransaction(testDatabaseUrl, async (client) => {
      const marker = await client.query(
        `INSERT INTO migration_markers (key, notes)
         VALUES (
           'public_endpoints_tenant_resolved',
           'temporary Curriculum MVP integration fixture gate'
         )
         ON CONFLICT (key) DO NOTHING
         RETURNING key`
      );
      const schoolA = await client.query(
        `INSERT INTO schools (name, slug, active)
         VALUES ($1, $2, TRUE)
         RETURNING id`,
        [`Curriculum Test A ${runKey}`, `curriculum-test-a-${runKey}`]
      );
      const schoolB = await client.query(
        `INSERT INTO schools (name, slug, active)
         VALUES ($1, $2, TRUE)
         RETURNING id`,
        [`Curriculum Test B ${runKey}`, `curriculum-test-b-${runKey}`]
      );
      if (marker.rowCount === 1) {
        await client.query(
          `DELETE FROM migration_markers
           WHERE key = 'public_endpoints_tenant_resolved'
             AND notes = 'temporary Curriculum MVP integration fixture gate'`
        );
      }
      return {
        schoolAId: Number(schoolA.rows[0].id),
        schoolBId: Number(schoolB.rows[0].id)
      };
    });
    schoolAId = fixtureSchools.schoolAId;
    schoolBId = fixtureSchools.schoolBId;

    const [instructorA] = await sql`
      INSERT INTO instructors (name, email, active, school_id, is_admin)
      VALUES (
        'Curriculum Instructor A',
        ${`curriculum-a-${runKey}@example.test`},
        TRUE,
        ${schoolAId},
        FALSE
      )
      RETURNING id
    `;
    instructorAId = Number(instructorA.id);

    const [instructorB] = await sql`
      INSERT INTO instructors (name, email, active, school_id, is_admin)
      VALUES (
        'Curriculum Instructor B',
        ${`curriculum-b-${runKey}@example.test`},
        TRUE,
        ${schoolAId},
        FALSE
      )
      RETURNING id
    `;
    instructorBId = Number(instructorB.id);

    const [inactiveInstructor] = await sql`
      INSERT INTO instructors (name, email, active, school_id, is_admin)
      VALUES (
        'Curriculum Inactive Instructor',
        ${`curriculum-inactive-${runKey}@example.test`},
        FALSE,
        ${schoolAId},
        FALSE
      )
      RETURNING id
    `;
    inactiveInstructorId = Number(inactiveInstructor.id);

    const [admin] = await sql`
      INSERT INTO admin_users (
        name,
        email,
        password_hash,
        role,
        active,
        school_id
      )
      VALUES (
        'Curriculum Test Admin',
        ${`curriculum-admin-${runKey}@example.test`},
        'not-a-real-password-hash',
        'admin',
        TRUE,
        ${schoolAId}
      )
      RETURNING id
    `;
    adminId = Number(admin.id);
  });

  test.afterAll(async () => {
    if (!shouldRun || !sql) return;
    await cleanSchool(schoolAId);
    await cleanSchool(schoolBId);
  });

  test('migration is idempotent and active same-school actors are enforced', async () => {
    const constraints = await sql`
      SELECT conname
      FROM pg_constraint
      WHERE conname IN (
        'curriculum_contribution_link_contract',
        'curriculum_topic_connections_left_topic_id_school_id_fkey',
        'curriculum_topic_connections_right_topic_id_school_id_fkey'
      )
      ORDER BY conname
    `;
    expect(constraints.map((row) => row.conname)).toContain(
      'curriculum_contribution_link_contract'
    );

    const instructorBootstrap = await callCurriculum('bootstrap');
    expect(instructorBootstrap.statusCode).toBe(200);
    expect(instructorBootstrap.body.actor).toMatchObject({
      id: instructorAId,
      type: 'instructor',
      is_admin: false
    });
    expect(instructorBootstrap.body.topics).toHaveLength(3);

    const adminBootstrap = await callCurriculum('bootstrap', {
      role: 'admin',
      actorId: adminId
    });
    expect(adminBootstrap.statusCode).toBe(200);
    expect(adminBootstrap.body.actor).toMatchObject({
      id: adminId,
      type: 'admin',
      is_admin: true
    });

    const inactiveBootstrap = await callCurriculum('bootstrap', {
      actorId: inactiveInstructorId
    });
    expect(inactiveBootstrap.statusCode).toBe(403);
    expect(inactiveBootstrap.body.code).toBe('INSTRUCTOR_INACTIVE');

    const schoolBTopicId = await createTopic('School B only', {
      schoolId: schoolBId,
      actorId: await (async () => {
        const [instructor] = await sql`
          INSERT INTO instructors (name, email, active, school_id, is_admin)
          VALUES (
            'Curriculum School B Instructor',
            ${`curriculum-school-b-${runKey}@example.test`},
            TRUE,
            ${schoolBId},
            FALSE
          )
          RETURNING id
        `;
        return Number(instructor.id);
      })()
    });
    const crossSchoolRead = await callCurriculum('topic', {
      query: { id: schoolBTopicId }
    });
    expect(crossSchoolRead.statusCode).toBe(404);
    expect(crossSchoolRead.body.code).toBe('TOPIC_NOT_FOUND');

    const staleAdminClaim = await callCurriculum('admin-topic', {
      method: 'POST',
      body: {
        topic_id: instructorBootstrap.body.topics[0].id,
        operation: 'archive'
      },
      isAdmin: true
    });
    expect(staleAdminClaim.statusCode).toBe(403);
    expect(staleAdminClaim.body.code).toBe('ADMIN_REQUIRED');
  });

  test('ownership and invalid cross-school topic connections are rejected', async () => {
    const topicId = await createTopic('Ownership');
    const linkedTopicId = await createTopic('Connection target');
    const [schoolBTopic] = await sql`
      SELECT id
      FROM curriculum_topics
      WHERE school_id = ${schoolBId}
        AND archived_at IS NULL
        AND merged_into_topic_id IS NULL
      ORDER BY id
      LIMIT 1
    `;

    const created = await callCurriculum('create-contribution', {
      method: 'POST',
      body: {
        topic_id: topicId,
        prompt_key: 'understand',
        body: 'Original words from instructor A'
      }
    });
    expect(created.statusCode).toBe(201);
    const contributionId = Number(created.body.contribution.id);

    const otherInstructorEdit = await callCurriculum('edit-contribution', {
      method: 'POST',
      actorId: instructorBId,
      body: {
        id: contributionId,
        body: 'Instructor B must not overwrite this'
      }
    });
    expect(otherInstructorEdit.statusCode).toBe(403);
    expect(otherInstructorEdit.body.code).toBe('NOT_CONTRIBUTION_OWNER');

    const ownerEdit = await callCurriculum('edit-contribution', {
      method: 'POST',
      body: {
        id: contributionId,
        body: 'Owner-approved edit'
      }
    });
    expect(ownerEdit.statusCode).toBe(200);
    expect(ownerEdit.body.contribution.body).toBe('Owner-approved edit');

    const invalidLinkedResponse = await callCurriculum('create-contribution', {
      method: 'POST',
      body: {
        topic_id: topicId,
        prompt_key: 'understand',
        parent_contribution_id: contributionId,
        response_type: 'build_on',
        linked_topic_id: linkedTopicId,
        body: 'This response type must not smuggle a topic link'
      }
    });
    expect(invalidLinkedResponse.statusCode).toBe(400);
    expect(invalidLinkedResponse.body.code).toBe('INVALID_LINKED_TOPIC');

    const selfConnection = await callCurriculum('create-connection', {
      method: 'POST',
      body: { topic_id: topicId, related_topic_id: topicId }
    });
    expect(selfConnection.statusCode).toBe(400);
    expect(selfConnection.body.code).toBe('INVALID_CONNECTION');

    const crossSchoolConnection = await callCurriculum('create-connection', {
      method: 'POST',
      body: {
        topic_id: topicId,
        related_topic_id: Number(schoolBTopic.id)
      }
    });
    expect(crossSchoolConnection.statusCode).toBe(404);
    expect(crossSchoolConnection.body.code).toBe('TOPIC_NOT_FOUND');

    const validConnection = await callCurriculum('create-connection', {
      method: 'POST',
      body: {
        topic_id: topicId,
        related_topic_id: linkedTopicId,
        label: 'Integration-tested connection'
      }
    });
    expect(validConnection.statusCode).toBe(201);

    const storedConnections = await sql`
      SELECT school_id, left_topic_id, right_topic_id
      FROM curriculum_topic_connections
      WHERE school_id = ${schoolAId}
        AND id = ${validConnection.body.connection.id}
    `;
    expect(storedConnections).toHaveLength(1);
    expect(Number(storedConnections[0].school_id)).toBe(schoolAId);
  });

  test('archive and merge preserve redirects, prevent cycles, and write audits', async () => {
    const archiveTopicId = await createTopic('Archive');
    const mergeSourceId = await createTopic('Merge source');
    const mergeChildId = await createTopic('Merge child', {
      parentTopicId: mergeSourceId
    });
    const mergeTargetId = await createTopic('Merge target');

    const mergeCycle = await callCurriculum('admin-topic', {
      method: 'POST',
      role: 'admin',
      actorId: adminId,
      body: {
        topic_id: mergeSourceId,
        operation: 'merge',
        target_topic_id: mergeChildId
      }
    });
    expect(mergeCycle.statusCode).toBe(409);
    expect(mergeCycle.body.code).toBe('MERGE_CYCLE');

    const archived = await callCurriculum('admin-topic', {
      method: 'POST',
      role: 'admin',
      actorId: adminId,
      body: {
        topic_id: archiveTopicId,
        operation: 'archive'
      }
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.body.topic.archived_at).toBeTruthy();

    const archivedRead = await callCurriculum('topic', {
      role: 'admin',
      actorId: adminId,
      query: { id: archiveTopicId }
    });
    expect(archivedRead.statusCode).toBe(200);
    expect(archivedRead.body.topic.archived_at).toBeTruthy();

    const merged = await callCurriculum('admin-topic', {
      method: 'POST',
      role: 'admin',
      actorId: adminId,
      body: {
        topic_id: mergeSourceId,
        operation: 'merge',
        target_topic_id: mergeTargetId
      }
    });
    expect(merged.statusCode).toBe(200);
    expect(Number(merged.body.topic.merged_into_topic_id)).toBe(mergeTargetId);

    const mergedRead = await callCurriculum('topic', {
      query: { id: mergeSourceId }
    });
    expect(mergedRead.statusCode).toBe(200);
    expect(Number(mergedRead.body.merged_into.id)).toBe(mergeTargetId);

    const [movedChild] = await sql`
      SELECT parent_topic_id
      FROM curriculum_topics
      WHERE id = ${mergeChildId}
        AND school_id = ${schoolAId}
    `;
    expect(Number(movedChild.parent_topic_id)).toBe(mergeTargetId);

    const suggestion = await callCurriculum('suggest-structure', {
      method: 'POST',
      body: {
        topic_id: mergeTargetId,
        suggestion_type: 'rename',
        details: 'Use a clearer integration-test name'
      }
    });
    expect(suggestion.statusCode).toBe(201);

    const review = await callCurriculum('review-suggestion', {
      method: 'POST',
      role: 'admin',
      actorId: adminId,
      body: {
        suggestion_id: suggestion.body.suggestion.id,
        status: 'accepted',
        review_note: 'Reviewed in the Curriculum integration test'
      }
    });
    expect(review.statusCode).toBe(200);

    const audits = await sql`
      SELECT action, target_id, school_id
      FROM audit_log
      WHERE school_id = ${schoolAId}
        AND action IN (
          'curriculum.topic_archive',
          'curriculum.topic_merge',
          'curriculum.suggestion_review'
        )
      ORDER BY action
    `;
    expect(audits.map((row) => row.action)).toEqual([
      'curriculum.suggestion_review',
      'curriculum.topic_archive',
      'curriculum.topic_merge'
    ]);
    expect(audits.every((row) => Number(row.school_id) === schoolAId)).toBe(true);
  });
});
