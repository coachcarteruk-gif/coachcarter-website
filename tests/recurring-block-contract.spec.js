const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test.describe('recurring weekly block foundation contract', () => {
  test('migration adds a dedicated block and item model separate from bookings and slot reservations', () => {
    const migration = read('db/migration.sql');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS recurring_slot_blocks');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS recurring_slot_block_items');
    expect(migration).toContain("status                     TEXT NOT NULL CHECK (status IN ('pending_payment', 'confirmed', 'payment_failed', 'expired', 'released'))");
    expect(migration).toContain("status            TEXT NOT NULL CHECK (status IN ('held', 'booked', 'released'))");
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_recurring_held_slot');
    expect(migration).toContain('WHERE status = \'held\'');
    expect(migration).not.toContain('ALTER TABLE slot_reservations ADD COLUMN IF NOT EXISTS recurring');
    expect(migration).not.toContain('ALTER TABLE lesson_offers ADD COLUMN IF NOT EXISTS recurring_slot_block_id');
  });

  test('slots API exposes preview, credit commit, and bank-payment hold paths without manual payment method lists', () => {
    const source = read('api/slots.js');

    expect(source).toContain("if (action === 'recurring-block-preview') return handleRecurringBlockPreview(req, res);");
    expect(source).toContain("if (action === 'recurring-block-commit') return handleRecurringBlockCommit(req, res);");
    expect(source).toContain("if (action === 'recurring-block-bank-checkout') return handleRecurringBlockBankCheckout(req, res);");
    expect(source).toContain('buildRecurringBlockPreview(sql, {');
    expect(source).toContain('bookCreditFundedSlotsTransaction({');
    expect(source).toContain("'confirmed', 'lesson_credit'");
    expect(source).toContain("'pending_payment', 'bank_payment'");
    expect(source).not.toContain('payment_method_types: [\'bacs_debit\']');
    expect(source).not.toContain("payment_method_types: ['bacs_debit']");
    expect(source).not.toContain("mode: 'setup'");
  });

  test('preview and commit guard school scope, instructor scope, same-instructor credit, and all-or-nothing semantics', () => {
    const source = read('api/slots.js');

    expect(source).toContain('AND lb.learner_id = ${learnerId}');
    expect(source).toContain('AND lb.school_id = ${schoolId}');
    expect(source).toContain('AND i.school_id = lb.school_id');
    expect(source).toContain('WHERE learner_id = ${learnerId}');
    expect(source).toContain('AND instructor_id = ${anchor.instructor_id}');
    expect(source).toContain('AND school_id = ${schoolId}');
    expect(source).toContain('return res.status(402).json({');
    expect(source).toContain("code: 'INSUFFICIENT_CREDIT'");
    expect(source).toContain('return res.status(409).json({');
    expect(source).toContain("code: 'SLOTS_UNAVAILABLE'");
    expect(source).toContain('selectedSlots.length === selectedLessons');
    expect(source).toContain('recurringBlock: {');
  });

  test('pending recurring holds block future availability without becoming normal bookings', () => {
    const source = read('api/slots.js');

    expect(source).toContain('FROM recurring_slot_block_items');
    expect(source).toContain("AND status = 'held'");
    expect(source).toContain('const reservations = reservationRows.concat(pendingOffers, pendingRequests, recurringHolds);');
    expect(source).toContain('for (const b of [...bookings, ...reservations])');
    expect(source).not.toContain("status, 'pending_payment'");
  });
});
