const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_booking_extension_review';

const {
  expireExtensionCheckoutSessions,
  invalidatePendingBookingExtensions,
} = require('../api/_booking-extension-invalidation');
const {
  _fulfilPaidBookingExtension: fulfilPaidBookingExtension,
  _settleUnfulfilledBookingExtensionRefund: settleUnfulfilledBookingExtensionRefund,
} = require('../api/webhook');
const { _acceptFreeBookingExtension: acceptFreeBookingExtension } = require('../api/offers');

function canonicalExtension({ lockedStatus = 'pending' } = {}) {
  const session = {
    id: 'cs_extension_race',
    payment_intent: 'pi_extension_race',
    amount_total: 2750,
    currency: 'gbp',
    metadata: { offer_id: '901' },
  };
  const offer = {
    id: 901,
    school_id: 7,
    learner_id: 31,
    instructor_id: 12,
    extension_minutes: 30,
    extension_booking_id: 501,
    offer_price_pence: 2750,
    extension_base_list_price_pence: 8250,
    scheduled_date: '2026-09-12',
    start_time: '10:30:00',
    end_time: '11:00:00',
    stripe_session_id: session.id,
  };
  return {
    session,
    offer,
    lockedStatus,
    metadata: {
      extension_booking_id: '501',
      extension_minutes: '30',
    },
  };
}

