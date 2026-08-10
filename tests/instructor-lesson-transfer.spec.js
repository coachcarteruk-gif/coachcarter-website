const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

process.env.STRIPE_SECRET_KEY ||= 'sk_test_instructor_transfer_unit_test_only';
process.env.STRIPE_MODE ||= 'test';

const repoRoot = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    _headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this._headers[String(name).toLowerCase()] = value; return this; },
    getHeader(name) { return this._headers[String(name).toLowerCase()]; },
    on() { return this; },
  };
}

function mockSql(resolver) {
  return async (strings, ...values) => resolver(strings.join(' '), values);
}

function booking(overrides = {}) {
  return {
    id: 10,
    instructor_id: 4,
    school_id: 1,
    scheduled_date: '2026-08-20',
    start_time: '09:00',
    duration_minutes: 90,
    transmission_type: 'manual',
    lesson_type_slug: '90min',
    pickup_address: '1 High Street, London SW1A 1AA',
    is_reserved_weekly_slot: false,
    ...overrides,
  };
}

function targetInstructor(overrides = {}) {
  return {
    id: 6,
    name: 'New Instructor',
    email: 'new@example.com',
    phone: '07123456789',
    active: true,
    offered_lesson_types: null,
    transmission_type: 'manual',
    min_booking_notice_hours: 1,
    max_booking_days_ahead: 84,
    ...overrides,
  };
}

