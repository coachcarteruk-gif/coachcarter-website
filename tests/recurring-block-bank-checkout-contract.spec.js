const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test.describe('Stage 6B1 recurring block bank checkout hold contract', () => {
  test('slots API exposes a learner-only reserved-block bank checkout action', () => {
    const source = read('api/slots.js');
    const handler = functionBody(source, 'handleRecurringBlockBankCheckout');

    expect(source).toContain("if (action === 'recurring-block-bank-checkout') return handleRecurringBlockBankCheckout(req, res);");
    expect(handler).toContain('const user = verifyAuth(req);');
    expect(handler).toContain('const schoolId = user.school_id || 1;');
    expect(handler).toContain('anchorBookingId: anchor_booking_id');
    expect(handler).toContain('learnerId: user.id');
    expect(handler).toContain('schoolId');
  });

  test('bank checkout rebuilds preview server-side and is reserved-block specific', () => {
    const source = read('api/slots.js');
    const handler = functionBody(source, 'handleRecurringBlockBankCheckout');

    expect(handler).toContain('buildRecurringBlockPreview(sql, {');
    expect(handler).toContain("code: 'SLOTS_UNAVAILABLE'");
    expect(handler).toContain("code: 'LESSON_CREDIT_AVAILABLE'");
    expect(handler).toContain("payment_type: 'recurring_block_bank_checkout'");
    expect(handler).toContain("funding_method: hold.block.funding_method");
    expect(handler).not.toContain('req.body.price');
    expect(handler).not.toContain('req.body.amount');
    expect(handler).not.toContain('req.body.payment_method');
  });

  test('hold transaction creates pending block and held items only', () => {
    const source = read('api/slots.js');
    const transaction = functionBody(source, 'createRecurringBlockBankHoldTransaction');

    expect(transaction).toContain("'pending_payment', 'bank_payment'");
    expect(transaction).toContain("status = 'held'");
    expect(transaction).toContain("status = 'released'");
    expect(transaction).toContain("NOW() + ($13::int * INTERVAL '1 minute')");
    expect(transaction).toContain('INSERT INTO recurring_slot_blocks');
    expect(transaction).toContain('INSERT INTO recurring_slot_block_items');
    expect(transaction).not.toContain('INSERT INTO lesson_bookings');
    expect(transaction).not.toContain('learner_credit_balances');
    expect(transaction).not.toContain('booking_credit_sources');
    expect(transaction).not.toContain('lockBalanceAdjustLCB');
  });

  test('unavailable slots fail all-or-nothing before payment conversion work exists', () => {
    const source = read('api/slots.js');
    const transaction = functionBody(source, 'createRecurringBlockBankHoldTransaction');
    const handler = functionBody(source, 'handleRecurringBlockBankCheckout');

    expect(transaction).toContain('bookingConflicts');
    expect(transaction).toContain('reservationConflicts');
    expect(transaction).toContain('offerConflicts');
    expect(transaction).toContain('heldConflicts');
    expect(transaction).toContain("code: 'SLOTS_UNAVAILABLE'");
    expect(transaction).toContain('abortRecurringBankHold({');
    expect(handler).toContain("message: 'One or more selected slots are no longer available. Please refresh the preview.'");
    expect(handler).not.toContain('handleRecurringBlockBankPaymentSuccess');
    expect(read('api/webhook.js')).not.toContain('recurring_block_bank_checkout');
  });

  test('Checkout uses product-scoped bank payment configuration without manual method lists', () => {
    const source = read('api/slots.js');
    const helper = read('api/_stripe-payment-methods.js');
    const handler = functionBody(source, 'handleRecurringBlockBankCheckout');

    expect(helper).toContain("STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION");
    expect(helper).toContain('payment_method_configuration: configurationId');
    expect(handler).toContain('getReservedBlockBankCheckoutPaymentOptions()');
    expect(handler).toContain('...bankPaymentOptions');
    expect(handler).toContain('excluded_payment_method_types: CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES');
    expect(handler).not.toMatch(/(^|[^_])payment_method_types\s*:/);
    expect(handler).not.toContain('allow_promotion_codes');
  });

  test('project docs record the new action and its non-goals', () => {
    const project = read('PROJECT.md');

    expect(project).toContain('STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION');
    expect(project).toContain('`recurring-block-bank-checkout` | POST | Learner');
    expect(project).toContain('Does not create `lesson_bookings`, mutate `learner_credit_balances`, write BCS rows');
    expect(project).toContain('webhook conversion, notifications, and expiry cron remain later slices');
  });
});
