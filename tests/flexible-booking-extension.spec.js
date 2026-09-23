const { test, expect } = require('@playwright/test');
process.env.STRIPE_SECRET_KEY ||= 'sk_test_flexible_extension';
const { _acceptBookingExtension: acceptExtension } = require('../api/offers');
const { cancelFlexiblePackageBookingWithClient } = require('../api/_flexible-package-ledger');

function fixture(options = {}) {
  const calls = [];
  const offer = { id: 901, status: 'pending', school_id: 7, learner_id: 31, instructor_id: 12,
    extension_booking_id: 501, extension_minutes: 30, offer_price_pence: 0,
    scheduled_date: '2026-10-12', start_time: '10:30:00', end_time: '11:00:00', ...options.offer };
  const booking = { id: 501, status: 'scheduled', school_id: 7, learner_id: 31, instructor_id: 12,
    scheduled_date: '2026-10-12', start_time: '09:00:00', end_time: '10:30:00',
    payment_method: 'flexible_package', instructor_active: true, minutes_deducted: 90,
    list_price_pence: 8100, ...options.booking };
  const sources = options.sources || [{ id: 101, rate_pence_per_unit: 2700, remaining_units: 5, remaining_value_pence: 13500 }];
  const allocations = options.allocations || [{ id: 201, learner_id: 31, instructor_id: 12,
    source_id: 101, units_allocated: 3, unit_minutes: 30, contribution_pence: 8100 }];
  const original = JSON.stringify({ offer, booking, sources, allocations });
  const rows = values => ({ rows: values, rowCount: values.length });
  const query = async (text, values = []) => {
    calls.push({ text, values });
    if (/pg_advisory_xact_lock/.test(text)) return rows([]);
    if (/FROM learner_users/.test(text)) {
      expect(values).toEqual([31, 7]);
      return rows(options.missingLearner ? [] : [{ id: 31 }]);
    }
    if (/FROM lesson_offers[\s\S]*FOR UPDATE/.test(text)) {
      expect(values).toEqual([901, 7]); return rows([offer]);
    }
    if (/FROM lesson_bookings lb/.test(text)) {
      expect(values).toEqual([501, 7]); return rows([booking]);
    }
    if (/FROM lesson_bookings[\s\S]*FOR UPDATE/.test(text)) return rows([booking]);
    if (/FROM instructor_availability\s/.test(text)) return rows(options.outsideHours ? [] : [{ start_time: '08:00', end_time: '18:00' }]);
    if (/FROM instructor_blackout_dates/.test(text)) return rows(options.blackout ? [{ id: 1 }] : []);
    if (/FROM instructor_external_events/.test(text)) return rows(options.externalEvent ? [{ is_all_day: true }] : []);
    if (/FROM instructor_availability_overrides/.test(text)) return rows([]);
    if (/SELECT (id|start_time::text AS start_time).*FROM instructor_busy_blocks/s.test(text)) return rows(options.busy ? [{ id: 1, start_time: '10:30', end_time: '11:30' }] : []);
    if (/SELECT id FROM (lesson_bookings|lesson_offers|lesson_requests|slot_reservations)/.test(text)) return rows(options.conflict ? [{ id: 999 }] : []);
    if (/SELECT a.id, a.learner_id/.test(text)) {
      expect(values).toEqual([501, 7]); return rows(allocations);
    }
    if (/SELECT a.id, a.units_allocated/.test(text)) return rows(allocations);
    if (/INSERT INTO flexible_package_allocation_returns/.test(text)) {
      const allocation = allocations.find(row => row.id === values[1]);
      expect(allocation.returned).not.toBe(true);
      allocation.returned = true;
      const source = sources.find(row => row.id === allocation.source_id);
      source.remaining_units += Number(allocation.units_allocated);
      source.remaining_value_pence += Number(allocation.contribution_pence);
      return rows([]);
    }
    if (/FROM flexible_package_source_remaining/.test(text)) return rows([{ remaining_units: sources.reduce((sum, row) => sum + row.remaining_units, 0) }]);
    if (/FROM booking_credit_sources/.test(text)) return rows(options.mixed ? [{ id: 1 }] : []);
    if (/FROM flexible_package_sources s/.test(text)) {
      expect(values).toEqual([7, 31]); expect(text).toContain('FOR UPDATE OF s'); return rows(sources);
    }
    if (/INSERT INTO flexible_package_booking_allocations/.test(text)) {
      const [school, learner, sourceId, bookingId, instructor, units, unitMinutes, rate, value] = values;
      expect([school, learner, bookingId, instructor]).toEqual([7, 31, 501, 12]);
      const source = sources.find(row => row.id === sourceId);
      source.remaining_units -= units; source.remaining_value_pence -= value;
      allocations.push({ id: 202 + allocations.length, learner_id: learner, instructor_id: instructor,
        source_id: sourceId, units_allocated: units, unit_minutes: unitMinutes, rate_pence_per_unit: rate, contribution_pence: value });
      return rows([]);
    }
    if (/INSERT INTO flexible_package_state_events/.test(text)) return rows([]);
    if (/UPDATE lesson_bookings/.test(text)) {
      if (text.includes('cancelled_at = NOW()')) {
        booking.cancelled_at = '2026-09-21';
        if (text.includes('SET status =')) booking.status = values[0];
        else booking.credit_forfeited = true;
        return rows([{ id: 501 }]);
      }
      if (options.failBookingWrite) throw new Error('simulated booking write failure');
      booking.end_time = values[0]; booking.minutes_deducted += values[5]; booking.list_price_pence += values[6];
      return rows([{ id: 501 }]);
    }
    if (/UPDATE lesson_offers/.test(text)) {
      offer.status = text.includes("'accepted'") ? 'accepted' : 'cancelled';
      return rows([{ id: 901 }]);
    }
    throw new Error(`Unexpected query: ${text}`);
  };
  let rolledBack = false;
  const runner = async (_, work) => {
    try { return await work({ query }); } catch (error) {
      rolledBack = true;
      const saved = JSON.parse(original);
      Object.assign(offer, saved.offer); Object.assign(booking, saved.booking);
      sources.splice(0, sources.length, ...saved.sources); allocations.splice(0, allocations.length, ...saved.allocations);
      throw error;
    }
  };
  return { calls, offer, booking, sources, allocations, get rolledBack() { return rolledBack; },
    cancel: eligibleReturn => cancelFlexiblePackageBookingWithClient({ query }, {
      schoolId: 7, learnerId: 31, instructorId: 12, bookingId: 501, eligibleReturn,
    }),
    accept: () => acceptExtension({ offer: { id: 901, school_id: 7, learner_id: 31, instructor_id: 12 },
      connectionString: 'test', transactionRunner: runner, useFlexibleHours: true }) };
}