test.describe('instructor lesson transfer', () => {
  test('authentication is required before instructor reschedule discovery', async () => {
    const handler = require('../api/instructor');
    const res = fakeRes();
    await handler({ method: 'GET', query: { action: 'reschedule-options', booking_id: '10' }, headers: {}, cookies: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Unauthorised');
  });

  test('server availability validator blocks overlapping lessons in the selected school scope', async () => {
    const { validateInstructorRescheduleSlot, InstructorRescheduleSlotError } = require('../api/_instructor-reschedule-slot');
    const seen = [];
    const sql = mockSql((query, values) => {
      seen.push({ query, values });
      if (query.includes('FROM instructors')) return [targetInstructor()];
      if (query.includes('FROM lesson_bookings') && query.includes('start_time <')) return [{ id: 99 }];
      throw new Error(`Unexpected query: ${query}`);
    });

    await expect(validateInstructorRescheduleSlot(sql, {
      schoolId: 1,
      booking: booking(),
      targetInstructorId: 6,
      newDate: '2026-08-11',
      newStartTime: '10:00',
      now: new Date('2026-08-10T08:00:00Z'),
    })).rejects.toMatchObject({
      name: InstructorRescheduleSlotError.name,
      code: 'LESSON_CONFLICT',
      status: 409,
    });

    expect(seen[0].values).toContain(1);
    expect(seen[1].values).toContain(1);
    expect(seen[1].query).toContain('school_id =');
  });

  test('server availability validator checks every blocking read model and accepts a clear slot', async () => {
    const { validateInstructorRescheduleSlot } = require('../api/_instructor-reschedule-slot');
    const queried = [];
    const sql = mockSql((query) => {
      queried.push(query);
      if (query.includes('FROM instructors')) return [targetInstructor()];
      if (query.includes('FROM instructor_availability') && !query.includes('overrides')) {
        return [{ start_time: '08:00:00', end_time: '18:00:00', transmission_type: 'both' }];
      }
      return [];
    });

    const result = await validateInstructorRescheduleSlot(sql, {
      schoolId: 1,
      booking: booking(),
      targetInstructorId: 6,
      newDate: '2026-08-11',
      newStartTime: '10:00',
      now: new Date('2026-08-10T08:00:00Z'),
      geocode: async () => ({}),
    });

    expect(result.newEndTime).toBe('11:30');
    for (const table of [
      'lesson_bookings',
      'slot_reservations',
      'lesson_requests',
      'lesson_offers',
      'recurring_slot_block_items',
      'instructor_availability_overrides',
      'instructor_blackout_dates',
      'instructor_availability',
      'instructor_external_events',
      'instructor_busy_blocks',
    ]) {
      expect(queried.some(query => query.includes(table)), `missing ${table} check`).toBe(true);
    }
  });

  test('reserved weekly lessons cannot switch instructor', async () => {
    const { validateInstructorRescheduleSlot } = require('../api/_instructor-reschedule-slot');
    const sql = mockSql(query => query.includes('FROM instructors') ? [targetInstructor()] : []);
    await expect(validateInstructorRescheduleSlot(sql, {
      schoolId: 1,
      booking: booking({ is_reserved_weekly_slot: true }),
      targetInstructorId: 6,
      newDate: '2026-08-11',
      newStartTime: '10:00',
      now: new Date('2026-08-10T08:00:00Z'),
    })).rejects.toMatchObject({ code: 'RESERVED_TRANSFER_NOT_SUPPORTED' });
  });

  test('migration 042 accounting remains balanced and replaces BCS attribution', async () => {
    const { transferBookingFunding } = require('../api/_instructor-switch-transfer');
    const calls = [];
    const client = {
      async query(text, values) {
        calls.push({ text, values });
        if (text.includes('FROM booking_credit_sources bcs')) {
          return {
            rowCount: 1,
            rows: [{
              booking_credit_source_id: 44,
              credit_transaction_id: 55,
              origin_credit_transaction_id: 55,
              minutes_drawn: 90,
              rate_pence_per_minute: 61,
              contribution_pence: 5490,
              stripe_fee_pence: 103,
              absorbed_by: null,
            }],
          };
        }
        if (text.includes("'instructor_transfer_in'")) return { rowCount: 1, rows: [{ id: 66 }] };
        return { rowCount: 1, rows: [] };
      },
    };

    const result = await transferBookingFunding(client, {
      oldBookingId: 10,
      newBookingId: 11,
      learnerId: 12,
      oldInstructorId: 4,
      newInstructorId: 6,
      schoolId: 1,
    });
    const transferOut = calls.find(call => call.text.includes("'instructor_transfer_out'"));
    const transferIn = calls.find(call => call.text.includes("'instructor_transfer_in'"));
    const replacementBcs = calls.find(call => call.text.includes('INSERT INTO booking_credit_sources'));

    expect(transferOut.values[3] + transferIn.values[3]).toBe(0);
    expect(result.transferredMinutes).toBe(90);
    expect(replacementBcs.values.slice(0, 4)).toEqual([1, 11, 66, 90]);
  });

  test('confirmation is atomic, preserves price/payment snapshots, and attributes payout to the replacement instructor', () => {
    const instructorApi = read('api/instructor.js');
    const payout = read('api/_payout-helpers.js');
    const activeHandler = instructorApi.slice(instructorApi.indexOf('async function handleRescheduleBooking'));

    expect(activeHandler).toContain('withNeonTransaction(process.env.POSTGRES_URL');
    expect(activeHandler).toContain('validateInstructorRescheduleSlot(txSql');
    expect(activeHandler).toContain('transferBookingFunding(client');
    expect(activeHandler).toContain('stripe_fee_pence, stripe_fee_source, list_price_pence, list_price_source');
    expect(activeHandler).toContain('booking.learner_id, targetInstructorId');
    expect(payout).toContain('WHERE lb.instructor_id = ${instructorId}');
    expect(payout).toContain('lb.status = ${CHARGEABLE}');
  });

  test('notifications identify both instructors and both slots for every party', () => {
    const instructorApi = read('api/instructor.js');
    const notification = instructorApi.slice(
      instructorApi.indexOf('async function notifyInstructorReschedule'),
      instructorApi.indexOf('async function loadManagedInstructorRescheduleBooking')
    );
    expect(notification).toContain('with ${booking.old_instructor_name}');
    expect(notification).toContain('with ${targetInstructor.name}');
    expect(notification).toContain('booking.learner_email');
    expect(notification).toContain('booking.old_instructor_email');
    expect(notification).toContain('targetInstructor.email');
    expect(notification).toContain('normal Friday payout');
    expect(notification).toContain('not been charged again');
  });

  test('shared instructor UI defaults the selector and uses server preview plus confirmation recheck', () => {
    const sharedUi = read('public/shared/instructor-booking-actions.js');
    const calendarUi = read('public/instructor/index.js');
    expect(sharedUi).toContain('id="ba-resch-instructor"');
    expect(sharedUi).toContain("select.value = String(data.current_instructor_id)");
    expect(sharedUi).toContain("action: 'reschedule-availability'");
    expect(sharedUi).toContain('new_instructor_id: newInstructorId');
    expect(sharedUi).toContain('btn.disabled = true');
    expect(calendarUi).toContain('BookingActions.openReschedule(booking)');
  });
});
