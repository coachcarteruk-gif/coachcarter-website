// Rollback-only bootstrap regression for the monolithic migration.
//
// This suite creates a unique, genuinely empty Postgres schema, applies the
// complete db/migration.sql aggregate, re-applies the moved school foundation,
// and rolls the schema back. It is triple-gated so it can run only against an
// explicitly confirmed non-production test database.

const { test, expect } = require('@playwright/test');
const { Client, neonConfig } = require('@neondatabase/serverless');
const fs = require('fs');
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
  });

  test('keeps the moved school foundation idempotent', async () => {
    const before = await client.query('SELECT COUNT(*)::INTEGER AS count FROM schools');
    await expect(client.query(schoolFoundationSql)).resolves.toBeTruthy();
    const after = await client.query('SELECT COUNT(*)::INTEGER AS count FROM schools');
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
});