test('extension consumes only the extra package minutes and preserves original allocations', async () => {
  const f = fixture();
  const original = { ...f.allocations[0] };
  expect(await f.accept()).toMatchObject({ applied: true, extensionMinutes: 30 });
  expect(f.booking).toMatchObject({ end_time: '11:00', minutes_deducted: 120, list_price_pence: 10800 });
  expect(f.sources[0]).toMatchObject({ remaining_units: 4, remaining_value_pence: 10800 });
  expect(f.allocations[0]).toEqual(original);
  expect(f.allocations).toHaveLength(2);
  expect(f.calls.some(call => /(?:INSERT INTO|UPDATE) (?:credit_transactions|booking_credit_sources|learner_credit_balances|learner_users)/.test(call.text))).toBe(false);
  expect(await f.accept()).toMatchObject({ applied: false, code: 'EXTENSION_NOT_AVAILABLE' });
  expect(f.allocations).toHaveLength(2);
});

test('extension draws FIFO across sources at their original values', async () => {
  const f = fixture({ offer: { extension_minutes: 60, end_time: '11:30' }, sources: [
    { id: 101, rate_pence_per_unit: 2700, remaining_units: 1, remaining_value_pence: 2700 },
    { id: 102, rate_pence_per_unit: 2650, remaining_units: 4, remaining_value_pence: 10600 },
  ] });
  expect(await f.accept()).toMatchObject({ applied: true });
  expect(f.booking).toMatchObject({ minutes_deducted: 150, list_price_pence: 13450 });
  expect(f.allocations.slice(1).map(row => [row.source_id, row.units_allocated, row.contribution_pence]))
    .toEqual([[101, 1, 2700], [102, 1, 2650]]);
});

test('eligible cancellation returns both original and extension units exactly once', async () => {
  const f = fixture();
  await f.accept();
  expect(await f.cancel(true)).toMatchObject({ ok: true, minutesReturned: 120 });
  expect(f.sources[0]).toMatchObject({ remaining_units: 8, remaining_value_pence: 21600 });
  expect(await f.cancel(true)).toMatchObject({ ok: true, idempotent: true });
  expect(f.sources[0].remaining_units).toBe(8);
  expect(f.calls.filter(call => /INSERT INTO flexible_package_allocation_returns/.test(call.text))).toHaveLength(2);
});

test('late cancellation keeps the entire extended lesson consumed and payable', async () => {
  const f = fixture();
  await f.accept();
  expect(await f.cancel(false)).toMatchObject({ ok: true, minutesReturned: 0 });
  expect(f.booking).toMatchObject({ status: 'scheduled', credit_forfeited: true, minutes_deducted: 120 });
  expect(f.sources[0].remaining_units).toBe(4);
  expect(f.calls.some(call => /INSERT INTO flexible_package_allocation_returns/.test(call.text))).toBe(false);
});

