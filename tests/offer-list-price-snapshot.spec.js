// @ts-check
// Mock-SQL test for Step 1b: api/offers.js bookOfferSeries() snapshots
// list_price_pence + list_price_source onto every lesson_bookings INSERT
// it creates. The values passed in by the caller are the ones that land.
//
// Why this test exists:
//   bookOfferSeries() is called from two places (api/webhook.js
//   handleOfferBooking for paid offers, api/offers.js handleFreeOffer for
//   free offers). Each call site supplies a different (value, source) pair:
//     - paid:  amountPence (per-lesson, from session metadata) + 'stripe_metadata'
//     - free:  0 + 'live_compute_insert'
//   This test pins down that the helper writes those values verbatim onto
//   every INSERT it issues, including across a multi-week series — so a
//   future refactor of bookOfferSeries can't silently drop the snapshot.
//
// Why mock SQL and not a real DB:
//   The property under test is purely the INSERT shape (do the listPrice
//   args reach the INSERT VALUES list?). No SQL semantics (locking,
//   ON CONFLICT, CTE atomicity) are involved. Integration tests are for
//   semantics; mock SQL is the right tool here.

const { test, expect } = require('@playwright/test');
const { bookOfferSeries } = require('../api/offers');

// Mock sql client. Captures every tagged-template call as { text, values }
// so the test can assert the right INSERT was issued with the right snapshot
// args. Returns synthetic data shapes good enough to let bookOfferSeries run
// to completion.
function makeMockSql() {
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    // instructor_availability lookup — return one window covering 09:00-17:00
    // every day so dowCoversSlot is true and repeats are allowed.
    if (text.includes('FROM instructor_availability')) {
      return Promise.resolve([{ start_time: '09:00:00', end_time: '17:00:00' }]);
    }
    // instructor_blackout_dates — no blackouts.
    if (text.includes('FROM instructor_blackout_dates')) {
      return Promise.resolve([]);
    }
    // Per-week conflict check — no existing booking.
    if (text.includes('FROM lesson_bookings') && text.includes('status = ANY')) {
      return Promise.resolve([]);
    }
    // The INSERT — return a synthetic booking id sequence.
    if (text.includes('INSERT INTO lesson_bookings')) {
      const id = calls.filter(c => c.text.includes('INSERT INTO lesson_bookings')).length;
      return Promise.resolve([{ id }]);
    }
    return Promise.resolve([]);
  };
  return { sql, calls };
}

const baseArgs = {
  instructorId: 5,
  learnerId: 7,
  firstDate: '2026-06-01',  // Monday
  startTime: '14:00',
  endTime: '15:30',
  lessonTypeId: 3,
  durationMins: 90,
  pickupAddress: '1 Test St',
  schoolId: 1,
  repeatWeeks: 1,
  paymentMethod: 'card',
};

function inserts(calls) {
  return calls.filter(c => c.text.includes('INSERT INTO lesson_bookings'));
}

test.describe('bookOfferSeries — list_price snapshot wiring (Step 1b)', () => {

  test('paid single-lesson offer writes amountPence + stripe_metadata', async () => {
    const { sql, calls } = makeMockSql();
    const result = await bookOfferSeries(sql, {
      ...baseArgs,
      listPricePerBookingPence: 8250,
      listPriceSource: 'stripe_metadata',
    });
    expect(result.booked.length).toBe(1);
    const ins = inserts(calls);
    expect(ins.length).toBe(1);
    // Snapshot values are the last two interpolated values on the INSERT
    // (matches the VALUES list order: ..., list_price_pence, list_price_source).
    const values = ins[0].values;
    expect(values[values.length - 2]).toBe(8250);
    expect(values[values.length - 1]).toBe('stripe_metadata');
  });

  test('paid offer booking accepts ISO timestamp-shaped metadata dates', async () => {
    const { sql, calls } = makeMockSql();
    const result = await bookOfferSeries(sql, {
      ...baseArgs,
      firstDate: '2026-06-01T00:00:00.000Z',
      listPricePerBookingPence: 8250,
      listPriceSource: 'stripe_metadata',
    });

    expect(result.booked).toEqual([{ date: '2026-06-01', booking_id: 1 }]);
    const ins = inserts(calls);
    expect(ins.length).toBe(1);
    expect(ins[0].values).toContain('2026-06-01');
  });

  test('free single-lesson offer writes 0 + live_compute_insert', async () => {
    const { sql, calls } = makeMockSql();
    await bookOfferSeries(sql, {
      ...baseArgs,
      paymentMethod: 'free',
      durationMins: 0,
      listPricePerBookingPence: 0,
      listPriceSource: 'live_compute_insert',
    });
    const ins = inserts(calls);
    expect(ins.length).toBe(1);
    const values = ins[0].values;
    expect(values[values.length - 2]).toBe(0);
    expect(values[values.length - 1]).toBe('live_compute_insert');
  });

  test('paid 3-week series writes the same per-lesson snapshot on every booking', async () => {
    const { sql, calls } = makeMockSql();
    const result = await bookOfferSeries(sql, {
      ...baseArgs,
      repeatWeeks: 3,
      listPricePerBookingPence: 8250,
      listPriceSource: 'stripe_metadata',
    });
    expect(result.booked.length).toBe(3);
    const ins = inserts(calls);
    expect(ins.length).toBe(3);
    for (const i of ins) {
      const values = i.values;
      expect(values[values.length - 2]).toBe(8250);
      expect(values[values.length - 1]).toBe('stripe_metadata');
    }
  });

  test('omitted snapshot args land as null (caller forgot to pass them)', async () => {
    // Safety net: if a future call site forgets the two new args, the helper
    // doesn't crash and the snapshot lands NULL — which is recoverable via
    // the Step 1c backfill. Prefer-failure-mode is silent NULL over silent
    // wrong number.
    const { sql, calls } = makeMockSql();
    await bookOfferSeries(sql, baseArgs);
    const ins = inserts(calls);
    expect(ins.length).toBe(1);
    const values = ins[0].values;
    expect(values[values.length - 2]).toBe(null);
    expect(values[values.length - 1]).toBe(null);
  });
});
