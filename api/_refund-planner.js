const REFUND_TYPES = Object.freeze([
  'credit_purchase',
  'repeat_offer_partial',
  'direct_slot',
  'direct_offer',
  'manual_record',
]);

const ADMIN_SUMMARY_PREFIX = 'Refund summary:';

function positiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nonNegativeInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function money(pence) {
  return `£${(Number(pence || 0) / 100).toFixed(2)}`;
}

function buildAdminSummary({ grossRefundPence, processingFeeWithheldPence, netRefundPence }) {
  return [
    ADMIN_SUMMARY_PREFIX,
    `Lesson credit value: ${money(grossRefundPence)}`,
    `Payment processing fee: -${money(processingFeeWithheldPence)}`,
    `Amount returned: ${money(netRefundPence)}`,
  ].join('\n');
}

function validationError(code, message, status = 400) {
  return { ok: false, status, code, message };
}

function validateRefundPreviewRequest(body = {}, { schoolId } = {}) {
  if (!positiveInteger(schoolId)) {
    return validationError('SCHOOL_SCOPE_REQUIRED', 'Admin school scope is required.');
  }

  const refundType = cleanText(body.refund_type);
  if (!REFUND_TYPES.includes(refundType)) {
    return validationError('INVALID_REFUND_TYPE', `refund_type must be one of: ${REFUND_TYPES.join(', ')}.`);
  }

  const input = {
    schoolId: Number(schoolId),
    refundType,
    creditTransactionId: positiveInteger(body.credit_transaction_id),
    bookingCreditSourceId: positiveInteger(body.booking_credit_source_id),
    lessonBookingId: positiveInteger(body.lesson_booking_id),
    grossRefundPence: body.gross_refund_pence == null ? null : nonNegativeInteger(body.gross_refund_pence),
    refundedMinutes: body.refunded_minutes == null ? null : nonNegativeInteger(body.refunded_minutes),
    reason: cleanText(body.reason) || 'Admin refund preview',
  };

  if (body.gross_refund_pence != null && input.grossRefundPence == null) {
    return validationError('INVALID_GROSS_REFUND', 'gross_refund_pence must be a non-negative integer.');
  }
  if (body.refunded_minutes != null && input.refundedMinutes == null) {
    return validationError('INVALID_REFUNDED_MINUTES', 'refunded_minutes must be a non-negative integer.');
  }

  if (['credit_purchase', 'repeat_offer_partial'].includes(refundType)
    && !input.creditTransactionId
    && !input.bookingCreditSourceId) {
    return validationError(
      'REFUND_SOURCE_REQUIRED',
      'credit_transaction_id or booking_credit_source_id is required for this refund preview.'
    );
  }

  if (['direct_slot', 'direct_offer'].includes(refundType) && !input.lessonBookingId) {
    return validationError('BOOKING_REQUIRED', 'lesson_booking_id is required for direct booking refund preview.');
  }

  return { ok: true, input };
}

function proportionalFee(grossPence, availablePence, availableFeePence) {
  if (grossPence <= 0 || availableFeePence <= 0) return 0;
  if (grossPence >= availablePence) return availableFeePence;
  return Math.round((availableFeePence * grossPence) / availablePence);
}

function netPreview({
  refundType,
  grossRefundPence,
  processingFeeWithheldPence,
  lines,
  feeEvidence,
  reason,
  blocked = false,
  manualReviewRequired = false,
  warnings = [],
  stripe = {},
  metadata = {},
}) {
  const netRefundPence = Math.max(0, grossRefundPence - processingFeeWithheldPence);
  return {
    ok: true,
    blocked,
    manual_review_required: manualReviewRequired,
    refund_type: refundType,
    gross_refund_pence: grossRefundPence,
    processing_fee_withheld_pence: processingFeeWithheldPence,
    net_refund_pence: netRefundPence,
    lines,
    fee_evidence: feeEvidence,
    admin_display_copy: buildAdminSummary({
      grossRefundPence,
      processingFeeWithheldPence,
      netRefundPence,
    }),
    warnings,
    reason,
    stripe,
    metadata,
  };
}

