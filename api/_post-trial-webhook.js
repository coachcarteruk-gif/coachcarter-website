'use strict';

const { validatePostTrialQuote } = require('./_post-trial-discount');

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function eventDate(event) {
  const seconds = Number(event?.created);
  return Number.isFinite(seconds) && seconds >= 0 ? new Date(seconds * 1000).toISOString() : null;
}

function classifyStripeEvent(event) {
  const object = event?.data?.object || {};
  if (event?.type === 'checkout.session.completed') {
    return {
      supported: true,
      authoritativeInitiation: true,
      paymentState: object.payment_status === 'paid' ? 'paid' : 'processing',
      fulfill: object.payment_status === 'paid',
    };
  }
  if (event?.type === 'checkout.session.async_payment_succeeded') {
    return { supported: true, authoritativeInitiation: false, paymentState: 'paid', fulfill: true };
  }
  if (event?.type === 'checkout.session.async_payment_failed'
      || event?.type === 'checkout.session.expired') {
    return { supported: true, authoritativeInitiation: false, paymentState: 'failed', fulfill: false };
  }
  if (event?.type === 'payment_intent.processing') {
    return { supported: true, authoritativeInitiation: true, paymentState: 'processing', fulfill: false };
  }
  if (event?.type === 'payment_intent.amount_capturable_updated' && object.status === 'requires_capture') {
    return { supported: true, authoritativeInitiation: true, paymentState: 'authorized', fulfill: true };
  }
  if (event?.type === 'payment_intent.succeeded') {
    return { supported: true, authoritativeInitiation: true, paymentState: 'paid', fulfill: true };
  }
  return { supported: false, authoritativeInitiation: false, paymentState: 'ignored', fulfill: false };
}

function stripePaymentIdentity(object) {
  return String(object?.id || '').trim();
}

function stripeGrossPence(event, supplied) {
  if (supplied !== undefined && supplied !== null) return positiveInteger(supplied);
  const object = event?.data?.object || {};
  if (String(event?.type || '').startsWith('checkout.session.')) return positiveInteger(object.amount_total);
  if (event?.type === 'payment_intent.succeeded' && positiveInteger(object.amount_received) !== null) {
    return positiveInteger(object.amount_received);
  }
  if (object.status === 'requires_capture' && positiveInteger(object.amount_capturable) !== null) {
    return positiveInteger(object.amount_capturable);
  }
  return positiveInteger(object.amount);
}

async function retainSettlementOutcome(sql, quoteId, schoolId, outcome) {
  if (!quoteId || !outcome) return;
  await sql`
    UPDATE post_trial_discount_quotes
       SET settlement_status = CASE
             WHEN settlement_status IS NULL OR settlement_status = 'authorized' THEN ${outcome.status}
             ELSE settlement_status
           END,
           settlement_reason = CASE
             WHEN settlement_status IS NULL OR settlement_status = 'authorized' THEN ${outcome.reason || null}
             ELSE settlement_reason
           END,
           settled_amount_pence = CASE
             WHEN settlement_status IS NULL OR settlement_status = 'authorized' THEN ${outcome.amountPence}
             ELSE settled_amount_pence
           END,
           provider_discount_pence = CASE
             WHEN settlement_status IS NULL OR settlement_status = 'authorized' THEN ${outcome.providerDiscountPence}
             ELSE provider_discount_pence
           END,
           settled_at = CASE
             WHEN settlement_status IS NULL OR settlement_status = 'authorized' THEN NOW()
             ELSE settled_at
           END
     WHERE id = ${String(quoteId)}::uuid
       AND school_id = ${Number(schoolId)}
  `;
}

/**
 * Validates only payments carrying a server-created post-trial quote id.
 * event and providerInitiationEvent must be Stripe-signature-verified objects.
 */