function extensionTransaction({ lockedStatus = 'pending', booking = null } = {}) {
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (/pg_advisory_xact_lock/.test(text)) return { rows: [], rowCount: 1 };
      if (/FROM lesson_offers[\s\S]*FOR UPDATE/.test(text)) {
        return { rows: [{ id: 901, status: lockedStatus, booking_id: null, stripe_session_id: 'cs_extension_race' }], rowCount: 1 };
      }
      if (/FROM lesson_bookings lb/.test(text)) {
        return { rows: booking ? [booking] : [], rowCount: booking ? 1 : 0 };
      }
      if (/INSERT INTO refund_events/.test(text)) {
        return {
          rows: [{
            id: 801, status: 'processing', school_id: 7, learner_id: 31,
            gross_refund_pence: 2750, stripe_payment_intent_id: 'pi_extension_race',
            refund_type: 'booking_extension_unfulfilled',
          }],
          rowCount: 1,
        };
      }
      if (/UPDATE lesson_offers SET status = 'cancelled'/.test(text)) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected extension transaction query: ${text}`);
    },
  };
  return {
    calls,
    runner: async (_connectionString, work) => work(client),
  };
}

async function runInvalidExtension({ lockedStatus = 'pending', booking = null } = {}) {
  const shape = canonicalExtension({ lockedStatus });
  const tx = extensionTransaction({ lockedStatus, booking });
  const result = await fulfilPaidBookingExtension({
    ...shape,
    fundingEvidence: { feePence: 85 },
    metadataLearnerId: 31,
    metadataSchoolId: 7,
    instructorId: 12,
    amountPence: 2750,
    durationMins: 30,
    transactionRunner: tx.runner,
    connectionString: 'test',
  });
  return { result, calls: tx.calls };
}

test.describe('booking extension offer contract', () => {
  test('migration stores an extension against one existing booking', () => {
    const migration = read('db/migrations/060_booking_extension_offers.sql');
    expect(migration).toContain('extension_booking_id INTEGER');
    expect(migration).toContain('lesson_offers_extension_booking_school_fkey');
    expect(migration).toContain('FOREIGN KEY (extension_booking_id, school_id)');
    expect(migration).toContain('REFERENCES lesson_bookings(id, school_id)');
    expect(migration).toContain('extension_minutes IS NOT NULL');
    expect(migration).toContain('extension_base_list_price_pence IS NOT NULL');
    expect(migration).toContain('extension_minutes BETWEEN 30 AND 180');
    expect(migration).toContain('extension_base_list_price_pence INTEGER');
    expect(migration).toContain('uq_lesson_offers_pending_extension');
    expect(migration).toContain("WHERE status = 'pending' AND extension_booking_id IS NOT NULL");
    expect(migration).toContain("'booking_extension_unfulfilled'");
    expect(migration).toContain("'processing', 'manual_review'");
  });

  test('instructor route prices and sends a booking-bound request', () => {
    const source = read('api/instructor.js');
    expect(source).toContain("if (action === 'create-extension-offer') return handleCreateExtensionOffer(req, res);");
    expect(source).toContain("status = 'pending' AND expires_at <= NOW()");
    expect(source).toContain('async function handleCreateExtensionOffer');
    expect(source).toContain('durationMinutes: extensionMinutes');
    expect(source).toContain("'manual', ${bookingId}, ${extensionMinutes}");
    expect(source).toContain("booking.status !== SCHEDULED");
    expect(source).toContain('lb.start_time < ${newEndTime}::time');
    expect(source).not.toContain('extension availability_override');
  });

  test('Checkout identifies the extension without restricting dynamic payment methods', () => {
    const source = read('api/offers.js');
    expect(source).toContain('const durationMins = isExtension ? Number(offer.extension_minutes)');
    expect(source).toContain('extension_booking_id: isExtension ? String(offer.extension_booking_id)');
    expect(source).toContain('extension_minutes: isExtension ? String(offer.extension_minutes)');
    expect(source).toContain('Lesson extension — ${lessonDate}');
    expect(source).toContain('excluded_payment_method_types: CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES');
    expect(source).toContain('idempotencyKey: `lesson_extension_offer_${offer.id}`');
    expect(source).not.toContain("payment_method_types: ['card']");
  });

  test('paid and free extensions use separate settlement paths', () => {
    const source = read('api/offers.js');
    const extensionPrice = source.indexOf('if (isExtension) {\n      pricePence = Number(offer.offer_price_pence);');
    const trialPrice = source.indexOf('} else if (isTrialOffer) {', extensionPrice);
    expect(extensionPrice).toBeGreaterThan(-1);
    expect(trialPrice).toBeGreaterThan(extensionPrice);
    expect(source).toContain('pricePence === 0 && isExtension');
    expect(source).toContain('await acceptFreeBookingExtension({');
    expect(source).toContain('pricePence === 0 && !isFlexible && !isExtension');
    expect(source).toContain('pricePence === 0 && isFlexible && !isExtension');
    expect(source).toContain('if (isExtension) {\n      finalPricePence = Number(offer.offer_price_pence);');
    expect(source).toContain('extension_booking_id: isExtension ? String(offer.extension_booking_id)');
    expect(read('api/webhook.js')).toContain('await fulfilPaidBookingExtension({');
  });

  test('free extension acceptance atomically changes only booking time and offer status', async () => {
    const calls = [];
    const transactionRunner = async (_connectionString, work) => work({
      async query(text, values = []) {
        calls.push({ text, values });
        if (/pg_advisory_xact_lock/.test(text)) return { rows: [], rowCount: 1 };
        if (/FROM lesson_offers[\s\S]*FOR UPDATE/.test(text)) {
          return {
            rows: [{
              id: 901, status: 'pending', expired: false, learner_id: 31,
              instructor_id: 12, school_id: 7, extension_booking_id: 501,
              extension_minutes: 30, offer_price_pence: 0,
              scheduled_date: '2026-09-12', start_time: '10:30:00', end_time: '11:00:00',
            }],
            rowCount: 1,
          };
        }
        if (/FROM lesson_bookings lb[\s\S]*FOR UPDATE OF lb/.test(text)) {
          return {
            rows: [{
              id: 501, status: 'scheduled', learner_id: 31, instructor_id: 12, school_id: 7,
              scheduled_date: '2026-09-12', start_time: '09:00:00', end_time: '10:30:00',
              lesson_has_ended: false, learner_name: 'Taylor Learner',
              learner_email: 'learner@example.com', learner_phone: null,
              instructor_name: 'Fraser', instructor_email: 'fraser@example.com', instructor_phone: null,
            }],
            rowCount: 1,
          };
        }
        if (/SELECT id FROM (lesson_bookings|instructor_busy_blocks|lesson_offers|lesson_requests|slot_reservations)/.test(text)) {
          return { rows: [], rowCount: 0 };
        }
        if (/UPDATE lesson_bookings/.test(text)) return { rows: [{ id: 501 }], rowCount: 1 };
        if (/UPDATE lesson_offers/.test(text)) return { rows: [{ id: 901 }], rowCount: 1 };
        throw new Error(`Unexpected free extension query: ${text}`);
      },
    });

    const result = await acceptFreeBookingExtension({
      offer: { id: 901, school_id: 7, instructor_id: 12 },
      connectionString: 'test',
      transactionRunner,
    });

    expect(result).toMatchObject({ applied: true, bookingId: 501, extensionMinutes: 30, newEndTime: '11:00' });
    const bookingUpdate = calls.find(call => /UPDATE lesson_bookings/.test(call.text));
    expect(bookingUpdate.text).toContain('SET end_time = $1::time, edited_at = NOW()');
    expect(bookingUpdate.text).not.toContain('minutes_deducted');
    expect(bookingUpdate.text).not.toContain('list_price_pence');
    expect(calls.some(call => /INSERT INTO (credit_transactions|booking_credit_sources)/.test(call.text))).toBe(false);
  });

  test('paid fulfilment updates booking and accounting evidence atomically', () => {
    const source = read('api/webhook.js');
    const start = source.indexOf('async function fulfilPaidBookingExtension');
    const end = source.indexOf('async function notifyPaidBookingExtension', start);
    const body = source.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('transactionRunner(connectionString');
    expect(body).toContain('pg_advisory_xact_lock');
    expect(body).toContain("VALUES ($1, 'slot_purchase'");
    expect(body).toContain('INSERT INTO booking_credit_sources');
    expect(body).toContain('minutes_deducted = COALESCE(minutes_deducted, 0) + $2');
    expect(body).toContain('list_price_pence = COALESCE(list_price_pence, $3) + $4');
    expect(body).toContain("SET status = 'accepted', booking_id = $1");
    expect(body.indexOf('INSERT INTO credit_transactions')).toBeLessThan(body.indexOf('UPDATE lesson_bookings'));
    expect(body.indexOf('UPDATE lesson_bookings')).toBeLessThan(body.indexOf("SET status = 'accepted'"));
  });

  test('source booking cancellation after Checkout creates a durable full-refund intent', async () => {
    const { result, calls } = await runInvalidExtension({
      booking: {
        id: 501, status: 'refunded', learner_id: 31, instructor_id: 12, school_id: 7,
        scheduled_date: '2026-09-12', start_time: '09:00:00', end_time: '10:30:00',
      },
    });
    expect(result).toMatchObject({ refundRequired: true, resolutionReason: 'booking_changed_or_cancelled', amountPence: 2750 });
    expect(calls.some(call => /INSERT INTO credit_transactions/.test(call.text))).toBe(false);
    expect(calls.some(call => /INSERT INTO refund_events/.test(call.text))).toBe(true);
  });

  test('source booking edit after Checkout creates the same durable refund intent', async () => {
    const { result } = await runInvalidExtension({
      booking: {
        id: 501, status: 'scheduled', learner_id: 31, instructor_id: 12, school_id: 7,
        scheduled_date: '2026-09-12', start_time: '09:30:00', end_time: '10:45:00',
      },
    });
    expect(result).toMatchObject({ refundRequired: true, resolutionReason: 'booking_changed_or_cancelled' });
  });

  test('cancelled extension offer after Checkout creates a durable refund intent', async () => {
    const { result, calls } = await runInvalidExtension({ lockedStatus: 'cancelled' });
    expect(result).toMatchObject({ refundRequired: true, resolutionReason: 'offer_cancelled' });
    expect(calls.some(call => /FROM lesson_bookings lb/.test(call.text))).toBe(false);
  });

  test('booking invalidation expires its open extension Checkout session', async () => {
    const expireCalls = [];
    const sql = async (strings) => {
      expect(strings.join('?')).toContain('extension_booking_id = ?');
      expect(strings.join('?')).toContain("status = 'pending'");
      return [{ id: 901, stripe_session_id: 'cs_open_extension' }];
    };
    const invalidated = await invalidatePendingBookingExtensions(sql, {
      bookingId: 501,
      instructorId: 12,
      schoolId: 7,
      stripeClient: { checkout: { sessions: { expire: async id => expireCalls.push(id) } } },
    });
    expect(invalidated).toHaveLength(1);
    expect(expireCalls).toEqual(['cs_open_extension']);
    const instructor = read('api/instructor.js');
    expect((instructor.match(/await invalidatePendingBookingExtensions\(sql,/g) || [])).toHaveLength(2);
    expect(instructor).toContain('await expireExtensionCheckoutSessions([updated.stripe_session_id])');
    expect(read('api/offers.js')).toContain("AND status = 'pending'\n      RETURNING id");
  });

  test('payment winning the invalidation race is refunded once across repeated webhook delivery', async () => {
    const { result } = await runInvalidExtension({ lockedStatus: 'cancelled' });
    const event = {
      id: 801,
      status: 'processing',
      school_id: 7,
      learner_id: 31,
      refund_type: 'booking_extension_unfulfilled',
      gross_refund_pence: 2750,
      stripe_payment_intent_id: 'pi_extension_race',
      stripe_refund_id: null,
    };
    const sql = async () => [{ ...event }];
    const refundCalls = [];
    const stripeClient = { refunds: { create: async (params, options) => {
      refundCalls.push({ params, options });
      return { id: 're_extension_race', status: 'succeeded', charge: 'ch_extension_race' };
    } } };
    const transactionRunner = async (_connectionString, work) => work({
      async query(text) {
        if (/SELECT id, status, stripe_refund_id/.test(text)) {
          return { rows: [{ id: event.id, status: event.status, stripe_refund_id: event.stripe_refund_id }], rowCount: 1 };
        }
        if (/INSERT INTO refund_event_lines/.test(text)) return { rows: [], rowCount: 1 };
        if (/UPDATE refund_events/.test(text)) {
          event.status = 'executed';
          event.stripe_refund_id = 're_extension_race';
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected refund finalization query: ${text}`);
      },
    });

    const first = await settleUnfulfilledBookingExtensionRefund({
      sql, session: canonicalExtension().session, result, stripeClient, transactionRunner, connectionString: 'test',
    });
    const repeated = await settleUnfulfilledBookingExtensionRefund({
      sql, session: canonicalExtension().session, result, stripeClient, transactionRunner, connectionString: 'test',
    });
    expect(first).toMatchObject({ refunded: true, idempotentReplay: false });
    expect(repeated).toMatchObject({ refunded: true, idempotentReplay: true });
    expect(refundCalls).toHaveLength(1);
    expect(refundCalls[0].options).toEqual({ idempotencyKey: 'lesson_extension_unfulfilled_cs_extension_race' });
    expect(refundCalls[0].params.amount).toBe(2750);
  });

  test('a failed race refund becomes durable manual review instead of retrying forever', async () => {
    const { result } = await runInvalidExtension({ lockedStatus: 'cancelled' });
    const event = {
      id: 801, status: 'processing', school_id: 7, learner_id: 31,
      refund_type: 'booking_extension_unfulfilled', gross_refund_pence: 2750,
      stripe_payment_intent_id: 'pi_extension_race', stripe_refund_id: null,
    };
    const sql = async (strings) => {
      const text = strings.join('?');
      if (/UPDATE refund_events/.test(text)) {
        event.status = 'manual_review';
        return [];
      }
      return [{ ...event }];
    };
    let attempts = 0;
    const stripeClient = { refunds: { create: async () => {
      attempts += 1;
      const error = new Error('provider unavailable');
      error.code = 'api_error';
      throw error;
    } } };

    const first = await settleUnfulfilledBookingExtensionRefund({
      sql, session: canonicalExtension().session, result, stripeClient,
    });
    const repeated = await settleUnfulfilledBookingExtensionRefund({
      sql, session: canonicalExtension().session, result, stripeClient,
    });
    expect(first).toMatchObject({ refunded: false, manualReview: true, idempotentReplay: false });
    expect(repeated).toMatchObject({ refunded: false, manualReview: true, idempotentReplay: true });
    expect(attempts).toBe(1);
  });

  test('instructor and learner surfaces label the extension clearly', () => {
    expect(read('public/instructor/index.js')).toContain('Request extension');
    expect(read('public/instructor/index.html')).toContain('id="extensionOfferModal"');
    expect(read('public/accept-offer.js')).toContain("document.getElementById('page-title').textContent = 'Extend your lesson'");
    expect(read('public/offer-success.js')).toContain("document.getElementById('s-title').textContent = 'Lesson extended!'");
    expect(read('public/accept-offer.js')).toContain("btn.textContent = 'Accept free extension →'");
    expect(read('public/offer-success.js')).toContain("'The free added time is now attached to your lesson.'");
    expect(read('public/offer-success.js')).toContain("offer.start_time.slice(0, 5) + ' \\u2013 ' + offer.end_time.slice(0, 5)");
  });

  test('accept page presents added time as an extension', async ({ page }) => {
    await page.route('**/api/offers**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        offer: {
          id: 901,
          scheduled_date: '2026-09-12',
          start_time: '10:30:00',
          end_time: '11:00:00',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          instructor_name: 'Fraser',
          lesson_type_name: 'Standard Lesson',
          duration_minutes: 30,
          price_pence: 2750,
          original_price_pence: 2750,
          kind: 'manual',
          is_extension: true,
          extension_minutes: 30,
          is_flexible: false,
          learner_email: 'learner@example.com',
          learner_name: 'Taylor Learner',
          learner_phone: '07123456789',
          learner_pickup_address: '1 Test Street',
        },
      }),
    }));

    await page.goto('/accept-offer?token=extension-test');
    await expect(page.locator('#page-title')).toHaveText('Extend your lesson');
    await expect(page.locator('#offer-duration-label')).toHaveText('Added time');
    await expect(page.locator('#offer-duration')).toHaveText('30 mins');
    await expect(page.locator('#offer-time')).toHaveText('10:30 – 11:00');
    await expect(page.locator('#pickup-field')).toBeHidden();
    await expect(page.locator('#pickup')).toBeHidden();
    await expect(page.locator('#repeat-weeks')).not.toHaveAttribute('id', 'pickup-field');
    await expect(page.locator('#repeat-section .field')).not.toHaveAttribute('id', 'pickup-field');
    await expect(page.locator('#accept-btn')).toHaveText('Add time & pay →');
  });

  test('accept page labels a zero-price extension as free', async ({ page }) => {
    await page.route('**/api/offers**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        offer: {
          id: 902,
          scheduled_date: '2026-09-12',
          start_time: '10:30:00',
          end_time: '11:00:00',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          instructor_name: 'Fraser',
          lesson_type_name: 'Standard Lesson',
          duration_minutes: 30,
          price_pence: 0,
          original_price_pence: 0,
          kind: 'manual',
          is_extension: true,
          extension_minutes: 30,
          is_flexible: false,
          learner_email: 'learner@example.com',
          learner_name: 'Taylor Learner',
          learner_phone: '07123456789',
          learner_pickup_address: '1 Test Street',
        },
      }),
    }));

    await page.goto('/accept-offer?token=free-extension-test');
    await expect(page.locator('#offer-price')).toHaveText('FREE');
    await expect(page.locator('#accept-btn')).toHaveText('Accept free extension →');
  });

  test('success page shows the extension interval after payment', async ({ page }) => {
    await page.route('**/api/offers**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        offer: {
          scheduled_date: '2026-09-12',
          start_time: '10:30:00',
          end_time: '11:00:00',
          instructor_name: 'Fraser',
          duration_minutes: 30,
          is_extension: true,
          is_flexible: false,
        },
      }),
    }));

    await page.goto('/offer-success?token=extension-test');
    await expect(page.locator('#s-title')).toHaveText('Lesson extended!');
    await expect(page.locator('#s-date')).toContainText('12 September');
    await expect(page.locator('#s-time')).toHaveText('10:30 – 11:00');
    await expect(page.locator('#s-duration-row .details-label')).toHaveText('Added time');
    await expect(page.locator('#s-duration')).toHaveText('30 mins');
  });
});
