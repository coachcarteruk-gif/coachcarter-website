// @ts-check
// Static contract tests for the Step 5 BCS school_id groundwork.
//
// These do not touch a database. They pin the migration and current writer
// query shape so the schema-only slice can be checked in ordinary CI.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test.describe('booking_credit_sources.school_id groundwork', () => {
  test('db migration creates and backfills explicit BCS tenant scope', () => {
    const sql = read('db/migration.sql');

    expect(sql).toContain('school_id             INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1');
    expect(sql).toContain('ALTER TABLE booking_credit_sources ADD COLUMN IF NOT EXISTS school_id INTEGER');
    expect(sql).toContain('(SELECT lb.school_id FROM lesson_bookings lb WHERE lb.id = bcs.booking_id)');
    expect(sql).toContain('(SELECT ct.school_id FROM credit_transactions ct WHERE ct.id = bcs.credit_transaction_id)');
    expect(sql).toContain('ALTER TABLE booking_credit_sources ALTER COLUMN school_id SET NOT NULL');
    expect(sql).toContain('booking_credit_sources_school_id_fkey');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_bcs_school ON booking_credit_sources(school_id)');
    expect(sql.indexOf('ALTER TABLE booking_credit_sources ADD COLUMN IF NOT EXISTS school_id INTEGER'))
      .toBeLessThan(sql.indexOf('CREATE INDEX IF NOT EXISTS idx_bcs_school ON booking_credit_sources(school_id)'));
  });

  test('targeted Step 2c migration creates school_id and index for fresh test branches', () => {
    const js = read('api/migrate-step-2c.js');

    expect(js).toContain("'idx_bcs_school'");
    expect(js).toContain('school_id             INTEGER NOT NULL REFERENCES schools(id) DEFAULT 1');
    expect(js).toContain('ALTER TABLE booking_credit_sources ADD COLUMN IF NOT EXISTS school_id INTEGER');
    expect(js).toContain('CREATE INDEX IF NOT EXISTS idx_bcs_school ON booking_credit_sources(school_id)');
  });

  test('current free-trial BCS writer stays deploy-safe before prod migration', () => {
    const js = read('api/slots.js');
    const insert = js.match(/INSERT INTO booking_credit_sources[\s\S]*?VALUES[\s\S]*?\$\{booking\.id\}[\s\S]*?'platform'\)/);

    expect(insert, 'free-trial BCS insert should still work before prod has BCS school_id').not.toBeNull();
    expect(insert[0]).not.toContain('school_id');
    expect(insert[0]).not.toContain('${schoolId}');
  });
});
