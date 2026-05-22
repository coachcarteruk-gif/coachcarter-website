const { test, expect } = require('@playwright/test');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';

const {
  _CREDIT_BOOKING_SOURCE_TYPES: CREDIT_BOOKING_SOURCE_TYPES,
} = require('../api/slots');

test.describe('slots.js credit-funded BCS writer policy', () => {
  test('regular credit-funded bookings draw only from reusable positive credit source types', () => {
    expect(CREDIT_BOOKING_SOURCE_TYPES).toEqual([
      'purchase',
      'admin_add',
      'referral_reward',
      'legacy_grandfather',
    ]);
    expect(CREDIT_BOOKING_SOURCE_TYPES).not.toContain('slot_purchase');
    expect(CREDIT_BOOKING_SOURCE_TYPES).not.toContain('admin_remove');
    expect(CREDIT_BOOKING_SOURCE_TYPES).not.toContain('free_trial');
    expect(CREDIT_BOOKING_SOURCE_TYPES).not.toContain('refund');
  });
});
