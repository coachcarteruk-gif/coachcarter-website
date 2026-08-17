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

test.describe('webhook slot booking regressions', () => {
  function getSlotBookingBody() {
    const webhookPath = path.join(__dirname, '..', 'api', 'webhook.js');
    const source = fs.readFileSync(webhookPath, 'utf8');
    return extractFunctionBody(source, 'handleSlotBooking');
  }

  function getFunctionBody(functionName) {
    const webhookPath = path.join(__dirname, '..', 'api', 'webhook.js');
    const source = fs.readFileSync(webhookPath, 'utf8');
    return extractFunctionBody(source, functionName);
  }

  test('handleSlotBooking uses the deductResult balance for the confirmation email', () => {
    const body = getSlotBookingBody();

    expect(body).toContain('const deductResult = await lockBalanceAdjustLCB');
    expect(body).toContain('deductResult.balance_minutes');
    expect(body).not.toContain('deducted.balance_minutes');
  });

  test('handleSlotBooking creates a slot_purchase transaction, lesson booking, and matching BCS row', () => {
    const body = getSlotBookingBody();

    const creditTxIndex = body.indexOf('INSERT INTO credit_transactions');
    const bookingIndex = body.indexOf('INSERT INTO lesson_bookings');
    const bcsIndex = body.indexOf('creditTransaction: slotCreditTx');

    expect(creditTxIndex).toBeGreaterThanOrEqual(0);
    expect(bookingIndex).toBeGreaterThan(creditTxIndex);
    expect(bcsIndex).toBeGreaterThan(bookingIndex);

    expect(body).toContain("(${learnerId}, 'slot_purchase', 1, ${amountPence}");
    expect(body).toContain('RETURNING id');
    expect(body).toContain('slotCreditTx = creditTx');
    expect(body).toContain('RETURNING id, scheduled_date, start_time::text, end_time::text');
    expect(body).toContain('await ensureSlotBookingBcs(sql, {');
    expect(body).toContain('bookingId: booking.id');
    expect(body).toContain('creditTransaction: slotCreditTx');
  });

  test('handleSlotBooking snapshots rounded rate but exact amountPence contribution for BCS', () => {
    const slotBody = getSlotBookingBody();
    const bcsBody = getFunctionBody('ensureSlotBookingBcs');

    expect(slotBody).toContain('Math.round(amountPence / chargeMins)');
    expect(slotBody).toContain('RETURNING id, amount_pence, stripe_fee_pence, effective_rate_pence_per_minute');
    expect(bcsBody).toContain('rate_pence_per_minute, contribution_pence, stripe_fee_pence, absorbed_by');
    expect(bcsBody).toContain('${creditTransaction.effective_rate_pence_per_minute}, ${creditTransaction.amount_pence}, ${bcsStripeFeePence}, NULL');
  });

  test('handleSlotBooking BCS school_id matches the resolved tenant and source booking tenant', () => {
    const body = getSlotBookingBody();
    const bcsBody = getFunctionBody('ensureSlotBookingBcs');

    expect(body).toContain('const schoolId = await resolveSchoolId(sql, metadata, session.id)');
    expect(body).toContain('minutes, school_id,');
    expect(body).toContain('minutes_deducted, school_id,');
    expect(body).toContain('schoolId,');
    expect(bcsBody).toContain('(school_id, booking_id, credit_transaction_id, minutes_drawn,');
    expect(bcsBody).toContain('(${schoolId}, ${bookingId}, ${creditTransaction.id}, ${durationMins}');
  });

  test('handleSlotBooking BCS insert is idempotent on booking/source natural key', () => {
    const body = getFunctionBody('ensureSlotBookingBcs');

    expect(body).toContain('ON CONFLICT (booking_id, credit_transaction_id) DO NOTHING');
  });

  test('handleSlotBooking only inserts BCS after booking insert succeeds', () => {
    const body = getSlotBookingBody();
    const failedBookingReturnIndex = body.indexOf('notifyBookingInsertFailed');
    const bcsIndex = body.lastIndexOf('creditTransaction: slotCreditTx');

    expect(failedBookingReturnIndex).toBeGreaterThanOrEqual(0);
    expect(bcsIndex).toBeGreaterThan(failedBookingReturnIndex);
  });

  test('handleSlotBooking repairs missing BCS when retry sees existing CT and booking', () => {
    const body = getSlotBookingBody();

    const existingCtIndex = body.indexOf('const [existingCreditTx] = await sql`');
    const existingBookingIndex = body.indexOf('const existingBooking = await findExistingSlotBooking');
    const liveGuardIndex = body.indexOf('existingBooking && blocksSlot(existingBooking.status)');
    const repairIndex = body.indexOf('creditTransaction: existingCreditTx');
    const fetchEvidenceIndex = body.indexOf('fetchSessionFundingEvidence(session)');

    expect(existingCtIndex).toBeGreaterThanOrEqual(0);
    expect(existingBookingIndex).toBeGreaterThan(existingCtIndex);
    expect(liveGuardIndex).toBeGreaterThan(existingBookingIndex);
    expect(repairIndex).toBeGreaterThan(liveGuardIndex);
    expect(fetchEvidenceIndex).toBeGreaterThanOrEqual(0);
    expect(fetchEvidenceIndex).toBeLessThan(existingCtIndex);
    expect(body).toContain('bookingId: existingBooking.id');
    expect(body).toContain('return;');
  });

  test('handleSlotBooking does not repair active BCS for refunded matching bookings', () => {
    const body = getSlotBookingBody();

    expect(body).toContain('isTerminal(existingBooking.status)');
    expect(body).toContain('has slot_purchase CT and refunded booking');
    expect(body).toContain('not repairing active BCS');
    expect(body).toContain('isTerminal(racedBooking.status)');
    expect(body).toContain('hit uq_credit_tx_session with refunded booking');
  });

  test('handleSlotBooking recovers a paid orphan only through the guarded recovery transaction', () => {
    const body = getSlotBookingBody();

    expect(body).toContain("bookingPurpose !== 'lesson'");
    expect(body).toContain('const recovered = await recoverPaidBookingOrphan({');
    expect(body).toContain("paymentType: 'slot_booking'");
    expect(body).toContain('bookingId: recovered.bookingId');
    expect(body).toContain('creditTransactionId: recovered.creditTransactionId');
    expect(body).not.toContain('leaving orphan recovery to operator flow');
  });

  test('handleSlotBooking unique constraint race fetches existing CT before safe BCS repair', () => {
    const body = getSlotBookingBody();

    expect(body).toContain('const [racedCreditTx] = await sql`');
    expect(body).toContain('const racedBooking = await findExistingSlotBooking');
    expect(body).toContain('if (racedCreditTx && racedBooking && blocksSlot(racedBooking.status)) {');
    expect(body).toContain('bookingId: racedBooking.id');
    expect(body).toContain('creditTransaction: racedCreditTx');
    expect(body).toContain('before a matching booking was visible; retry required');
  });

  test('findExistingSlotBooking uses the same slot identity and tenant as the webhook metadata', () => {
    const body = getFunctionBody('findExistingSlotBooking');

    expect(body).toContain('SELECT id, status, scheduled_date, start_time::text, end_time::text');
    expect(body).toContain('WHERE learner_id = ${learnerId}');
    expect(body).toContain('AND instructor_id = ${instructorId}');
    expect(body).toContain('AND scheduled_date = ${scheduledDate}');
    expect(body).toContain('AND start_time = ${startTime}');
    expect(body).toContain('AND end_time = ${endTime}');
    expect(body).toContain('AND school_id = ${schoolId}');
  });

  test('findExistingSlotBooking deterministically prefers blocking bookings over terminal matches', () => {
    const body = getFunctionBody('findExistingSlotBooking');

    expect(body).toContain('ORDER BY id DESC');
    expect(body).not.toContain('LIMIT 1');
    expect(body).toContain('return bookings.find(booking => blocksSlot(booking.status))');
    expect(body).toContain('|| bookings.find(booking => isTerminal(booking.status))');
    expect(body.indexOf('blocksSlot(booking.status)'))
      .toBeLessThan(body.indexOf('isTerminal(booking.status)'));
  });
});
