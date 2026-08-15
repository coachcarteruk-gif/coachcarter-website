'use strict';

const { neon } = require('@neondatabase/serverless');
const { reportError } = require('./_error-alert');
const { sendFullCurriculumDurableConfirmation } = require('./_full-curriculum-confirmation');
const {
  PACKAGE_EVENT_TYPES,
  PACKAGE_PAYMENT_TYPE,
  createPackageTestStripeClient,
  getPackageTestWebhookSecret,
  getRawBody,
  isUuid,
  payloadSha256,
  positiveInteger,
  safeFailureCode,
  validateProviderObject,
} = require('./_learner-package-payments');

function providerCreatedAt(event) {
  return Number.isFinite(Number(event?.created))
    ? new Date(Number(event.created) * 1000).toISOString()
    : null;
}

function objectPaymentIntentId(object) {
  if (String(object?.id || '').startsWith('pi_')) return object.id;
  if (typeof object?.payment_intent === 'string') return object.payment_intent;
  return object?.payment_intent?.id || null;
}

async function claimEvent(sql, { event, attempt, rawBody }) {
  const object = event.data.object;
  const inserted = await sql`
    INSERT INTO package_payment_events (
      school_id, attempt_id, stripe_event_id, event_type, stripe_object_id,
      livemode, payload_sha256, provider_created_at, processing_state
    ) VALUES (
      ${attempt.school_id}, ${attempt.id}::uuid, ${event.id}, ${event.type},
      ${object.id}, FALSE, ${payloadSha256(rawBody)},
      ${providerCreatedAt(event)}::timestamptz, 'processing'
    )
    ON CONFLICT (stripe_event_id) DO NOTHING
    RETURNING *
  `;
  if (inserted[0]) return { claimed: true, receipt: inserted[0] };

  await sql`
    UPDATE package_payment_events
       SET delivery_count = delivery_count + 1,
           last_received_at = NOW()
     WHERE stripe_event_id = ${event.id}
       AND school_id = ${attempt.school_id}
       AND attempt_id = ${attempt.id}::uuid
  `;
  const rows = await sql`
    SELECT * FROM package_payment_events
     WHERE stripe_event_id = ${event.id}
       AND school_id = ${attempt.school_id}
       AND attempt_id = ${attempt.id}::uuid
     LIMIT 1
  `;
  const existing = rows[0];
  if (!existing) {
    const error = new Error('Stripe event identity conflicts with another package scope');
    error.code = 'PACKAGE_EVENT_SCOPE_CONFLICT';
    throw error;
  }
  if (existing.processing_state !== 'failed') return { claimed: false, receipt: existing };
  const reclaimed = await sql`
    UPDATE package_payment_events
       SET processing_state = 'processing', failure_code = NULL,
           last_received_at = NOW()
     WHERE id = ${existing.id}
       AND school_id = ${attempt.school_id}
       AND processing_state = 'failed'
     RETURNING *
  `;
  return { claimed: !!reclaimed[0], receipt: reclaimed[0] || existing };
}

async function markEventProcessed(sql, receipt) {
  await sql`
    UPDATE package_payment_events
       SET processing_state = 'processed', processed_at = NOW(),
           failure_code = NULL, last_received_at = NOW()
     WHERE id = ${receipt.id}
       AND school_id = ${receipt.school_id}
       AND processing_state = 'processing'
  `;
}

async function markEventFailed(sql, receipt, error) {
  await sql`
    UPDATE package_payment_events
       SET processing_state = 'failed',
           failure_code = ${safeFailureCode(error?.code, 'PACKAGE_WEBHOOK_FAILED')},
           last_received_at = NOW()
     WHERE id = ${receipt.id}
       AND school_id = ${receipt.school_id}
       AND processing_state = 'processing'
  `;
}

