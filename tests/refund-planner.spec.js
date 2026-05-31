// @ts-check
// Read-only refund planner tests. No Neon, no prod, no Stripe mutations.

const { test, expect } = require('@playwright/test');
const {
  planAdminRefundPreview,
  validateRefundPreviewRequest,
} = require('../api/_refund-planner');

function makeSql(handler) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    if (/\b(INSERT|UPDATE|DELETE)\b/i.test(text)) {
      throw new Error(`mutation SQL is forbidden in refund-preview tests: ${text}`);
    }
    return handler ? handler(text, values) : [];
  };
  sql.calls = calls;
  return sql;
}

function creditSourceRow(overrides = {}) {
  return {
    credit_transaction_id: 101,
    school_id: 1,
    learner_id: 61,
    instructor_id: 4,
    source_minutes: 90,
    source_amount_pence: 8250,
    source_stripe_fee_pence: 144,
    payment_method: 'card',
    stripe_session_id: 'cs_credit',
    stripe_payment_intent_id: 'pi_credit',
    stripe_charge_id: 'ch_credit',
    learner_name: 'Beatriz Example',
    learner_email: 'beatriz@example.test',
    instructor_name: 'Fraser Carter',
    payment_source: 'credit_transaction',
    active_contribution_pence: 0,
    active_stripe_fee_pence: 0,
    active_minutes_drawn: 0,
    adjusted_pence: 0,
    adjusted_minutes: 0,
    ...overrides,
  };
}

function bcsRow(overrides = {}) {
  return {
    booking_credit_source_id: 55,
    school_id: 1,
    booking_id: 9001,
    credit_transaction_id: 101,
    minutes_drawn: 90,
    contribution_pence: 8250,
    bcs_stripe_fee_pence: 123,
    learner_id: 61,
    instructor_id: 4,
    source_amount_pence: 8250,
    source_stripe_fee_pence: 999,
    stripe_session_id: 'cs_bcs',
    stripe_payment_intent_id: 'pi_bcs',
    stripe_charge_id: 'ch_bcs',
    payment_method: 'card',
    learner_name: 'Beatriz Example',
    learner_email: 'beatriz@example.test',
    instructor_name: 'Fraser Carter',
    booking_start_at: '2026-06-01 10:00:00',
    booking_duration_minutes: 90,
    payment_source: 'booking_credit_source',
    ...overrides,
  };
}

function bookingRow(overrides = {}) {
  return {
    lesson_booking_id: 7001,
    school_id: 1,
    learner_id: 61,
    instructor_id: 4,
    payment_method: 'card',
    payment_channel: 'card',
    list_price_pence: 8250,
    booking_stripe_fee_pence: 144,
    learner_name: 'Beatriz Example',
    learner_email: 'beatriz@example.test',
    instructor_name: 'Fraser Carter',
    booking_start_at: '2026-06-01 10:00:00',
    booking_duration_minutes: 90,
    payment_source: 'lesson_booking',
    bcs_contribution_pence: 0,
    bcs_stripe_fee_pence: 0,
    stripe_session_id: null,
    stripe_payment_intent_id: null,
    stripe_charge_id: null,
    already_paid_out: false,
    ...overrides,
  };
}

async function plan(input, sql) {
  return planAdminRefundPreview({ sql, stripe: null, input });
}

function stripeFeeLookup(feePence = 144) {
  return {
    charges: {
      retrieve: async () => ({
        id: 'ch_lookup',
        payment_intent: 'pi_lookup',
        balance_transaction: {
          id: 'txn_lookup',
          fee: feePence,
        },
      }),
    },
  };
}

