const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

process.env.STRIPE_SECRET_KEY ||= 'sk_test_admin_lesson_transfer_unit_test_only';
process.env.STRIPE_MODE ||= 'test';

const repoRoot = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    on() { return this; },
  };
}

test.describe('admin lesson reschedule and instructor transfer', () => {
  for (const action of ['reschedule-options', 'reschedule-availability', 'reschedule-booking']) {
    test(`${action} requires admin authentication`, async () => {
      const handler = require('../api/admin');
      const res = fakeRes();
      await handler({
        method: action === 'reschedule-booking' ? 'POST' : 'GET',
        query: { action, booking_id: '10', new_instructor_id: '6', new_date: '2026-09-10', new_start_time: '10:00' },
        body: { booking_id: 10, new_instructor_id: 6, new_date: '2026-09-10', new_start_time: '10:00' },
        headers: {},
        cookies: {},
      }, res);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Unauthorised');
    });
  }

  test('admin confirmation is tenant-scoped, atomic, and preserves every funding model', () => {
    const source = read('api/admin.js');
    const start = source.indexOf('async function handleAdminRescheduleBooking');
    const end = source.indexOf('// -- POST /api/admin?action=reserved-goodwill-move', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const handler = source.slice(start, end);

    expect(handler).toContain('withNeonTransaction(process.env.POSTGRES_URL');
    expect(handler).toContain('AND school_id = $2');
    expect(handler).toContain('FOR UPDATE');
    expect(handler).toContain('validateInstructorRescheduleSlot(txSql');
    expect(handler).toContain('validateAdminFlexibleRescheduleNotice(booking)');
    expect(handler).toContain('booking.learner_id, targetInstructorId');
    expect(handler).toContain('stripe_fee_pence, stripe_fee_source, list_price_pence, list_price_source');
    expect(handler).toContain('moveFlexiblePackageBookingAllocations(client');
    expect(handler).toContain('transferBookingFunding(client');
    expect(handler).toContain('markBookingCreditSourcesRefunded(txSql');
    expect(handler).toContain('copyRefundedBookingCreditSources(txSql');
    expect(handler).toContain('SET status = $1, credit_returned = TRUE, cancelled_at = NOW()');
    expect(handler).toContain("action: 'admin.reschedule_booking'");
  });

  test('server discovery only returns eligible same-school instructors and keeps reserved lessons on their instructor', () => {
    const source = read('api/admin.js');
    const start = source.indexOf('async function handleAdminRescheduleOptions');
    const end = source.indexOf('async function handleAdminRescheduleAvailability', start);
    const handler = source.slice(start, end);

    expect(handler).toContain('listEligibleRescheduleInstructors(sql, { schoolId, booking })');
    expect(handler).toContain('if (booking.is_reserved_weekly_slot)');
    expect(handler).toContain('Number(candidate.id) === Number(booking.instructor_id)');
    expect(handler).toContain('current_instructor_id: Number(booking.instructor_id)');
  });

  test('Flexible Hours keeps its recorded 48-hour reschedule contract', () => {
    const source = read('api/admin.js');
    const start = source.indexOf('function validateAdminFlexibleRescheduleNotice');
    const end = source.indexOf('async function handleAdminRescheduleOptions', start);
    const guard = source.slice(start, end);

    expect(guard).toContain('hoursUntilFlexibleLesson({');
    expect(guard).toContain('schoolConfig: booking.school_config');
    expect(guard).toContain('hoursUntil < RESERVED_MOVE_NOTICE_HOURS');
    expect(guard).toContain("'FLEXIBLE_PACKAGE_RESCHEDULE_NOTICE_TOO_SHORT'");
  });

  test('admin UI selects instructor, date, and time and rechecks availability on confirmation', () => {
    const js = read('public/admin/portal.js');
    const html = read('public/admin/portal.html');

    expect(js).toContain('data-action="open-admin-reschedule"');
    expect(js).toContain('title="Edit lesson type, locations and notes"');
    expect(js).toContain("editDate.disabled = b.status === 'scheduled'");
    expect(js).toContain("editTime.disabled = b.status === 'scheduled'");
    expect(js).toContain("fetchAdmin('/api/admin?action=reschedule-options&booking_id='");
    expect(js).toContain("action: 'reschedule-availability'");
    expect(js).toContain("fetchAdmin('/api/admin?action=reschedule-booking'");
    expect(js).toContain('new_instructor_id: instructorId');
    expect(js).toContain('new_date: newDate');
    expect(js).toContain('new_start_time: newStartTime');
    expect(js).toContain('submit.disabled = true');
    expect(html).toContain('id="adminRescheduleInstructor"');
    expect(html).toContain('Instructor taking the lesson');
    expect(html).toContain('id="adminRescheduleDate"');
    expect(html).toContain('id="adminRescheduleStartTime"');
    expect(html).toContain('Use <strong>Reschedule lesson</strong> to change the instructor, date, or time.');
  });

  test('learner and both instructors are notified when the instructor changes', () => {
    const source = read('api/admin.js');
    const start = source.indexOf('async function notifyAdminReschedule');
    const end = source.indexOf('async function handleAdminRescheduleBooking', start);
    const notification = source.slice(start, end);

    expect(notification).toContain('booking.learner_email');
    expect(notification).toContain('booking.old_instructor_email');
    expect(notification).toContain('targetInstructor.email');
    expect(notification).toContain('with ${booking.old_instructor_name}');
    expect(notification).toContain('with ${targetInstructor.name}');
    expect(notification).toContain('not been charged again');
  });
});
