const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

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

test.describe('admin reserved goodwill move UI', () => {
  test('all-bookings exposes reserved metadata with school, learner, and instructor scope', () => {
    const adminSource = read('api/admin.js');
    const allBookings = section(
      adminSource,
      'async function handleAllBookings(req, res) {',
      'async function handleEditBooking(req, res) {'
    );

    expect(allBookings).toContain('rsb.id AS recurring_slot_block_id');
    expect(allBookings).toContain('rsbi.id AS recurring_slot_block_item_id');
    expect(allBookings).toContain('AS is_reserved_weekly_slot');
    expect(allBookings).toContain('reserved_move_notice_hours');
    expect(allBookings).toContain('reserved_move_request_deadline');
    expect(allBookings).toContain('reserved_move_policy_open');
    expect(allBookings).toContain('reserved_goodwill_move_open');
    expect(allBookings).toContain("'policy_visible_admin_override'");

    expect(allBookings).toContain('rsbi.lesson_booking_id = lb.id');
    expect(allBookings).toContain('rsbi.school_id = lb.school_id');
    expect(allBookings).toContain('rsbi.instructor_id = lb.instructor_id');
    expect(allBookings).toContain("rsbi.status = 'booked'");
    expect(allBookings).toContain('rsb.school_id = lb.school_id');
    expect(allBookings).toContain('rsb.learner_id = lb.learner_id');
    expect(allBookings).toContain('rsb.instructor_id = lb.instructor_id');
    expect(allBookings).toContain("rsb.status = 'confirmed'");
    expect(allBookings).toContain('lb.status = ${SCHEDULED}');
  });

  test('portal renders reserved label and safe booking actions', () => {
    const portalJs = read('public/admin/portal.js');
    const portalHtml = read('public/admin/portal.html');

    expect(portalJs).toContain('Reserved weekly slot');
    expect(portalJs).toContain('data-action="open-reserved-goodwill-move"');
    expect(portalJs).toContain('Goodwill move');
    expect(portalJs).toContain('learner self-serve move available');
    expect(portalJs).toContain('disabled title="');
    expect(portalJs).toContain('Reschedule lesson');
    expect(portalJs).toContain('title="Edit booking details"');
    expect(portalJs).toContain('!b || !b.is_reserved_weekly_slot || !b.reserved_goodwill_move_open');

    expect(portalHtml).toContain('id="modal-reserved-goodwill-move"');
    expect(portalHtml).toContain('Replacement date');
    expect(portalHtml).toContain('Replacement start time');
    expect(portalHtml).toContain('Reason');
  });

  test('portal posts the reserved-goodwill endpoint with the expected body and refreshes', () => {
    const portalJs = read('public/admin/portal.js');
    const submit = section(
      portalJs,
      'async function submitReservedGoodwillMove() {',
      '//'
    );

    expect(submit).toContain("fetchAdmin('/api/admin?action=reserved-goodwill-move'");
    expect(submit).toContain('method: \'POST\'');
    expect(submit).toContain('booking_id: reservedGoodwillBookingId');
    expect(submit).toContain('new_date: newDate');
    expect(submit).toContain('new_start_time: newStartTime');
    expect(submit).toContain('reason: reason');
    expect(submit).toContain('loadBookings();');
  });

  test('new goodwill move modal does not add refund, payment, or payout controls', () => {
    const portalJs = read('public/admin/portal.js');
    const portalHtml = read('public/admin/portal.html');
    const submit = section(
      portalJs,
      'async function submitReservedGoodwillMove() {',
      '//'
    );
    const modal = section(
      portalHtml,
      '<!-- Reserved Goodwill Move Modal -->',
      '<!-- Toast -->'
    );

    expect(submit).not.toContain('execute-refund');
    expect(submit).not.toContain('record-manual-bank-refund');
    expect(submit).not.toContain('stripe');
    expect(submit).not.toContain('payout');
    expect(submit).not.toContain('learner_credit_balances');
    expect(modal).not.toContain('Refund preview');
    expect(modal).not.toContain('Execute refund');
    expect(modal).not.toContain('Payment');
    expect(modal).not.toContain('Payout');
  });
});
