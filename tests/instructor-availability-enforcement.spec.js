const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const {
  availabilityChangeConflicts, buildInstructorScheduleWarnings,
  loadAvailabilityChangeReview, requireAvailabilityChangeReview,
  requireNormalHoursReview,
} = require('../api/_instructor-schedule-warnings');

process.env.STRIPE_SECRET_KEY ||= 'sk_test_availability_unit_only';
process.env.POSTGRES_URL ||= 'postgresql://availability-unit.invalid/db';

const date = '2030-09-23';
const window = { day_of_week: 1, start_time: '09:00', end_time: '17:00', transmission_type: 'automatic' };
const booking = {
  id: 634, instructor_id: 6, school_id: 7, learner_id: 22, learner_name: 'Test learner',
  learner_email: 'learner@example.invalid', scheduled_date: date, start_time: '12:00', end_time: '13:30',
  status: 'scheduled', payment_method: 'credit', minutes_deducted: 90, lesson_type_id: 1,
  transmission_type: 'automatic', instructor_transmission_type: 'automatic', type_duration_minutes: 90,
};

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, setHeader() {}, getHeader() {}, on() {} };
}

function loadModule(file, mocks) {
  const filename = path.resolve(__dirname, '..', file);
  const actualRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, process, console, Buffer, URL, Date, setTimeout, clearTimeout,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : actualRequire(name),
    __filename: filename, __dirname: path.dirname(filename),
  }, { filename });
  return module.exports;
}

function fixture({ windows = [window], overrides = [], busy = [], blackouts = [], events = [], pendingRequests = [], extensionConflict, fundingResult, auth = true, failAudit = false } = {}) {
  const calls = [], funding = [], notifications = [], transactions = [];
  let savedBooking = { ...booking };
  const query = async (text, values = []) => {
    text = text.replace(/\s+/g, ' ').trim();
    calls.push({ text, values });
    if (failAudit && text.startsWith('INSERT INTO audit_log')) throw new Error('Audit write failed');
    if (text.includes('information_schema.columns')) return [{ exists: true }];
    if (extensionConflict && text.includes('FROM ' + extensionConflict) && text.startsWith('SELECT')
        && !text.includes('WHERE lb.id =')) return [{ id: 999, learner_name: 'Another learner', start_time: '19:30', end_time: '20:30' }];
    if (text.includes('FROM instructor_availability_overrides')) return overrides;
    if (text.includes('FROM instructor_availability')) return windows;
    if (text.includes('FROM instructor_busy_blocks')) return busy;
    if (text.includes('FROM instructor_blackout_dates')) return blackouts;
    if (text.includes('FROM instructor_external_events')) return events;
    if (text.includes('FROM lesson_requests')) return pendingRequests;
    if (text.includes('FROM lesson_types')) return [{ id: 1, slug: 'standard', duration_minutes: 90, name: 'Lesson' }];
    if (text.includes('FROM learner_users')) return [{ id: 22, name: 'Test learner', balance_minutes: 300, credit_balance: 4 }];
    if (text.includes('FROM instructors')) return [{ id: 6, name: 'Test instructor', transmission_type: 'automatic' }];
    if (text.includes('FROM lesson_bookings b') && !text.includes('lb.')) return [savedBooking];
    if (text.includes('FROM lesson_bookings lb') && text.includes('WHERE lb.id =')) return [savedBooking];
    if (text.includes('SELECT status, scheduled_date')) return [savedBooking];
    if (text.startsWith('UPDATE lesson_bookings')) return [{ id: booking.id }];
    if (text.startsWith('INSERT INTO lesson_bookings')) return [{ id: booking.id }];
    if (text.startsWith('INSERT INTO lesson_offers')) return [{ id: 901, expires_at: '2030-09-22T12:00:00Z' }];
    return [];
  };
  const sql = (strings, ...values) => query(strings.join(' ? '), values);
  const tx = async (_, callback) => {
    transactions.push('begin');
    try {
      const result = await callback({ query: async (text, values) => ({ rows: await query(text, values) }) });
      transactions.push('commit');
      return result;
    } catch (error) { transactions.push('rollback'); throw error; }
  };
  const handler = loadModule('api/instructor.js', {
    '@neondatabase/serverless': { neon: () => sql },
    './_auth': { requireAuth: () => auth ? { id: 6, school_id: 7, email: 'instructor@example.invalid' } : null },
    './_db-transaction': { withNeonTransaction: tx },
    './_auth-helpers': { generateToken: () => 'test-extension-token', createTransporter: () => ({ sendMail: async () => notifications.push('email') }) },
    './_whatsapp': { sendWhatsApp: async () => notifications.push('whatsapp') },
    './_error-alert': { reportError: () => {} },
    './_booking-extension-invalidation': {
      invalidatePendingBookingExtensions: async () => calls.push({ text: 'invalidate', values: [] }),
      expireExtensionCheckoutSessions: async () => {},
    },
    './_flexible-package-ledger': { bookFlexiblePackageSlotTransaction: async args => {
      funding.push(args); return fundingResult || { ok: true, booking: { id: booking.id } };
    } },
  });
  return { calls, funding, notifications, transactions, sql,
    setBooking: value => { savedBooking = { ...booking, ...value }; },
    async run(action, body) {
      const res = response();
      await handler({ method: 'POST', query: { action }, headers: {}, body }, res);
      return res;
    },
  };
}

