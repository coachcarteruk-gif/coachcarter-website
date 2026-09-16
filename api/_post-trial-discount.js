'use strict';

const crypto = require('crypto');
const { SCHEDULED, CHARGEABLE } = require('./_booking-status');
const { operationalTimeZone } = require('./_full-curriculum');

const POLICY_VERSION = 'post-trial-discount-v1';
const DEFAULT_DISCOUNT_PCT = 10;
const DEFAULT_DISCOUNT_HOURS = 48;
const MAX_QUOTE_MINUTES = 30;

function clampConfigNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function applyPostTrialDiscount(amountPence, discountPct) {
  const amount = Number(amountPence);
  const pct = Number(discountPct);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError('amountPence must be a non-negative integer');
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new TypeError('discountPct must be between 0 and 100');
  const pricePence = Math.round(amount * (100 - pct) / 100);
  return { pricePence, discountPence: amount - pricePence, discountPct: pct };
}

function normaliseNow(now) {
  const value = now instanceof Date ? now : new Date(now || Date.now());
  if (Number.isNaN(value.getTime())) throw new TypeError('now must be a valid date');
  return value;
}

async function getPostTrialDiscount(sql, { schoolId, learnerId, now = new Date() } = {}) {
  const sid = Number(schoolId);
  const lid = Number(learnerId);
  const at = normaliseNow(now);
  if (!Number.isSafeInteger(sid) || sid <= 0 || !Number.isSafeInteger(lid) || lid <= 0) {
    return { eligible: false, discountPct: 0, trialBookingId: null, trialEndedAt: null, eligibleUntil: null };
  }

  const [school] = await sql`SELECT config FROM schools WHERE id = ${sid}`;
  if (!school) return { eligible: false, discountPct: 0, trialBookingId: null, trialEndedAt: null, eligibleUntil: null };
  const pricing = school.config?.pricing || {};
  const discountPct = clampConfigNumber(pricing.post_trial_discount_pct, DEFAULT_DISCOUNT_PCT, 0, 99.99);
  const durationHours = clampConfigNumber(pricing.post_trial_discount_hours, DEFAULT_DISCOUNT_HOURS, 1, 720);
  if (discountPct <= 0) {
    return { eligible: false, discountPct: 0, durationHours, trialBookingId: null, trialEndedAt: null, eligibleUntil: null };
  }

  const timezone = operationalTimeZone(school.config || {});
  const rows = await sql`
    SELECT lb.id,
           ((lb.scheduled_date + lb.end_time) AT TIME ZONE ${timezone}) AS trial_ended_at
      FROM lesson_bookings lb
      JOIN lesson_types lt
        ON lt.id = lb.lesson_type_id
       AND lt.school_id = lb.school_id
       AND lt.slug = 'trial'
     WHERE lb.school_id = ${sid}
       AND lb.learner_id = ${lid}
       AND lb.payment_method = 'free'
       AND COALESCE(lb.minutes_deducted, 0) = 0
       AND COALESCE(lb.list_price_pence, 0) = 0
       AND lb.status IN (${SCHEDULED}, ${CHARGEABLE})
       AND COALESCE(lb.booking_purpose, 'lesson') = 'lesson'
       AND lb.cancelled_at IS NULL
       AND COALESCE(lb.credit_forfeited, FALSE) = FALSE
       AND ((lb.scheduled_date + lb.end_time) AT TIME ZONE ${timezone}) <= ${at.toISOString()}::timestamptz
       AND ${at.toISOString()}::timestamptz <
           ((lb.scheduled_date + lb.end_time) AT TIME ZONE ${timezone})
             + (${durationHours} * INTERVAL '1 hour')
     ORDER BY trial_ended_at DESC, lb.id DESC
     LIMIT 1
  `;
  const trial = rows[0];
  if (!trial) {
    return { eligible: false, discountPct: 0, durationHours, trialBookingId: null, trialEndedAt: null, eligibleUntil: null };
  }
  const trialEndedAt = new Date(trial.trial_ended_at);
  const eligibleUntil = new Date(trialEndedAt.getTime() + durationHours * 3600000);
  return {
    eligible: true,
    discountPct,
    durationHours,
    trialBookingId: Number(trial.id),
    trialEndedAt: trialEndedAt.toISOString(),
    eligibleUntil: eligibleUntil.toISOString(),
    policyVersion: POLICY_VERSION,
  };
}