for (const [label, options, code] of [
  ['insufficient balance', { sources: [] }, 'INSUFFICIENT_FLEXIBLE_UNITS'],
  ['mixed funding', { mixed: true }, 'FLEXIBLE_MIXED_FUNDING_CONTRADICTION'],
  ['missing allocation', { allocations: [] }, 'FLEXIBLE_ALLOCATION_VALUE_CONTRADICTION'],
  ['duration mismatch', { booking: { minutes_deducted: 60 } }, 'FLEXIBLE_ALLOCATION_VALUE_CONTRADICTION'],
  ['value mismatch', { booking: { list_price_pence: 8000 } }, 'FLEXIBLE_ALLOCATION_VALUE_CONTRADICTION'],
  ['another learner', { booking: { learner_id: 32 } }, 'SOURCE_BOOKING_CHANGED'],
  ['another instructor', { booking: { instructor_id: 13 } }, 'SOURCE_BOOKING_CHANGED'],
  ['another school learner', { missingLearner: true }, 'LEARNER_SCOPE_MISMATCH'],
  ['inactive instructor', { booking: { instructor_active: false } }, 'FLEXIBLE_EXTENSION_FUNDING_REQUIRED'],
  ['cash lesson', { booking: { payment_method: 'cash' } }, 'FLEXIBLE_EXTENSION_FUNDING_REQUIRED'],
  ['cancelled lesson', { booking: { cancelled_at: '2026-09-21' } }, 'SOURCE_BOOKING_CHANGED'],
  ['ended lesson', { booking: { lesson_has_ended: true } }, 'SOURCE_BOOKING_CHANGED'],
  ['changed end time', { booking: { end_time: '10:00' } }, 'SOURCE_BOOKING_CHANGED'],
  ['expired offer', { offer: { expired: true } }, 'EXTENSION_NOT_AVAILABLE'],
  ['Checkout in progress', { offer: { checkout_attempt_id: 'attempt' } }, 'EXTENSION_FUNDING_CONFLICT'],
  ['blackout despite agreed hours', { outsideHours: true, blackout: true }, 'SCHEDULE_UNAVAILABLE'],
  ['external event despite agreed hours', { outsideHours: true, externalEvent: true }, 'SCHEDULE_UNAVAILABLE'],
  ['busy block despite agreed hours', { outsideHours: true, busy: true }, 'SCHEDULE_UNAVAILABLE'],
  ['occupied added time', { conflict: true }, 'EXTENSION_TIME_UNAVAILABLE'],
]) {
  test(`rejects ${label} without allocating or extending`, async () => {
    const f = fixture(options);
    expect(await f.accept()).toMatchObject({ applied: false, code });
    expect(f.calls.some(call => /INSERT INTO flexible_package_|UPDATE lesson_bookings/.test(call.text))).toBe(false);
  });
}

test('acceptance honours instructor-agreed extension hours outside normal availability', async () => {
  const f = fixture({ outsideHours: true });
  expect(await f.accept()).toMatchObject({ applied: true, extensionMinutes: 30 });
  expect(f.booking).toMatchObject({ end_time: '11:00', minutes_deducted: 120, list_price_pence: 10800 });
  expect(f.allocations).toHaveLength(2);
  expect(await f.accept()).toMatchObject({ applied: false, code: 'EXTENSION_NOT_AVAILABLE' });
});

test('a write failure propagates for transaction rollback after allocation', async () => {
  const f = fixture({ failBookingWrite: true });
  await expect(f.accept()).rejects.toThrow('simulated booking write failure');
  expect(f.rolledBack).toBe(true);
  expect(f.offer.status).toBe('pending');
  expect(f.allocations).toHaveLength(1);
  expect(f.sources[0].remaining_units).toBe(5);
});

test('learner explicitly accepts package minutes and errors keep the correct button label', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cc_cookie_consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, timestamp: Date.now(), version: 2 })));
  await page.route('**/api/offers**', route => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON().payment_method).toBe('flexible_package');
      return route.fulfill({ status: 409, json: { error: 'Not enough Flexible Hours.' } });
    }
    return route.fulfill({ json: { ok: true, offer: { id: 901, is_extension: true,
      extension_payment_method: 'flexible_package', extension_minutes: 30, duration_minutes: 30,
      instructor_name: 'Instructor', learner_name: 'Learner', learner_email: 'learner@example.com',
      scheduled_date: '2026-10-12', start_time: '10:30', end_time: '11:00',
      price_pence: 0, expires_at: new Date(Date.now() + 86400000).toISOString() } } });
  });
  await page.goto('/accept-offer?token=flexible-test');
  await expect(page.locator('#offer-price')).toHaveText('30 mins of Flexible Hours');
  await expect(page.locator('#accept-btn')).toHaveText('Accept with Flexible Hours →');
  await page.locator('#accept-btn').click();
  await expect(page.locator('#form-error')).toHaveText('Not enough Flexible Hours.');
  await expect(page.locator('#accept-btn')).toHaveText('Accept with Flexible Hours →');
});
