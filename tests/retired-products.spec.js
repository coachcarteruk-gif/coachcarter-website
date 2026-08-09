const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const {
  RETIRED_PRODUCT_CODE,
  isRetirementEnabled,
  loadRetiredProductState,
  retiredProductPayload,
  sendRetiredProduct,
} = require('../api/_retired-products');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');

test.describe('school-scoped retired-product state', () => {
  test('defaults inactive and activates only for an explicit nested boolean true', () => {
    expect(isRetirementEnabled(undefined)).toBe(false);
    expect(isRetirementEnabled({})).toBe(false);
    expect(isRetirementEnabled({ features: {} })).toBe(false);
    expect(isRetirementEnabled({ features: { retire_incompatible_products: 'true' } })).toBe(false);
    expect(isRetirementEnabled({ features: { retire_incompatible_products: 1 } })).toBe(false);
    expect(isRetirementEnabled({ features: { retire_incompatible_products: true } })).toBe(true);
  });

  test('loads only the requested school row', async () => {
    const calls = [];
    const sql = async (strings, ...values) => {
      calls.push({ text: strings.join('?'), values });
      return [{ config: { features: { retire_incompatible_products: true } } }];
    };

    await expect(loadRetiredProductState(sql, 7)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('FROM schools');
    expect(calls[0].text).toContain('WHERE id = ?');
    expect(calls[0].values).toEqual([7]);
  });

  test('returns one stable 410 response contract', () => {
    const response = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };

    sendRetiredProduct(response, 'reserved_weekly_slot');
    expect(response.statusCode).toBe(410);
    expect(response.body).toEqual(retiredProductPayload('reserved_weekly_slot'));
    expect(response.body).toMatchObject({
      error: true,
      code: RETIRED_PRODUCT_CODE,
      retired_product: 'reserved_weekly_slot',
    });
  });
});