async function quotePostTrialPrice(sql, {
  schoolId,
  learnerId,
  amountPence,
  now = new Date(),
  maxExpiresAt = null,
} = {}) {
  const sid = Number(schoolId);
  const lid = Number(learnerId);
  const amount = Number(amountPence);
  const at = normaliseNow(now);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError('amountPence must be a non-negative integer');
  const eligibility = await getPostTrialDiscount(sql, { schoolId: sid, learnerId: lid, now: at });
  const applied = applyPostTrialDiscount(amount, eligibility.eligible ? eligibility.discountPct : 0);
  if (amount > 0 && applied.pricePence < 1) throw new Error('Post-trial discount final amount must remain positive');
  if (!eligibility.eligible) {
    return {
      ...applied,
      trialBookingId: null,
      eligibleUntil: null,
      checkoutExpiresAt: null,
      quoteId: null,
      metadata: {},
    };
  }

  const candidates = [
    at.getTime() + MAX_QUOTE_MINUTES * 60000,
  ];
  if (maxExpiresAt) {
    const maximum = new Date(maxExpiresAt);
    if (!Number.isNaN(maximum.getTime())) candidates.push(maximum.getTime());
  }
  const checkoutExpiresAt = new Date(Math.min(...candidates));
  if (checkoutExpiresAt <= at) throw new Error('Post-trial discount checkout window has closed');
  const quoteId = crypto.randomUUID();
  await sql`
    INSERT INTO post_trial_discount_quotes (
      id, school_id, learner_id, trial_booking_id, policy_version,
      base_amount_pence, discount_pct, discount_pence, final_amount_pence,
      trial_ended_at, eligible_until, checkout_expires_at, created_at
    ) VALUES (
      ${quoteId}::uuid, ${sid}, ${lid}, ${eligibility.trialBookingId}, ${POLICY_VERSION},
      ${amount}, ${applied.discountPct}, ${applied.discountPence}, ${applied.pricePence},
      ${eligibility.trialEndedAt}::timestamptz, ${eligibility.eligibleUntil}::timestamptz,
      ${checkoutExpiresAt.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz
    )
  `;
  const metadata = {
    post_trial_quote_id: quoteId,
    post_trial_policy_version: POLICY_VERSION,
    post_trial_trial_booking_id: String(eligibility.trialBookingId),
    post_trial_base_amount_pence: String(amount),
    post_trial_discount_pct: String(applied.discountPct),
    post_trial_discount_pence: String(applied.discountPence),
    post_trial_final_amount_pence: String(applied.pricePence),
    post_trial_eligible_until: eligibility.eligibleUntil,
    post_trial_checkout_expires_at: checkoutExpiresAt.toISOString(),
  };
  return {
    ...applied,
    trialBookingId: eligibility.trialBookingId,
    eligibleUntil: eligibility.eligibleUntil,
    checkoutExpiresAt: checkoutExpiresAt.toISOString(),
    quoteId,
    metadata,
  };
}

async function bindPostTrialQuote(sql, {
  quoteId, schoolId, learnerId, paymentType, paymentIdentity,
} = {}) {
  if (!quoteId) return { ok: true, skipped: true };
  if (!String(paymentType || '').trim() || !String(paymentIdentity || '').trim()) {
    return { ok: false, code: 'POST_TRIAL_QUOTE_BINDING_REQUIRED' };
  }
  const [bound] = await sql`
    UPDATE post_trial_discount_quotes
       SET payment_type = ${String(paymentType || '')},
           payment_identity = ${String(paymentIdentity || '')},
           bound_at = COALESCE(bound_at, NOW())
     WHERE id = ${String(quoteId)}::uuid
       AND school_id = ${Number(schoolId)}
       AND learner_id = ${Number(learnerId)}
       AND (payment_type IS NULL OR payment_type = ${String(paymentType || '')})
       AND (payment_identity IS NULL OR payment_identity = ${String(paymentIdentity || '')})
     RETURNING id
  `;
  return bound ? { ok: true } : { ok: false, code: 'POST_TRIAL_QUOTE_BINDING_MISMATCH' };
}

