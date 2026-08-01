const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migrationSql = fs.readFileSync(
  path.join(root, 'db', 'migrations', '040_stripe_launch_payout_source_fill_once_fix.sql'),
  'utf8'
);
const aggregateSql = fs.readFileSync(path.join(root, 'db', 'migration.sql'), 'utf8');

test.describe('Stripe launch payout-source fill-once correction', () => {
  test('distinguishes SQL NULL from an already-known JSON value', () => {
    expect(migrationSql).toContain('to_jsonb(OLD)->>fill_column IS NOT NULL');
    expect(migrationSql).toContain(
      'to_jsonb(OLD)->fill_column IS DISTINCT FROM to_jsonb(NEW)->fill_column'
    );
    expect(migrationSql).not.toContain('to_jsonb(OLD)->fill_column IS NOT NULL');
  });

  test('keeps the original append-only and terminal-classification guards', () => {
    expect(migrationSql).toContain('payout funding source historic facts are immutable');
    expect(migrationSql).toContain('known payout source launch evidence cannot be replaced');
    expect(migrationSql).toContain('terminal payout source evidence classification is immutable');
    expect(migrationSql).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|COPY)\b/gim);
  });

  test('is the exact current suffix of the repository bootstrap aggregate', () => {
    const marker = '-- Stripe Connect Simon launch: forward-only correction for the Slice 1';
    const normalizedAggregate = aggregateSql.replace(/\r\n/g, '\n');
    const normalizedMigration = migrationSql.replace(/\r\n/g, '\n').trim();
    const start = normalizedAggregate.lastIndexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(normalizedAggregate.slice(start).trim()).toBe(normalizedMigration);
  });
});