test('outside-hours creation requires review for packages and stays blocked for other payments despite old override fields', async () => {
  for (const payment of ['flexible_package', 'credit', 'cash', 'free']) {
    const f = fixture({ windows: [{ ...window, end_time: '11:30' }] });
    const res = await f.run('create-booking', { learner_id: 22, scheduled_date: date, start_time: '12:00',
      payment_method: payment, availability_override: true, force: true });
    expect(res.statusCode, payment).toBe(409);
    expect(res.body.code).toBe(payment === 'flexible_package' ? 'NORMAL_HOURS_OVERRIDE_REQUIRED' : 'SCHEDULE_UNAVAILABLE');
    expect(f.funding).toEqual([]);
    expect(f.notifications).toEqual([]);
    expect(f.calls.filter(call => /^(INSERT|UPDATE|DELETE)/.test(call.text))).toEqual([]);
  }
});

const outsideHoursBooking = { learner_id: 22, scheduled_date: date, start_time: '18:00',
  payment_method: 'flexible_package', client_request_id: 'cfca77ec-1d30-4a34-8cf9-49c08b212c1b' };

test('confirmed normal-hours exception books once through the unchanged package transaction', async () => {
  const f = fixture();
  const warning = await f.run('create-booking', outsideHoursBooking);
  expect(warning.body.code).toBe('NORMAL_HOURS_OVERRIDE_REQUIRED');
  expect(f.funding).toEqual([]);
  expect(f.notifications).toEqual([]);
  const result = await f.run('create-booking', { ...outsideHoursBooking,
    normal_hours_override_token: warning.body.normal_hours_override_token });
  expect(result.statusCode).toBe(200);
  expect(f.funding).toHaveLength(1);
  expect(f.funding[0]).toMatchObject({ createdBy: 'instructor', schoolId: 7, instructorId: 6,
    learnerId: 22, durationMinutes: 90, startTime: '18:00', endTime: '19:30',
    clientRequestId: outsideHoursBooking.client_request_id });
});

test('changed lesson details or an invalid review token require fresh confirmation', async () => {
  const f = fixture();
  const warning = await f.run('create-booking', outsideHoursBooking);
  for (const changes of [{ start_time: '19:00' }, { learner_id: 23 }, { scheduled_date: '2030-09-24' },
    { normal_hours_override_token: true }, { normal_hours_override_token: 'invalid' }]) {
    const result = await f.run('create-booking', { ...outsideHoursBooking,
      normal_hours_override_token: warning.body.normal_hours_override_token, ...changes });
    expect(result.body.code).toBe('NORMAL_HOURS_OVERRIDE_REQUIRED');
  }
  expect(f.funding).toEqual([]);
});

test('normal-hours acknowledgement cannot cross school or instructor scope', () => {
  const warnings = buildInstructorScheduleWarnings({ startTime: '18:00', endTime: '19:30' });
  const original = response();
  const proposal = { schoolId: 7, instructorId: 6, learnerId: 22, scheduledDate: date,
    startTime: '18:00', endTime: '19:30' };
  requireNormalHoursReview({ body: {} }, original, warnings, proposal);
  for (const changes of [{ schoolId: 8 }, { instructorId: 9 }]) {
    const res = response();
    expect(requireNormalHoursReview({ body: {
      normal_hours_override_token: original.body.normal_hours_override_token,
    } }, res, warnings, { ...proposal, ...changes })).toBe(true);
    expect(res.body.code).toBe('NORMAL_HOURS_OVERRIDE_REQUIRED');
  }
});