async function transitionAttempt(sql, { attempt, targetStatus, event, object, failureCode = null }) {
  const checkoutSessionId = String(object?.id || '').startsWith('cs_test_') ? object.id : null;
  const paymentIntentId = objectPaymentIntentId(object);
  const eventCreatedAt = providerCreatedAt(event);
  const allowedStatuses = targetStatus === 'paid'
    ? ['created', 'submitting', 'pending', 'failed', 'expired', 'review_required']
    : targetStatus === 'pending'
      ? ['submitting', 'review_required']
      : targetStatus === 'failed'
        ? ['created', 'submitting', 'pending', 'review_required']
        : targetStatus === 'expired'
          ? ['submitting', 'pending', 'review_required']
          : ['created', 'submitting', 'pending', 'failed', 'expired', 'review_required'];

  // Keep the state mutation and append-only state evidence in one statement.
  // The CASE expressions are static; allowedStatuses is passed as a value,
  // never interpolated as a SQL identifier or fragment.
  const rows = await sql`
    WITH previous AS (
      SELECT id, school_id, status
        FROM package_purchase_attempts
       WHERE id = ${attempt.id}::uuid
         AND school_id = ${attempt.school_id}
         AND status = ANY(${allowedStatuses}::text[])
       FOR UPDATE
    ), updated AS (
      UPDATE package_purchase_attempts a
         SET status = ${targetStatus},
             stripe_checkout_session_id = COALESCE(a.stripe_checkout_session_id, ${checkoutSessionId}),
             stripe_payment_intent_id = COALESCE(a.stripe_payment_intent_id, ${paymentIntentId}),
             paid_at = CASE WHEN ${targetStatus} = 'paid' THEN COALESCE(a.paid_at, NOW()) ELSE a.paid_at END,
             failed_at = CASE WHEN ${targetStatus} = 'failed' THEN COALESCE(a.failed_at, NOW()) ELSE a.failed_at END,
             expired_at = CASE WHEN ${targetStatus} = 'expired' THEN COALESCE(a.expired_at, NOW()) ELSE a.expired_at END,
             review_required_at = CASE WHEN ${targetStatus} = 'review_required' THEN COALESCE(a.review_required_at, NOW()) ELSE a.review_required_at END,
             failure_code = ${failureCode},
             failure_message = CASE
               WHEN ${targetStatus} = 'review_required' THEN 'Provider evidence contradicted the durable attempt.'
               WHEN ${targetStatus} = 'failed' THEN 'Stripe reported that the test payment failed.'
               WHEN ${targetStatus} = 'expired' THEN 'Stripe reported that the test Checkout expired.'
               WHEN ${targetStatus} = 'paid' THEN NULL
               ELSE a.failure_message
             END,
             last_provider_event_id = ${event.id},
             last_provider_event_type = ${event.type},
             last_provider_event_created_at = ${eventCreatedAt}::timestamptz,
             updated_at = NOW()
        FROM previous p
       WHERE a.id = p.id
         AND a.school_id = p.school_id
       RETURNING a.*, p.status AS from_status
    ), evidence AS (
      INSERT INTO package_purchase_attempt_state_events (
        school_id, attempt_id, from_status, to_status, source, stripe_event_id, detail
      )
      SELECT school_id, id, from_status, status, 'package_webhook', ${event.id},
             ${JSON.stringify({ provider_event_type: event.type })}::jsonb
        FROM updated
       WHERE from_status IS DISTINCT FROM status
      RETURNING id
    )
    SELECT * FROM updated
  `;
  if (rows[0]) return rows[0];
  const current = await sql`
    SELECT * FROM package_purchase_attempts
     WHERE id = ${attempt.id}::uuid
       AND school_id = ${attempt.school_id}
     LIMIT 1
  `;
  return current[0] || attempt;
}

async function processPackageEvent(sql, { event, attempt }) {
  const object = event.data.object;
  const validation = validateProviderObject(attempt, object);
  if (!validation.ok) {
    return transitionAttempt(sql, {
      attempt,
      targetStatus: 'review_required',
      event,
      object,
      failureCode: 'PROVIDER_EVIDENCE_MISMATCH',
    });
  }

  if (event.type === 'checkout.session.completed') {
    return transitionAttempt(sql, {
      attempt,
      targetStatus: object.payment_status === 'paid' ? 'paid' : 'pending',
      event,
      object,
    });
  }
  if (event.type === 'checkout.session.async_payment_succeeded') {
    if (object.payment_status !== 'paid') {
      return transitionAttempt(sql, {
        attempt,
        targetStatus: 'review_required',
        event,
        object,
        failureCode: 'SUCCESS_EVENT_NOT_PAID',
      });
    }
    return transitionAttempt(sql, { attempt, targetStatus: 'paid', event, object });
  }
  if (event.type === 'checkout.session.expired') {
    return transitionAttempt(sql, { attempt, targetStatus: 'expired', event, object });
  }
  return transitionAttempt(sql, {
    attempt,
    targetStatus: 'failed',
    event,
    object,
    failureCode: 'STRIPE_PAYMENT_FAILED',
  });
}

