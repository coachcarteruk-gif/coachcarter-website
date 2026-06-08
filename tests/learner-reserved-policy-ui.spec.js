const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test.describe('learner reserved policy move UI', () => {
  test('renders Move reserved lesson only for policy-open reserved bookings', () => {
    const lessonsJs = read('public/learner/lessons.js');

    expect(lessonsJs).toContain('var isReserved = !!b.is_reserved_weekly_slot;');
    expect(lessonsJs).toContain('var canReservedMove = canAct && isReserved && b.reserved_move_policy_open === true;');
    expect(lessonsJs).toContain('var canReschedule = canAct && !isReserved && hoursUntil >= 48');
    expect(lessonsJs).toContain("? 'Move reserved lesson'");
    expect(lessonsJs).toContain("? 'reserved_move=' : 'reschedule='");
    expect(lessonsJs).toContain('After that, your instructor or admin can review goodwill moves.');
  });

  test('ordinary copy and booking-page action stay separate from reserved policy moves', () => {
    const lessonsJs = read('public/learner/lessons.js');
    const bookJs = read('public/learner/book.js');

    expect(lessonsJs).toContain("'Reschedule lesson'");
    expect(bookJs).toContain("const reservedMoveBookingId = params.get('reserved_move');");
    expect(bookJs).toContain("const action = isReservedMove ? 'reserved-policy-move' : 'reschedule';");
    expect(bookJs).toContain('No balance change. This moves one Reserved Weekly Slot occurrence and releases the old weekly slot.');
  });

  test('does not add refund, payment, payout, or recurring payment controls', () => {
    const lessonsHtml = read('public/learner/lessons.html');
    const lessonsJs = read('public/learner/lessons.js');
    const bookJs = read('public/learner/book.js');
    const combined = [lessonsHtml, lessonsJs, bookJs].join('\n');

    expect(combined).not.toContain('execute-refund');
    expect(combined).not.toContain('stripe.refunds.create');
    expect(combined).not.toContain('payout_line_items');
    expect(combined).not.toContain('pay-by-bank');
    expect(combined).not.toContain('klarna');
    expect(combined).not.toContain('recurring-block-checkout');
  });
});
