// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function extractFunctionBody(source, functionName) {
  const marker = `async function ${functionName}`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);

  const openParen = source.indexOf('(', start);
  expect(openParen).toBeGreaterThanOrEqual(0);

  let parenDepth = 0;
  let openBrace = -1;
  for (let i = openParen; i < source.length; i++) {
    if (source[i] === '(') parenDepth++;
    if (source[i] === ')') parenDepth--;
    if (parenDepth === 0) {
      openBrace = source.indexOf('{', i);
      break;
    }
  }
  expect(openBrace).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(openBrace + 1, i);
  }

  throw new Error(`Could not find end of ${functionName}`);
}

function webhookSource() {
  return fs.readFileSync(path.join(__dirname, '..', 'api', 'webhook.js'), 'utf8');
}

test.describe('webhook paid offer BCS attribution', () => {
  function getOfferBookingBody() {
    return extractFunctionBody(webhookSource(), 'handleOfferBooking');
  }

  function getBcsBody() {
    return extractFunctionBody(webhookSource(), 'ensureSlotBookingBcs');
  }

  test('paid single-slot offer acceptance creates one active BCS row after the booking', () => {
    const body = getOfferBookingBody();

    const creditTxIndex = body.indexOf('INSERT INTO credit_transactions');
    const bookingIndex = body.indexOf('seriesResult = await bookOfferSeries(sql, {');
    const guardIndex = body.indexOf('if (!isFlexible && repeatWeeks === 1 && seriesResult.booked.length === 1) {');
    const bcsIndex = body.indexOf('creditTransaction: offerCreditTx');

    expect(creditTxIndex).toBeGreaterThanOrEqual(0);
    expect(bookingIndex).toBeGreaterThan(creditTxIndex);
    expect(guardIndex).toBeGreaterThan(bookingIndex);
    expect(bcsIndex).toBeGreaterThan(guardIndex);

    expect(body).toContain('RETURNING id, amount_pence, stripe_fee_pence, effective_rate_pence_per_minute');
    expect(body).toContain('offerCreditTx = creditTx');
    expect(body).toContain('bookingId: seriesResult.booked[0].booking_id');
    expect(body).toContain('await ensureSlotBookingBcs(sql, {');
  });

  test('offer BCS row carries the resolved school_id through the shared writer', () => {
    const body = getOfferBookingBody();
    const bcsBody = getBcsBody();

    expect(body).toContain('const schoolId = await resolveSchoolId(sql, metadata, session.id)');
    expect(body).toContain('schoolId,');
    expect(bcsBody).toContain('(school_id, booking_id, credit_transaction_id, minutes_drawn,');
    expect(bcsBody).toContain('(${schoolId}, ${bookingId}, ${creditTransaction.id}, ${durationMins}');
  });

  test('offer BCS contribution_pence matches the paid source amount for the single booking', () => {
    const body = getOfferBookingBody();
    const bcsBody = getBcsBody();

    expect(body).toContain('const totalAmountPence = amountPence * repeatWeeks');
    expect(body).toContain("(${learnerId}, 'slot_purchase', ${totalCredits}, ${totalAmountPence}");
    expect(body).toContain('RETURNING id, amount_pence, stripe_fee_pence, effective_rate_pence_per_minute');
    expect(bcsBody).toContain('rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by');
    expect(bcsBody).toContain('${creditTransaction.effective_rate_pence_per_minute}, ${creditTransaction.amount_pence}, ${bcsStripeFeePence}, NULL');
  });

  test('repeat, flexible, and free offer paths are deliberately outside this writer', () => {
    const body = getOfferBookingBody();
    const flexibleBlockStart = body.indexOf('if (isFlexible) {');
    const slotPinnedStart = body.indexOf('const deducted = await lockBalanceAdjustLCB', flexibleBlockStart);
    const singleGuardIndex = body.indexOf('if (!isFlexible && repeatWeeks === 1 && seriesResult.booked.length === 1) {');

    expect(flexibleBlockStart).toBeGreaterThanOrEqual(0);
    expect(slotPinnedStart).toBeGreaterThan(flexibleBlockStart);
    expect(singleGuardIndex).toBeGreaterThan(slotPinnedStart);
    expect(body).toContain('Repeat, flexible, and free offers');
    expect(body).toContain('repeatWeeks === 1');
    expect(body).toContain('seriesResult.booked.length === 1');
    expect(body.slice(flexibleBlockStart, slotPinnedStart)).not.toContain('ensureSlotBookingBcs');
  });

  test('accepted retry can repair a missing BCS only for single non-flex paid offers', () => {
    const body = getOfferBookingBody();
    const acceptedIndex = body.indexOf("if (offer.status === 'accepted') {");
    const guardIndex = body.indexOf('if (!isFlexible && repeatWeeks === 1 && offer.booking_id) {');
    const fetchIndex = body.indexOf('const [existingOfferCreditTx] = await sql`');
    const repairIndex = body.indexOf('creditTransaction: existingOfferCreditTx');
    const mainInsertIndex = body.indexOf('INSERT INTO credit_transactions');

    expect(acceptedIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeGreaterThan(acceptedIndex);
    expect(fetchIndex).toBeGreaterThan(guardIndex);
    expect(repairIndex).toBeGreaterThan(fetchIndex);
    expect(mainInsertIndex).toBeGreaterThan(repairIndex);
    expect(body).toContain('AND type = \'slot_purchase\'');
    expect(body).toContain('bookingId: offer.booking_id');
  });
});
