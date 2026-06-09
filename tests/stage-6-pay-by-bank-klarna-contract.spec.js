const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
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
  });

  test('roadmap records resolved Stage 6 decisions and remaining verification work', () => {
    const roadmap = read('docs/pricing-booking-roadmap.md');

    expect(roadmap).toContain('Answered in `docs/pricing-booking-stage-6-pay-by-bank-klarna-decision-record.md`:');
    expect(roadmap).toContain('Klarna should be removed completely from CoachCarter checkout surfaces.');
    expect(roadmap).toContain('Stripe Pay by Bank is enabled on the Stripe account, but still needs a test-mode Checkout success/failure run before implementation.');
    expect(roadmap).toContain('Eligible 48h+ cancellation value for bank-paid reserved blocks should return as same-instructor Lesson Credit by default.');
    expect(roadmap).toContain('Stripe Pay by Bank test-mode success/failure behaviour for the account');
    expect(roadmap).not.toContain('whether eligible 48h+ cancellation value returns as Lesson Credit, cash refund workflow, or hybrid policy');
  });

  test('decision record does not approve broad money-flow changes', () => {
    const doc = read('docs/pricing-booking-stage-6-pay-by-bank-klarna-decision-record.md');

    expect(doc).toContain('automatic Stripe refunds for bank-paid cancellations');
    expect(doc).toContain('payout eligibility changes');
    expect(doc).toContain('BCS refund execution broadening');
    expect(doc).toContain('dual-confirmation or "did the lesson happen?" prompts');
  });
});
