// @ts-check
// Database-backed migration rehearsal. It is gated, refuses the configured
// Production URL, and rolls the entire DDL rehearsal back.

const { test, expect } = require('@playwright/test');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const enabled = process.env.CC_TEST_DB === '1' && Boolean(process.env.POSTGRES_URL_TEST);
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'migrations', '062_interim_v1_manual_payout_settlements.sql'),
  'utf8'
);
const boundaryMigrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'migrations', '057_interim_v1_manual_settlement_boundary.sql'),
  'utf8'
).replace(/^\+--/, '--');
const productionPreflightSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'diagnostics', 'simon-manual-payout-settlement-062-preflight.sql'),
  'utf8'
).replace(/BEGIN TRANSACTION READ ONLY;/, '').replace(/ROLLBACK;\s*$/, '');
const evidenceMigrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'migrations', '061_authoritative_payout_evidence.sql'),
  'utf8'
);

test.describe('Simon manual payout settlement migration 062', () => {
  test.skip(!enabled, 'Requires CC_TEST_DB=1 and an isolated POSTGRES_URL_TEST');
  test.setTimeout(60_000);

  test('rehearses in a rolled-back non-Production transaction', async () => {
    if (process.env.POSTGRES_URL
        && process.env.POSTGRES_URL === process.env.POSTGRES_URL_TEST) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL');
    }
    const client = new Client({ connectionString: process.env.POSTGRES_URL_TEST });
    await client.connect();
    try {
      await client.query('BEGIN');
      const prerequisite = await client.query(
        `SELECT to_regclass('public.interim_v1_manual_settlement_boundaries')::text AS boundary,
                to_regclass('public.payout_funding_basis_events')::text AS funding_basis`
      );
      if (!prerequisite.rows[0].boundary) await client.query(boundaryMigrationSql);
      if (!prerequisite.rows[0].funding_basis) await client.query(evidenceMigrationSql);
      await client.query(migrationSql);
      await client.query(productionPreflightSql);

      const relations = await client.query(`
        SELECT to_regclass('public.interim_v1_manual_payout_settlements')::text AS settlements,
               to_regclass('public.interim_v1_manual_payout_settlement_bookings')::text AS bookings
      `);
      expect(relations.rows[0]).toEqual({
        settlements: 'interim_v1_manual_payout_settlements',
        bookings: 'interim_v1_manual_payout_settlement_bookings',
      });

      const moneyColumns = await client.query(`
        SELECT column_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'interim_v1_manual_payout_settlement_bookings'
           AND column_name ~ '(amount|pence|fee|currency)'
      `);
      expect(moneyColumns.rows).toEqual([]);

      const triggers = await client.query(`
        SELECT c.relname AS table_name, t.tgname AS trigger_name
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND t.tgname IN (
             'interim_v1_manual_payout_settlements_append_only',
             'interim_v1_manual_payout_bookings_append_only',
             'interim_v1_manual_payout_bookings_claim_guard',
             'payout_line_items_manual_settlement_guard',
             'school_payout_line_items_manual_settlement_guard',
             'booking_earnings_manual_settlement_guard',
             'stripe_launch_booking_earnings_manual_settlement_guard'
           )
         ORDER BY c.relname, t.tgname
      `);
      expect(triggers.rows).toHaveLength(7);
      expect(new Set(triggers.rows.map((row) => row.table_name))).toEqual(new Set([
        'interim_v1_manual_payout_settlements',
        'interim_v1_manual_payout_settlement_bookings',
        'payout_line_items',
        'school_payout_line_items',
        'booking_earnings',
        'stripe_launch_booking_earnings',
      ]));

      const rowCounts = await client.query(`
        SELECT
          (SELECT COUNT(*)::int FROM interim_v1_manual_payout_settlements) AS settlements,
          (SELECT COUNT(*)::int FROM interim_v1_manual_payout_settlement_bookings) AS bookings
      `);
      expect(rowCounts.rows[0]).toEqual({ settlements: 0, bookings: 0 });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
  });
});
