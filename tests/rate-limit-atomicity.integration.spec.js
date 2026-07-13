// @ts-check
// Real-Postgres coverage for the shared rate limiter and its aggregate
// migration. Run with CC_TEST_DB=1 and POSTGRES_URL_TEST set to an isolated
// Neon branch.

const { test, expect } = require('@playwright/test');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { checkRateLimit } = require('../api/_rate-limit');

(function loadEnvLocal() {
  try {
    const envPath = path.resolve(__dirname, '..', '.env.local');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  } catch (error) {
    console.warn('[rate-limit-atomicity.integration] .env.local load failed:', error.message);
  }
})();

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
const migrationSql = fs.readFileSync(path.resolve(__dirname, '..', 'db', 'migration.sql'), 'utf8');

function rateLimitMigrationBlock() {
  const sectionStart = migrationSql.indexOf('CREATE TABLE IF NOT EXISTS rate_limits');
  const blockStart = migrationSql.indexOf('DO $$', sectionStart);
  const blockEnd = migrationSql.indexOf('END $$;', blockStart);
  if (sectionStart < 0 || blockStart < 0 || blockEnd < 0) {
    throw new Error('Could not find the rate_limits deduplication migration block');
  }
  return migrationSql.slice(blockStart, blockEnd + 'END $$;'.length);
}

test.describe('shared rate limiter — real Postgres integration', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run.');

  let sql;
  const testKeys = new Set();

  test.beforeAll(async () => {
    if (!ENABLED) return;
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL === process.env.POSTGRES_URL_TEST) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL. Use an isolated test branch.');
    }

    sql = neon(process.env.POSTGRES_URL_TEST);
    await sql`
      CREATE TABLE IF NOT EXISTS rate_limits (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 1,
        window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql(rateLimitMigrationBlock());
  });

  test.afterAll(async () => {
    if (!ENABLED || !sql) return;
    for (const key of testKeys) {
      await sql`DELETE FROM rate_limits WHERE key = ${key}`;
    }
  });

  function uniqueKey(prefix) {
    const key = `${prefix}:${crypto.randomBytes(8).toString('hex')}`;
    testKeys.add(key);
    return key;
  }

  test('migration keeps the newest duplicate and is idempotent', async () => {
    const fixtureTable = `rl_fix_${crypto.randomBytes(5).toString('hex')}`;
    const fixtureBlock = rateLimitMigrationBlock().replaceAll('rate_limits', fixtureTable);

    try {
      await sql(`
        CREATE TABLE ${fixtureTable} (
          id SERIAL PRIMARY KEY,
          key TEXT NOT NULL,
          request_count INTEGER NOT NULL DEFAULT 1,
          window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await sql(`
        INSERT INTO ${fixtureTable} (key, request_count, window_start) VALUES
          ('duplicate', 2, NOW() - INTERVAL '2 hours'),
          ('duplicate', 4, NOW() - INTERVAL '1 hour'),
          ('duplicate', 7, NOW() - INTERVAL '1 hour'),
          ('other', 1, NOW())
      `);

      await sql(fixtureBlock);
      await sql(fixtureBlock);

      const rows = await sql(`
        SELECT key, request_count
        FROM ${fixtureTable}
        ORDER BY key
      `);
      expect(rows).toEqual([
        { key: 'duplicate', request_count: 7 },
        { key: 'other', request_count: 1 },
      ]);

      await expect(sql(`
        INSERT INTO ${fixtureTable} (key, request_count)
        VALUES ('duplicate', 99)
      `)).rejects.toThrow();
    } finally {
      await sql(`DROP TABLE IF EXISTS ${fixtureTable}`);
    }
  });

  test('concurrent calls keep one row and every increment', async () => {
    const key = uniqueKey('rate_limit_concurrent');

    const results = await Promise.all(Array.from({ length: 20 }, () =>
      checkRateLimit(sql, { key, max: 10, windowSeconds: 3600 })
    ));

    const rows = await sql`
      SELECT request_count FROM rate_limits WHERE key = ${key}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].request_count).toBe(20);
    expect(results.filter((result) => result.allowed)).toHaveLength(10);
    expect(results.filter((result) => !result.allowed)).toHaveLength(10);
  });

  test('short windows do not remove longer-window counters', async () => {
    const longKey = uniqueKey('rate_limit_long');
    const shortKey = uniqueKey('rate_limit_short');

    await checkRateLimit(sql, { key: longKey, max: 5, windowSeconds: 3600 });
    await sql`
      UPDATE rate_limits
      SET window_start = NOW() - INTERVAL '61 seconds'
      WHERE key = ${longKey}
    `;

    await checkRateLimit(sql, { key: shortKey, max: 5, windowSeconds: 60 });
    const result = await checkRateLimit(sql, { key: longKey, max: 5, windowSeconds: 3600 });

    expect(result).toEqual({ allowed: true, remaining: 3 });
    const [row] = await sql`SELECT request_count FROM rate_limits WHERE key = ${longKey}`;
    expect(row.request_count).toBe(2);
  });

  test('an expired window resets atomically to count one', async () => {
    const key = uniqueKey('rate_limit_expired');

    await sql`
      INSERT INTO rate_limits (key, request_count, window_start)
      VALUES (${key}, 9, NOW() - INTERVAL '61 seconds')
    `;

    const result = await checkRateLimit(sql, { key, max: 3, windowSeconds: 60 });
    expect(result).toEqual({ allowed: true, remaining: 2 });

    const [row] = await sql`
      SELECT request_count, window_start > NOW() - INTERVAL '5 seconds' AS window_is_fresh
      FROM rate_limits
      WHERE key = ${key}
    `;
    expect(row.request_count).toBe(1);
    expect(row.window_is_fresh).toBe(true);
  });
});
