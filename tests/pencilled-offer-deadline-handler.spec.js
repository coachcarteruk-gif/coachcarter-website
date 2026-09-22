const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { validatePencilledOfferCreation } = require('../api/_pencilled-offers');
const { PencilledOfferConflict } = require('../api/_pencilled-offer-store');

// Execute the production handler with local storage/notification doubles only.
// No real database, Stripe or outbound messages are used.
function harness() {
  const saved = [], emails = [], messages = [];
  const now = new Date('2026-09-22T09:00:00Z').getTime();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const sql = async (strings, ...values) => {
    const query = strings.join('?');
    if (query.includes('FROM lesson_types')) return [{ id: 9, slug: 'standard', duration_minutes: 60 }];
    if (query.includes('FROM instructors')) return [{ id: 7, name: 'Alex' }];
    if (query.includes('FROM learner_users')) {
      expect(values).toEqual([42, 3]);
      return [{ id: 42, name: 'Jamie', email: 'jamie@example.test', phone: '07700900000' }];
    }
    if (query.includes('FROM schools')) {
      expect(values).toEqual([3]);
      return [{ config: { timezone: 'Europe/London' } }];
    }
    if (query.includes('INSERT INTO lesson_offers')) {
      saved.push({ ordinary: true });
      return [{ id: 81, expires_at: values[values.length - 2] }];
    }
    if (/FROM (lesson_bookings|lesson_offers|lesson_requests|slot_reservations)/.test(query)) return [];
    throw new Error(`Unexpected query: ${query}`);
  };
  const source = fs.readFileSync(path.join(__dirname, '../api/instructor.js'), 'utf8');
  const start = source.indexOf('async function handleCreateOffer(');
  const end = source.indexOf('\nasync function ', start + 1);
  const context = vm.createContext({
    Date: Clock, process: { env: {} }, console,
    verifyInstructorAuth: () => ({ id: 7, school_id: 3 }),
    neon: () => sql, BLOCKING_STATUSES: ['scheduled', 'chargeable'],
    isLessonTypeOffered: () => true, loadInstructorScheduleWarnings: async () => [],
    generateToken: () => 'test-token',
    calcOfferLessonPrice: async () => ({ pricePence: 5000, discountPct: 0 }),
    validatePencilledOfferCreation: (input, options) => validatePencilledOfferCreation(input, { ...options, now }),
    createPencilledOfferTransaction: async ({ offer }) => {
      saved.push(offer);
      return { id: 81, expires_at: offer.expiresAt.toISOString() };
    },
    PencilledOfferConflict,
    sendWhatsApp: async (...args) => { messages.push(args); return { ok: true }; },
    createTransporter: () => ({ sendMail: async mail => { emails.push(mail); } }),
    reportError: (_route, error) => { throw error; },
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    saved, emails, messages,
    async create(overrides = {}) {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await context.handleCreateOffer({ method: 'POST', body: {
        learner_id: 42, lesson_type_id: 9, scheduled_date: '2026-09-25', start_time: '10:00',
        offer_price_pence: 5000, pencilled: true, ...overrides,
      } }, res);
      return res;
    },
  };
}

for (const hours of [undefined, 12, 24, 48]) {
  test(`create-offer persists and communicates the ${hours ?? 'default'}-hour deadline`, async () => {
    const h = harness();
    const res = await h.create(hours === undefined ? {} : { pencilled_expiry_hours: hours });
    const expectedHours = hours ?? 48;
    const deadline = new Date(Date.parse('2026-09-25T09:00:00Z') - expectedHours * 3600000).toISOString();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ expires_at: deadline, pay_by: deadline });
    expect(h.saved[0]).toMatchObject({ schoolId: 3, learnerId: 42, instructorId: 7 });
    expect(h.saved[0].expiresAt.toISOString()).toBe(deadline);
    expect(h.emails[0].html).toContain(`until ${expectedHours} hours before the lesson starts`);
    expect(h.messages[0][1]).toContain(`${expectedHours} hours before the lesson starts`);
  });
}

test('bad deadlines and elapsed deadlines create no hold or notification', async () => {
  for (const overrides of [
    { pencilled_expiry_hours: 6 }, { pencilled_expiry_hours: '12' },
    { pencilled_expiry_hours: null },
    { scheduled_date: '2026-09-23', pencilled_expiry_hours: 24 },
  ]) {
    const h = harness();
    const res = await h.create(overrides);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe(overrides.scheduled_date ? 'PAYMENT_DEADLINE_REACHED' : 'INVALID_PENCILLED_EXPIRY_HOURS');
    expect(h.saved).toEqual([]);
    expect(h.emails).toEqual([]);
    expect(h.messages).toEqual([]);
  }
});

test('a 12-hour deadline allows a nearer lesson and ordinary offers keep their existing expiry', async () => {
  const pencil = harness();
  expect((await pencil.create({ scheduled_date: '2026-09-23', pencilled_expiry_hours: 12 })).statusCode).toBe(200);
  const ordinary = harness();
  const res = await ordinary.create({ pencilled: false, pencilled_expiry_hours: 12 });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ expires_at: '2026-09-23T09:00:00.000Z', pay_by: null });
  expect(ordinary.saved).toEqual([{ ordinary: true }]);
  expect(ordinary.emails[0].html).toContain('This offer expires in 24 hours');
  expect(ordinary.messages[0][1]).toContain('Accept within 24 hours');
});
