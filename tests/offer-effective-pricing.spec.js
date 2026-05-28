// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { calcOfferLessonPrice } = require('../api/_pricing-helpers');

function makeMockSql(canned) {
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    for (const entry of canned) {
      if (text.includes(entry.match)) return Promise.resolve(entry.rows);
    }
    return Promise.resolve([]);
  };
  return { sql, calls };
}

function schoolRow(bulkHourlyPence, tiers = [{ min_hours: 1, discount_pct: 50 }]) {
  return {
    config: {
      pricing: {
        bulk_hourly_pence: bulkHourlyPence,
        bulk_discount_tiers: tiers,
      },
    },
  };
}

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test.describe('calcOfferLessonPrice', () => {
  test('explicit offer_price_pence wins and does not query live pricing', async () => {
    const { sql, calls } = makeMockSql([
      { match: 'FROM instructors', rows: [{ hourly_rate_pence: 6000 }] },
      { match: 'FROM schools', rows: [schoolRow(5500)] },
    ]);

    const result = await calcOfferLessonPrice(sql, {
      schoolId: 1,
      instructorId: 8,
      learnerId: 42,
      durationMinutes: 90,
      explicitPricePence: 7777,
      discountPct: 50,
    });

    expect(result.pricePence).toBe(7777);
    expect(result.source).toBe('explicit_offer_price');
    expect(calls).toHaveLength(0);
  });

  test('explicit zero keeps free offers free', async () => {
    const { sql, calls } = makeMockSql([{ match: 'FROM schools', rows: [schoolRow(5500)] }]);

    const result = await calcOfferLessonPrice(sql, {
      schoolId: 1,
      instructorId: 8,
      durationMinutes: 90,
      explicitPricePence: 0,
    });

    expect(result.pricePence).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test('manual offer with instructor hourly override stores computed lesson price', async () => {
    const { sql, calls } = makeMockSql([
      { match: 'instructor_learner_notes', rows: [] },
      { match: 'SELECT hourly_rate_pence', rows: [{ hourly_rate_pence: 6000 }] },
      { match: 'FROM schools', rows: [schoolRow(5500)] },
    ]);

    const result = await calcOfferLessonPrice(sql, {
      schoolId: 1,
      instructorId: 8,
      learnerId: 42,
      durationMinutes: 90,
    });

    expect(result.pricePence).toBe(9000);
    expect(result.basePricePence).toBe(9000);
    expect(result.source).toBe('instructor_rate');
    expect(calls.some(c => c.text.includes('SELECT bulk_tiers_enabled'))).toBe(false);
  });

  test('manual offer with custom learner rate uses the pair rate', async () => {
    const { sql } = makeMockSql([
      { match: 'instructor_learner_notes', rows: [{ custom_hourly_rate_pence: 5200 }] },
      { match: 'SELECT hourly_rate_pence', rows: [{ hourly_rate_pence: 6000 }] },
      { match: 'FROM schools', rows: [schoolRow(5500)] },
    ]);

    const result = await calcOfferLessonPrice(sql, {
      schoolId: 1,
      instructorId: 8,
      learnerId: 42,
      durationMinutes: 90,
    });

    expect(result.pricePence).toBe(7800);
    expect(result.source).toBe('custom_learner_rate');
  });

  test('link-only offer with no learner uses instructor then school fallback', async () => {
    const { sql, calls } = makeMockSql([
      { match: 'instructor_learner_notes', rows: [{ custom_hourly_rate_pence: 5200 }] },
      { match: 'SELECT hourly_rate_pence', rows: [{ hourly_rate_pence: null }] },
      { match: 'FROM schools', rows: [schoolRow(5500)] },
    ]);

    const result = await calcOfferLessonPrice(sql, {
      schoolId: 1,
      instructorId: 8,
      durationMinutes: 120,
    });

    expect(result.pricePence).toBe(11000);
    expect(result.source).toBe('school_default');
    expect(calls.some(c => c.text.includes('instructor_learner_notes'))).toBe(false);
  });

  test('discount_pct applies to the effective base price, not bulk tiers', async () => {
    const { sql, calls } = makeMockSql([
      { match: 'instructor_learner_notes', rows: [] },
      { match: 'SELECT hourly_rate_pence', rows: [{ hourly_rate_pence: 6000 }] },
      { match: 'SELECT bulk_tiers_enabled', rows: [{ bulk_tiers_enabled: true }] },
      { match: 'FROM schools', rows: [schoolRow(5500, [{ min_hours: 1, discount_pct: 50 }])] },
    ]);

    const result = await calcOfferLessonPrice(sql, {
      schoolId: 1,
      instructorId: 8,
      learnerId: 42,
      durationMinutes: 90,
      discountPct: 25,
    });

    expect(result.basePricePence).toBe(9000);
    expect(result.discountAmtPence).toBe(2250);
    expect(result.pricePence).toBe(6750);
    expect(calls.some(c => c.text.includes('SELECT bulk_tiers_enabled'))).toBe(false);
  });
});

test.describe('offer pricing integration wiring', () => {
  test('manual and broadcast offer creation freeze offer_price_pence from the helper', () => {
    const instructor = source('api/instructor.js');

    expect(instructor).toContain("const { getEffectiveHourlyPence, calcOfferLessonPrice } = require('./_pricing-helpers')");
    expect(instructor).toContain('const offerPricing = await calcOfferLessonPrice(sql, {');
    expect(instructor).toContain('learnerId: existingLearner?.id || null');
    expect(instructor).toContain('${lessonType.id}, ${discountPctClean}, ${offerPricing.pricePence}');
    expect(instructor).toContain('learnerId: lu.id');
    expect(instructor).toContain('${lessonType.id}, ${dp}, ${offerPricing.pricePence},');
  });

  test('cancellation-triggered broadcasts store per-recipient effective discounted price', () => {
    const notify = source('api/_notify-availability.js');

    expect(notify).toContain("const { calcOfferLessonPrice } = require('./_pricing-helpers')");
    expect(notify).toContain('learnerId: m.learner_id');
    expect(notify).toContain('discountPct: FLASH_DISCOUNT_PCT');
    expect(notify).toContain('${lessonType.id}, ${FLASH_DISCOUNT_PCT}, ${offerPricing.pricePence},');
  });

  test('accept-offer preserves legacy null-price fallback but new offers use stored price', () => {
    const offers = source('api/offers.js');

    expect(offers).toContain('if (offer.offer_price_pence != null) {');
    expect(offers).toContain('finalPricePence = offer.offer_price_pence');
    expect(offers).toContain('pricePence = offer.offer_price_pence');
    expect(offers).toContain('pricePence = Math.round(originalPricePence * (100 - discountPct) / 100)');
  });

  test('repeat checkout charges stored per-lesson price times requested repeat count', () => {
    const offers = source('api/offers.js');

    expect(offers).toContain('unit_amount: pricePence');
    expect(offers).toContain('quantity: repeatWeeksClean');
    expect(offers).toContain("amount_pence:      String(pricePence)");
    expect(offers).toContain("repeat_weeks:      String(repeatWeeksClean)");
  });

  test('webhook uses Stripe metadata snapshots for offer list price and rate', () => {
    const webhook = source('api/webhook.js');

    expect(webhook).toContain('const amountPence   = parseInt(metadata.amount_pence, 10)');
    expect(webhook).toContain('const totalAmountPence = amountPence * repeatWeeks');
    expect(webhook).toContain('effectiveRatePencePerMinute = totalMinutes > 0');
    expect(webhook).toContain('listPricePerBookingPence: amountPence');
    expect(webhook).toContain("listPriceSource: 'stripe_metadata'");
  });
});