test('confirmed normal-hours exception cannot bypass new blocks or pending requests', async () => {
  const warning = await fixture().run('create-booking', outsideHoursBooking);
  for (const block of ['busy', 'blackouts', 'events', 'pendingRequests']) {
    const f = fixture({ [block]: [{ id: 9, start_time: '18:00', end_time: '20:00' }] });
    const result = await f.run('create-booking', { ...outsideHoursBooking,
      normal_hours_override_token: warning.body.normal_hours_override_token });
    expect(result.statusCode).toBe(409);
    expect(result.body.normal_hours_override_token).toBeUndefined();
    expect(f.funding).toEqual([]);
    expect(f.notifications).toEqual([]);
  }
});

test('confirmed exception still reports a booking conflict from the package transaction', async () => {
  const f = fixture({ fundingResult: { ok: false, code: 'SLOTS_UNAVAILABLE' } });
  const warning = await f.run('create-booking', outsideHoursBooking);
  const result = await f.run('create-booking', { ...outsideHoursBooking,
    normal_hours_override_token: warning.body.normal_hours_override_token });
  expect(result.statusCode).toBe(409);
  expect(result.body.error).toContain('already booked');
  expect(f.notifications).toEqual([]);
});

test('one-off availability permits a valid Flexible Hours booking with instructor attribution', async () => {
  const f = fixture({ windows: [], overrides: [{ start_time: '12:00', end_time: '13:30' }] });
  const res = await f.run('create-booking', { learner_id: 22, scheduled_date: date, start_time: '12:00',
    payment_method: 'flexible_package', created_by: 'admin' });
  expect(res.statusCode).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(f.funding).toHaveLength(1);
  expect(f.funding[0]).toMatchObject({ createdBy: 'instructor', schoolId: 7, instructorId: 6, durationMinutes: 90 });
});

test('one-off coverage never overrides busy blocks or external events', async () => {
  for (const block of ['busy', 'events']) {
    const f = fixture({ overrides: [{ start_time: '12:00', end_time: '14:00' }],
      [block]: [{ start_time: '13:00', end_time: '14:00' }] });
    const res = await f.run('create-booking', { learner_id: 22, scheduled_date: date, start_time: '12:00',
      payment_method: 'flexible_package', availability_override: true });
    expect(res.body.code).toBe('SCHEDULE_UNAVAILABLE');
    expect(f.funding).toEqual([]);
  }
});

test('Edit cannot move a lesson outside hours, even with force; no audit, credit or offer changes occur', async () => {
  const f = fixture({ windows: [{ ...window, end_time: '11:30' }] });
  const res = await f.run('edit-booking', { booking_id: 634, start_time: '12:00', force: true, availability_override: true });
  expect(res.body.code).toBe('SCHEDULE_UNAVAILABLE');
  expect(f.transactions).toEqual([]);
  expect(f.calls.some(call => /^(INSERT|UPDATE|DELETE|invalidate)/.test(call.text))).toBe(false);
});

test('valid Edit commits the booking and old/new audit together before responding', async () => {
  const f = fixture();
  const res = await f.run('edit-booking', { booking_id: 634, start_time: '14:00', notify: false });
  expect(res.statusCode).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(f.transactions).toEqual(['begin', 'commit']);
  const audit = f.calls.find(call => call.text.startsWith('INSERT INTO audit_log'));
  expect(audit.values).toContain('instructor.edit_booking');
  const details = JSON.parse(audit.values.find(value => typeof value === 'string' && value.startsWith('{')));
  expect(details).toMatchObject({ instructor_id: 6, old: { start_time: '12:00', end_time: '13:30' },
    new: { start_time: '14:00', end_time: '15:30' } });
  const update = f.calls.find(call => call.text.startsWith('UPDATE lesson_bookings'));
  expect(update.text).toContain('school_id =');
  expect(update.values).toContain(7);
});

test('extension requests require normal-hours confirmation before creating an offer', async () => {
  const f = fixture({ windows: [{ ...window, end_time: '13:30' }] });
  const res = await f.run('create-extension-offer', { booking_id: 634, extension_minutes: 30 });
  expect(res.body.code).toBe('NORMAL_HOURS_OVERRIDE_REQUIRED');
  expect(f.calls.some(call => call.text.startsWith('INSERT'))).toBe(false);
  expect(f.notifications).toEqual([]);
});