test.describe('refund preview planner', () => {
  test('previews a Beatriz-like full unused credit purchase net of the original Stripe fee', async () => {
    const sql = makeSql(() => [creditSourceRow()]);

    const result = await plan({
      schoolId: 1,
      refundType: 'credit_purchase',
      creditTransactionId: 101,
      reason: 'approved unused credit refund',
    }, sql);

    expect(result).toMatchObject({
      ok: true,
      blocked: false,
      manual_review_required: false,
      refund_type: 'credit_purchase',
      gross_refund_pence: 8250,
      processing_fee_withheld_pence: 144,
      net_refund_pence: 8106,
      recommended_operator_action: 'execute_eligible',
      learner_name: 'Beatriz Example',
      learner_email: 'beatriz@example.test',
      instructor_name: 'Fraser Carter',
      payment_source: 'credit_transaction',
      payment_channel: 'card',
      fee_evidence: {
        source: 'credit_transactions.stripe_fee_pence',
        pence: 144,
      },
    });
    expect(result.lines).toEqual([expect.objectContaining({
      credit_transaction_id: 101,
      gross_pence_removed: 8250,
      source_fee_pence_used: 144,
      fee_withheld_pence: 144,
      net_refund_pence: 8106,
    })]);
    expect(result.admin_display_copy).toBe([
      'Refund summary:',
      'Lesson credit value: £82.50',
      'Payment processing fee: -£1.44',
      'Amount returned: £81.06',
    ].join('\n'));
  });

  test('deducts a proportional original processing-fee share for a partial refund', async () => {
    const sql = makeSql(() => [creditSourceRow({
      source_amount_pence: 10000,
      source_stripe_fee_pence: 200,
    })]);

    const result = await plan({
      schoolId: 1,
      refundType: 'credit_purchase',
      creditTransactionId: 101,
      grossRefundPence: 5000,
      reason: 'partial refund',
    }, sql);

    expect(result.gross_refund_pence).toBe(5000);
    expect(result.processing_fee_withheld_pence).toBe(100);
    expect(result.net_refund_pence).toBe(4900);
  });

  test('prefers BCS-attributed fee evidence over rough source-level calculation', async () => {
    const sql = makeSql(() => [bcsRow()]);

    const result = await plan({
      schoolId: 1,
      refundType: 'repeat_offer_partial',
      bookingCreditSourceId: 55,
      reason: 'unused repeat week',
    }, sql);

    expect(result.processing_fee_withheld_pence).toBe(123);
    expect(result.fee_evidence).toEqual({
      source: 'booking_credit_sources.stripe_fee_pence',
      pence: 123,
      preferred_bcs_attribution: true,
    });
    expect(result).toMatchObject({
      recommended_operator_action: 'manual_review_required',
      learner_name: 'Beatriz Example',
      learner_email: 'beatriz@example.test',
      instructor_name: 'Fraser Carter',
      booking_start_at: '2026-06-01 10:00:00',
      booking_duration_minutes: 90,
      payment_source: 'booking_credit_source',
      payment_channel: 'card',
    });
  });

  test('falls back from zero BCS fee to source fee for Stripe-paid credit source', async () => {
    const sql = makeSql(() => [bcsRow({
      contribution_pence: 4125,
      source_amount_pence: 8250,
      bcs_stripe_fee_pence: 0,
      source_stripe_fee_pence: 144,
      stripe_payment_intent_id: 'pi_paid',
      stripe_charge_id: 'ch_paid',
    })]);

    const result = await plan({
      schoolId: 1,
      refundType: 'repeat_offer_partial',
      bookingCreditSourceId: 55,
      reason: 'unused repeat week',
    }, sql);

    expect(result).toMatchObject({
      ok: true,
      blocked: false,
      gross_refund_pence: 4125,
      processing_fee_withheld_pence: 72,
      net_refund_pence: 4053,
      fee_evidence: {
        source: 'credit_transactions.stripe_fee_pence',
        pence: 144,
        attributed_fee_pence: 72,
        fallback_from_zero_bcs_fee: true,
      },
    });
    expect(result.lines[0]).toMatchObject({
      source_fee_pence_used: 72,
      fee_withheld_pence: 72,
    });
  });

  test('blocks zero BCS fee when Stripe-paid source has no reliable fee evidence', async () => {
    const sql = makeSql(() => [bcsRow({
      bcs_stripe_fee_pence: 0,
      source_stripe_fee_pence: 0,
      stripe_payment_intent_id: 'pi_paid',
      stripe_charge_id: 'ch_paid',
    })]);

    const result = await plan({
      schoolId: 1,
      refundType: 'repeat_offer_partial',
      bookingCreditSourceId: 55,
      reason: 'missing fee attribution',
    }, sql);

    expect(result).toMatchObject({
      ok: true,
      blocked: true,
      manual_review_required: true,
      code: 'MISSING_PROCESSING_FEE',
      gross_refund_pence: 8250,
      recommended_operator_action: 'blocked',
    });
    expect(result.processing_fee_withheld_pence).toBe(0);
    expect(result.lines[0]).toMatchObject({
      booking_credit_source_id: 55,
      credit_transaction_id: 101,
      source_fee_pence_used: 0,
      fee_withheld_pence: 0,
      net_refund_pence: 8250,
      minutes_adjusted: 90,
    });
    expect(result.warnings[0]).toContain('Processing fee evidence is missing');
  });

  test('uses Stripe lookup instead of silently withholding zero fee for paid BCS flows', async () => {
    const sql = makeSql(() => [bcsRow({
      bcs_stripe_fee_pence: 0,
      source_stripe_fee_pence: null,
      stripe_payment_intent_id: null,
      stripe_charge_id: 'ch_paid',
    })]);

    const result = await planAdminRefundPreview({
      sql,
      stripe: stripeFeeLookup(180),
      input: {
        schoolId: 1,
        refundType: 'repeat_offer_partial',
        bookingCreditSourceId: 55,
        reason: 'lookup fee attribution',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      blocked: false,
      gross_refund_pence: 8250,
      processing_fee_withheld_pence: 180,
      net_refund_pence: 8070,
      fee_evidence: {
        source: 'stripe_balance_transaction',
        feePence: 180,
        attributed_fee_pence: 180,
        fallback_from_zero_bcs_fee: true,
      },
    });
    expect(result.processing_fee_withheld_pence).toBeGreaterThan(0);
  });

  test('blocks automatic preview when fee data is missing and there is no Stripe lookup path', async () => {
    const sql = makeSql(() => [creditSourceRow({
      source_stripe_fee_pence: null,
      stripe_session_id: null,
      stripe_payment_intent_id: null,
      stripe_charge_id: null,
    })]);

    const result = await plan({
      schoolId: 1,
      refundType: 'credit_purchase',
      creditTransactionId: 101,
      reason: 'missing fee',
    }, sql);

    expect(result).toMatchObject({
      ok: true,
      blocked: true,
      manual_review_required: true,
      code: 'MISSING_PROCESSING_FEE',
      gross_refund_pence: 8250,
      net_refund_pence: 8250,
      recommended_operator_action: 'blocked',
    });
    expect(result.lines[0]).toMatchObject({
      credit_transaction_id: 101,
      source_fee_pence_used: 0,
      fee_withheld_pence: 0,
      net_refund_pence: 8250,
      minutes_adjusted: 90,
    });
    expect(result.warnings[0]).toContain('Processing fee evidence is missing');
  });

  test('blocks automatic Stripe refund for direct bookings already in payout_line_items', async () => {
    const sql = makeSql(() => [bookingRow({ already_paid_out: true })]);

    const result = await plan({
      schoolId: 1,
      refundType: 'direct_slot',
      lessonBookingId: 7001,
      reason: 'already paid out booking',
    }, sql);

    expect(result).toMatchObject({
      ok: true,
      blocked: true,
      manual_review_required: true,
      code: 'BOOKING_ALREADY_PAID_OUT',
      gross_refund_pence: 8250,
      processing_fee_withheld_pence: 144,
      net_refund_pence: 8106,
      recommended_operator_action: 'manual_bank_review_required',
      learner_name: 'Beatriz Example',
      learner_email: 'beatriz@example.test',
      instructor_name: 'Fraser Carter',
      booking_start_at: '2026-06-01 10:00:00',
      booking_duration_minutes: 90,
      payment_source: 'lesson_booking',
      payment_channel: 'card',
      fee_evidence: {
        source: 'lesson_bookings.stripe_fee_pence',
        pence: 144,
      },
    });
    expect(result.lines[0]).toMatchObject({
      lesson_booking_id: 7001,
      source_fee_pence_used: 144,
      fee_withheld_pence: 144,
      net_refund_pence: 8106,
    });
    expect(result.message).toContain('manual bank refund');
  });

  test('blocks BCS-backed direct bookings from automatic execute eligibility', async () => {
    const sql = makeSql(() => [bookingRow({
      bcs_contribution_pence: 8250,
      bcs_stripe_fee_pence: 144,
      stripe_payment_intent_id: 'pi_bcs_direct',
      stripe_charge_id: 'ch_bcs_direct',
    })]);

    const result = await plan({
      schoolId: 1,
      refundType: 'direct_slot',
      lessonBookingId: 7001,
      reason: 'bcs backed direct booking',
    }, sql);

    expect(result).toMatchObject({
      ok: true,
      blocked: true,
      manual_review_required: true,
      code: 'BCS_EXECUTE_NOT_ENABLED',
      recommended_operator_action: 'blocked',
      gross_refund_pence: 8250,
      stripe: {
        stripePaymentIntentId: 'pi_bcs_direct',
        stripeChargeId: 'ch_bcs_direct',
      },
    });
    expect(result.message).toContain('booking credit sources');
  });

  test('blocks direct booking preview when caller requests more than computed refundable value', async () => {
    const sql = makeSql(() => [bookingRow({ list_price_pence: 8250 })]);

    const result = await plan({
      schoolId: 1,
      refundType: 'direct_slot',
      lessonBookingId: 7001,
      grossRefundPence: 10000,
      reason: 'over gross probe',
    }, sql);

    expect(result).toMatchObject({
      ok: true,
      blocked: true,
      manual_review_required: true,
      code: 'GROSS_REFUND_OUT_OF_RANGE',
      gross_refund_pence: 10000,
      metadata: {
        max_gross_refund_pence: 8250,
      },
    });
    expect(result.message).toContain('no more than the booking refundable value');
  });

  test('tenant-scoped source lookup uses school_id and cross-school missing source is rejected', async () => {
    const sql = makeSql(() => []);

    const result = await plan({
      schoolId: 2,
      refundType: 'credit_purchase',
      creditTransactionId: 101,
      reason: 'cross-school probe',
    }, sql);

    expect(result).toMatchObject({
      ok: true,
      blocked: true,
      code: 'CREDIT_TRANSACTION_NOT_FOUND',
    });
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0].text).toContain('WHERE ct.school_id = ?');
    expect(sql.calls[0].text).toContain('lu.school_id = ?');
    expect(sql.calls[0].text).toContain('i.school_id = ?');
    expect(sql.calls[0].values).toEqual(expect.arrayContaining([2, 101]));
  });

  test('marks clean previews without a Stripe refund target for manual review', async () => {
    const sql = makeSql(() => [creditSourceRow({
      stripe_session_id: null,
      stripe_payment_intent_id: null,
      stripe_charge_id: null,
    })]);

    const result = await plan({
      schoolId: 1,
      refundType: 'credit_purchase',
      creditTransactionId: 101,
      reason: 'manual target review',
    }, sql);

    expect(result).toMatchObject({
      ok: true,
      blocked: false,
      manual_review_required: false,
      recommended_operator_action: 'manual_review_required',
    });
  });

  test('validates the pragmatic admin request shapes', () => {
    expect(validateRefundPreviewRequest({
      refund_type: 'credit_purchase',
      credit_transaction_id: 101,
    }, { schoolId: 1 })).toMatchObject({ ok: true });

    expect(validateRefundPreviewRequest({
      refund_type: 'direct_slot',
      lesson_booking_id: 7001,
    }, { schoolId: 1 })).toMatchObject({ ok: true });

    expect(validateRefundPreviewRequest({
      refund_type: 'direct_slot',
    }, { schoolId: 1 })).toMatchObject({
      ok: false,
      code: 'BOOKING_REQUIRED',
    });
  });
});