function blockedPreview({
  refundType,
  grossRefundPence = 0,
  lines = [],
  reason,
  code,
  message,
  feeEvidence = null,
  stripe = {},
  metadata = {},
}) {
  return {
    ...netPreview({
      refundType,
      grossRefundPence,
      processingFeeWithheldPence: 0,
      lines,
      feeEvidence,
      reason,
      blocked: true,
      manualReviewRequired: true,
      warnings: [message],
      stripe,
      metadata: { ...metadata, code },
    }),
    code,
    message,
  };
}

function objectId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return typeof value.id === 'string' ? value.id : null;
}

function feeFromCharge(charge) {
  const fee = charge?.balance_transaction?.fee;
  if (typeof fee !== 'number') return null;
  return {
    feePence: fee,
    source: 'stripe_balance_transaction',
    balanceTransactionId: objectId(charge.balance_transaction),
    chargeId: objectId(charge),
    paymentIntentId: objectId(charge.payment_intent),
  };
}

async function lookupStripeFeeEvidence(stripe, identities = {}) {
  if (!stripe) return null;

  const chargeId = cleanText(identities.stripeChargeId);
  if (chargeId && stripe.charges?.retrieve) {
    const charge = await stripe.charges.retrieve(chargeId, { expand: ['balance_transaction', 'payment_intent'] });
    const evidence = feeFromCharge(charge);
    if (evidence) return evidence;
  }

  const paymentIntentId = cleanText(identities.stripePaymentIntentId);
  if (paymentIntentId && stripe.paymentIntents?.retrieve) {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge.balance_transaction'],
    });
    const charge = pi?.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
    const evidence = feeFromCharge(charge);
    if (evidence) {
      return { ...evidence, paymentIntentId: pi.id || evidence.paymentIntentId };
    }
  }

  return null;
}

function sourceIdentities(row = {}) {
  return {
    stripePaymentIntentId: row.stripe_payment_intent_id || null,
    stripeChargeId: row.stripe_charge_id || null,
    stripeSessionId: row.stripe_session_id || null,
  };
}

function hasStripeIdentity(row = {}) {
  const ids = sourceIdentities(row);
  return Boolean(ids.stripePaymentIntentId || ids.stripeChargeId || ids.stripeSessionId);
}

function positiveFee(value) {
  const fee = Number(value);
  return Number.isInteger(fee) && fee > 0 ? fee : null;
}

async function resolveBcsFeeEvidence({ row, stripe }) {
  const bcsFee = positiveFee(row.bcs_stripe_fee_pence);
  if (bcsFee != null) {
    return {
      feePence: bcsFee,
      evidence: {
        source: 'booking_credit_sources.stripe_fee_pence',
        pence: bcsFee,
        preferred_bcs_attribution: true,
      },
    };
  }

  const stripePaid = hasStripeIdentity(row) || positiveFee(row.source_stripe_fee_pence) != null;
  if (!stripePaid && Number(row.bcs_stripe_fee_pence) === 0) {
    return {
      feePence: 0,
      evidence: {
        source: 'booking_credit_sources.stripe_fee_pence',
        pence: 0,
        preferred_bcs_attribution: true,
      },
    };
  }

  const sourceFee = positiveFee(row.source_stripe_fee_pence);
  if (sourceFee != null) {
    const contribution = Number(row.contribution_pence || 0);
    const sourceAmount = Number(row.source_amount_pence || 0);
    const attributedFee = sourceAmount > 0 && contribution > 0
      ? proportionalFee(contribution, sourceAmount, sourceFee)
      : sourceFee;
    return {
      feePence: attributedFee,
      evidence: {
        source: 'credit_transactions.stripe_fee_pence',
        pence: sourceFee,
        attributed_fee_pence: attributedFee,
        fallback_from_zero_bcs_fee: true,
      },
    };
  }

  const stripeEvidence = await lookupStripeFeeEvidence(stripe, sourceIdentities(row));
  if (stripeEvidence) {
    const contribution = Number(row.contribution_pence || 0);
    const sourceAmount = Number(row.source_amount_pence || 0);
    const attributedFee = sourceAmount > 0 && contribution > 0
      ? proportionalFee(contribution, sourceAmount, stripeEvidence.feePence)
      : stripeEvidence.feePence;
    return {
      feePence: attributedFee,
      evidence: {
        ...stripeEvidence,
        attributed_fee_pence: attributedFee,
        fallback_from_zero_bcs_fee: true,
      },
    };
  }

  return null;
}

