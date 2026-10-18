const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { InstructorRescheduleSlotError } = require('../api/_instructor-reschedule-slot');
const source = fs.readFileSync(path.join(__dirname, '../api/admin.js'), 'utf8');

function handler(name, next, overrides = {}) {
  const calls = [];
  const booking = { id: 10, learner_id: 2, instructor_id: 3, school_id: 7,
    status: 'scheduled', is_flexible_package_booking: true, reschedule_count: 0,
    scheduled_date: '2026-10-18', start_time: '18:00', minutes_deducted: 90,
    payment_method: 'flexible_package' };
  const client = { query: async (query, values) => {
    calls.push({ query, values });
    return { rowCount: 1, rows: query.includes('INSERT INTO lesson_bookings') ? [{ id: 11 }] : [] };
  } };
  const context = {
    process: { env: {} }, console, SCHEDULED: 'scheduled', REFUNDED: 'refunded',
    InstructorRescheduleSlotError,
    verifyAdminJWT: () => ({ id: 9, school_id: 7 }), getAdminSchoolId: () => 7,
    neon: () => ({}), adminClientSqlTag: () => ({}),
    loadAdminRescheduleBooking: async (_, scope) => {
      assert.equal(scope.schoolId, 7); assert.equal(scope.bookingId, 10); return booking;
    },
    // Any remaining notice guard must fail this under-48-hour scenario.
    hoursUntilFlexibleLesson: () => 1, RESERVED_MOVE_NOTICE_HOURS: 48,
    validateInstructorRescheduleSlot: async (_, args) => {
      calls.push({ validate: args });
      return { newEndTime: '19:30', targetInstructor: { id: 4, name: 'Target' } };
    },
    withNeonTransaction: async (_, run) => run(client),
    moveFlexiblePackageBookingAllocations: async (_, args) => calls.push({ move: args }),
    logAudit: async (_, args) => calls.push({ audit: args }),
    expireExtensionCheckoutSessions: async () => {}, notifyAdminReschedule: async () => {},
    reportError: (_, err) => { throw err; }, ...overrides,
  };
  // Include the old guard when present so this test reproduces the pre-fix 409.
  const guardStart = source.indexOf('function validateAdminFlexibleRescheduleNotice(');
  if (guardStart >= 0) vm.runInNewContext(source.slice(guardStart,
    source.indexOf('async function handleAdminRescheduleOptions', guardStart)), context);
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start);
  return { run: vm.runInNewContext(`(${source.slice(start, end).trim()})`, context), calls };
}

for (const [name, next, method] of [
  ['handleAdminRescheduleAvailability', 'function adminRescheduleDateLabel', 'GET'],
  ['handleAdminRescheduleBooking', '// -- POST /api/admin?action=reserved-goodwill-move', 'POST'],
]) {
  const params = { booking_id: '10', new_instructor_id: '4', new_date: '2026-10-18', new_start_time: '18:00' };
  const request = { method, query: params, body: params };
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } });
  test(`${name}: travel warning requires explicit confirmation on save and is audited`, async () => {
    const travelConflict = { direction: 'after', booking_id: 20, gap_minutes: 5, travel_minutes: 15 };
    for (const confirmation of [undefined, false, 'true', true]) {
      const { run, calls } = handler(name, next, { validateInstructorRescheduleSlot: async (_, args) => {
        if (args.allowPickupTravelConflict !== true) {
          throw new InstructorRescheduleSlotError('PICKUP_TRAVEL_CONFLICT', 'Travel warning', 409, travelConflict);
        }
        return { newEndTime: '19:30', targetInstructor: { id: 4, name: 'Target' }, travelConflict };
      } });
      const res = response();
      await run({ ...request, body: { ...params, confirm_pickup_travel: confirmation } }, res);
      if (method === 'GET') {
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.travel_warning, travelConflict);
      } else if (confirmation === true) {
        assert.equal(res.statusCode, 200);
        assert.equal(calls.find(call => call.audit).audit.details.pickup_travel_override, true);
        assert.equal(calls.find(call => call.audit).audit.details.pickup_travel_conflict, travelConflict);
      } else {
        assert.equal(res.statusCode, 409);
        assert.equal(calls.some(call => call.move), false);
      }
    }
  });
  test(`${name}: short-notice admin transfer reaches existing slot and funding checks`, async () => {
    const { run, calls } = handler(name, next);
    const res = response(); await run(request, res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.ok, true);
    assert.equal(calls.find(call => call.validate).validate.targetInstructorId, 4);
    if (method === 'POST') {
      assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call => call.move).move)), {
        learnerId: 2, schoolId: 7, oldBookingId: 10, newBookingId: 11, newInstructorId: 4,
      });
      assert.equal(calls.find(call => call.audit).audit.action, 'admin.reschedule_booking');
      assert.equal(calls.find(call => call.audit).audit.adminId, 9);
    }
  });
  test(`${name}: slot conflicts still block the admin transfer`, async () => {
    const { run, calls } = handler(name, next, { validateInstructorRescheduleSlot: async () => {
      throw new InstructorRescheduleSlotError('LESSON_CONFLICT', 'Occupied slot');
    } });
    const res = response(); await run(request, res);
    assert.equal(res.statusCode, 409); assert.equal(res.body.code, 'LESSON_CONFLICT');
    assert.equal(calls.some(call => call.move || call.query?.includes('INSERT INTO lesson_bookings')), false);
  });
  test(`${name}: unauthenticated requests remain blocked`, async () => {
    const { run, calls } = handler(name, next, { verifyAdminJWT: () => null });
    const res = response(); await run(request, res);
    assert.equal(res.statusCode, 401); assert.equal(calls.length, 0);
  });
}
