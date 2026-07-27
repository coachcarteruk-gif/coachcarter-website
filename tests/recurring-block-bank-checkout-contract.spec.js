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

test.describe('Stage 6B reserved recurring block bank checkout/webhook contract', () => {
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
    expect(handler).toContain('payment_intent_data');
    expect(handler).toContain('metadata: recurringBlockBankMetadata');
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

  test('unavailable slots fail all-or-nothing before payment starts', () => {
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
    expect(handler).not.toContain('INSERT INTO lesson_bookings');
  });

  test('Checkout uses product-scoped bank payment configuration without manual method lists', () => {
    const source = read('api/slots.js');
    const helper = read('api/_stripe-payment-methods.js');
    const handler = functionBody(source, 'handleRecurringBlockBankCheckout');
    const paygAuth = functionBody(source, 'handleCheckoutSlot');
    const paygGuest = functionBody(source, 'handleCheckoutSlotGuest');

    expect(helper).toContain("STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION");
    expect(helper).toContain('payment_method_configuration: configurationId');
    expect(handler).toContain('getReservedBlockBankCheckoutPaymentOptions()');
    expect(handler).toContain('...bankPaymentOptions');
    expect(handler).toContain('excluded_payment_method_types: CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES');
    expect(handler).not.toMatch(/(^|[^_])payment_method_types\s*:/);
    expect(handler).not.toContain('allow_promotion_codes');

    expect(paygAuth).not.toContain('getReservedBlockBankCheckoutPaymentOptions');
    expect(paygAuth).not.toContain('payment_method_configuration');
    expect(paygGuest).not.toContain('getReservedBlockBankCheckoutPaymentOptions');
    expect(paygGuest).not.toContain('payment_method_configuration');
  });

  test('reserved bank payment configuration is not used by Pay As You Go, offers, or retired credit checkout', () => {
    const slots = read('api/slots.js');
    const offers = read('api/offers.js');
    const credits = read('api/credits.js');
    const decisionRecord = read('docs/pricing-booking-stage-6-pay-by-bank-klarna-decision-record.md');
    const project = read('PROJECT.md');

    expect((slots.match(/getReservedBlockBankCheckoutPaymentOptions\(\)/g) || []).length).toBe(1);
    expect(offers).not.toContain('getReservedBlockBankCheckoutPaymentOptions');
    expect(offers).not.toContain('STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION');
    expect(credits).not.toContain('getReservedBlockBankCheckoutPaymentOptions');
    expect(credits).not.toContain('STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION');

    expect(decisionRecord).toContain('Reserved Weekly Slot bank checkout is the only path that calls `getReservedBlockBankCheckoutPaymentOptions()`');
    expect(decisionRecord).toContain('Pay As You Go Checkout and offer Checkout must not use the reserved-block bank payment-method configuration');
    expect(project).toContain('This is the only Checkout path that may use the reserved-block bank payment-method configuration');
  });

  test('learner booking UI starts reserved-block bank checkout when same-instructor credit is insufficient', () => {
    const js = read('public/learner/book.js');

    expect(js).toContain('const canBankCheckout = !!(recurringPreview.can_commit && recurringPreview.credit && !recurringPreview.credit.has_sufficient_credit && auth);');
    expect(js).toContain("recurringConfirmMode = canCreditCommit ? 'credit' : (canBankCheckout ? 'bank' : 'credit');");
    expect(js).toContain("document.getElementById('recurringConfirmLabel').textContent = canBankCheckout ? 'Pay upfront by bank' : 'Confirm with Lesson Credit';");
    expect(js).toContain("if (recurringConfirmMode === 'bank')");
    expect(js).toContain('async function startRecurringBlockBankCheckout()');
    expect(js).toContain("/api/slots?action=recurring-block-bank-checkout");
    expect(js).toContain('window.location.href = data.url;');
    expect(js).not.toContain('The bank-payment hold option is coming later');
    expect(js).not.toContain('Klarna');
  });

  test('project docs record the new action and its non-goals', () => {
    const project = read('PROJECT.md');

    expect(project).toContain('STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION');
    expect(project).toContain('`recurring-block-bank-checkout` | POST | Learner');
    expect(project).toContain('creates `lesson_bookings` only after Stripe reports successful payment');
    expect(project).toContain('does not mutate `learner_credit_balances`, write BCS rows, or create credit purchase rows');
    expect(project).toContain('The referenced Stripe configuration must exclude card, Apple Pay, Klarna, and any non-bank method.');
    expect(project).toContain('does not support partial Lesson Credit plus bank payment');
    expect(project).toContain('Confirmed bank-paid occurrences use the existing 48h+ cancellation path to return same-instructor Lesson Credit by default');
    expect(project).toContain('cash/original-payment-method refunds remain admin/operator exceptions');
    expect(project).toContain('Notifications and expiry cron remain out of v1 scope');
  });

  test('webhook routes reserved-block bank success without changing Pay As You Go dispatch', () => {
    const source = read('api/webhook.js');

    expect(source).toContain("paymentType === 'slot_booking'");
    expect(source).toContain('await handleSlotBooking(session, payoutV2Receipt);');
    expect(source).toContain("paymentType === 'recurring_block_bank_checkout'");
    expect(source).toContain('await handleRecurringBlockBankPaymentSuccess(session);');
    expect(source).toContain('await handleRecurringBlockBankPaymentSuccess(paymentIntentToRecurringBlockSession(paymentIntent));');
  });

  test('success conversion confirms the block, books held items, and creates scheduled bookings', () => {
    const source = read('api/webhook.js');
    const conversion = functionBody(source, 'convertRecurringBlockBankHoldTransaction');

    expect(conversion).toContain("block.status === 'confirmed'");
    expect(conversion).toContain("code: 'ALREADY_CONFIRMED'");
    expect(conversion).toContain('createdBookings: []');
    expect(conversion).toContain("block.status !== 'pending_payment'");
    expect(conversion).toContain('INSERT INTO lesson_bookings');
    expect(conversion).toContain('SCHEDULED');
    expect(conversion).toContain("'bank_payment', 'recurring_block_bank_checkout'");
    expect(conversion).toContain("status = 'booked'");
    expect(conversion).toContain('lesson_booking_id = $4');
    expect(conversion).toContain("SET status = 'confirmed'");
    expect(conversion).toContain('confirmed_at = NOW()');
    expect(conversion).toContain('converted_booking_ids');
    expect(conversion).toContain('stripe_payment_intent_id = COALESCE');
    expect(conversion).not.toContain('learner_credit_balances');
    expect(conversion).not.toContain('booking_credit_sources');
    expect(conversion).not.toContain('credit_transactions');
  });

  test('success conversion releases to manual review state when slots became unavailable', () => {
    const source = read('api/webhook.js');
    const conversion = functionBody(source, 'convertRecurringBlockBankHoldTransaction');

    expect(conversion).toContain('bookingConflicts');
    expect(conversion).toContain('reservationConflicts');
    expect(conversion).toContain('offerConflicts');
    expect(conversion).toContain("release_reason: 'payment_success_slot_conflict_manual_review'");
    expect(conversion).toContain("code: 'SLOTS_UNAVAILABLE'");
    expect(conversion).not.toContain('stripe.refunds.create');
  });

  test('failure and expiry release only pending-payment blocks', () => {
    const source = read('api/webhook.js');
    const release = functionBody(source, 'releaseRecurringBlockBankHoldTransaction');
    const releaseInner = functionBody(source, 'releaseRecurringBlockBankHoldInTransaction');

    expect(source).toContain("event.type === 'checkout.session.expired'");
    expect(source).toContain("event.type === 'payment_intent.payment_failed'");
    expect(source).toContain("event.type === 'charge.failed'");
    expect(release).toContain("block.status !== 'pending_payment'");
    expect(releaseInner).toContain("status = 'released'");
    expect(releaseInner).toContain('AND status = \'held\'');
    expect(releaseInner).toContain("AND status = 'pending_payment'");
    expect(releaseInner).toContain("releaseStatus === 'expired'");
    expect(releaseInner).toContain("releaseStatus === 'payment_failed'");
  });
});
