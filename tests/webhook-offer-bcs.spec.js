// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { splitFifoPlanAcrossBookings } = require('../api/_bcs-booking-plan');

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

function extractFunctionSource(source, functionName) {
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
    if (depth === 0) return source.slice(start, i + 1);
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

  function getSeriesBcsBody() {
    return extractFunctionBody(webhookSource(), 'ensureOfferSeriesBcs');
  }

  function getExecutableSeriesBcs() {
    const source = extractFunctionSource(webhookSource(), 'ensureOfferSeriesBcs');
    return new Function('splitFifoPlanAcrossBookings', `return ${source};`)(splitFifoPlanAcrossBookings);
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

    expect(body).toContain('SELECT id, status, booking_id, learner_id, school_id FROM lesson_offers');
    expect(body).toContain('const schoolId = offer.school_id');
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

  test('paid repeat offer acceptance creates BCS rows only after every requested week is booked', () => {
    const body = getOfferBookingBody();
    const seriesBcsBody = getSeriesBcsBody();

    const bookingIndex = body.indexOf('seriesResult = await bookOfferSeries(sql, {');
    const repeatGuardIndex = body.indexOf('repeatWeeks > 1 && seriesResult.booked.length === repeatWeeks');
    const seriesBcsIndex = body.indexOf('await ensureOfferSeriesBcs(sql, {');
    const partialRefundIndex = body.indexOf('if (bookedCount < repeatWeeks) {');

    expect(bookingIndex).toBeGreaterThanOrEqual(0);
    expect(repeatGuardIndex).toBeGreaterThan(bookingIndex);
    expect(seriesBcsIndex).toBeGreaterThan(repeatGuardIndex);
    expect(partialRefundIndex).toBeGreaterThan(seriesBcsIndex);

    expect(body).toContain('RETURNING id, amount_pence, stripe_fee_pence, effective_rate_pence_per_minute, minutes');
    expect(seriesBcsBody).toContain('splitFifoPlanAcrossBookings({');
    expect(seriesBcsBody).toContain('minutes_drawn: creditTransaction.minutes');
    expect(seriesBcsBody).toContain('contribution_pence: creditTransaction.amount_pence');
    expect(seriesBcsBody).toContain('stripe_fee_pence: creditTransaction.stripe_fee_pence ?? 0');
    expect(seriesBcsBody).toContain('school_id: schoolId');
    expect(seriesBcsBody).toContain('(${row.school_id}, ${row.booking_id}, ${row.credit_transaction_id}, ${row.minutes_drawn}');
  });

  test('repeat offer BCS writer is retry-safe on the booking/source natural key', async () => {
    const ensureOfferSeriesBcs = getExecutableSeriesBcs();
    const calls = [];
    const sql = async (strings, ...values) => {
      calls.push({
        text: String.raw(strings, ...values.map((_, index) => `$${index + 1}`)),
        values,
      });
      return [];
    };

    const input = {
      schoolId: 2,
      bookedLessons: [
        { booking_id: 1101 },
        { booking_id: 1102 },
      ],
      creditTransaction: {
        id: 42,
        minutes: 180,
        amount_pence: 16500,
        stripe_fee_pence: 288,
        effective_rate_pence_per_minute: 92,
      },
      durationMins: 90,
    };

    await ensureOfferSeriesBcs(sql, input);
    await ensureOfferSeriesBcs(sql, input);

    const conflictPattern = /ON\s+CONFLICT\s*\(\s*booking_id\s*,\s*credit_transaction_id\s*\)\s+DO\s+NOTHING/i;
    expect(getBcsBody()).toMatch(conflictPattern);
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.text).toContain('INSERT INTO booking_credit_sources');
      expect(call.text).toMatch(conflictPattern);
    }
    expect(calls.map(call => [call.values[1], call.values[2]])).toEqual([
      [1101, 42],
      [1102, 42],
      [1101, 42],
      [1102, 42],
    ]);
  });

  test('partial repeat, flexible, and free offer paths are deliberately outside this writer', () => {
    const body = getOfferBookingBody();
    const flexibleBlockStart = body.indexOf('if (isFlexible) {');
    const slotPinnedStart = body.indexOf('const deducted = await lockBalanceAdjustLCB', flexibleBlockStart);
    const singleGuardIndex = body.indexOf('if (!isFlexible && repeatWeeks === 1 && seriesResult.booked.length === 1) {');
    const repeatGuardIndex = body.indexOf('repeatWeeks > 1 && seriesResult.booked.length === repeatWeeks');

    expect(flexibleBlockStart).toBeGreaterThanOrEqual(0);
    expect(slotPinnedStart).toBeGreaterThan(flexibleBlockStart);
    expect(singleGuardIndex).toBeGreaterThan(slotPinnedStart);
    expect(repeatGuardIndex).toBeGreaterThan(singleGuardIndex);
    expect(body).toContain('Partial');
    expect(body).toContain('repeatWeeks === 1');
    expect(body).toContain('seriesResult.booked.length === 1');
    expect(body).toContain('seriesResult.booked.length === repeatWeeks');
    expect(body.slice(flexibleBlockStart, slotPinnedStart)).not.toContain('ensureSlotBookingBcs');
    expect(body).not.toContain('seriesResult.booked.length < repeatWeeks && ensureOfferSeriesBcs');
  });

  test('partial repeat refund failure is reported and fails before success emails', () => {
    const body = getOfferBookingBody();

    const partialRefundIndex = body.indexOf('if (bookedCount < repeatWeeks) {');
    const refundCreateIndex = body.indexOf('await stripe.refunds.create({', partialRefundIndex);
    const reportIndex = body.indexOf("reportError('/api/webhook (lesson_offer partial repeat refund failed)'", partialRefundIndex);
    const throwIndex = body.indexOf('throw partialRefundError;', partialRefundIndex);
    const offerUpdateIndex = body.indexOf('UPDATE lesson_offers', partialRefundIndex);
    const learnerEmailIndex = body.indexOf('purpose: \'offer.accepted_learner\'', partialRefundIndex);

    expect(partialRefundIndex).toBeGreaterThanOrEqual(0);
    expect(refundCreateIndex).toBeGreaterThan(partialRefundIndex);
    expect(reportIndex).toBeGreaterThan(refundCreateIndex);
    expect(throwIndex).toBeGreaterThan(reportIndex);
    expect(offerUpdateIndex).toBeGreaterThan(throwIndex);
    expect(learnerEmailIndex).toBeGreaterThan(throwIndex);
    expect(body).toContain('Missing payment_intent for partial repeat-offer refund');
    expect(body).toContain('refund_amount_pence=${amountPence * unused}');
  });

  test('retry after mid-flight offer failure does not become a clean duplicate no-op', () => {
    const body = getOfferBookingBody();

    const duplicateIndex = body.indexOf("insertErr.message?.includes('uq_credit_tx_session')");
    const sourceRetryIndex = body.indexOf('AS payout_source_exists', duplicateIndex);
    const resumeIndex = body.indexOf('if (retryCandidate && !retryCandidate.payout_source_exists)', duplicateIndex);
    const errorIndex = body.indexOf('const duplicatePendingError = new Error(', duplicateIndex);
    const throwIndex = body.indexOf('throw duplicatePendingError;', duplicateIndex);
    const offerAcceptedUpdateIndex = body.indexOf('UPDATE lesson_offers', duplicateIndex);

    expect(duplicateIndex).toBeGreaterThanOrEqual(0);
    expect(sourceRetryIndex).toBeGreaterThan(duplicateIndex);
    expect(resumeIndex).toBeGreaterThan(sourceRetryIndex);
    expect(errorIndex).toBeGreaterThan(duplicateIndex);
    expect(errorIndex).toBeGreaterThan(resumeIndex);
    expect(throwIndex).toBeGreaterThan(errorIndex);
    expect(offerAcceptedUpdateIndex).toBeGreaterThan(throwIndex);
    expect(body).toContain('previous webhook attempt likely failed mid-flight');
  });

  test('accepted retry can repair a missing BCS only for single non-flex paid offers', () => {
    const body = getOfferBookingBody();
    const acceptedIndex = body.indexOf("if (offer.status === 'accepted') {");
    const guardIndex = body.indexOf('if (!isFlexible && repeatWeeks === 1 && offer.booking_id) {');
    const fetchIndex = body.indexOf('const [existingOfferCreditTx] = await sql`');
    const repairIndex = body.indexOf('creditTransaction: existingOfferCreditTx');
    const mainInsertIndex = body.indexOf('INSERT INTO credit_transactions');

    expect(acceptedIndex).toBeGreaterThanOrEqual(0);
    expect(fetchIndex).toBeGreaterThan(acceptedIndex);
    expect(guardIndex).toBeGreaterThan(fetchIndex);
    expect(repairIndex).toBeGreaterThan(fetchIndex);
    expect(mainInsertIndex).toBeGreaterThan(repairIndex);
    expect(body).toContain('AND type = \'slot_purchase\'');
    expect(body).toContain('bookingId: offer.booking_id');
  });
});
