// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

process.env.POSTGRES_URL = process.env.POSTGRES_URL || 'postgres://free-trial-window.test';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_free_trial_window';

const repoRoot = path.resolve(__dirname, '..');
const slotsPath = path.join(repoRoot, 'api', 'slots.js');
const stripeClientsPath = path.join(repoRoot, 'api', '_stripe-clients.js');

function isoDaysFromToday(days) {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    on() {},
  };
}

function createSql(maxBookingDaysAhead = 84) {
  return async (strings) => {
    const query = strings.join(' ').replace(/\s+/g, ' ').trim();
    if (query.includes('FROM schools')) return [];
    if (query.includes('FROM lesson_types')) {
      return [{ id: 37, slug: 'trial', name: 'Free trial', duration_minutes: 30, active: true }];
    }
    if (query.includes('FROM learner_users')) return [];
    if (query.includes('FROM lesson_bookings lb') && query.includes('JOIN learner_users')) return [];
    if (query.includes('FROM instructors')) {
      return [{
        id: 7,
        name: 'Test Instructor',
        email: 'instructor@example.test',
        phone: '07123456789',
        buffer_minutes: 30,
        offered_lesson_types: ['trial'],
        max_booking_days_ahead: maxBookingDaysAhead,
        transmission_type: 'manual',
      }];
    }
    return [];
  };
}

async function loadHandler(sql) {
  const neonPath = require.resolve('@neondatabase/serverless');
  const resolvedSlots = require.resolve(slotsPath);
  const resolvedStripeClients = require.resolve(stripeClientsPath);
  delete require.cache[resolvedSlots];
  delete require.cache[neonPath];
  delete require.cache[resolvedStripeClients];
  require.cache[neonPath] = { exports: { neon: () => sql } };
  require.cache[resolvedStripeClients] = {
    exports: {
      STRIPE_CLIENT_PURPOSES: { PAYMENTS: 'payments' },
      createPlatformStripeClient: () => ({}),
    },
  };
  return require(slotsPath);
}

async function call(handler, { method, action, query = {}, body = {} }) {
  const req = {
    method,
    query: { action, ...query },
    body,
    headers: { host: 'localhost' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res = makeResponse();
  await handler(req, res);
  return res;
}

function trialBody(daysAhead) {
  return {
    instructor_id: 7,
    date: isoDaysFromToday(daysAhead),
    start_time: '10:00',
    end_time: '10:30',
    guest_name: 'Trial Learner',
    guest_email: 'trial@example.test',
    guest_phone: '07123456789',
    guest_pickup_address: '1 Test Street, B1 1AA',
  };
}

test.describe('free trial API booking window', () => {
  test('picker requests 28 days and renders a slot on the boundary', async ({ page }) => {
    let requestedRangeDays = null;
    await page.route('**/api/slots?action=available**', async route => {
      const url = new URL(route.request().url());
      const from = new Date(url.searchParams.get('from') + 'T00:00:00Z');
      const to = new Date(url.searchParams.get('to') + 'T00:00:00Z');
      requestedRangeDays = Math.round((to.getTime() - from.getTime()) / 86400000);
      const boundaryDate = url.searchParams.get('to');
      await route.fulfill({
        json: {
          slots: {
            [boundaryDate]: [{
              start_time: '10:00',
              end_time: '10:30',
              instructor_id: 7,
              instructor_name: 'Boundary Instructor',
              transmission_type: 'manual',
            }],
          },
        },
      });
    });

    await page.goto('/free-trial.html');

    await expect(page.getByRole('button', { name: /10:00.*Boundary/i })).toBeVisible();
    expect(requestedRangeDays).toBe(28);
  });

  test('rejects trial availability requests ending after day 28', async () => {
    const handler = await loadHandler(createSql());
    const res = await call(handler, {
      method: 'GET',
      action: 'available',
      query: {
        from: isoDaysFromToday(0),
        to: isoDaysFromToday(29),
        lesson_type_slug: 'trial',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('more than 28 days');
  });

  test('rejects a direct day-29 free trial booking', async () => {
    const handler = await loadHandler(createSql(84));
    const res = await call(handler, {
      method: 'POST',
      action: 'book-free-trial',
      body: trialBody(29),
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('up to 28 days in advance');
  });

  test('preserves a shorter instructor window for free trial bookings', async () => {
    const handler = await loadHandler(createSql(14));
    const res = await call(handler, {
      method: 'POST',
      action: 'book-free-trial',
      body: trialBody(15),
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('up to 14 days in advance');
  });
});