async function sourceByBcs(sql, { schoolId, bookingCreditSourceId }) {
  const rows = await sql`
    SELECT bcs.id AS booking_credit_source_id,
           bcs.school_id,
           bcs.booking_id,
           bcs.credit_transaction_id,
           bcs.minutes_drawn,
           bcs.contribution_pence,
           bcs.stripe_fee_pence AS bcs_stripe_fee_pence,
           ct.learner_id,
           ct.instructor_id,
           ct.amount_pence AS source_amount_pence,
           ct.stripe_fee_pence AS source_stripe_fee_pence,
           ct.stripe_session_id,
           ct.stripe_payment_intent_id,
           ct.stripe_charge_id
      FROM booking_credit_sources bcs
      JOIN credit_transactions ct
        ON ct.id = bcs.credit_transaction_id
       AND ct.school_id = ${schoolId}
     WHERE bcs.school_id = ${schoolId}
       AND bcs.id = ${bookingCreditSourceId}
       AND bcs.refunded_at IS NULL
     LIMIT 1
  `;
  return rows[0] || null;
}

async function sourceByCreditTransaction(sql, { schoolId, creditTransactionId }) {
  const rows = await sql`
    SELECT ct.id AS credit_transaction_id,
           ct.school_id,
           ct.learner_id,
           ct.instructor_id,
           COALESCE(ct.minutes, 0)::int AS source_minutes,
           COALESCE(ct.amount_pence, 0)::int AS source_amount_pence,
           ct.stripe_fee_pence AS source_stripe_fee_pence,
           ct.stripe_session_id,
           ct.stripe_payment_intent_id,
           ct.stripe_charge_id,
           (
             SELECT COALESCE(SUM(bcs.contribution_pence), 0)::int
               FROM booking_credit_sources bcs
              WHERE bcs.school_id = ${schoolId}
                AND bcs.credit_transaction_id = ct.id
                AND bcs.refunded_at IS NULL
           ) AS active_contribution_pence,
           (
             SELECT COALESCE(SUM(bcs.stripe_fee_pence), 0)::int
               FROM booking_credit_sources bcs
              WHERE bcs.school_id = ${schoolId}
                AND bcs.credit_transaction_id = ct.id
                AND bcs.refunded_at IS NULL
           ) AS active_stripe_fee_pence,
           (
             SELECT COALESCE(SUM(bcs.minutes_drawn), 0)::int
               FROM booking_credit_sources bcs
              WHERE bcs.school_id = ${schoolId}
                AND bcs.credit_transaction_id = ct.id
                AND bcs.refunded_at IS NULL
           ) AS active_minutes_drawn,
           (
             SELECT COALESCE(SUM(csa.pence_adjusted), 0)::int
               FROM credit_source_adjustments csa
              WHERE csa.credit_transaction_id = ct.id
           ) AS adjusted_pence,
           (
             SELECT COALESCE(SUM(csa.minutes_adjusted), 0)::int
               FROM credit_source_adjustments csa
              WHERE csa.credit_transaction_id = ct.id
           ) AS adjusted_minutes
      FROM credit_transactions ct
     WHERE ct.school_id = ${schoolId}
       AND ct.id = ${creditTransactionId}
     LIMIT 1
  `;
  return rows[0] || null;
}