for (const payment of ['flexible_package', 'cash', 'free']) {
  test(`${payment} extension from 19:30 to 20:00 can be confirmed outside normal hours`, async () => {
    const f = fixture();
    f.setBooking({ scheduled_date: '2030-09-30', start_time: '18:30', end_time: '19:30',
      payment_method: payment, has_flexible_package_allocation: payment === 'flexible_package', list_price_pence: 5400 });
    const body = { booking_id: 634, extension_minutes: 30,
      ...(payment === 'flexible_package' ? {} : { offer_price_pence: payment === 'free' ? 0 : 2700 }) };
    const first = await f.run('create-extension-offer', body);
    expect(first.body.code).toBe('NORMAL_HOURS_OVERRIDE_REQUIRED');
    expect(first.body.error).toContain('20:00');
    expect(f.calls.some(call => call.text.startsWith('INSERT INTO lesson_offers'))).toBe(false);
    expect(f.notifications).toEqual([]);
    const result = await f.run('create-extension-offer', { ...body,
      normal_hours_override_token: first.body.normal_hours_override_token });
    expect(result.statusCode).toBe(200);
    expect(result.body.new_end_time).toBe('20:00');
    expect(f.calls.filter(call => call.text.startsWith('INSERT INTO lesson_offers'))).toHaveLength(1);
    expect(f.funding).toEqual([]);
    expect(f.calls.some(call => call.text.startsWith('UPDATE lesson_bookings'))).toBe(false);
  });
}

test('changed extension duration, price or original finish requires new confirmation', async () => {
  const f = fixture({ windows: [] });
  const body = { booking_id: 634, extension_minutes: 30, offer_price_pence: 0 };
  const first = await f.run('create-extension-offer', body);
  for (const changes of [{ extension_minutes: 60 }, { offer_price_pence: 2750 }]) {
    const res = await f.run('create-extension-offer', { ...body,
      normal_hours_override_token: first.body.normal_hours_override_token, ...changes });
    expect(res.body.code).toBe('NORMAL_HOURS_OVERRIDE_REQUIRED');
  }
  f.setBooking({ end_time: '14:00' });
  const res = await f.run('create-extension-offer', { ...body,
    normal_hours_override_token: first.body.normal_hours_override_token });
  expect(res.body.code).toBe('NORMAL_HOURS_OVERRIDE_REQUIRED');
  expect(f.notifications).toEqual([]);
});

test('extension confirmation cannot bypass calendar blocks or occupied added time', async () => {
  const body = { booking_id: 634, extension_minutes: 30 };
  const first = await fixture({ windows: [] }).run('create-extension-offer', body);
  for (const options of [
    { busy: [{ start_time: '13:30', end_time: '14:30' }] }, { blackouts: [{ id: 1 }] },
    { events: [{ start_time: '13:30', end_time: '14:30' }] },
    ...['lesson_bookings lb', 'lesson_offers', 'lesson_requests', 'slot_reservations'].map(extensionConflict => ({ extensionConflict })),
  ]) {
    const f = fixture({ windows: [], ...options });
    const res = await f.run('create-extension-offer', { ...body,
      normal_hours_override_token: first.body.normal_hours_override_token });
    expect(res.statusCode, JSON.stringify(options)).toBe(409);
    expect(res.body.code).not.toBe('NORMAL_HOURS_OVERRIDE_REQUIRED');
    expect(f.calls.some(call => call.text.startsWith('INSERT INTO lesson_offers'))).toBe(false);
    expect(f.notifications).toEqual([]);
  }
});

test('package-funded extension creates a zero-cash offer without drawing hours before acceptance', async () => {
  const f = fixture();
  f.setBooking({ payment_method: 'flexible_package', has_flexible_package_allocation: true, list_price_pence: 8100 });
  const res = await f.run('create-extension-offer', { booking_id: 634, extension_minutes: 30 });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ ok: true, price_pence: 0, new_end_time: '14:00' });
  const insert = f.calls.find(call => call.text.startsWith('INSERT INTO lesson_offers'));
  expect(insert.values).toContain(7);
  expect(insert.values.slice(-3)).toEqual([634, 30, 8100]);
  expect(f.funding).toEqual([]);
  expect(f.calls.some(call => /INSERT INTO flexible_package_|UPDATE lesson_bookings/.test(call.text))).toBe(false);
  expect(f.notifications).toEqual(['email']);
});

