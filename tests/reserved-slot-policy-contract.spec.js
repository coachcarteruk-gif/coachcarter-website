const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

test.describe('reserved weekly slot policy contract', () => {
  test('decision record keeps Stage 5 policy scoped to a reserved-specific learner move', () => {
    const doc = read('docs/pricing-booking-stage-5-reserved-slot-policy-decision-record.md');

    expect(doc).toContain("lesson_bookings.status = 'scheduled'");
    expect(doc).toContain("recurring_slot_block_items.status = 'booked'");
    expect(doc).toContain('learner self-serve policy-move slice now enforces the 48-hour rule through a reserved-slot-specific endpoint');
    expect(doc).toContain("reserved_move_policy_mode = 'policy_visible_admin_override'");
    expect(doc).toContain('`POST /api/slots?action=reserved-policy-move`');
    expect(doc).toContain('under-48-hour learner attempts return `RESERVED_MOVE_NOTICE_TOO_SHORT`');
    expect(doc).toContain('Stage 5 does not broaden automatic refunds');
    expect(doc).toContain('does not add new BCS refund execution');
  });

  test('my-bookings exposes reserved-slot read fields with learner, school, and instructor scope', () => {
    const source = read('api/slots.js');
    const myBookings = section(
      source,
      'async function handleMyBookings(req, res) {',
      '// \u2500\u2500 GET /api/slots?action=series-info'
    );

    expect(myBookings).toContain('rsb.id AS recurring_slot_block_id');
    expect(myBookings).toContain('rsbi.id AS recurring_slot_block_item_id');
    expect(myBookings).toContain('AS is_reserved_weekly_slot');
    expect(myBookings).toContain('reserved_move_notice_hours');
    expect(myBookings).toContain('reserved_move_request_deadline');
    expect(myBookings).toContain('reserved_move_policy_open');
    expect(myBookings).toContain("'policy_visible_admin_override'");

    expect(myBookings).toContain('rsbi.lesson_booking_id = lb.id');
    expect(myBookings).toContain('rsbi.school_id = COALESCE(lb.school_id, 1)');
    expect(myBookings).toContain('rsbi.instructor_id = lb.instructor_id');
    expect(myBookings).toContain("rsbi.status = 'booked'");
    expect(myBookings).toContain('rsb.learner_id = lb.learner_id');
    expect(myBookings).toContain('rsb.instructor_id = lb.instructor_id');
    expect(myBookings).toContain("rsb.status = 'confirmed'");
  });

  test('Stage 5 learner reserved policy move is endpoint-specific and money-safe', () => {
    const source = read('api/slots.js');
    const handler = section(
      source,
      'async function handleReservedPolicyMove(req, res) {',
      'async function handleReschedule(req, res) {'
    );

    expect(source).toContain("if (action === 'reserved-policy-move') return handleReservedPolicyMove(req, res);");
    expect(handler).toContain('rsbi.lesson_booking_id = lb.id');
    expect(handler).toContain('rsbi.school_id = lb.school_id');
    expect(handler).toContain('rsbi.instructor_id = lb.instructor_id');
    expect(handler).toContain('rsb.learner_id = lb.learner_id');
    expect(handler).toContain('rsb.instructor_id = lb.instructor_id');
    expect(handler).toContain("rsb.status = 'confirmed'");
    expect(handler).toContain('RESERVED_MOVE_NOTICE_TOO_SHORT');
    expect(handler).toContain('ensureReservedReplacementFitsAvailability');
    expect(handler).toContain('start_time < $5::time');
    expect(handler).toContain('end_time > $4::time');
    expect(handler).toContain('status = $1,');
    expect(handler).toContain('credit_returned = TRUE');
    expect(handler).toContain("SET status = 'released'");
    expect(handler).toContain("'booked', $8");
    expect(handler).toContain("movement_type: 'reserved_policy_move'");

    expect(handler).not.toContain('learner_credit_balances');
    expect(handler).not.toContain('refund_events');
    expect(handler).not.toContain('refund_event_lines');
    expect(handler).not.toContain('stripe.refunds.create');
    expect(handler).not.toContain('payout_line_items');
    expect(handler).not.toContain('execute-refund');
    expect(handler).not.toContain('sendWhatsApp');
    expect(handler).not.toContain('sendMail');
  });

  test('Stage 5 does not broaden ordinary learner cancel or reschedule money behaviour', () => {
    const source = read('api/slots.js');
    const cancel = section(
      source,
      'async function handleCancel(req, res) {',
      '// \u2500\u2500 POST /api/slots?action=reschedule'
    );
    const reschedule = section(
      source,
      'async function handleReschedule(req, res) {',
      '// \u2500\u2500 GET /api/slots?action=my-bookings'
    );

    expect(cancel).toContain('hoursUntil >= CANCEL_HOURS_CUTOFF');
    expect(cancel).toContain('SET status = ${REFUNDED}, cancelled_at = NOW(), credit_returned = TRUE');
    expect(cancel).toContain('SET cancelled_at = NOW(), credit_returned = FALSE, credit_forfeited = TRUE');
    expect(cancel).not.toContain('recurring_slot_block_items');
    expect(cancel).not.toContain('reserved_move');
    expect(cancel).not.toContain('stripe.refunds.create');
    expect(cancel).not.toContain('payout_line_items');

    expect(reschedule).toContain('hoursUntil < CANCEL_HOURS_CUTOFF');
    expect(reschedule).toContain('RESERVED_MOVE_REQUIRES_POLICY_ENDPOINT');
    expect(reschedule).toContain('RESERVED_MOVE_NOTICE_TOO_SHORT');
    expect(reschedule).toContain('SET status = ${REFUNDED}, credit_returned = TRUE, cancelled_at = NOW()');
    expect(reschedule).toContain('${SCHEDULED}, ${booking_id}, ${booking.reschedule_count + 1}');
    expect(reschedule).not.toContain('stripe.refunds.create');
    expect(reschedule).not.toContain('payout_line_items');
  });

  test('learner My Lessons shows reserved-slot policy without adding payment or refund controls', () => {
    const html = read('public/learner/lessons.html');
    const js = read('public/learner/lessons.js');
    const bookJs = read('public/learner/book.js');

    expect(html).toContain('.reserved-policy-note');
    expect(js).toContain('Reserved weekly slot.');
    expect(js).toContain('reservedMoveCopy(b)');
    expect(js).toContain('Move reserved lesson');
    expect(js).toContain('Reschedule lesson');
    expect(js).toContain('reserved_move=');
    expect(bookJs).toContain("'reserved-policy-move'");
    expect(js).toContain('Move requests are open until');
    expect(js).toContain('Move requests and cancellation credit returns use the 48-hour policy');
    expect(js).not.toContain('recurring-block-checkout');
    expect(js).not.toContain('execute-refund');
    expect(js).not.toContain('stripe.refunds.create');
  });

  test('admin goodwill move decision and endpoint keep refund, payout, and credit ledgers out of scope', () => {
    const doc = read('docs/pricing-booking-stage-5-admin-goodwill-move-decision-record.md');
    const adminSource = read('api/admin.js');
    const handler = section(
      adminSource,
      'async function handleReservedGoodwillMove(req, res) {',
      'async function handleMarkComplete(req, res) {'
    );

    expect(doc).toContain('The move rule belongs to the Reserved Weekly Slot product, not to a payment method.');
    expect(doc).toContain('Ordinary Pay As You Go and other one-off self-serve checkout bookings keep the existing 48-hour cancellation/reschedule rule.');
    expect(doc).toContain('old item: `status = released`');
    expect(doc).toContain('new item: `status = booked`');
    expect(doc).toContain('`reserved_goodwill_admin_move`');

    expect(adminSource).toContain("if (action === 'reserved-goodwill-move') return handleReservedGoodwillMove(req, res);");
    expect(handler).toContain('rsbi.lesson_booking_id = lb.id');
    expect(handler).toContain('rsbi.school_id = lb.school_id');
    expect(handler).toContain('rsbi.instructor_id = lb.instructor_id');
    expect(handler).toContain('rsb.learner_id = lb.learner_id');
    expect(handler).toContain('rsb.instructor_id = lb.instructor_id');
    expect(handler).toContain("rsb.status = 'confirmed'");
    expect(handler).toContain('RESERVED_POLICY_MOVE_OPEN');
    expect(handler).toContain('status = $1,');
    expect(handler).toContain('credit_returned = TRUE');
    expect(handler).toContain("SET status = 'released'");
    expect(handler).toContain("'booked', $8");
    expect(handler).toContain("action: 'reserved_goodwill_admin_move'");

    expect(handler).not.toContain('learner_credit_balances');
    expect(handler).not.toContain('refund_events');
    expect(handler).not.toContain('refund_event_lines');
    expect(handler).not.toContain('stripe.refunds.create');
    expect(handler).not.toContain('payout_line_items');
    expect(handler).not.toContain('execute-refund');
  });
});