test.describe('retired creation surfaces', () => {
  test('server routes gate every incompatible creation family', () => {
    const slots = read('api/slots.js');
    const instructor = read('api/instructor.js');
    const offers = read('api/offers.js');
    const credits = read('api/credits.js');

    expect(credits).toContain("code: 'CREDIT_PURCHASE_RETIRED'");
    expect(credits).toContain('const SELF_SERVE_CREDIT_PURCHASES_ENABLED = false;');

    expect(slots).toContain("sendRetiredProduct(res, 'repeated_booking')");
    expect(slots.match(/sendRetiredProduct\(res, 'reserved_weekly_slot'\)/g)).toHaveLength(3);
    expect(instructor).toContain("sendRetiredProduct(res, 'flexible_offer')");
    expect(instructor).toContain("sendRetiredProduct(res, 'repeated_offer')");
    expect(offers).toContain("if (isFlexible) return sendRetiredProduct(res, 'flexible_offer')");
    expect(offers).toContain("if (repeatWeeksClean > 1) return sendRetiredProduct(res, 'repeated_offer')");
  });

  test('creation gates run before booking, hold, offer insert, or Stripe creation', () => {
    const slots = read('api/slots.js');
    const instructor = read('api/instructor.js');
    const offers = read('api/offers.js');

    const repeatedBook = slots.indexOf("sendRetiredProduct(res, 'repeated_booking')");
    expect(repeatedBook).toBeGreaterThan(0);
    expect(repeatedBook).toBeLessThan(slots.indexOf('// 0. Look up lesson type', repeatedBook));

    const bankHandler = slots.indexOf('async function handleRecurringBlockBankCheckout');
    const bankGate = slots.indexOf("sendRetiredProduct(res, 'reserved_weekly_slot')", bankHandler);
    expect(bankGate).toBeGreaterThan(bankHandler);
    expect(bankGate).toBeLessThan(slots.indexOf('getReservedBlockBankCheckoutPaymentOptions()', bankHandler));
    expect(bankGate).toBeLessThan(slots.indexOf('createRecurringBlockBankHoldTransaction({', bankHandler));
    expect(bankGate).toBeLessThan(slots.indexOf('stripe.checkout.sessions.create({', bankHandler));

    const createOffer = instructor.indexOf('async function handleCreateOffer');
    const offerGate = instructor.indexOf('loadRetiredProductState(sql, schoolId)', createOffer);
    expect(offerGate).toBeGreaterThan(createOffer);
    expect(offerGate).toBeLessThan(instructor.indexOf('INSERT INTO lesson_offers', createOffer));

    const acceptOffer = offers.indexOf('async function handleAcceptOffer');
    const acceptGate = offers.indexOf('if (await loadRetiredProductState(sql, schoolId))', acceptOffer);
    expect(acceptGate).toBeGreaterThan(acceptOffer);
    expect(acceptGate).toBeLessThan(offers.indexOf('stripe.checkout.sessions.create({', acceptOffer));
  });

  test('legacy reads and management routes remain available', () => {
    const slots = read('api/slots.js');
    const instructor = read('api/instructor.js');
    const webhook = read('api/webhook.js');

    expect(slots).toContain("if (action === 'recurring-block-status') return handleRecurringBlockStatus(req, res);");
    expect(slots).toContain("if (action === 'reserved-policy-move') return handleReservedPolicyMove(req, res);");
    expect(slots).toContain("if (action === 'series-info')  return handleSeriesInfo(req, res);");
    expect(slots).toContain("if (action === 'cancel')       return handleCancel(req, res);");
    expect(slots).toContain("if (action === 'reschedule')   return handleReschedule(req, res);");
    expect(instructor).toContain("if (action === 'list-offers')");
    expect(instructor).toContain("if (action === 'cancel-offer')");

    // In-flight sessions created before retirement must still settle through
    // the existing idempotent webhook handlers rather than strand paid users.
    expect(webhook).toContain("if (paymentType === 'credit_purchase')");
    expect(webhook).toContain("paymentType === 'recurring_block_bank_checkout'");
    expect(webhook).toContain("paymentType === 'lesson_offer'");
    expect(webhook).not.toContain("require('./_retired-products')");
  });

  test('learner, offer-acceptance, instructor, and admin UI remove retired entry points when active', () => {
    const learner = read('public/learner/book.js');
    const acceptOffer = read('public/accept-offer.js');
    const instructor = read('public/instructor/index.js');
    const instructorHtml = read('public/instructor/index.html');
    const adminHtml = read('public/admin/editor.html');

    expect(learner).toContain('incompatibleProductsRetired = data.incompatible_products_retired === true;');
    expect(learner).toContain("repeatSection.style.display = 'none'");
    expect(learner).toContain("paidPrompt.style.display = 'none'");
    expect(learner).toContain("successPrompt.style.display = 'none'");
    expect(acceptOffer).toContain('!o.incompatible_products_retired && !o.is_flexible');
    expect(instructor).toContain('applyOfferRetirementUi()');
    expect(instructorHtml).toContain('id="offerRetirementNotice"');
    expect(instructorHtml).toContain('id="offerRepeatRow"');
    expect(adminHtml).toContain('New self-serve credit packages are retired');
  });

  test('launch payment eligibility remains limited to one-payment/one-lesson origins', () => {
    const contracts = read('api/_stripe-launch-payment-contracts.js');
    const webhook = read('api/webhook.js');

    expect(contracts).toContain("DIRECT_SLOT: 'direct_slot'");
    expect(contracts).toContain("TEST_DATE_DIRECT: 'test_date_direct'");
    expect(contracts).toContain("ONE_OFF_OFFER: 'one_off_offer'");
    expect(contracts).toContain("CAPTURED_REQUEST: 'captured_request'");
    expect(contracts).not.toMatch(/PAYMENT_ORIGINS[\s\S]{0,300}(credit_purchase|recurring_block|flexible_offer)/);
    expect(webhook).toContain('Credits, flexible/repeating offers, and every other legacy shape remain');
  });
});
