const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'migrate-instructor-learner-archive.js'),
  'utf8'
);

test.describe('targeted instructor learner archive migration', () => {
  test('is POST-only and protected by the migration secret', () => {
    expect(source).toContain("req.method !== 'POST'");
    expect(source).toContain("req.headers['x-migration-secret']");
    expect(source).toContain('safeEqual(secret, process.env.MIGRATION_SECRET)');
  });

  test('uses only the configured owner connection for schema changes', () => {
    expect(source).toContain('process.env.POSTGRES_URL_NON_POOLING');
    expect(source).toContain("Owner database connection is not configured");
    expect(source).toContain('const sql = neon(ownerConnectionString)');
    expect(source).not.toContain('neon(process.env.POSTGRES_URL)');
  });

  test('only adds the archive column and its partial index idempotently', () => {
    expect(source).toContain('ALTER TABLE instructor_learner_notes');
    expect(source).toContain('ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ');
    expect(source).toContain('CREATE INDEX IF NOT EXISTS idx_instructor_learner_notes_archived');
    expect(source).toContain('WHERE archived_at IS NOT NULL');
    expect(source).not.toMatch(/\b(?:UPDATE|DELETE|INSERT)\b/);
  });

  test('verifies both schema objects before reporting success', () => {
    expect(source).toContain("table_name = 'instructor_learner_notes'");
    expect(source).toContain("column_name = 'archived_at'");
    expect(source).toContain("indexname = 'idx_instructor_learner_notes_archived'");
    expect(source).toContain('verification?.column_exists === true');
    expect(source).toContain('verification?.index_exists === true');
    expect(source).toContain('res.status(success ? 200 : 500)');
  });
});
