// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const { checkRateLimit } = require('../api/_rate-limit');

const repoRoot = path.resolve(__dirname, '..');

/**
 * Small deterministic rate_limits model for the shared helper. It deliberately
 * accepts only the atomic upsert contract, so a regression to SELECT + UPDATE
 * or caller-window cleanup fails these tests instead of being modelled away.
 */
function makeAtomicSql(startMs = Date.parse('2026-07-13T12:00:00.000Z')) {
  const rows = new Map();
  const calls = [];
  let nowMs = startMs;

  const sql = async (strings, ...values) => {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings);
    calls.push({ text, values });

    expect(text).toMatch(/INSERT INTO rate_limits/i);
    expect(text).toMatch(/ON CONFLICT \(key\) DO UPDATE/i);
    expect(text).toMatch(/RETURNING request_count/i);
    expect(text).not.toMatch(/DELETE FROM rate_limits/i);
    expect(text).not.toMatch(/SELECT request_count/i);

    const key = String(values[0]);
    const windowSeconds = Number(values[1]);
    const existing = rows.get(key);

    if (!existing || existing.windowStartMs <= nowMs - windowSeconds * 1000) {
      rows.set(key, { requestCount: 1, windowStartMs: nowMs });
    } else {
      existing.requestCount += 1;
    }

    return [{ request_count: rows.get(key).requestCount }];
  };

  sql.rows = rows;
  sql.calls = calls;
  sql.advance = (milliseconds) => { nowMs += milliseconds; };
  return sql;
}

test.describe('shared rate limiter atomicity and window isolation', () => {
  test('uses one atomic upsert per request', async () => {
    const sql = makeAtomicSql();

    const result = await checkRateLimit(sql, {
      key: 'admin_login_ip:203.0.113.10',
      max: 10,
      windowSeconds: 3600,
    });

    expect(result).toEqual({ allowed: true, remaining: 9 });
    expect(sql.calls).toHaveLength(1);
  });

  test('a short-window caller cannot erase a valid long-window key', async () => {
    const sql = makeAtomicSql();

    await checkRateLimit(sql, {
      key: 'admin_login_email:learner@example.test',
      max: 5,
      windowSeconds: 3600,
    });

    sql.advance(61_000);

    await checkRateLimit(sql, {
      key: 'validate_referral:203.0.113.11',
      max: 10,
      windowSeconds: 60,
    });
    const longWindowResult = await checkRateLimit(sql, {
      key: 'admin_login_email:learner@example.test',
      max: 5,
      windowSeconds: 3600,
    });

    expect(longWindowResult).toEqual({ allowed: true, remaining: 3 });
    expect(sql.rows.get('admin_login_email:learner@example.test').requestCount).toBe(2);
  });

  test('concurrent first requests produce one row and no lost increments', async () => {
    const sql = makeAtomicSql();
    const key = 'enquiry_submit:203.0.113.12';

    const results = await Promise.all(Array.from({ length: 25 }, () =>
      checkRateLimit(sql, { key, max: 25, windowSeconds: 3600 })
    ));

    expect(sql.rows.size).toBe(1);
    expect(sql.rows.get(key).requestCount).toBe(25);
    expect(results.filter((result) => result.allowed)).toHaveLength(25);
    expect(results.some((result) => result.remaining === 0)).toBe(true);
  });

  test('allows the configured maximum and rejects the next request', async () => {
    const sql = makeAtomicSql();
    const options = { key: 'learner_feedback:42', max: 3, windowSeconds: 3600 };

    expect(await checkRateLimit(sql, options)).toEqual({ allowed: true, remaining: 2 });
    expect(await checkRateLimit(sql, options)).toEqual({ allowed: true, remaining: 1 });
    expect(await checkRateLimit(sql, options)).toEqual({ allowed: true, remaining: 0 });
    expect(await checkRateLimit(sql, options)).toEqual({ allowed: false, remaining: 0 });
  });

  test('resets an expired window to count one', async () => {
    const sql = makeAtomicSql();
    const options = { key: 'address_lookup:42', max: 2, windowSeconds: 60 };

    await checkRateLimit(sql, options);
    await checkRateLimit(sql, options);
    expect(await checkRateLimit(sql, options)).toEqual({ allowed: false, remaining: 0 });

    sql.advance(60_000);

    expect(await checkRateLimit(sql, options)).toEqual({ allowed: true, remaining: 1 });
    expect(sql.rows.get(options.key).requestCount).toBe(1);
  });

  test('retains the documented fail-open response when the database fails', async () => {
    const sql = async () => { throw new Error('database unavailable'); };

    await expect(checkRateLimit(sql, {
      key: 'admin_login_ip:203.0.113.13',
      max: 10,
      windowSeconds: 3600,
    })).resolves.toEqual({ allowed: true, remaining: 10 });
  });
});

test('migration deduplicates deterministically before adding uniqueness', () => {
  const migration = fs.readFileSync(path.join(repoRoot, 'db', 'migration.sql'), 'utf8');
  const rateLimitSection = migration.slice(
    migration.indexOf('CREATE TABLE IF NOT EXISTS rate_limits'),
    migration.indexOf('-- PERFORMANCE: FOREIGN KEY INDEXES')
  );

  const dedupeAt = rateLimitSection.indexOf('DELETE FROM rate_limits AS stale');
  const uniqueAt = rateLimitSection.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limits_key_unique');

  expect(dedupeAt).toBeGreaterThan(-1);
  expect(uniqueAt).toBeGreaterThan(dedupeAt);
  expect(rateLimitSection).toContain('stale.window_start < newest.window_start');
  expect(rateLimitSection).toContain('stale.id < newest.id');
  expect(rateLimitSection).toContain('LOCK TABLE rate_limits IN ACCESS EXCLUSIVE MODE');
});

test('retention cleanup uses a fixed conservative horizon', () => {
  const retention = fs.readFileSync(path.join(repoRoot, 'api', 'cron-retention.js'), 'utf8');

  expect(retention).toContain("DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '7 days'");
  expect(retention).not.toContain("DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '2 hours'");
});
