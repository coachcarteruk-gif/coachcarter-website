const { test, expect } = require('@playwright/test');
const jwt = require('jsonwebtoken');

test.describe.configure({ mode: 'serial' });

async function readPicker({ endpoint, account = { id: 42, school_id: 1 }, active = true, request = false }) {
  const cached = new Map(Object.entries(require.cache));
  const oldSecret = process.env.JWT_SECRET;
  const oldStripe = process.env.STRIPE_SECRET_KEY;
  process.env.JWT_SECRET = 'post-trial-picker-fixture-secret';
  process.env.STRIPE_SECRET_KEY = 'sk_test_picker_fixture';
  const pricingCalls = [];
  const eligibilityCalls = [];
  const types = [{ id: 2, slug: 'standard', name: 'Standard', duration_minutes: 90, price_pence: 9000, active: true }];
  const sql = async (parts, ...values) => {
    const query = parts.join('?');
    if (/INSERT|UPDATE|DELETE/.test(query)) throw new Error('Price display must be read-only');
    if (query.includes('SELECT config FROM schools')) return [{ config: { pricing: { post_trial_discount_pct: 10, post_trial_discount_hours: 48 } } }];
    if (query.includes('AS trial_ended_at')) {
      eligibilityCalls.push(values);
      return active ? [{ id: 641, trial_ended_at: new Date(Date.now() - 3600000).toISOString() }] : [];
    }
    if (query.includes('FROM schools')) return [{ id: 1, slug: 'coachcarter' }];
    if (query.includes('FROM lesson_types')) return types.map(t => ({ ...t }));
    if (query.includes('FROM instructors')) return [{ id: 7, offered_lesson_types: ['standard'], social_video_opt_in: true,
      request_to_book: request, max_booking_days_ahead: 84, min_booking_notice_hours: 0, transmission_type: 'manual' }];
    if (query.includes('FROM instructor_availability') && !query.includes('overrides')) return [{ start_time: '08:00', end_time: '18:00', transmission_type: 'manual' }];
    return [];
  };
  const replace = (name, exports) => {
    const key = require.resolve(name);
    require.cache[key] = { id: key, filename: key, loaded: true, exports };
  };
  try {
    replace('@neondatabase/serverless', { ...require('@neondatabase/serverless'), neon: () => sql });
    replace('../api/_pricing-helpers', { ...require('../api/_pricing-helpers'), calcDirectLessonPrice: async (_sql, args) => {
      pricingCalls.push(args);
      return { pricePence: args.learnerId === 42 ? 7837 : 9000 };
    } });
    delete require.cache[require.resolve('../api/lesson-types')];
    delete require.cache[require.resolve('../api/slots')];
    const handler = require(endpoint === 'lengths' ? '../api/lesson-types' : '../api/slots');
    const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const cookie = account ? 'cc_learner=' + jwt.sign({ ...account, role: 'learner' }, process.env.JWT_SECRET) : '';
    const req = { method: 'GET', headers: { host: 'www.coachcarter.uk', cookie },
      query: { action: endpoint === 'lengths' ? 'list' : 'durations-for-slot', instructor_id: '7', learner_id: '999', date, start_time: '10:00' } };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    return { row: (res.body.lesson_types || res.body.durations)[0], pricingCalls, eligibilityCalls };
  } finally {
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key];
    for (const [key, value] of cached) require.cache[key] = value;
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
    if (oldStripe === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = oldStripe;
  }
}

for (const endpoint of ['lengths', 'durations']) {
  test(`${endpoint}: authenticated effective price has the exact 10% reduction, ignoring supplied learner ID`, async () => {
    const result = await readPicker({ endpoint });
    expect(result.row).toMatchObject({ price_pence: 7837, checkout_price_pence: 7053, post_trial_discount_pct: 10 });
    expect(result.pricingCalls[0]).toMatchObject({ schoolId: 1, learnerId: 42 });
    expect(result.eligibilityCalls[0]).toContain(42);
    expect(result.eligibilityCalls[0]).not.toContain(999);
    if (endpoint === 'durations') expect(result.row).toMatchObject({ social_video_price_pence: 7445, social_video_checkout_price_pence: 6701 });
  });
  for (const account of [null, { id: 42, school_id: 2 }]) {
    test(`${endpoint}: ${account ? 'another school' : 'guest-supplied learner ID'} cannot reveal a discount`, async () => {
      const result = await readPicker({ endpoint, account });
      expect(result.row).toMatchObject({ price_pence: 9000, checkout_price_pence: 9000, post_trial_discount_pct: 0 });
      expect(result.pricingCalls[0].learnerId).toBeNull();
      expect(result.eligibilityCalls).toHaveLength(0);
    });
  }
  test(`${endpoint}: expired/ineligible learner keeps their custom rate without the trial reduction`, async () => {
    const result = await readPicker({ endpoint, active: false });
    expect(result.row).toMatchObject({ price_pence: 7837, checkout_price_pence: 7837, post_trial_discount_pct: 0 });
  });
}

test('request-to-book retains post-trial pricing without advertising a filming discount', async () => {
  const result = await readPicker({ endpoint: 'durations', request: true });
  expect(result.row).toMatchObject({ checkout_price_pence: 7053, social_video_price_pence: null, social_video_checkout_price_pence: null });
});
