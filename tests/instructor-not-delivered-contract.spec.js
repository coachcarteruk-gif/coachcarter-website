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

test.describe('instructor not-delivered pre-payout exception', () => {
  test('endpoint is instructor-scoped, pre-payout, and credit-return only', () => {
    const source = read('api/instructor.js');
    const handler = section(
      source,
      'async function handleMarkNotDelivered(req, res) {',
      'async function handleRescheduleBooking(req, res) {'
    );

    expect(source).toContain("if (action === 'mark-not-delivered') return handleMarkNotDelivered(req, res);");
    expect(handler).toContain('verifyInstructorAuth(req)');
    expect(handler).toContain('withNeonTransaction(process.env.POSTGRES_URL');
    expect(handler).toContain('FOR UPDATE');
    expect(handler).toContain('lb.instructor_id = ${instructor.id}');
    expect(handler).toContain('COALESCE(lb.school_id, 1) = ${schoolId}');
    expect(handler).toContain('payout_line_items pli');
    expect(handler).toContain('already_paid_out');
    expect(handler).toContain('This lesson has already been included in a payout');
    expect(handler).toContain('This lesson is still upcoming. Use Cancel lesson instead.');
    expect(handler).toContain('SET status = ${REFUNDED}');
    expect(handler).toContain('credit_returned = ${minsToReturn > 0}');
    expect(handler).toContain('credit_forfeited = FALSE');
    expect(handler).toContain('markBookingCreditSourcesRefunded');
    expect(handler).toContain('lockBalanceAdjustLCB');
    expect(handler).toContain("action: 'instructor.lesson_not_delivered'");

    expect(handler).not.toContain('stripe.refunds.create');
    expect(handler).not.toContain('refund_events');
    expect(handler).not.toContain('refund_event_lines');
    expect(handler).not.toContain('UPDATE payout_line_items');
    expect(handler).not.toContain('DELETE FROM payout_line_items');
  });

  test('schedule APIs expose a server-derived unpaid past-lesson flag', () => {
    const source = read('api/instructor.js');
    const scheduleRange = section(
      source,
      'async function handleScheduleRange(req, res) {',
      '// Pending offers in the same window'
    );

    expect(scheduleRange).toContain('AS can_report_not_delivered');
    expect(scheduleRange).toContain('lb.status = ${CHARGEABLE}');
    expect(scheduleRange).toContain('lb.status = ${SCHEDULED}');
    expect(scheduleRange).toContain('(lb.scheduled_date + lb.end_time) <= NOW()');
    expect(scheduleRange).toContain('NOT EXISTS');
    expect(scheduleRange).toContain('payout_line_items pli');
  });

  test('instructor UI opens the shared mark-not-delivered action only from eligible bookings', () => {
    const shared = read('public/shared/instructor-booking-actions.js');
    const dashboard = read('public/instructor/dashboard.js');
    const calendar = read('public/instructor/index.js');

    expect(shared).toContain('/api/instructor?action=mark-not-delivered');
    expect(shared).toContain('openNotDelivered: openNotDelivered');
    expect(shared).toContain('Mark as not delivered');
    expect(shared).toContain('credit returned and payout blocked');

    expect(dashboard).toContain('b.can_report_not_delivered');
    expect(dashboard).toContain("data-action=\"not-delivered-from-detail\"");
    expect(dashboard).toContain('BookingActions.openNotDelivered');

    expect(calendar).toContain('BookingActions.init');
    expect(calendar).toContain('b.can_report_not_delivered');
    expect(calendar).toContain("data-action=\"open-not-delivered-modal\"");
    expect(calendar).toContain('BookingActions.openNotDelivered');
  });
});