async function directBooking(sql, { schoolId, lessonBookingId }) {
  const rows = await sql`
    SELECT lb.id AS lesson_booking_id,
           lb.school_id,
           lb.learner_id,
           lb.instructor_id,
           lb.payment_method,
           COALESCE(lb.list_price_pence, 0)::int AS list_price_pence,
           lb.stripe_fee_pence AS booking_stripe_fee_pence,
           COALESCE(SUM(bcs.contribution_pence) FILTER (WHERE bcs.refunded_at IS NULL), 0)::int AS bcs_contribution_pence,
           COALESCE(SUM(bcs.stripe_fee_pence) FILTER (WHERE bcs.refunded_at IS NULL), 0)::int AS bcs_stripe_fee_pence,
           MAX(ct.stripe_session_id) AS stripe_session_id,
           MAX(ct.stripe_payment_intent_id) AS stripe_payment_intent_id,
           MAX(ct.stripe_charge_id) AS stripe_charge_id,
           EXISTS (
             SELECT 1
               FROM payout_line_items pli
              WHERE pli.school_id = ${schoolId}
                AND pli.booking_id = lb.id
           ) AS already_paid_out
      FROM lesson_bookings lb
      LEFT JOIN booking_credit_sources bcs
        ON bcs.booking_id = lb.id
       AND bcs.school_id = ${schoolId}
      LEFT JOIN credit_transactions ct
        ON ct.id = bcs.credit_transaction_id
       AND ct.school_id = ${schoolId}
     WHERE lb.school_id = ${schoolId}
       AND lb.id = ${lessonBookingId}
     GROUP BY lb.id
     LIMIT 1
  `;
  return rows[0] || null;
}

function line(row) {
  return {
    credit_transaction_id: row.credit_transaction_id || null,
    booking_credit_source_id: row.booking_credit_source_id || null,
    lesson_booking_id: row.lesson_booking_id || row.booking_id || null,
    credit_source_adjustment_id: null,
    gross_pence_removed: row.gross_pence_removed,
    source_fee_pence_used: row.source_fee_pence_used,
    fee_withheld_pence: row.fee_withheld_pence,
    net_refund_pence: Math.max(0, row.gross_pence_removed - row.fee_withheld_pence),
    minutes_adjusted: row.minutes_adjusted || 0,
  };
}

async function planBcsPreview({ sql, stripe, input }) {
  const row = await sourceByBcs(sql, {
    schoolId: input.schoolId,
    bookingCreditSourceId: input.bookingCreditSourceId,
  });
  if (!row) {
    return blockedPreview({
      refundType: input.refundType,
      reason: input.reason,
      code: 'REFUND_SOURCE_NOT_FOUND',
      message: 'Refund source was not found in this school.',
    });
  }

  const gross = input.grossRefundPence == null
    ? Number(row.contribution_pence)
    : input.grossRefundPence;
  if (gross <= 0 || gross > Number(row.contribution_pence)) {
    return validationError('GROSS_REFUND_OUT_OF_RANGE', 'gross_refund_pence must be positive and no more than the selected source value.', 400);
  }

  const feeResolution = await resolveBcsFeeEvidence({ row, stripe });
  if (!feeResolution) {
    return blockedPreview({
      refundType: input.refundType,
      grossRefundPence: gross,
      reason: input.reason,
      code: 'MISSING_PROCESSING_FEE',
      message: 'Processing fee evidence is missing; manual review is required.',
      stripe: sourceIdentities(row),
    });
  }

  const attributedFee = feeResolution.feePence;
  const withheld = proportionalFee(gross, Number(row.contribution_pence), attributedFee);
  const item = line({
    booking_credit_source_id: row.booking_credit_source_id,
    credit_transaction_id: row.credit_transaction_id,
    booking_id: row.booking_id,
    gross_pence_removed: gross,
    source_fee_pence_used: attributedFee,
    fee_withheld_pence: withheld,
    minutes_adjusted: input.refundedMinutes || row.minutes_drawn || 0,
  });

  return netPreview({
    refundType: input.refundType,
    grossRefundPence: gross,
    processingFeeWithheldPence: withheld,
    lines: [item],
    feeEvidence: feeResolution.evidence,
    reason: input.reason,
    stripe: sourceIdentities(row),
  });
}