async function preprocessPostTrialWebhook(sql, {
  event, schoolId, learnerId, paymentType, paymentIdentity,
  amountPence, providerDiscountPence, providerInitiationEvent = null,
  useStoredPaymentIdentity = false,
} = {}) {
  const object = event?.data?.object || {};
  const metadata = object.metadata || {};
  const quoteId = String(metadata.post_trial_quote_id || '').trim();
  if (!quoteId) return { hasQuote: false, ok: true, fulfill: true, paymentState: 'legacy' };

  const classification = classifyStripeEvent(event);
  if (!classification.supported) {
    return { hasQuote: true, ok: true, fulfill: false, paymentState: 'ignored', code: 'POST_TRIAL_EVENT_IGNORED' };
  }
  if (classification.paymentState === 'failed') {
    return { hasQuote: true, ok: true, fulfill: false, paymentState: 'failed', code: 'POST_TRIAL_PAYMENT_FAILED' };
  }
  const gross = stripeGrossPence(event, amountPence);
  const promo = providerDiscountPence === undefined
    ? positiveInteger(object.total_details?.amount_discount || 0)
    : positiveInteger(providerDiscountPence);
  if (gross === null || promo === null) {
    return { hasQuote: true, ok: false, fulfill: false, paymentState: classification.paymentState,
      compensationRequired: classification.paymentState === 'paid', code: 'POST_TRIAL_PROVIDER_AMOUNT_INVALID' };
  }

  let identity = String(paymentIdentity || stripePaymentIdentity(object)).trim();
  let validationPaymentType = paymentType;
  if (useStoredPaymentIdentity) {
    const [binding] = await sql`
      SELECT payment_type, payment_identity FROM post_trial_discount_quotes
       WHERE id = ${quoteId}::uuid AND school_id = ${Number(schoolId)} AND learner_id = ${Number(learnerId)}
    `;
    identity = String(binding?.payment_identity || '').trim();
    validationPaymentType = String(binding?.payment_type || '').trim();
  }
  const initiationSource = providerInitiationEvent || (classification.authoritativeInitiation ? event : null);
  const initiationClassification = initiationSource ? classifyStripeEvent(initiationSource) : null;
  const initiationIdentity = initiationSource ? stripePaymentIdentity(initiationSource.data?.object) : '';
  if (providerInitiationEvent && (!initiationClassification?.authoritativeInitiation
      || initiationIdentity !== identity)) {
    return { hasQuote: true, ok: false, fulfill: false, paymentState: classification.paymentState,
      compensationRequired: classification.paymentState === 'paid', code: 'POST_TRIAL_INITIATION_IDENTITY_MISMATCH' };
  }
  const providerInitiatedAt = initiationClassification?.authoritativeInitiation
    ? eventDate(initiationSource)
    : undefined;
  const validation = await validatePostTrialQuote(sql, {
    quoteId,
    schoolId,
    learnerId,
    amountPence: gross,
    providerDiscountPence: promo,
    paymentType: validationPaymentType,
    paymentIdentity: identity,
    providerInitiatedAt,
  });
  const paidOrAuthorized = classification.paymentState === 'paid' || classification.paymentState === 'authorized';
  if (!validation.ok) {
    const canHaveEarlierProviderEvidence = !providerInitiationEvent
      && (event?.type === 'checkout.session.async_payment_succeeded'
        || event?.type === 'payment_intent.succeeded')
      && (validation.code === 'POST_TRIAL_INITIATION_EVIDENCE_REQUIRED'
        || validation.code === 'POST_TRIAL_INITIATION_OUTSIDE_WINDOW');
    if (canHaveEarlierProviderEvidence) {
      return {
        hasQuote: true, ok: false, fulfill: false, paymentState: classification.paymentState,
        compensationRequired: false, retryable: true, code: 'POST_TRIAL_INITIATION_HISTORY_REQUIRED',
      };
    }
    if (paidOrAuthorized && validation.quote) {
      await retainSettlementOutcome(sql, quoteId, schoolId, {
        status: 'invalid_requires_compensation', reason: validation.code,
        amountPence: gross, providerDiscountPence: promo,
      });
    }
    return {
      hasQuote: true, ok: false, fulfill: false, paymentState: classification.paymentState,
      compensationRequired: paidOrAuthorized, code: validation.code,
    };
  }
  if (paidOrAuthorized) {
    await retainSettlementOutcome(sql, quoteId, schoolId, {
      status: classification.paymentState, reason: null,
      amountPence: gross, providerDiscountPence: promo,
    });
  }
  const quote = validation.quote;
  return {
    hasQuote: true,
    ok: true,
    fulfill: classification.fulfill,
    paymentState: classification.paymentState,
    compensationRequired: false,
    quote,
    monetary: {
      baseAmountPence: Number(quote.base_amount_pence),
      postTrialDiscountPence: Number(quote.discount_pence),
      postTrialDiscountPct: Number(quote.discount_pct),
      postTrialPricePence: Number(quote.final_amount_pence),
      providerDiscountPence: promo,
      paidAmountPence: gross,
    },
  };
}

module.exports = {
  classifyStripeEvent,
  preprocessPostTrialWebhook,
};
