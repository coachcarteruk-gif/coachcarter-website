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
  test('decision record keeps Stage 5 policy visible before mutation enforcement', () => {
    const doc = read('docs/pricing-booking-stage-5-reserved-slot-policy-decision-record.md');

    expect(doc).toContain("lesson_bookings.status = 'scheduled'");
    expect(doc).toContain("recurring_slot_block_items.status = 'booked'");
    expect(doc).toContain('Stage 5 starts with policy visibility and read-model flags');
    expect(doc).toContain("reserved_move_policy_mode = 'policy_visible_admin_override'");
    expect(doc).toContain('automatic backend enforcement is deferred');
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
    expect(myBookings).toContain('reserved_move_notice_days');
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

  test('Stage 5 does not broaden learner cancel or reschedule mutation behaviour', () => {
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
    expect(reschedule).toContain('SET status = ${REFUNDED}, credit_returned = TRUE, cancelled_at = NOW()');
    expect(reschedule).toContain('${SCHEDULED}, ${booking_id}, ${booking.reschedule_count + 1}');
    expect(reschedule).not.toContain('recurring_slot_block_items');
    expect(reschedule).not.toContain('reserved_move');
    expect(reschedule).not.toContain('stripe.refunds.create');
    expect(reschedule).not.toContain('payout_line_items');
  });

  test('learner My Lessons shows reserved-slot policy without adding payment or refund controls', () => {
    const html = read('public/learner/lessons.html');
    const js = read('public/learner/lessons.js');

    expect(html).toContain('.reserved-policy-note');
    expect(js).toContain('Reserved weekly slot.');
    expect(js).toContain('reservedMoveCopy(b)');
    expect(js).toContain('Move requests are open until');
    expect(js).toContain('cancellation credit returns still follow the 48-hour rule');
    expect(js).not.toContain('recurring-block-checkout');
    expect(js).not.toContain('execute-refund');
    expect(js).not.toContain('stripe.refunds.create');
  });
});
