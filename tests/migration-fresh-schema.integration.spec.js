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
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'migration.sql'),
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

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (
      process.env.POSTGRES_URL
      && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL
    ) throw new Error('Refusing fresh-schema bootstrap test: test URL equals production URL');

    if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket === 'function') {
      neonConfig.webSocketConstructor = globalThis.WebSocket;
    }
    client = new Client({ connectionString: process.env.POSTGRES_URL_TEST });
    await client.connect();
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${quotedSchema}`);
    await client.query(`SET LOCAL search_path TO ${quotedSchema}, pg_catalog`);
  });

  test.afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  test('applies the complete aggregate to an empty schema', async () => {
    const before = await client.query(`
      SELECT COUNT(*)::INTEGER AS count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
    `, [schemaName]);
    expect(before.rows[0].count).toBe(0);

    await expect(client.query(migrationSql)).resolves.toBeTruthy();

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

  test('keeps the moved school foundation idempotent', async () => {
    const before = await client.query('SELECT COUNT(*)::INTEGER AS count FROM schools');
    await expect(client.query(schoolFoundationSql)).resolves.toBeTruthy();
    const after = await client.query('SELECT COUNT(*)::INTEGER AS count FROM schools');
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  test('supports audited same-school admin access without passwords or login codes', async () => {
    const originalJwtSecret = process.env.JWT_SECRET;
    const jwtSecret = 'fresh-schema-admin-access-test-secret';
    const csrfToken = 'fresh-schema-admin-access-csrf-token';
    const statements = [];
    const sql = createClientSqlTag(client, statements);
    let loadedAdmin;

    process.env.JWT_SECRET = jwtSecret;
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
    }
  });
});
