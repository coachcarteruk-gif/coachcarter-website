const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

test('numbered migrations include the lesson-request schema expected by live code', () => {
  const migration = read('db/migrations/034_lesson_requests.sql');

  expect(migration).toContain('ALTER TABLE instructors ADD COLUMN IF NOT EXISTS request_to_book BOOLEAN NOT NULL DEFAULT FALSE');
  expect(migration).toContain('CREATE TABLE IF NOT EXISTS lesson_requests');
  expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_request_slot');
  expect(migration).toContain("'request_hold'");
  expect(migration).toContain("'request_refund'");
});

test('paid-session reconciliation tracks every checkout flow that can require webhook conversion', () => {
  const reconcile = read('api/cron-reconcile-payments.js');

  for (const paymentType of [
    'credit_purchase',
    'slot_booking',
    'lesson_offer',
    'lesson_request_hold',
    'recurring_block_bank_checkout',
  ]) {
    expect(reconcile).toContain(`'${paymentType}'`);
  }

  expect(reconcile).toContain('FROM credit_transactions');
  expect(reconcile).toContain('FROM lesson_requests');
  expect(reconcile).toContain('FROM recurring_slot_blocks');
});