async function fulfilFullCurriculum(sql, { attempt }) {
  if (attempt.product_slug !== 'full-curriculum' || attempt.status !== 'paid') {
    return { created: false, enrolment: null };
  }
  const rows = await sql`
    WITH source AS (
      SELECT a.*,
             evidence.early_start_requested,
             evidence.policy_version,
             evidence.disclosure_version,
             evidence.refund_calculation_version,
             a.paid_at AS contract_formed_at,
             (
               ((a.paid_at AT TIME ZONE zone.name)::date + 15)
               AT TIME ZONE zone.name
             ) AS cooling_off_expires_at,
             (tb.test_date + tb.test_time) AT TIME ZONE zone.name AS verified_first_test_at
        FROM package_purchase_attempts a
        JOIN schools school
          ON school.id = a.school_id
        JOIN full_curriculum_test_bookings tb
          ON tb.id = a.full_curriculum_test_booking_id
         AND tb.school_id = a.school_id
         AND tb.learner_id = a.learner_id
         AND tb.attempt_number = 1
         AND tb.verification_status = 'verified'
        JOIN full_curriculum_consumer_contract_evidence evidence
          ON evidence.attempt_id = a.id
         AND evidence.school_id = a.school_id
         AND evidence.learner_id = a.learner_id
         AND evidence.customer_terms_version = a.customer_terms_version
         AND evidence.adult_age_confirmed = TRUE
        CROSS JOIN LATERAL (
          SELECT COALESCE(
            (SELECT name FROM pg_timezone_names
              WHERE name = NULLIF(a.eligibility_snapshot->>'timezone', '') LIMIT 1),
            (SELECT name FROM pg_timezone_names
              WHERE name = NULLIF(school.config->>'timezone', '') LIMIT 1),
            'Europe/London'
          ) AS name
        ) zone
       WHERE a.id = ${attempt.id}::uuid
         AND a.school_id = ${attempt.school_id}
         AND a.status = 'paid'
         AND a.stripe_mode = 'test'
         AND a.product_slug = 'full-curriculum'
         AND a.stripe_checkout_session_id IS NOT NULL
       FOR UPDATE OF a
    ), inserted_purchase AS (
      INSERT INTO learner_package_purchases (
        school_id, learner_id, attempt_id, product_id, product_version_id,
        product_slug, product_snapshot, amount_pence, currency,
        customer_terms_version, stripe_mode, stripe_checkout_session_id,
        stripe_payment_intent_id, paid_at
      )
      SELECT school_id, learner_id, id, product_id, product_version_id,
             product_slug, product_snapshot, amount_pence, currency,
             customer_terms_version, stripe_mode, stripe_checkout_session_id,
             stripe_payment_intent_id, paid_at
        FROM source
      ON CONFLICT (attempt_id) DO UPDATE
        SET attempt_id = EXCLUDED.attempt_id
      RETURNING *, (xmax = 0) AS created_now
    ), purchase_identity AS (
      SELECT * FROM inserted_purchase
    ), inserted_enrolment AS (
      INSERT INTO full_curriculum_enrolments (
        school_id, learner_id, purchase_id, first_test_booking_id, status,
        current_phase, matching_deadline, original_first_test_at, current_first_test_at,
        early_start_requested, contract_formed_at, cooling_off_expires_at,
        service_may_start_at
      )
      SELECT p.school_id, p.learner_id, p.id, s.full_curriculum_test_booking_id,
             CASE WHEN s.early_start_requested THEN 'paid_matching' ELSE 'cooling_off_hold' END,
             1,
             (CASE WHEN s.early_start_requested THEN p.paid_at ELSE s.cooling_off_expires_at END)
               + INTERVAL '7 days',
             s.verified_first_test_at, s.verified_first_test_at,
             s.early_start_requested, s.contract_formed_at, s.cooling_off_expires_at,
             CASE WHEN s.early_start_requested THEN p.paid_at ELSE s.cooling_off_expires_at END
        FROM purchase_identity p
        JOIN source s ON s.id = p.attempt_id AND s.school_id = p.school_id
      ON CONFLICT (purchase_id) DO UPDATE
        SET purchase_id = EXCLUDED.purchase_id
      RETURNING *, (xmax = 0) AS created_now
    ), enrolment_identity AS (
      SELECT * FROM inserted_enrolment
    ), matching AS (
      INSERT INTO full_curriculum_matching_records (
        school_id, enrolment_id, learner_id, status, created_at, updated_at
      )
      SELECT e.school_id, e.id, e.learner_id, 'pending', e.created_at, NOW()
        FROM enrolment_identity e
      ON CONFLICT (school_id, enrolment_id) DO NOTHING
      RETURNING id
    ), progress AS (
      INSERT INTO full_curriculum_progress_events (
        school_id, enrolment_id, phase_number, event_type, actor_type, detail
      )
      SELECT e.school_id, e.id, 1, 'enrolment_created', 'system',
             jsonb_build_object(
               'purchase_id', e.purchase_id,
               'matching_deadline', e.matching_deadline,
               'early_start_requested', e.early_start_requested,
               'cooling_off_expires_at', e.cooling_off_expires_at,
               'service_may_start_at', e.service_may_start_at,
               'programme_started', false,
               'weekly_opportunities_created', 0
             )
        FROM inserted_enrolment e
       WHERE e.created_now = TRUE
      RETURNING id
    ), contract_event AS (
      INSERT INTO full_curriculum_contract_events (
        school_id, attempt_id, purchase_id, enrolment_id, event_type,
        actor_type, detail, occurred_at
      )
      SELECT e.school_id, p.attempt_id, p.id, e.id, 'contract_formed',
             'system',
             jsonb_build_object(
               'customer_terms_version', p.customer_terms_version,
               'early_start_requested', e.early_start_requested,
               'cooling_off_expires_at', e.cooling_off_expires_at,
               'service_may_start_at', e.service_may_start_at
             ), e.contract_formed_at
        FROM inserted_enrolment e
        JOIN purchase_identity p ON p.id = e.purchase_id AND p.school_id = e.school_id
       WHERE e.created_now = TRUE
      ON CONFLICT DO NOTHING
      RETURNING id
    )
    SELECT e.*, e.created_now AS fulfilment_created
      FROM enrolment_identity e
     LIMIT 1
  `;
  if (!rows[0]) {
    const error = new Error('Paid Full Curriculum attempt lacked verified same-school fulfilment evidence');
    error.code = 'FULL_CURRICULUM_FULFILMENT_EVIDENCE_MISSING';
    throw error;
  }
  return { created: rows[0].fulfilment_created === true, enrolment: rows[0] };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: true, code: 'METHOD_NOT_ALLOWED', message: 'POST required' });
  }

  let stripe;
  let endpointSecret;
  try {
    stripe = createPackageTestStripeClient();
    endpointSecret = getPackageTestWebhookSecret();
  } catch (err) {
    reportError('/api/package-webhook (configuration)', err);
    return res.status(503).json({ error: true, code: 'PACKAGE_TEST_WEBHOOK_NOT_CONFIGURED' });
  }

  let rawBody;
  let event;
  try {
    rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      req.headers['stripe-signature'],
      endpointSecret
    );
  } catch (err) {
    return res.status(400).json({ error: true, code: 'INVALID_STRIPE_SIGNATURE' });
  }

  if (event.livemode === true || event.data?.object?.livemode === true) {
    return res.status(400).json({ error: true, code: 'LIVE_STRIPE_EVENT_REJECTED' });
  }
  if (!PACKAGE_EVENT_TYPES.has(event.type)) {
    return res.json({ received: true, ignored: true });
  }
  const object = event.data?.object || {};
  const metadata = object.metadata || {};
  if (metadata.payment_type !== PACKAGE_PAYMENT_TYPE) {
    return res.json({ received: true, ignored: true });
  }
  const attemptId = String(metadata.package_attempt_id || '').trim();
  const schoolId = positiveInteger(metadata.school_id);
  if (!isUuid(attemptId) || !schoolId || !event.id || !object.id) {
    return res.status(400).json({ error: true, code: 'INVALID_PACKAGE_EVENT_SCOPE' });
  }

  const sql = neon(process.env.POSTGRES_URL);
  let receipt = null;
  try {
    const attempts = await sql`
      SELECT * FROM package_purchase_attempts
       WHERE id = ${attemptId}::uuid
         AND school_id = ${schoolId}
       LIMIT 1
    `;
    const attempt = attempts[0];
    if (!attempt) {
      const error = new Error('Signed package event has no matching durable attempt');
      error.code = 'PACKAGE_ATTEMPT_NOT_FOUND';
      throw error;
    }
    const claim = await claimEvent(sql, { event, attempt, rawBody });
    receipt = claim.receipt;
    if (!claim.claimed) {
      return res.json({ received: true, duplicate: true });
    }
    const updated = await processPackageEvent(sql, { event, attempt });
    const fulfilment = updated.status === 'paid'
      ? await fulfilFullCurriculum(sql, { attempt: updated })
      : { created: false, enrolment: null };
    const confirmation = updated.status === 'paid' && updated.product_slug === 'full-curriculum'
      ? await sendFullCurriculumDurableConfirmation({
        sql,
        attemptId: updated.id,
        schoolId: updated.school_id,
      })
      : { delivered: false, reused: false };
    await markEventProcessed(sql, receipt);
    return res.json({
      received: true,
      status: updated.status,
      fulfilment_created: fulfilment.created,
      enrolment_id: fulfilment.enrolment?.id || null,
      durable_confirmation_delivered: confirmation.delivered,
    });
  } catch (err) {
    if (receipt) {
      await markEventFailed(sql, receipt, err).catch(() => {});
    }
    reportError(`/api/package-webhook (${event.type})`, err);
    return res.status(500).json({ error: true, code: 'PACKAGE_WEBHOOK_PROCESSING_FAILED' });
  }
};

module.exports._test = {
  claimEvent,
  processPackageEvent,
  transitionAttempt,
  fulfilFullCurriculum,
};
