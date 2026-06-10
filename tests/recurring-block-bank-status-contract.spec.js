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

test.describe('Stage 6B3 reserved recurring block bank status contract', () => {
  test('slots API exposes a learner-authenticated status action scoped to learner and school', () => {
    const source = read('api/slots.js');
    const handler = functionBody(source, 'handleRecurringBlockStatus');

    expect(source).toContain("if (action === 'recurring-block-status') return handleRecurringBlockStatus(req, res);");
    expect(handler).toContain('const user = verifyAuth(req);');
    expect(handler).toContain('const schoolId = user.school_id || 1;');
    expect(handler).toContain('block_id is required');
    expect(handler).toContain('rsb.learner_id = ${user.id}');
    expect(handler).toContain('rsb.school_id = ${schoolId}');
    expect(handler).toContain("code: 'BLOCK_NOT_FOUND'");
    expect(handler).not.toContain('err.stack');
  });

  test('status read expires stale pending bank holds and releases held items idempotently', () => {
    const source = read('api/slots.js');
    const cleanup = functionBody(source, 'expireStaleRecurringBlockBankHoldForLearner');

    expect(cleanup).toContain('FOR UPDATE');
    expect(cleanup).toContain("block.funding_method !== 'bank_payment'");
    expect(cleanup).toContain("block.status !== 'pending_payment'");
    expect(cleanup).toContain('expires_at <= NOW() AS is_stale');
    expect(cleanup).toContain("status = 'released'");
    expect(cleanup).toContain("status = 'expired'");
    expect(cleanup).toContain('learner_id = $2');
    expect(cleanup).toContain('school_id = $3');
    expect(cleanup).toContain('status_read_stale_pending_hold');
    expect(cleanup).not.toContain('INSERT INTO lesson_bookings');
    expect(cleanup).not.toContain('learner_credit_balances');
    expect(cleanup).not.toContain('booking_credit_sources');
    expect(cleanup).not.toContain('credit_transactions');
    expect(cleanup).not.toContain('stripe.refunds.create');
  });

  test('status response returns safe block, item, booking, and Stripe reference fields', () => {
    const source = read('api/slots.js');
    const handler = functionBody(source, 'handleRecurringBlockStatus');

    expect(handler).toContain('rsb.status');
    expect(handler).toContain('rsb.funding_method');
    expect(handler).toContain('rsb.selected_lessons');
    expect(handler).toContain('rsb.expires_at');
    expect(handler).toContain('rsb.stripe_payment_intent_id');
    expect(handler).toContain('rsb.stripe_checkout_session_id');
    expect(handler).toContain('rsbi.lesson_booking_id');
    expect(handler).toContain('LEFT JOIN lesson_bookings lb');
    expect(handler).toContain('bookings: normalisedItems');
    expect(handler).toContain('checkout_session_id: block.stripe_checkout_session_id || null');
    expect(handler).toContain('payment_intent_id: block.stripe_payment_intent_id || null');
    expect(handler).not.toContain('metadata: block.metadata');
    expect(handler).not.toContain('SELECT rsb.*');
  });

  test('failure after success cannot be released by the status cleanup path', () => {
    const source = read('api/slots.js');
    const cleanup = functionBody(source, 'expireStaleRecurringBlockBankHoldForLearner');
    const webhookRelease = functionBody(read('api/webhook.js'), 'releaseRecurringBlockBankHoldTransaction');

    expect(cleanup).toContain("block.status !== 'pending_payment'");
    expect(cleanup).toContain("AND status = 'pending_payment'");
    expect(webhookRelease).toContain("block.status !== 'pending_payment'");
  });

  test('booking page handles bank checkout and cancellation returns without changing Pay As You Go return handling', () => {
    const js = read('public/learner/book.js');

    expect(js).toContain("params.get('reserved_bank_checkout') === '1'");
    expect(js).toContain("params.get('reserved_bank_cancelled') === '1'");
    expect(js).toContain('/learner/login.html?redirect=');
    expect(js).toContain('handleReservedBankReturn(reservedBankBlockId');
    expect(js).toContain('/api/slots?action=recurring-block-status&block_id=');
    expect(js).toContain('renderReservedBankStatus(data, opts)');
    expect(js).toContain("params.get('paid') === '1'");
    expect(js).toContain("document.body.classList.add('cc-paid-return')");
    expect(js).toContain("window.history.replaceState({}, '', '/learner/book.html')");
  });

  test('learner copy distinguishes confirmed, pending, failed, expired, and manual review states', () => {
    const js = read('public/learner/book.js');
    const render = js.slice(js.indexOf('function renderReservedBankStatus'));

    expect(render).toContain("status === 'confirmed'");
    expect(render).toContain('Your bank payment is confirmed and your Reserved Weekly Slot lessons are booked');
    expect(render).toContain("status === 'pending_payment'");
    expect(render).toContain('Payment still processing');
    expect(render).toContain('you do not need to try again yet');
    expect(render).toContain('it may still confirm shortly');
    expect(render).toContain("status === 'payment_failed'");
    expect(render).toContain('The bank payment did not complete');
    expect(render).toContain('please choose the block again if you still want them');
    expect(render).toContain("status === 'expired'");
    expect(render).toContain('The checkout window closed before payment was confirmed');
    expect(render).toContain("status === 'released'");
    expect(render).toContain('We need to check this manually');
    expect(render).toContain('We could not finish booking this weekly block');
    expect(render).toContain('does not trigger an automatic refund');
    expect(render).not.toContain('automatic Stripe refund');
    expect(render).not.toContain('cash refund');
  });

  test('docs record status endpoint and stale pending-hold cleanup non-goals', () => {
    const project = read('PROJECT.md');
    const roadmap = read('docs/pricing-booking-roadmap.md');

    expect(project).toContain('`recurring-block-status` | GET | Learner');
    expect(project).toContain('stale `pending_payment` bank blocks');
    expect(project).toContain('does not mutate `learner_credit_balances`, write BCS rows, create credit purchase rows, or trigger Stripe refunds');
    expect(roadmap).toContain('Stage 6B3 learner-facing bank status and stale-hold cleanup');
    expect(roadmap).toContain('returns confirmed booking IDs/dates');
    expect(roadmap).toContain('Stage 6B5 bank checkout smoke and expiry decision');
    expect(roadmap).toContain('opportunistic stale-hold cleanup is enough for Reserved Weekly Slot bank checkout v1');
    expect(roadmap).toContain("funding_method='bank_payment'");
    expect(roadmap).toContain("status='pending_payment'");
    expect(roadmap).toContain('expires_at <= NOW()');
  });
});
