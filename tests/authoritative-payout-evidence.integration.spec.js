// @ts-check

const { test, expect } = require('@playwright/test');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const enabled = process.env.CC_TEST_DB === '1' && Boolean(process.env.POSTGRES_URL_TEST);
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'migrations', '061_authoritative_payout_evidence.sql'),
  'utf8'
);

test.describe('authoritative payout evidence migration', () => {
  test.skip(!enabled, 'Requires CC_TEST_DB=1 and an isolated POSTGRES_URL_TEST');
  test.setTimeout(60_000);

  test('applies in a rolled-back transaction with append-only and tenant constraints', async () => {
    const client = new Client({ connectionString: process.env.POSTGRES_URL_TEST });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(migrationSql);
      const relations = await client.query(`
        SELECT to_regclass('public.payout_direct_evidence_observations')::text AS direct,
               to_regclass('public.payout_flexible_source_evidence')::text AS flexible,
               to_regclass('public.payout_funding_basis_events')::text AS basis
      `);
      expect(relations.rows[0]).toEqual({
        direct: 'payout_direct_evidence_observations',
        flexible: 'payout_flexible_source_evidence',
        basis: 'payout_funding_basis_events',
      });
      const authoritativeColumns = await client.query(`
        SELECT table_name, column_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name IN ('instructor_payouts', 'payout_line_items')
           AND column_name IN (
             'payout_value_semantics', 'payout_calculation_version',
             'actual_processing_fee_pence', 'authoritative_processing_fee_pence',
             'funding_evidence_json'
           )
         ORDER BY table_name, column_name
      `);
      expect(authoritativeColumns.rows).toEqual([
        { table_name: 'instructor_payouts', column_name: 'authoritative_processing_fee_pence' },
        { table_name: 'instructor_payouts', column_name: 'payout_calculation_version' },
        { table_name: 'instructor_payouts', column_name: 'payout_value_semantics' },
        { table_name: 'payout_line_items', column_name: 'actual_processing_fee_pence' },
        { table_name: 'payout_line_items', column_name: 'funding_evidence_json' },
        { table_name: 'payout_line_items', column_name: 'payout_calculation_version' },
        { table_name: 'payout_line_items', column_name: 'payout_value_semantics' },
      ]);
      const triggers = await client.query(`
        SELECT tgname
          FROM pg_trigger
         WHERE tgrelid IN (
           'payout_direct_evidence_observations'::regclass,
           'payout_flexible_source_evidence'::regclass,
           'payout_funding_basis_events'::regclass
         )
           AND NOT tgisinternal
         ORDER BY tgname
      `);
      expect(triggers.rows.map(row => row.tgname)).toEqual([
        'payout_direct_evidence_observations_append_only',
        'payout_flexible_source_evidence_append_only',
        'payout_funding_basis_events_append_only',
      ]);
      const supersession = await client.query(`
        SELECT pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
         WHERE conrelid = 'payout_funding_basis_events'::regclass
           AND contype = 'f'
           AND pg_get_constraintdef(oid) LIKE '%supersedes_event_id%'
      `);
      expect(supersession.rows[0]?.definition).toContain(
        'FOREIGN KEY (supersedes_event_id, school_id, booking_id, instructor_id)'
      );
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
  });
});
