const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  isPencilledOffer,
  pencilledOfferTimes,
  validatePencilledOfferCreation,
  pencilledPaymentWasOnTime,
} = require('../api/_pencilled-offers');

function validInput(overrides = {}) {
  return {
    pencilled: true,
    learner_id: 22,
    learner_school_id: 7,
    kind: 'manual',
    scheduled_date: '2026-12-09',
    start_time: '10:00',
    end_time: '11:30',
    offer_price_pence: 5000,
    max_repeat_weeks: 1,
    lesson_type_slug: 'standard',
    ...overrides,
  };
}

const options = {
  schoolId: 7,
  learnerSchoolId: 7,
  timezone: 'Europe/London',
  now: new Date('2026-09-16T12:00:00.000Z'),
};

test.describe('pencilled offer policy', () => {
  test('surfaces the unpaid hold in instructor, learner and payment UI', () => {
    const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    expect(read('public/instructor/index.html')).toContain('id="offerPencilled"');
    expect(read('public/instructor/index.js')).toContain("pencilled: pencilled");
    expect(read('public/instructor/index.js')).toContain("'Pencilled · unpaid'");
    expect(read('public/learner/lessons.js')).toContain('Pencilled in · unpaid');
    expect(read('public/learner/lessons.js')).toContain('cancel-pencilled-offer');
    expect(read('public/accept-offer.js')).toContain('Your pencilled-in lesson');
    expect(read('public/accept-offer.js')).toContain("exactPayBy.textContent = 'Pay by '");
    expect(read('public/accept-offer.js')).toContain("text = 'Time remaining: '");
  });
  test('recognises only an explicit true flag', () => {
    expect(isPencilledOffer({ pencilled: true })).toBe(true);
    for (const value of [false, 'true', 1, null, undefined]) {
      expect(isPencilledOffer({ pencilled: value })).toBe(false);
    }
  });

  test('requires a same-school existing learner, fixed manual single slot and positive price', () => {
    expect(validatePencilledOfferCreation(validInput(), options).ok).toBe(true);
    expect(validatePencilledOfferCreation(validInput({ pencilled: 'true' }), options).code).toBe('PENCILLED_FLAG_REQUIRED');
    expect(validatePencilledOfferCreation(validInput({ learner_id: null }), options).code).toBe('EXISTING_LEARNER_REQUIRED');
    expect(validatePencilledOfferCreation(validInput(), { ...options, learnerSchoolId: 8 }).code).toBe('LEARNER_SCHOOL_MISMATCH');
    expect(validatePencilledOfferCreation(validInput({ kind: 'broadcast' }), options).code).toBe('MANUAL_OFFER_REQUIRED');
    expect(validatePencilledOfferCreation(validInput({ scheduled_date: null }), options).code).toBe('FIXED_SLOT_REQUIRED');
    expect(validatePencilledOfferCreation(validInput({ start_time: '10:00junk' }), options).code).toBe('INVALID_FIXED_SLOT');
    expect(validatePencilledOfferCreation(validInput({ start_time: '11:30' }), options).code).toBe('INVALID_FIXED_SLOT');
    expect(validatePencilledOfferCreation(validInput({ start_time: '10:00:00' }), options).ok).toBe(true);
    expect(validatePencilledOfferCreation(validInput({ extension_booking_id: 9 }), options).code).toBe('EXTENSION_NOT_ALLOWED');
    expect(validatePencilledOfferCreation(validInput({ max_repeat_weeks: 2 }), options).code).toBe('REPEAT_NOT_ALLOWED');
    expect(validatePencilledOfferCreation(validInput({ lesson_type_slug: 'trial' }), options).code).toBe('TRIAL_NOT_ALLOWED');
    expect(validatePencilledOfferCreation(validInput({ offer_price_pence: 0 }), options).code).toBe('POSITIVE_PRICE_REQUIRED');
  });

  test('uses an inclusive 84 local-calendar-day ceiling', () => {
    const day84 = validatePencilledOfferCreation(validInput(), options);
    expect(day84.ok).toBe(true);
    expect(day84.daysAhead).toBe(84);
    expect(validatePencilledOfferCreation(
      validInput({ scheduled_date: '2026-12-10' }), options
    ).code).toBe('LESSON_BEYOND_84_LOCAL_DAYS');
  });

  test('expires exactly 48 elapsed hours before the school-local lesson across DST', () => {
    const spring = pencilledOfferTimes({
      scheduledDate: '2027-03-29',
      startTime: '10:00',
      timezone: 'Europe/London',
    });
    expect(spring.lessonStartsAt.toISOString()).toBe('2027-03-29T09:00:00.000Z');
    expect(spring.expiresAt.toISOString()).toBe('2027-03-27T09:00:00.000Z');
    expect(spring.lessonStartsAt.getTime() - spring.expiresAt.getTime()).toBe(48 * 60 * 60 * 1000);

    expect(pencilledOfferTimes({
      scheduledDate: '2027-03-28',
      startTime: '01:30',
      timezone: 'Europe/London',
    })).toBeNull();
  });

  test('allows creation before the deadline and rejects it at the exact deadline', () => {
    const input = validInput({ scheduled_date: '2026-09-20', start_time: '10:00' });
    expect(validatePencilledOfferCreation(input, {
      ...options, now: new Date('2026-09-18T08:59:59.999Z'),
    }).ok).toBe(true);
    expect(validatePencilledOfferCreation(input, {
      ...options, now: new Date('2026-09-18T09:00:00.000Z'),
    }).code).toBe('PAYMENT_DEADLINE_REACHED');
  });

  test('uses recorded payment success time, independent of a later webhook receipt', () => {
    const offer = { pencilled: true, expires_at: '2026-09-18T09:00:00.000Z' };
    expect(pencilledPaymentWasOnTime({
      offer,
      paymentSucceededAt: '2026-09-18T08:59:59.999Z',
      webhookReceivedAt: '2026-09-18T09:05:00.000Z',
    })).toBe(true);
    expect(pencilledPaymentWasOnTime({
      offer,
      paymentSucceededAt: '2026-09-18T09:00:00.000Z',
    })).toBe(false);
    expect(pencilledPaymentWasOnTime({
      offer: { pencilled: false, expires_at: offer.expires_at },
      paymentSucceededAt: '2026-09-18T08:00:00.000Z',
    })).toBe(false);
    for (const missingPayment of [null, undefined, '', 'not-a-date']) {
      expect(pencilledPaymentWasOnTime({ offer, paymentSucceededAt: missingPayment })).toBe(false);
    }
    for (const missingDeadline of [null, undefined, '', 'not-a-date']) {
      expect(pencilledPaymentWasOnTime({
        offer: { pencilled: true, expires_at: missingDeadline },
        paymentSucceededAt: '2026-09-18T08:00:00.000Z',
      })).toBe(false);
    }
  });
});
