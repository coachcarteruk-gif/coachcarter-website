// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test.describe('free trial lesson offers', () => {
  test('create-offer keeps trial offers fixed-slot and price-free', () => {
    const body = functionBody(read('api/instructor.js'), 'handleCreateOffer');

    expect(body).toContain("const isTrialOffer = lessonType.slug === 'trial';");
    expect(body).toContain('if (isTrialOffer && isFlexible)');
    expect(body).toContain('Free trial offers must be for a fixed slot');
    expect(body).toContain('explicitPricePence: isTrialOffer ? 0 : offer_price_pence');
    expect(body).toContain('${lessonType.id}, ${discountPctClean}, ${offerPricing.pricePence}');
  });

  test('get-offer displays pending trial offers as free even with a stale stored price', () => {
    const body = functionBody(read('api/offers.js'), 'handleGetOffer');

    expect(body).toContain('lt.slug AS lesson_type_slug');
    expect(body).toContain("const isTrialOffer = offer.lesson_type_slug === 'trial';");
    expect(body).toContain('if (isTrialOffer) {');
    expect(body).toContain('finalPricePence = 0;');
    expect(body).toContain('displayOriginalPricePence = 0;');
  });

  test('accept-offer books fixed trial offers directly and blocks flexible trial credits', () => {
    const body = functionBody(read('api/offers.js'), 'handleAcceptOffer');

    expect(body).toContain('lt.slug AS lesson_type_slug');
    expect(body).toContain("const isTrialOffer = offer.lesson_type_slug === 'trial';");
    expect(body).toContain('if (isTrialOffer && isFlexible)');
    expect(body).toContain('Ask your instructor to send a dated trial offer');
    expect(body).toContain('if (isTrialOffer) {');
    expect(body).toContain('pricePence = 0;');
    expect(body).toContain('if (pricePence === 0 && !isFlexible)');
    expect(body).toContain('return await handleFreeOffer(sql, offer, learnerDetails, baseUrl, token, res, resolvedEmail, repeatWeeksClean)');
  });
});