async function planCreditTransactionPreview({ sql, stripe, input }) {
  const row = await sourceByCreditTransaction(sql, {
    schoolId: input.schoolId,
    creditTransactionId: input.creditTransactionId,
  });
  if (!row) {
    return blockedPreview({
      refundType: input.refundType,
      reason: input.reason,
      code: 'CREDIT_TRANSACTION_NOT_FOUND',
      message: 'Credit transaction was not found in this school.',
    });
  }

  const availablePence = Number(row.source_amount_pence)
    - Number(row.active_contribution_pence || 0)
    - Number(row.adjusted_pence || 0);
  const availableMinutes = Number(row.source_minutes || 0)
    - Number(row.active_minutes_drawn || 0)
    - Number(row.adjusted_minutes || 0);
  const gross = input.grossRefundPence == null ? availablePence : input.grossRefundPence;

  if (gross <= 0 || gross > availablePence) {
    return validationError('GROSS_REFUND_OUT_OF_RANGE', 'gross_refund_pence must be positive and no more than available source value.', 400);
  }

  let sourceFee = row.source_stripe_fee_pence == null ? null : Number(row.source_stripe_fee_pence);
  let evidence = sourceFee == null ? null : {
    source: 'credit_transactions.stripe_fee_pence',
    pence: sourceFee,
  };
  if (sourceFee == null) {
    const stripeEvidence = await lookupStripeFeeEvidence(stripe, sourceIdentities(row));
    if (stripeEvidence) {
      sourceFee = stripeEvidence.feePence;
      evidence = stripeEvidence;
    }
  }
  if (sourceFee == null) {
    return blockedPreview({
      refundType: input.refundType,
      grossRefundPence: gross,
      reason: input.reason,
      code: 'MISSING_PROCESSING_FEE',
      message: 'Processing fee evidence is missing; manual review is required.',
      stripe: sourceIdentities(row),
    });
  }

  const activeFee = Number(row.active_stripe_fee_pence || 0);
  const availableFee = Math.max(0, sourceFee - activeFee);
  const withheld = proportionalFee(gross, availablePence, availableFee);
  const item = line({
    credit_transaction_id: row.credit_transaction_id,
    gross_pence_removed: gross,
    source_fee_pence_used: availableFee,
    fee_withheld_pence: withheld,
    minutes_adjusted: input.refundedMinutes || availableMinutes || 0,
  });

  return netPreview({
    refundType: input.refundType,
    grossRefundPence: gross,
    processingFeeWithheldPence: withheld,
    lines: [item],
    feeEvidence: {
      ...evidence,
      available_fee_pence: availableFee,
      active_bcs_fee_pence: activeFee,
    },
    reason: input.reason,
    stripe: sourceIdentities(row),
  });
}

