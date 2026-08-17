// @ts-check
const { test, expect } = require('@playwright/test');
const {
  PaidBookingRecoveryError,
  recoverPaidBookingOrphan,
} = require('../api/_paid-booking-orphan-recovery');

function input(overrides = {}) {
  return {
    connectionString: 'postgresql://unused',
    paymentType: 'slot_booking',
    schoolId: 1,
    learnerId: 19,
    instructorId: 1,
    sessionId: 'cs_paid_orphan',
    paymentIntentId: 'pi_paid_orphan',
    scheduledDate: '2026-08-31',
    startTime: '11:00',
    endTime: '12:30',
    minutes: 90,
    amountPence: 8250,
    lessonTypeId: 1,
    stripeFeePence: 144,
    stripeChargeId: 'ch_paid_orphan',
    ...overrides,
  };
}

function harness({ booking = null, conflicts = [], actual = 0, expectedWith = 90 } = {}) {
  const queries = [];
  const balanceCalls = [];
  const source = {
    id: 282,
    amount_pence: 8250,
    minutes: 90,
    stripe_fee_pence: 144,
    stripe_charge_id: 'ch_paid_orphan',
    effective_rate_pence_per_minute: 92,
  };
  const client = {
    async query(text, values = []) {
      queries.push({ text, values });
      if (/SELECT id,amount_pence,minutes,stripe_fee_pence,stripe_charge_id/i.test(text)) {
        return { rowCount: 1, rows: [source] };
      }
      if (/FROM lesson_bookings[\s\S]*ORDER BY id/i.test(text)) {
        return { rowCount: booking ? 1 : 0, rows: booking ? [booking] : [] };
      }
      if (/SELECT ARRAY_REMOVE/i.test(text)) return { rowCount: 1, rows: [{ conflicts }] };
      if (/WITH purchases AS/i.test(text)) {
        return { rowCount: 1, rows: [{ actual_minutes: actual, expected_with_orphan_minutes: expectedWith }] };
      }
      if (/INSERT INTO lesson_bookings/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 480, status: 'scheduled' }] };
      }
      if (/SELECT id,minutes_drawn,contribution_pence,stripe_fee_pence/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 242, minutes_drawn: 90, contribution_pence: 8250, stripe_fee_pence: 144 }] };
      }
      if (/UPDATE lesson_offers/i.test(text)) {
        return { rowCount: 1, rows: [{ id: 60, booking_id: 480 }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const transactionRunner = async (work) => work(client);
  const balanceAdjuster = async (_sql, args) => {
    balanceCalls.push(args);
    const prior = balanceCalls.length === 1 ? actual : actual + Number(balanceCalls[0]?.delta || 0);
    return { ok: true, balanceMinutes: prior + args.delta };
  };
  return { client, queries, balanceCalls, transactionRunner, balanceAdjuster };
}

test('repairs an uncredited orphan with an audited net-zero balance cycle', async () => {
  const h = harness({ actual: 0, expectedWith: 90 });
  const result = await recoverPaidBookingOrphan(input(), h);

  expect(result).toMatchObject({ created: true, balanceMode: 'net_zero', bookingId: 480, creditTransactionId: 282 });
  expect(h.balanceCalls.map(call => call.delta)).toEqual([90, -90]);
  expect(h.queries.some(call => /INSERT INTO lesson_bookings/i.test(call.text))).toBe(true);
  expect(h.queries.some(call => /INSERT INTO booking_credit_sources/i.test(call.text))).toBe(true);
});

test('consumes credit staged by an earlier partial webhook attempt', async () => {
  const h = harness({ actual: 90, expectedWith: 90 });
  const result = await recoverPaidBookingOrphan(input(), h);

  expect(result.balanceMode).toBe('consume_staged_credit');
  expect(h.balanceCalls.map(call => call.delta)).toEqual([-90]);
});

test('one-off offer recovery accepts only the correlated offer and clears its session hold', async () => {
  const h = harness();
  const result = await recoverPaidBookingOrphan(input({
    paymentType: 'lesson_offer',
    repeatWeeks: 1,
    offerId: 60,
  }), h);

  expect(result.bookingId).toBe(480);
  const offerUpdate = h.queries.find(call => /UPDATE lesson_offers/i.test(call.text));
  expect(offerUpdate?.values).toEqual([480, 19, 60, 1, 1, 'cs_paid_orphan']);
  expect(h.queries.some(call => /DELETE FROM slot_reservations/i.test(call.text))).toBe(true);
});

test('is idempotent when the exact live booking and BCS already exist', async () => {
  const h = harness({
    booking: { id: 480, status: 'scheduled', minutes_deducted: 90, list_price_pence: 8250 },
  });
  const result = await recoverPaidBookingOrphan(input(), h);

  expect(result).toMatchObject({ created: false, balanceMode: 'not_needed', bookingId: 480 });
  expect(h.balanceCalls).toEqual([]);
  expect(h.queries.some(call => /INSERT INTO lesson_bookings/i.test(call.text))).toBe(false);
});

test('refuses a newly conflicting slot without touching balances', async () => {
  const h = harness({ conflicts: ['booking'] });
  let error;
  try {
    await recoverPaidBookingOrphan(input(), h);
  } catch (caught) {
    error = caught;
  }

  expect(error).toBeInstanceOf(PaidBookingRecoveryError);
  expect(error.code).toBe('PAID_BOOKING_RECOVERY_SLOT_CONFLICT');
  expect(h.balanceCalls).toEqual([]);
  expect(h.queries.some(call => /INSERT INTO lesson_bookings/i.test(call.text))).toBe(false);
});

test('refuses unexplained scoped balance drift without touching balances', async () => {
  const h = harness({ actual: 45, expectedWith: 90 });
  await expect(recoverPaidBookingOrphan(input(), h)).rejects.toMatchObject({
    code: 'PAID_BOOKING_RECOVERY_BALANCE_DRIFT',
  });
  expect(h.balanceCalls).toEqual([]);
});

test('requires complete immutable Stripe evidence before opening a transaction', async () => {
  const h = harness();
  await expect(recoverPaidBookingOrphan(input({ stripeChargeId: null }), h)).rejects.toMatchObject({
    code: 'PAID_BOOKING_RECOVERY_EVIDENCE_INCOMPLETE',
  });
  expect(h.queries).toEqual([]);
});