async function validatePostTrialQuote(sql, {
  quoteId, schoolId, learnerId, amountPence, providerDiscountPence = 0,
  paymentType, paymentIdentity, providerInitiatedAt,
} = {}) {
  if (!quoteId) return { ok: true, skipped: true };
  const [quote] = await sql`
    SELECT * FROM post_trial_discount_quotes
     WHERE id = ${String(quoteId)}::uuid
       AND school_id = ${Number(schoolId)}
       AND learner_id = ${Number(learnerId)}
  `;
  if (!quote) return { ok: false, code: 'POST_TRIAL_QUOTE_NOT_FOUND' };
  if (!quote.provider_initiated_at && quote.trial_booking_id) {
    const [trialStillValid] = await sql`
      SELECT 1 AS trial_still_valid
        FROM lesson_bookings lb
        JOIN lesson_types lt ON lt.id=lb.lesson_type_id AND lt.school_id=lb.school_id AND lt.slug='trial'
       WHERE lb.id=${Number(quote.trial_booking_id)} AND lb.school_id=${Number(schoolId)}
         AND lb.learner_id=${Number(learnerId)} AND lb.status IN (${SCHEDULED}, ${CHARGEABLE})
         AND lb.payment_method='free' AND COALESCE(lb.minutes_deducted,0)=0
         AND COALESCE(lb.list_price_pence,0)=0 AND lb.cancelled_at IS NULL
         AND COALESCE(lb.credit_forfeited,FALSE)=FALSE
       LIMIT 1
    `;
    if (!trialStillValid) return { ok: false, code: 'POST_TRIAL_TRIAL_REVOKED', quote };
  }
  // This must be the provider event time at authorization/processing/payment,
  // never PI/Checkout creation, quote creation, receipt time, or client input.
  // Once recorded, the initial provider authorization/processing event remains
  // authoritative for later capture, settlement, and webhook retries.
  const initiationEvidence = quote.provider_initiated_at || providerInitiatedAt;
  if (!initiationEvidence) return { ok: false, code: 'POST_TRIAL_INITIATION_EVIDENCE_REQUIRED' };
  const initiated = normaliseNow(initiationEvidence);
  const providerAmount = Number(amountPence);
  const promotionDiscount = Number(providerDiscountPence || 0);
  if (!Number.isSafeInteger(providerAmount) || providerAmount < 0
      || !Number.isSafeInteger(promotionDiscount) || promotionDiscount < 0
      || providerAmount + promotionDiscount !== Number(quote.final_amount_pence)) {
    return { ok: false, code: 'POST_TRIAL_AMOUNT_MISMATCH', quote };
  }
  if (quote.payment_type !== String(paymentType || '')
      || quote.payment_identity !== String(paymentIdentity || '')) {
    return { ok: false, code: 'POST_TRIAL_PAYMENT_IDENTITY_MISMATCH', quote };
  }
  if (Math.floor(initiated.getTime() / 1000) < Math.floor(new Date(quote.created_at).getTime() / 1000)
      || initiated >= new Date(quote.checkout_expires_at)) {
    return { ok: false, code: 'POST_TRIAL_INITIATION_OUTSIDE_WINDOW', quote };
  }
  if (!quote.provider_initiated_at) {
    const [recorded] = await sql`
      UPDATE post_trial_discount_quotes
         SET provider_initiated_at = ${initiated.toISOString()}::timestamptz
       WHERE id = ${String(quoteId)}::uuid
         AND school_id = ${Number(schoolId)}
         AND learner_id = ${Number(learnerId)}
         AND provider_initiated_at IS NULL
       RETURNING *
    `;
    if (!recorded) {
      const [winner] = await sql`
        SELECT * FROM post_trial_discount_quotes
         WHERE id = ${String(quoteId)}::uuid
           AND school_id = ${Number(schoolId)}
           AND learner_id = ${Number(learnerId)}
      `;
      if (winner?.provider_initiated_at
          && Math.floor(new Date(winner.provider_initiated_at).getTime() / 1000) === Math.floor(initiated.getTime() / 1000)) {
        return { ok: true, quote: winner };
      }
      return { ok: false, code: 'POST_TRIAL_INITIATION_RACE' };
    }
    return { ok: true, quote: recorded };
  }
  return { ok: true, quote };
}

function validatePostTrialConfig(pricing) {
  if (!pricing || typeof pricing !== 'object') return null;
  if ('post_trial_discount_pct' in pricing) {
    const value = pricing.post_trial_discount_pct;
    if (!Number.isFinite(value) || value < 0 || value >= 100
        || Math.abs(Math.round(value * 100) - value * 100) > 1e-8) {
      return 'post_trial_discount_pct must be from 0 up to 99.99 with at most two decimal places';
    }
  }
  if ('post_trial_discount_hours' in pricing) {
    const value = pricing.post_trial_discount_hours;
    if (!Number.isFinite(value) || value < 1 || value > 720) return 'post_trial_discount_hours must be between 1 and 720';
  }
  return null;
}

module.exports = {
  POLICY_VERSION,
  DEFAULT_DISCOUNT_PCT,
  DEFAULT_DISCOUNT_HOURS,
  MAX_QUOTE_MINUTES,
  applyPostTrialDiscount,
  getPostTrialDiscount,
  quotePostTrialPrice,
  bindPostTrialQuote,
  validatePostTrialQuote,
  validatePostTrialConfig,
};