async function planDirectBookingPreview({ sql, stripe, input }) {
  const row = await directBooking(sql, {
    schoolId: input.schoolId,
    lessonBookingId: input.lessonBookingId,
  });
  if (!row) {
    return blockedPreview({
      refundType: input.refundType,
      reason: input.reason,
      code: 'BOOKING_NOT_FOUND',
      message: 'Booking was not found in this school.',
    });
  }

  const grossDefault = Number(row.bcs_contribution_pence || 0) || Number(row.list_price_pence || 0);
  const gross = input.grossRefundPence == null ? grossDefault : input.grossRefundPence;
  const identities = sourceIdentities(row);

  if (gross <= 0 || gross > grossDefault) {
    return blockedPreview({
      refundType: input.refundType,
      grossRefundPence: Math.max(0, gross),
      reason: input.reason,
      code: 'GROSS_REFUND_OUT_OF_RANGE',
      message: 'gross_refund_pence must be positive and no more than the booking refundable value.',
      stripe: identities,
      metadata: { max_gross_refund_pence: grossDefault },
    });
  }

  if (row.already_paid_out === true) {
    return blockedPreview({
      refundType: input.refundType,
      grossRefundPence: gross,
      lines: [line({
        lesson_booking_id: row.lesson_booking_id,
        gross_pence_removed: gross,
        source_fee_pence_used: 0,
        fee_withheld_pence: 0,
      })],
      reason: input.reason,
      code: 'BOOKING_ALREADY_PAID_OUT',
      message: 'This booking has already been paid out. Record a manual bank refund instead of attempting an automatic Stripe refund.',
      stripe: identities,
    });
  }

  let fee = row.bcs_stripe_fee_pence > 0
    ? Number(row.bcs_stripe_fee_pence)
    : (row.booking_stripe_fee_pence == null ? null : Number(row.booking_stripe_fee_pence));
  let evidence = row.bcs_stripe_fee_pence > 0
    ? { source: 'booking_credit_sources.stripe_fee_pence', pence: fee, preferred_bcs_attribution: true }
    : (fee == null ? null : { source: 'lesson_bookings.stripe_fee_pence', pence: fee });

  if (fee == null) {
    const stripeEvidence = await lookupStripeFeeEvidence(stripe, identities);
    if (stripeEvidence) {
      fee = stripeEvidence.feePence;
      evidence = stripeEvidence;
    }
  }

  if (fee == null) {
    return blockedPreview({
      refundType: input.refundType,
      grossRefundPence: gross,
      lines: [line({
        lesson_booking_id: row.lesson_booking_id,
        gross_pence_removed: gross,
        source_fee_pence_used: 0,
        fee_withheld_pence: 0,
      })],
      reason: input.reason,
      code: 'MISSING_PROCESSING_FEE',
      message: 'Processing fee evidence is missing; manual review is required.',
      stripe: identities,
    });
  }

  const feeBase = Number(row.bcs_contribution_pence || 0) || Number(row.list_price_pence || gross);
  const withheld = proportionalFee(gross, feeBase, fee);
  return netPreview({
    refundType: input.refundType,
    grossRefundPence: gross,
    processingFeeWithheldPence: withheld,
    lines: [line({
      lesson_booking_id: row.lesson_booking_id,
      gross_pence_removed: gross,
      source_fee_pence_used: fee,
      fee_withheld_pence: withheld,
    })],
    feeEvidence: evidence,
    reason: input.reason,
    stripe: identities,
  });
}

async function planAdminRefundPreview({ sql, stripe, input } = {}) {
  if (!sql) throw new Error('sql client required');
  if (!input) throw new Error('input required');

  if (input.bookingCreditSourceId) {
    return planBcsPreview({ sql, stripe, input });
  }
  if (['credit_purchase', 'repeat_offer_partial'].includes(input.refundType)) {
    return planCreditTransactionPreview({ sql, stripe, input });
  }
  if (['direct_slot', 'direct_offer'].includes(input.refundType)) {
    return planDirectBookingPreview({ sql, stripe, input });
  }

  return blockedPreview({
    refundType: input.refundType,
    reason: input.reason,
    code: 'MANUAL_RECORD_ONLY',
    message: 'Manual refund records are ledger-only and cannot be automatically previewed yet.',
  });
}

module.exports = {
  REFUND_TYPES,
  buildAdminSummary,
  lookupStripeFeeEvidence,
  planAdminRefundPreview,
  validateRefundPreviewRequest,
};
