'use strict';

const { reportError } = require('./_error-alert');
const { withNeonTransaction } = require('./_db-transaction');
const {
  FLEXIBLE_PACKAGE_EVENT_TYPES,
  FLEXIBLE_PACKAGE_PAYMENT_TYPE,
  createFlexiblePackageLiveStripeClient,
  getFlexiblePackageLiveWebhookSecret,
  getRawBody,
  isUuid,
  payloadSha256,
  validateFlexibleProviderObject,
} = require('./_flexible-package-payments');

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function targetStatus(eventType, object) {
  if (eventType === 'checkout.session.async_payment_succeeded') return 'paid';
  if (eventType === 'checkout.session.async_payment_failed') return 'failed';
  if (eventType === 'checkout.session.expired') return 'expired';
  if (eventType === 'checkout.session.completed') return object?.payment_status === 'paid' ? 'paid' : 'pending';
  return null;
}

function allowedTransition(current, target) {
  if (current === target) return true;
  if (target === 'paid') return ['created','submitting','pending','failed','expired','review_required'].includes(current);
  if (current === 'paid') return false;
  if (target === 'pending') return ['created','submitting','review_required'].includes(current);
  if (target === 'failed' || target === 'expired') return ['created','submitting','pending','review_required'].includes(current);
  return false;
}

