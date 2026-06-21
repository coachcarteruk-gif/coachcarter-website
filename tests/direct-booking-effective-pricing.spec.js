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

test.describe('direct pay-per-slot effective pricing alignment', () => {
  test('lesson-types list applies server-side direct pricing for selected instructor and keeps trial prices untouched', () => {
    const source = read('api/lesson-types.js');
    const body = functionBody(source, 'handleList');

    expect(source).toContain("const { calcDirectLessonPrice } = require('./_pricing-helpers');");
    expect(body).toContain('WHERE id = ${instructorId} AND school_id = ${schoolId}');
    expect(body).toContain("if (lt.slug === 'trial') continue;");
    expect(body).toContain('const direct = await calcDirectLessonPrice(sql, {');
    expect(body).toContain('schoolId,');
    expect(body).toContain('instructorId,');
    expect(body).toContain('learnerId,');
    expect(body).toContain('lt.price_pence = direct.pricePence;');
    expect(body).not.toContain('SELECT custom_hourly_rate_pence FROM instructor_learner_notes');
  });

  test('durations-for-slot returns direct prices and supports learner-specific rates for modal display', () => {
    const source = read('api/slots.js');
    const body = functionBody(source, 'handleDurationsForSlot');

    expect(body).toContain('const directPrices = new Map();');
    expect(body).toContain('const direct = await calcDirectLessonPrice(sql, {');
    expect(body).toContain('schoolId,');
    expect(body).toContain('instructorId,');
    expect(body).toContain('learnerId: parseInt(req.query.learner_id) || null,');
    expect(body).toContain('price_pence: directPrices.get(lt.id) || lt.price_pence');
  });

  test('authenticated checkout-slot charges direct effective price and snapshots matching metadata', () => {
    const source = read('api/slots.js');
    const body = functionBody(source, 'handleCheckoutSlot');

    expect(body).toContain('const directPrice  = await calcDirectLessonPrice(sql, {');
    expect(body).toContain('learnerId: user.id,');
    expect(body).toContain('const priced = applySocialVideoDiscount(directPrice.pricePence, socialVideo.selected);');
    expect(body).toContain('const pricePence = priced.pricePence;');
    expect(body).toContain('const chargeMins = calcSocialVideoChargeMinutes(durationMins, socialVideo.selected);');
    expect(body).toContain('unit_amount: pricePence');
    expect(body).toContain('amount_pence:    String(pricePence)');
    expect(body).toContain('charge_minutes:   String(chargeMins)');
    expect(body).toContain('effective_rate_pence_per_minute: String(chargeMins > 0 ? Math.round(pricePence / chargeMins) : 0)');
    expect(body).toContain('if (isFreeTrialLessonType(lessonType)) return rejectFreeTrialOnPaidPath(res);');
  });

  test('guest checkout-slot computes direct price after learner resolution', () => {
    const source = read('api/slots.js');
    const body = functionBody(source, 'handleCheckoutSlotGuest');
    const learnerInsert = body.indexOf('Find or create learner');
    const directPrice = body.indexOf('const directPrice = await calcDirectLessonPrice');

    expect(learnerInsert).toBeGreaterThanOrEqual(0);
    expect(directPrice).toBeGreaterThan(learnerInsert);
    expect(body).toContain('learnerId,');
    expect(body).toContain('const priced = applySocialVideoDiscount(directPrice.pricePence, socialVideo.selected);');
    expect(body).toContain('const pricePence = priced.pricePence;');
    expect(body).toContain('const chargeMins = calcSocialVideoChargeMinutes(durationMins, socialVideo.selected);');
    expect(body).toContain('unit_amount: pricePence');
    expect(body).toContain('amount_pence:    String(pricePence)');
    expect(body).toContain('charge_minutes:   String(chargeMins)');
    expect(body).toContain('effective_rate_pence_per_minute: String(chargeMins > 0 ? Math.round(pricePence / chargeMins) : 0)');
    expect(body).toContain('if (isFreeTrialLessonType(lessonType)) return rejectFreeTrialOnPaidPath(res);');
  });

  test('booking modal asks server for instructor and learner priced durations without sending client price to checkout', () => {
    const source = read('public/learner/book.js');
    const durationsBody = functionBody(source, 'loadDurationsForSlot');
    const checkoutBody = functionBody(source, 'confirmPayAndBook');

    expect(durationsBody).toContain('instructor_id=${encodeURIComponent(slot.instructor_id)}');
    expect(durationsBody).toContain('&learner_id=${encodeURIComponent(auth.user.id)}');
    expect(durationsBody).toContain('opt.textContent = `${d.name}');
    expect(durationsBody).toContain('d.price_pence');
    expect(checkoutBody).not.toContain('price_pence:');
    expect(checkoutBody).not.toContain('amount_pence:');
  });
});
