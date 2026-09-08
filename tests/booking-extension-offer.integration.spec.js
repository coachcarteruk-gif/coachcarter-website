// Transactional schema rehearsal for migration 060.
//
// Requires an isolated Neon test branch:
//   CC_TEST_DB=1 POSTGRES_URL_TEST="..." npx playwright test tests/booking-extension-offer.integration.spec.js

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { Client, neonConfig } = require('@neondatabase/serverless');

const ENABLED = process.env.CC_TEST_DB === '1' && !!process.env.POSTGRES_URL_TEST;
const migrationSql = fs.readFileSync(
  path.join(__dirname, '..', 'db', 'migrations', '060_booking_extension_offers.sql'),
  'utf8'
);

test.describe.configure({ mode: 'serial' });

test.describe('booking extension migration 060 - integration', () => {
  test.skip(() => !ENABLED, 'Set CC_TEST_DB=1 and POSTGRES_URL_TEST to run against an isolated Neon branch.');

  test('applies atomically and establishes the tenant-safe schema contract', async () => {
    if (process.env.POSTGRES_URL && process.env.POSTGRES_URL_TEST === process.env.POSTGRES_URL) {
      throw new Error('REFUSING TO RUN: POSTGRES_URL_TEST equals POSTGRES_URL. Use an isolated test branch.');
    }

    neonConfig.webSocketConstructor = globalThis.WebSocket;
    const client = new Client({ connectionString: process.env.POSTGRES_URL_TEST });
    let transactionOpen = false;

    try {
      await client.connect();
      await client.query('BEGIN');
      transactionOpen = true;
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query("SET LOCAL statement_timeout = '60s'");

      const before = await client.query(`
        SELECT column_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'lesson_offers'
           AND column_name IN (
             'extension_booking_id',
             'extension_minutes',
             'extension_base_list_price_pence'
           )
      `);
      if (before.rowCount > 0 && before.rowCount < 3) {
        throw new Error(`Test branch has a partial migration 060 shape (${before.rowCount}/3 columns).`);
      }

      await client.query(migrationSql);

      const columns = await client.query(`
        SELECT column_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'lesson_offers'
           AND column_name IN (
             'extension_booking_id',
             'extension_minutes',
             'extension_base_list_price_pence'
           )
         ORDER BY column_name
      `);
      expect(columns.rows.map(row => row.column_name)).toEqual([
        'extension_base_list_price_pence',
        'extension_booking_id',
        'extension_minutes',
      ]);

      const constraints = await client.query(`
        SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
         WHERE conrelid = 'public.lesson_offers'::regclass
           AND conname IN (
             'lesson_offers_extension_booking_school_fkey',
             'lesson_offers_extension_shape_check'
           )
         ORDER BY conname
      `);
      expect(constraints.rowCount).toBe(2);
      expect(constraints.rows.every(row => row.convalidated)).toBe(true);
      const foreignKey = constraints.rows.find(row => row.contype === 'f');
      const shapeCheck = constraints.rows.find(row => row.contype === 'c');
      expect(foreignKey.definition).toContain('FOREIGN KEY (extension_booking_id, school_id)');
      expect(foreignKey.definition).toContain('REFERENCES lesson_bookings(id, school_id)');
      expect(shapeCheck.definition).toContain('extension_minutes IS NOT NULL');
      expect(shapeCheck.definition).toContain('extension_base_list_price_pence IS NOT NULL');

      const indexes = await client.query(`
        SELECT indexrelid::regclass::text AS index_name, indisvalid, indisunique
          FROM pg_index
         WHERE indexrelid IN (
           'public.uq_lesson_offers_pending_extension'::regclass,
           'public.idx_lesson_offers_extension_booking'::regclass
         )
         ORDER BY index_name
      `);
      expect(indexes.rowCount).toBe(2);
      expect(indexes.rows.every(row => row.indisvalid)).toBe(true);
      expect(indexes.rows.find(row => row.index_name.includes('uq_lesson_offers_pending_extension')).indisunique).toBe(true);

      const refundConstraints = await client.query(`
        SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
         WHERE conrelid = 'public.refund_events'::regclass
           AND conname IN ('refund_events_refund_type_check', 'refund_events_status_check')
         ORDER BY conname
      `);
      expect(refundConstraints.rowCount).toBe(2);
      expect(refundConstraints.rows.every(row => row.convalidated)).toBe(true);
      expect(refundConstraints.rows.find(row => row.conname === 'refund_events_refund_type_check').definition)
        .toContain('booking_extension_unfulfilled');
      expect(refundConstraints.rows.find(row => row.conname === 'refund_events_status_check').definition)
        .toContain('processing');
    } finally {
      if (transactionOpen) await client.query('ROLLBACK');
      await client.end().catch(() => {});
    }
  });
});