test('package extension refuses custom cash prices and missing funding evidence', async () => {
  for (const price of [0, 2750]) {
    const f = fixture();
    f.setBooking({ payment_method: 'flexible_package', has_flexible_package_allocation: true, list_price_pence: 8100 });
    const res = await f.run('create-extension-offer', { booking_id: 634, extension_minutes: 30, offer_price_pence: price });
    expect(res.statusCode).toBe(400);
    expect(f.calls.some(call => call.text.startsWith('INSERT'))).toBe(false);
  }
  const f = fixture();
  f.setBooking({ payment_method: 'flexible_package', has_flexible_package_allocation: false });
  const res = await f.run('create-extension-offer', { booking_id: 634, extension_minutes: 30 });
  expect(res.body.code).toBe('FLEXIBLE_ALLOCATION_VALUE_CONTRADICTION');
});

test('manual and broadcast offers cannot bypass availability with the old override flag', async () => {
  const upcoming = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  for (const action of ['create-offer', 'create-broadcast-offer']) {
    const f = fixture({ windows: [] });
    const res = await f.run(action, { learner_id: 22, learner_ids: [22], scheduled_date: upcoming,
      start_time: '12:00', availability_override: true });
    expect(res.statusCode, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('SCHEDULE_UNAVAILABLE');
    expect(f.calls.some(call => call.text.startsWith('INSERT'))).toBe(false);
  }
});

test('failed edit audit rolls back the booking transaction', async () => {
  const f = fixture({ failAudit: true });
  const res = await f.run('edit-booking', { booking_id: 634, start_time: '14:00', notify: false });
  expect(res.statusCode).toBe(500);
  expect(f.transactions).toEqual(['begin', 'rollback']);
  expect(f.notifications).toEqual([]);
});

test('admin force edits cannot move a scheduled lesson beyond availability', async () => {
  const f = fixture({ windows: [] });
  const handler = loadModule('api/admin.js', {
    '@neondatabase/serverless': { neon: () => f.sql },
    './_auth': { requireAuth: () => ({ id: 3, school_id: 7 }) },
    './_interim-v1-payout': { createInterimV1PayoutHandler: () => async () => false },
    './_stripe-clients': { createPlatformStripeClient: () => ({}), STRIPE_CLIENT_PURPOSES: {} },
    './_error-alert': { reportError: () => {} },
  });
  const res = response();
  await handler({ method: 'POST', query: { action: 'edit-booking' }, headers: {},
    body: { booking_id: 634, start_time: '14:00', force: true } }, res);
  expect(res.body.code).toBe('SCHEDULE_UNAVAILABLE');
  expect(f.calls.some(call => /^(UPDATE|INSERT|DELETE)/.test(call.text))).toBe(false);
});

test('Flexible Hours SQL persists the caller role and defaults learner bookings correctly', async () => {
  for (const createdBy of [undefined, 'instructor']) {
    let insert;
    const ledger = loadModule('api/_flexible-package-ledger.js', {
      './_db-transaction': { withNeonTransaction: async (_, callback) => callback({ query: async (text, values) => {
        let rows = [];
        if (text.includes('SELECT id FROM learner_users') || text.includes('SELECT id FROM instructors')) rows = [{ id: 22 }];
        if (text.includes('FROM flexible_package_sources s')) rows = [{ id: 1, remaining_units: 6, rate_pence_per_unit: 2500, remaining_value_pence: 15000 }];
        if (text.includes('INSERT INTO lesson_bookings')) { insert = { text, values }; rows = [{ id: 634 }]; }
        if (text.includes('FROM flexible_package_source_remaining')) rows = [{ remaining_units: 3 }];
        return { rows, rowCount: rows.length };
      } }) },
    });
    const result = await ledger.bookFlexiblePackageSlotTransaction({ connectionString: 'unused', learnerId: 22,
      instructorId: 6, schoolId: 7, date, startTime: '12:00', endTime: '13:30', lessonTypeId: 1,
      durationMinutes: 90, clientRequestId: 'cfca77ec-1d30-4a34-8cf9-49c08b212c1b', createdBy });
    expect(result.ok).toBe(true);
    expect(insert.text).toContain('flexible_package_booking_request_id, created_by');
    expect(insert.values[14]).toBe(createdBy || 'learner');
    expect(insert.values[10]).toBe(90);
    expect(insert.values[12]).toBe(7500);
  }
});

test('availability reduction returns affected lessons and needs a matching reviewed token', async () => {
  const f = fixture();
  const windows = [{ ...window, end_time: '11:30' }];
  const first = await f.run('set-availability', { windows });
  expect(first.body.code).toBe('AVAILABILITY_BOOKING_CONFLICTS');
  expect(first.body.conflicts.map(b => b.id)).toEqual([634]);
  expect(f.transactions).toEqual([]);
  const stale = await f.run('set-availability', { windows: [], availability_conflict_token: first.body.availability_conflict_token });
  expect(stale.body.code).toBe('AVAILABILITY_BOOKING_CONFLICTS');
  const saved = await f.run('set-availability', { windows, availability_conflict_token: first.body.availability_conflict_token });
  expect(saved.body.success).toBe(true);
  expect(f.transactions).toEqual(['begin', 'commit']);
  expect(f.calls.some(call => /^(UPDATE|DELETE) lesson_bookings/.test(call.text))).toBe(false);
});

test('blackouts and removing one-off hours review newly stranded bookings', async () => {
  const f = fixture();
  const blackout = await f.run('set-blackout-dates', { ranges: [{ start_date: date, end_date: date }] });
  expect(blackout.body.code).toBe('AVAILABILITY_BOOKING_CONFLICTS');
  const g = fixture({ windows: [], overrides: [{ ...window, id: 8, override_date: date }] });
  const removed = await g.run('delete-availability-override', { id: 8 });
  expect(removed.body.code).toBe('AVAILABILITY_BOOKING_CONFLICTS');
  expect(g.transactions).toEqual([]);
});

test('schedule reads and review tokens are school and instructor scoped', async () => {
  const f = fixture();
  const a = await loadAvailabilityChangeReview(f.sql, { instructorId: 6, schoolId: 7, windows: [] });
  const b = await loadAvailabilityChangeReview(f.sql, { instructorId: 6, schoolId: 8, windows: [] });
  expect(a.token).not.toBe(b.token);
  for (const call of f.calls) {
    expect(call.text).toContain('school_id =');
    expect(call.text).toContain('instructor_id =');
  }
  const res = response();
  expect(requireAvailabilityChangeReview({ body: { availability_conflict_token: a.token } }, res, b)).toBe(true);
});

test('coverage respects full duration, lunch gaps, one-off hours and transmission', () => {
  const base = { bookings: [booking], weeklyWindows: [window], oneOffWindows: [], blackoutRanges: [] };
  expect(availabilityChangeConflicts({ ...base, nextWeeklyWindows: [
    { ...window, end_time: '12:30' }, { ...window, start_time: '13:00' },
  ] })).toHaveLength(1);
  expect(availabilityChangeConflicts({ ...base, nextWeeklyWindows: [],
    nextOneOffWindows: [{ ...window, override_date: date }] })).toEqual([]);
  expect(availabilityChangeConflicts({ ...base, nextWeeklyWindows: [{ ...window, transmission_type: 'manual' }] })).toHaveLength(1);
  expect(availabilityChangeConflicts({ ...base, weeklyWindows: [], nextWeeklyWindows: [] })).toEqual([]);
  expect(buildInstructorScheduleWarnings({ startTime: '23:00', endTime: '24:30', weeklyWindows: [window] })[0].code).toBe('INVALID_TIME_RANGE');
});

test('unauthenticated requests cannot reach schedule reads', async () => {
  const f = fixture({ auth: false });
  const res = await f.run('create-booking', {});
  expect(res.statusCode).toBe(401);
  expect(f.calls).toEqual([]);
});

test('availability UI only retries after approval and binds the returned token', async () => {
  const calls = [], prompts = [];
  const result = { code: 'AVAILABILITY_BOOKING_CONFLICTS', conflicts: [booking], availability_conflict_token: 'review-token' };
  const context = { window: { confirm: text => { prompts.push(text); return true; } },
    ccAuth: { fetchAuthed: async (_, options) => {
      calls.push(JSON.parse(options.body));
      return calls.length === 1 ? { status: 409, json: async () => result } : { status: 200, json: async () => ({ success: true }) };
    } } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../public/shared/instructor-availability-review.js'), 'utf8'), context);
  const saved = await context.window.saveAvailabilityWithReview('/availability', { windows: [] });
  expect(saved.data.success).toBe(true);
  expect(prompts[0]).toContain('Test learner');
  expect(prompts[0]).toContain('12:00–13:30');
  expect(calls[1].availability_conflict_token).toBe('review-token');
});