async function processVerifiedFlexibleEvent({ connectionString, event, rawBody }) {
  const object = event.data?.object || {};
  const metadata = object.metadata || {};
  const attemptId = String(metadata.flexible_attempt_id || '');
  const schoolId = positiveInteger(metadata.school_id);
  if (!isUuid(attemptId) || !schoolId) {
    const error = new Error('Invalid Flexible Hours event scope');
    error.code = 'INVALID_FLEXIBLE_PACKAGE_EVENT_SCOPE';
    throw error;
  }

  return withNeonTransaction(connectionString, async client => {
    const attempts = await client.query(
      `SELECT * FROM flexible_package_purchase_attempts
        WHERE id = $1::uuid AND school_id = $2 FOR UPDATE`,
      [attemptId, schoolId]
    );
    let attempt = attempts.rows[0];
    if (!attempt) {
      const error = new Error('Flexible Hours attempt not found');
      error.code = 'FLEXIBLE_PACKAGE_ATTEMPT_NOT_FOUND';
      throw error;
    }
    const insertedEvent = await client.query(
      `INSERT INTO flexible_package_payment_events (
         school_id, attempt_id, stripe_event_id, event_type, stripe_object_id,
         payload_sha256, provider_created_at, processing_state
       ) VALUES ($1,$2::uuid,$3,$4,$5,$6,to_timestamp($7),'processing')
       ON CONFLICT (stripe_event_id) DO NOTHING
       RETURNING *`,
      [schoolId, attemptId, event.id, event.type, object.id, payloadSha256(rawBody), Number(event.created || 0)]
    );
    if (!insertedEvent.rowCount) {
      const existingEvent = await client.query(
        `SELECT school_id, attempt_id::text, event_type, stripe_object_id, payload_sha256
           FROM flexible_package_payment_events
          WHERE stripe_event_id = $1`,
        [event.id]
      );
      const recorded = existingEvent.rows[0];
      if (!recorded
          || Number(recorded.school_id) !== schoolId
          || recorded.attempt_id !== attemptId
          || recorded.event_type !== event.type
          || recorded.stripe_object_id !== object.id
          || recorded.payload_sha256 !== payloadSha256(rawBody)) {
        const error = new Error('Duplicate Stripe event identity carried contradictory evidence');
        error.code = 'FLEXIBLE_PACKAGE_DUPLICATE_EVENT_CONTRADICTION';
        throw error;
      }
      await client.query(
        `UPDATE flexible_package_payment_events
            SET delivery_count = delivery_count + 1, last_received_at = NOW()
          WHERE stripe_event_id = $1 AND school_id = $2`,
        [event.id, schoolId]
      );
      return { duplicate: true, status: attempt.status, sourceCreated: false };
    }

    const validation = validateFlexibleProviderObject(attempt, object);
    if (!validation.ok) {
      const status = attempt.status === 'paid' ? 'paid' : 'review_required';
      await client.query(
        `UPDATE flexible_package_purchase_attempts
            SET status = CASE WHEN status = 'paid' THEN status ELSE 'review_required' END,
                failure_code = 'PROVIDER_EVIDENCE_CONTRADICTION',
                review_required_at = CASE WHEN status = 'paid' THEN review_required_at ELSE COALESCE(review_required_at, NOW()) END,
                updated_at = NOW()
          WHERE id = $1::uuid AND school_id = $2`,
        [attemptId, schoolId]
      );
      await client.query(
        `INSERT INTO flexible_package_state_events (
           school_id, learner_id, event_type, attempt_id, detail
         ) VALUES ($1,$2,'reconciliation_contradiction',$3::uuid,$4::jsonb)`,
        [schoolId, attempt.learner_id, attemptId, JSON.stringify({
          stripe_event_id: event.id,
          event_type: event.type,
          contradictions: validation.contradictions,
        })]
      );
      await client.query(
        `UPDATE flexible_package_payment_events
            SET processing_state = 'failed', failure_code = 'PROVIDER_EVIDENCE_CONTRADICTION',
                processed_at = NOW(), last_received_at = NOW()
          WHERE stripe_event_id = $1 AND school_id = $2`,
        [event.id, schoolId]
      );
      return { duplicate: false, status, sourceCreated: false, sourceId: null, reviewRequired: true };
    }

    const providerIdentity = await client.query(
      `UPDATE flexible_package_purchase_attempts
          SET stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, $1),
              stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $2),
              updated_at = NOW()
        WHERE id = $3::uuid AND school_id = $4
          AND (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id = $1)
          AND (stripe_payment_intent_id IS NULL OR $2::text IS NULL OR stripe_payment_intent_id = $2)
        RETURNING *`,
      [object.id, validation.paymentIntentId, attemptId, schoolId]
    );
    if (!providerIdentity.rowCount) {
      const error = new Error('Verified Flexible Hours provider identity could not be persisted safely');
      error.code = 'FLEXIBLE_PACKAGE_PROVIDER_IDENTITY_CONTRADICTION';
      throw error;
    }
    attempt = providerIdentity.rows[0];

    const target = targetStatus(event.type, object);
    let status = attempt.status;
    if (target && allowedTransition(status, target) && status !== target) {
      await client.query(
        `UPDATE flexible_package_purchase_attempts
            SET status = $1,
                stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $2),
                paid_at = CASE WHEN $1 = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
                failed_at = CASE WHEN $1 = 'failed' THEN COALESCE(failed_at, NOW()) ELSE failed_at END,
                expired_at = CASE WHEN $1 = 'expired' THEN COALESCE(expired_at, NOW()) ELSE expired_at END,
                updated_at = NOW()
          WHERE id = $3::uuid AND school_id = $4`,
        [target, validation.paymentIntentId, attemptId, schoolId]
      );
      status = target;
    }

    let sourceCreated = false;
    let sourceId = null;
    if (status === 'paid') {
      const purchase = await client.query(
        `INSERT INTO flexible_package_purchases (
           school_id, learner_id, attempt_id, product_id, product_version_id,
           product_slug, product_snapshot, amount_pence, currency, total_units,
           unit_minutes, rate_pence_per_unit, customer_terms_version,
           stripe_checkout_session_id, stripe_payment_intent_id, paid_at
         ) SELECT school_id, learner_id, id, product_id, product_version_id,
                  product_slug, product_snapshot, amount_pence, currency, total_units,
                  unit_minutes, rate_pence_per_unit, customer_terms_version,
                  stripe_checkout_session_id, stripe_payment_intent_id, paid_at
             FROM flexible_package_purchase_attempts
            WHERE id = $1::uuid AND school_id = $2 AND status = 'paid'
         ON CONFLICT (attempt_id) DO NOTHING
         RETURNING *`,
        [attemptId, schoolId]
      );
      let purchaseRow = purchase.rows[0];
      if (!purchaseRow) {
        const existing = await client.query(
          `SELECT * FROM flexible_package_purchases WHERE attempt_id = $1::uuid AND school_id = $2`,
          [attemptId, schoolId]
        );
        purchaseRow = existing.rows[0];
      }
      if (!purchaseRow) throw new Error('Paid Flexible Hours attempt could not create or recover its purchase');

      const source = await client.query(
        `INSERT INTO flexible_package_sources (
           school_id, learner_id, purchase_id, product_version_id, initial_units,
           unit_minutes, rate_pence_per_unit, original_value_pence, available_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (purchase_id) DO NOTHING
         RETURNING id`,
        [
          purchaseRow.school_id, purchaseRow.learner_id, purchaseRow.id,
          purchaseRow.product_version_id, purchaseRow.total_units, purchaseRow.unit_minutes,
          purchaseRow.rate_pence_per_unit, purchaseRow.amount_pence, purchaseRow.paid_at,
        ]
      );
      sourceCreated = source.rowCount === 1;
      if (sourceCreated) {
        sourceId = source.rows[0].id;
        await client.query(
          `INSERT INTO flexible_package_state_events (
             school_id, learner_id, event_type, attempt_id, purchase_id, source_id, detail
           ) VALUES ($1,$2,'entitlement_created',$3::uuid,$4,$5,$6::jsonb)`,
          [schoolId, purchaseRow.learner_id, attemptId, purchaseRow.id, sourceId, JSON.stringify({
            product_version_id: purchaseRow.product_version_id,
            units: purchaseRow.total_units,
            unit_minutes: purchaseRow.unit_minutes,
            rate_pence_per_unit: purchaseRow.rate_pence_per_unit,
            earnings_created: false,
            payout_created: false,
          })]
        );
      }
    }

    await client.query(
      `UPDATE flexible_package_payment_events
          SET processing_state = 'processed', processed_at = NOW(), last_received_at = NOW()
        WHERE stripe_event_id = $1 AND school_id = $2`,
      [event.id, schoolId]
    );
    return { duplicate: false, status, sourceCreated, sourceId };
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'POST required' });
  }
  let stripe;
  let secret;
  try {
    stripe = createFlexiblePackageLiveStripeClient();
    secret = getFlexiblePackageLiveWebhookSecret();
  } catch (error) {
    reportError('/api/flexible-package-webhook (configuration)', error);
    return res.status(503).json({ error: true, code: 'FLEXIBLE_PACKAGE_LIVE_WEBHOOK_NOT_CONFIGURED' });
  }
  let rawBody;
  let event;
  try {
    rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], secret);
  } catch (_) {
    return res.status(400).json({ error: true, code: 'INVALID_STRIPE_SIGNATURE' });
  }
  if (event.livemode !== true || event.data?.object?.livemode !== true) {
    return res.status(400).json({ error: true, code: 'NON_LIVE_FLEXIBLE_EVENT_REJECTED' });
  }
  if (!FLEXIBLE_PACKAGE_EVENT_TYPES.has(event.type)) return res.json({ received: true, ignored: true });
  if (event.data?.object?.metadata?.payment_type !== FLEXIBLE_PACKAGE_PAYMENT_TYPE) {
    return res.json({ received: true, ignored: true });
  }
  try {
    const result = await processVerifiedFlexibleEvent({
      connectionString: process.env.POSTGRES_URL,
      event,
      rawBody,
    });
    return res.json({
      received: true,
      duplicate: result.duplicate,
      status: result.status,
      entitlement_created: result.sourceCreated,
      source_id: result.sourceId,
      review_required: result.reviewRequired === true,
    });
  } catch (error) {
    reportError(`/api/flexible-package-webhook (${event.type})`, error);
    return res.status(500).json({ error: true, code: 'FLEXIBLE_PACKAGE_WEBHOOK_PROCESSING_FAILED' });
  }
};

module.exports._test = { allowedTransition, processVerifiedFlexibleEvent, targetStatus };
