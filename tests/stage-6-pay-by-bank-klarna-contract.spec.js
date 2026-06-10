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

test.describe('Stage 6 Pay by Bank and Klarna contract', () => {
  test('decision record captures the agreed v1 product boundaries', () => {
    const doc = read('docs/pricing-booking-stage-6-pay-by-bank-klarna-decision-record.md');

    expect(doc).toContain('Klarna should be removed completely from CoachCarter checkout surfaces.');
    expect(doc).toContain('Pay by Bank should be used only for Reserved Weekly Slot blocks, not ordinary Pay As You Go bookings.');
    expect(doc).toContain('Pay As You Go should keep immediate-confirmation payment methods only');
    expect(doc).toContain('Reserved Weekly Slot bank payment is whole-block upfront only.');
    expect(doc).toContain('Reserved Weekly Slot bank payment v1 excludes card, Apple Pay, Klarna, and partial Lesson Credit plus bank payment.');
    expect(doc).toContain('Paid-In-Full Reward discounting is deferred from v1.');
    expect(doc).toContain('Bank-payment checkout holds should start with a 10-minute window.');
    expect(doc).toContain('same-instructor Lesson Credit');
    expect(doc).toContain('Cash or original-payment-method refunds remain admin/operator exceptions');
  });

  test('roadmap records resolved Stage 6 decisions and remaining verification work', () => {
    const roadmap = read('docs/pricing-booking-roadmap.md');

    expect(roadmap).toContain('Answered in `docs/pricing-booking-stage-6-pay-by-bank-klarna-decision-record.md`:');
    expect(roadmap).toContain('Klarna should be removed completely from CoachCarter checkout surfaces.');
    expect(roadmap).toContain('Stripe Pay by Bank test-mode Checkout success/failure probes passed on 2026-06-09.');
    expect(roadmap).toContain('Eligible 48h+ cancellation value for bank-paid reserved blocks should return as same-instructor Lesson Credit by default.');
    expect(roadmap).toContain('Cash/original-payment-method refunds for bank-paid reserved blocks remain admin/operator exceptions');
    expect(roadmap).toContain('Stage 6B8 production Stripe configuration audit');
    expect(roadmap).toContain('default Payment Method Configuration keeps Pay by Bank disabled and Klarna disabled');
    expect(roadmap).toContain('pmc_1TggYZIqhTSdZedSRi8AgRVd');
    expect(roadmap).toContain('0.5% + 20p per successful charge, capped at GBP 5.00');
    expect(roadmap).toContain("Stripe's processing fees from the original transaction are not returned");
    expect(roadmap).toContain('Remaining production fact still requiring confirmation is operational handling for failed or insufficient-balance Stripe refund attempts.');
    expect(roadmap).not.toContain('whether eligible 48h+ cancellation value returns as Lesson Credit, cash refund workflow, or hybrid policy');
  });

  test('production config contract pins the reserved bank env var to the reserved-block product only', () => {
    const doc = read('docs/pricing-booking-stage-6-pay-by-bank-klarna-decision-record.md');
    const project = read('PROJECT.md');

    expect(doc).toContain('Reserved Weekly Slot bank checkout is the only path that calls `getReservedBlockBankCheckoutPaymentOptions()`');
    expect(doc).toContain('reads `STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION`');
    expect(doc).toContain('the referenced Stripe Payment Method Configuration must be Pay by Bank-only for this product');
    expect(doc).toContain('Pay As You Go Checkout and offer Checkout must not use the reserved-block bank payment-method configuration');
    expect(doc).toContain('card, Apple Pay, Klarna, and partial Lesson Credit plus bank payment remain excluded');
    expect(doc).toContain('card/Apple Pay/wallet exclusion for the reserved bank product is enforced by the confirmed live `Reserved Weekly Slot` Payment Method Configuration');
    expect(doc).toContain('The reserved product configuration ID is `pmc_1TggYZIqhTSdZedSRi8AgRVd`');
    expect(doc).toContain('default Payment Method Configuration keeps Pay by Bank disabled');

    expect(project).toContain('used only by Reserved Weekly Slot Pay by Bank Checkout');
    expect(project).toContain('Pay As You Go and offers must not use this env var');
  });

  test('decision record captures confirmed and remaining live Stripe production facts', () => {
    const doc = read('docs/pricing-booking-stage-6-pay-by-bank-klarna-decision-record.md');

    expect(doc).toContain('Confirmed in the CoachCarter live Stripe Dashboard on 2026-06-10');
    expect(doc).toContain('Pay by Bank is enabled on the account.');
    expect(doc).toContain('Pay by Bank payment confirmation is immediate.');
    expect(doc).toContain('Pay by Bank recurring payments are not supported.');
    expect(doc).toContain('Pay by Bank refund support is enabled.');
    expect(doc).toContain('Pay by Bank dispute support is not available.');
    expect(doc).toContain('Pay by Bank transaction amounts are GBP 0.50 to GBP 10,000.');
    expect(doc).toContain('The `Reserved Weekly Slot` configuration has Pay by Bank enabled.');
    expect(doc).toContain('Cards, Apple Pay, Google Pay, PayPal, Klarna, and all other payment methods disabled.');
    expect(doc).toContain('Pay by Bank pricing is shown as 0.5% + 20p per successful charge, capped at GBP 5.00');
    expect(doc).toContain("Stripe Dashboard says Stripe's processing fees from the original transaction are not returned.");
    expect(doc).toContain('Stripe Dashboard says refunds normally take 5-10 days to appear on the customer\'s account.');
    expect(doc).toContain('Stripe Dashboard says refunds go back to the original payment method only');
    expect(doc).toContain('operational handling for failed or insufficient-balance Stripe refund attempts');
  });

  test('customer refund policy makes Stripe fee withholding explicit', () => {
    const terms = read('public/terms.html');
    const project = read('PROJECT.md');
    const stripeConnect = read('docs/stripe-connect.md');

    expect(terms).toContain('Stripe processing fees from the original transaction are not returned by Stripe and will be deducted from the refunded amount.');
    expect(terms).toContain('Approved Stripe refunds normally take 5-10 days to appear on the customer\'s account');
    expect(terms).toContain('can only be returned to the original payment method');
    expect(project).toContain('Stripe processing fees from the original transaction are not returned by Stripe');
    expect(stripeConnect).toContain('minus the original Stripe processing fee because Stripe does not return processing fees from the original transaction');
    expect(stripeConnect).toContain('Approved card, wallet, and Pay by Bank refunds are net of the original non-refundable Stripe processing fee.');
  });

  test('bank-paid cancellation policy returns Lesson Credit by default and leaves cash refunds operator-controlled', () => {
    const doc = read('docs/pricing-booking-stage-6-pay-by-bank-klarna-decision-record.md');
    const stripeConnect = read('docs/stripe-connect.md');
    const slots = read('api/slots.js');
    const webhook = read('api/webhook.js');
    const cancel = functionBody(slots, 'handleCancel');

    expect(doc).toContain("Confirmed bank-funded Reserved Weekly Slot occurrences are normal `lesson_bookings` rows with `payment_method='bank_payment'`");
    expect(doc).toContain('48 or more hours\' notice marks the booking `refunded`, sets `credit_returned = TRUE`, and returns the lesson duration to `learner_credit_balances`');
    expect(doc).toContain('Cash or original-payment-method refunds are exceptions for the admin/operator refund workflow.');
    expect(stripeConnect).toContain('Bank-paid Reserved Weekly Slot v1 follows the same default cancellation value rule');

    expect(webhook).toContain("'bank_payment', 'recurring_block_bank_checkout'");
    expect(cancel).toContain('const creditReturned = !isDemoBooking && hoursUntil >= CANCEL_HOURS_CUTOFF && minsToReturn > 0;');
    expect(cancel).toContain('SET status = ${REFUNDED}, cancelled_at = NOW(), credit_returned = TRUE');
    expect(cancel).toContain('lockBalanceAdjustLCB(sql, {');
    expect(cancel).not.toContain('stripe.refunds.create');
  });

  test('decision record pins observed Pay by Bank test-mode outcomes', () => {
    const doc = read('docs/pricing-booking-stage-6-pay-by-bank-klarna-decision-record.md');

    expect(doc).toContain('Pay by Bank was tested from this workspace on 2026-06-09');
    expect(doc).toContain('Checkout Session status: `complete`');
    expect(doc).toContain('Checkout Session payment status: `paid`');
    expect(doc).toContain('PaymentIntent status: `succeeded`');
    expect(doc).toContain('Checkout Session status: `open`');
    expect(doc).toContain('Checkout Session payment status: `unpaid`');
    expect(doc).toContain('PaymentIntent status: `requires_payment_method`');
    expect(doc).toContain('checkout.session.completed');
    expect(doc).toContain('checkout.session.async_payment_succeeded');
    expect(doc).toContain('payment_intent.payment_failed');
    expect(doc).toContain('charge.failed');
  });

  test('decision record does not approve broad money-flow changes', () => {
    const doc = read('docs/pricing-booking-stage-6-pay-by-bank-klarna-decision-record.md');

    expect(doc).toContain('automatic Stripe refunds for bank-paid cancellations');
    expect(doc).toContain('payout eligibility changes');
    expect(doc).toContain('BCS refund execution broadening');
    expect(doc).toContain('dual-confirmation or "did the lesson happen?" prompts');
  });
});
