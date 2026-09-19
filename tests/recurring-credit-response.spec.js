const { test, expect } = require('@playwright/test');

process.env.POSTGRES_URL = process.env.POSTGRES_URL || 'postgres://recurring-credit-response.test';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_recurring_credit_response';

const { _handleRecurringBlockCommit } = require('../api/slots');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('credit-funded recurring commit returns the restored non-purchase pricing response after mutation', async () => {
  const mutationCalls = [];
  const preview = {
    ok: true,
    can_commit: true,
    requested_lessons: 4,
    selected_slots: [
      { date: '2026-10-01' },
      { date: '2026-10-08' },
      { date: '2026-10-15' },
      { date: '2026-10-22' },
    ],
    anchor: {
      booking_id: 51,
      instructor_id: 7,
      start_time: '10:00',
      end_time: '11:00',
      lesson_type_id: 3,
      duration_minutes: 60,
      pickup_address: '1 Test Street',
      dropoff_address: null,
      transmission_type: 'manual',
    },
    pricing: {
      price_per_lesson_pence: 5500,
      requested_total_price_pence: 22000,
      price_source: 'instructor_rate',
    },
    credit: { has_sufficient_credit: true },
  };
  const createdBookings = preview.selected_slots.map((slot, index) => ({
    id: 700 + index,
    scheduled_date: slot.date,
    start_time: '10:00',
  }));
  const sql = async () => [];
  const res = responseRecorder();

  await _handleRecurringBlockCommit({
    method: 'POST',
    body: { anchor_booking_id: 51, lessons: 4 },
  }, res, {
    verifyAuth: () => ({ id: 19, school_id: 2, role: 'learner' }),
    sql,
    loadRetiredProductState: async () => false,
    buildRecurringBlockPreview: async () => preview,
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    bookCreditFundedSlotsTransaction: async (input) => {
      mutationCalls.push(input);
      return {
        ok: true,
        createdBookings,
        balanceMinutes: 180,
        recurringBlock: { id: 91, status: 'confirmed', funding_method: 'lesson_credit' },
      };
    },
    supersedeBroadcastSiblings: async () => {},
  });

  expect(mutationCalls).toHaveLength(1);
  expect(mutationCalls[0]).toMatchObject({
    learnerId: 19,
    instructorId: 7,
    schoolId: 2,
    durationMins: 60,
    recurringBlock: {
      pricePerLessonPence: 5500,
      totalPricePence: 22000,
      priceSource: 'instructor_rate',
    },
  });
  expect(res.statusCode).toBe(201);
  expect(res.body).toEqual({
    ok: true,
    block_id: 91,
    status: 'confirmed',
    funding_method: 'lesson_credit',
    series_id: '00000000-0000-4000-8000-000000000001',
    booking_ids: [700, 701, 702, 703],
    dates: ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22'],
    selected_lessons: 4,
    balance_minutes: 180,
    pricing: {
      price_per_lesson_pence: 5500,
      total_price_pence: 22000,
      price_source: 'instructor_rate',
    },
  });
});
