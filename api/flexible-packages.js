'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { requireAuth, getSchoolId } = require('./_auth');
const { reportError } = require('./_error-alert');
const { isDevelopmentHost } = require('./_tenant');
const { withNeonTransaction } = require('./_db-transaction');
const {
  FLEXIBLE_HOURS_DISCLOSURE_VERSION,
  buildFlexiblePackageCheckoutParams,
  classifyFlexibleStripeError,
  createFlexiblePackageLiveStripeClient,
  getFlexiblePackageLivePaymentConfiguration,
  isFlexiblePackageLivePurchasingEnabled,
  isUuid,
  productTerms,
  validateFlexibleProviderObject,
} = require('./_flexible-package-payments');

function errorResponse(res, status, code, message) {
  return res.status(status).json({ error: true, code, message });
}

function isMissingFlexibleSchemaError(error) {
  return error?.code === '42P01' || error?.code === '42703';
}

function learnerScope(req, res) {
  const learner = requireAuth(req, { roles: ['learner'], requireSchool: true });
  if (!learner) {
    errorResponse(res, 401, 'UNAUTHORIZED', 'Learner sign-in required');
    return null;
  }
  return { learner, schoolId: getSchoolId(learner, req) };
}

function adminScope(req, res) {
  const admin = requireAuth(req, { roles: ['admin'], requireSchool: false });
  if (!admin) {
    errorResponse(res, 401, 'UNAUTHORIZED', 'Admin access required');
    return null;
  }
  const schoolId = getSchoolId(admin, req);
  if (!Number.isSafeInteger(schoolId) || schoolId <= 0) {
    errorResponse(res, 400, 'SCHOOL_REQUIRED', 'A valid school is required');
    return null;
  }
  return { admin, schoolId };
}

function returnBaseUrl(req, school) {
  const host = String(school?.primary_host || '').trim().toLowerCase();
  if (/^[a-z0-9.-]+$/.test(host) && host.includes('.')) return `https://${host}`;
  const forwarded = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();
  if (isDevelopmentHost(forwarded)) {
    return `${forwarded.includes('localhost') || forwarded.startsWith('127.') ? 'http' : 'https'}://${forwarded}`;
  }
  return 'https://coachcarter.uk';
}

function publicAttempt(attempt) {
  let status = attempt.status;
  if (['created','submitting','pending'].includes(status)
      && attempt.review_after && new Date(attempt.review_after) <= new Date()) status = 'review_required';
  return {
    id: attempt.id,
    status,
    product: { id: attempt.product_id, version_id: attempt.product_version_id, slug: attempt.product_slug },
    amount_pence: Number(attempt.amount_pence),
    currency: attempt.currency,
    total_units: Number(attempt.total_units),
    unit_minutes: Number(attempt.unit_minutes),
    terms_version: attempt.customer_terms_version,
    disclosure_version: attempt.disclosure_version,
    immediate_access_requested: attempt.immediate_access_requested === true,
    paid_at: attempt.paid_at,
    failure_code: attempt.failure_code || null,
    message: status === 'paid'
      ? 'Your bank payment is confirmed and your Flexible Hours are available.'
      : status === 'review_required'
        ? 'Payment needs review. Do not start another Checkout.'
        : status === 'failed' || status === 'expired'
          ? 'No Flexible Hours were created. You may start a new Checkout.'
          : 'Waiting for signed Stripe confirmation. This page cannot create hours.',
  };
}

async function handleBalance(req, res) {
  if (req.method !== 'GET') return errorResponse(res, 405, 'METHOD_NOT_ALLOWED', 'GET required');
  const scope = learnerScope(req, res);
  if (!scope) return;
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [balance] = await sql`
      SELECT remaining_units, remaining_minutes, refundable_value_pence
        FROM flexible_package_balances
       WHERE school_id = ${scope.schoolId} AND learner_id = ${scope.learner.id}
    `;
    const sources = await sql`
      SELECT remaining.source_id, remaining.purchase_id, remaining.remaining_units,
             remaining.unit_minutes, remaining.rate_pence_per_unit,
             remaining.refundable_value_pence, remaining.available_at,
             purchase.product_slug, purchase.product_version_id, purchase.customer_terms_version
        FROM flexible_package_source_remaining remaining
        JOIN flexible_package_purchases purchase
          ON purchase.id = remaining.purchase_id AND purchase.school_id = ${scope.schoolId}
       WHERE remaining.school_id = ${scope.schoolId}
         AND remaining.learner_id = ${scope.learner.id}
         AND remaining.remaining_units > 0
       ORDER BY remaining.available_at, remaining.source_id
    `;
    return res.json({
      ok: true,
      unit_minutes: 30,
      remaining_units: Number(balance?.remaining_units || 0),
      remaining_minutes: Number(balance?.remaining_minutes || 0),
      refundable_value_pence: Number(balance?.refundable_value_pence || 0),
      sources,
    });
  } catch (error) {
    if (isMissingFlexibleSchemaError(error)) {
      return res.json({ ok: true, unit_minutes: 30, remaining_units: 0, remaining_minutes: 0, refundable_value_pence: 0, sources: [], schema_ready: false });
    }
    reportError('/api/flexible-packages?action=balance', error);
    return errorResponse(res, 500, 'SERVER_ERROR', 'Failed to load Flexible Hours');
  }
}

async function handleCreateCheckout(req, res) {
  if (req.method !== 'POST') return errorResponse(res, 405, 'METHOD_NOT_ALLOWED', 'POST required');
  const scope = learnerScope(req, res);
  if (!scope) return;
  const productId = Number(req.body?.product_id);
  const clientRequestId = String(req.body?.client_request_id || '').trim().toLowerCase();
  if (!Number.isSafeInteger(productId) || productId <= 0 || !isUuid(clientRequestId)) {
    return errorResponse(res, 400, 'INVALID_CHECKOUT_REQUEST', 'A product and secure request identity are required');
  }
  if (req.body?.adult_age_confirmed !== true
      || req.body?.consumer_terms_accepted !== true
      || req.body?.immediate_access_requested !== true
      || req.body?.disclosure_version !== FLEXIBLE_HOURS_DISCLOSURE_VERSION) {
    return errorResponse(res, 400, 'FLEXIBLE_CONSUMER_RIGHTS_ACKNOWLEDGEMENT_REQUIRED', 'Confirm the current terms and expressly request immediate access');
  }

  const sql = neon(process.env.POSTGRES_URL);
  let attempt = null;
  try {
    const [school] = await sql`
      SELECT id, primary_host, config FROM schools
       WHERE id = ${scope.schoolId} AND active = TRUE LIMIT 1
    `;
    if (!school) return errorResponse(res, 404, 'SCHOOL_NOT_FOUND', 'School not found');
    if (!isFlexiblePackageLivePurchasingEnabled(school.config, scope.schoolId)) {
      return errorResponse(res, 404, 'FLEXIBLE_PACKAGE_LIVE_PURCHASING_DISABLED', 'Flexible Hours purchasing is not enabled');
    }
    const [learner] = await sql`
      SELECT id, name, email, email_verified FROM learner_users
       WHERE id = ${scope.learner.id} AND school_id = ${scope.schoolId} LIMIT 1
    `;
    if (!learner?.email || learner.email_verified !== true) {
      return errorResponse(res, 403, 'VERIFIED_LEARNER_REQUIRED', 'A verified same-school learner email is required');
    }
    const [product] = await sql`
      SELECT p.id AS product_id, p.slug AS product_slug, p.product_type,
             v.id AS product_version_id, v.version_number, v.price_pence,
             v.currency, v.content, v.customer_terms_version
        FROM package_products p
        JOIN LATERAL (
          SELECT * FROM package_product_versions candidate
           WHERE candidate.school_id = ${scope.schoolId}
             AND candidate.product_id = p.id AND candidate.effective_from <= NOW()
           ORDER BY candidate.effective_from DESC, candidate.version_number DESC LIMIT 1
        ) v ON TRUE
       WHERE p.id = ${productId} AND p.school_id = ${scope.schoolId}
         AND p.product_type = 'flexible_hours' AND p.active = TRUE AND p.visible = TRUE
       LIMIT 1
    `;
    const terms = productTerms(product);
    if (!terms) return errorResponse(res, 409, 'FLEXIBLE_PACKAGE_VERSION_NOT_APPROVED', 'The current immutable product version is not approved for Checkout');

    const existing = await sql`
      SELECT * FROM flexible_package_purchase_attempts
       WHERE school_id = ${scope.schoolId} AND learner_id = ${scope.learner.id}
         AND (client_request_id = ${clientRequestId}::uuid
           OR (product_id = ${productId} AND status IN ('created','submitting','pending','review_required')))
       ORDER BY created_at DESC LIMIT 1
    `;
    if (existing[0]) {
      const safe = publicAttempt(existing[0]);
      if (existing[0].status === 'pending' && existing[0].stripe_checkout_url) {
        return res.json({ ok: true, reused: true, url: existing[0].stripe_checkout_url, attempt: safe });
      }
      return res.status(202).json({ ok: true, reused: true, attempt: safe });
    }

    let stripe;
    let paymentConfiguration;
    try {
      stripe = createFlexiblePackageLiveStripeClient();
      paymentConfiguration = getFlexiblePackageLivePaymentConfiguration();
    } catch (error) {
      return errorResponse(res, 503, error.code || 'FLEXIBLE_PACKAGE_LIVE_STRIPE_NOT_CONFIGURED', 'Live Flexible Hours Pay by Bank is not configured');
    }

    const attemptId = crypto.randomUUID();
    const idempotencyKey = `cc-flexible-package-live-${attemptId}`;
    const inserted = await sql`
      INSERT INTO flexible_package_purchase_attempts (
        id, school_id, learner_id, product_id, product_version_id, product_slug,
        product_snapshot, amount_pence, currency, total_units, unit_minutes,
        rate_pence_per_unit, customer_terms_version, disclosure_version,
        adult_age_confirmed, terms_accepted, immediate_access_requested,
        stripe_mode, status, client_request_id, idempotency_key,
        stripe_payment_method_configuration_id
      ) VALUES (
        ${attemptId}::uuid, ${scope.schoolId}, ${scope.learner.id},
        ${product.product_id}, ${product.product_version_id}, ${product.product_slug},
        ${JSON.stringify(product.content)}::jsonb, ${terms.amountPence}, 'GBP',
        ${terms.totalUnits}, ${terms.unitMinutes}, ${terms.ratePencePerUnit},
        ${product.customer_terms_version}, ${FLEXIBLE_HOURS_DISCLOSURE_VERSION},
        TRUE, TRUE, TRUE, 'live', 'submitting', ${clientRequestId}::uuid,
        ${idempotencyKey}, ${paymentConfiguration}
      ) RETURNING *
    `;
    attempt = inserted[0];
    let session;
    try {
      session = await stripe.checkout.sessions.create(buildFlexiblePackageCheckoutParams({
        attempt,
        learnerEmail: learner.email,
        returnBaseUrl: returnBaseUrl(req, school),
      }), { idempotencyKey });
    } catch (error) {
      const classification = classifyFlexibleStripeError(error);
      const status = classification.ambiguous ? 'review_required' : 'failed';
      const [updated] = await sql`
        UPDATE flexible_package_purchase_attempts
           SET status = ${status}, failure_code = ${classification.ambiguous ? 'STRIPE_RESPONSE_AMBIGUOUS' : classification.code},
               review_required_at = CASE WHEN ${status} = 'review_required' THEN NOW() ELSE NULL END,
               failed_at = CASE WHEN ${status} = 'failed' THEN NOW() ELSE NULL END,
               updated_at = NOW()
         WHERE id = ${attempt.id}::uuid AND school_id = ${scope.schoolId}
         RETURNING *
      `;
      return res.status(classification.ambiguous ? 202 : 502).json({ ok: classification.ambiguous, attempt: publicAttempt(updated) });
    }
    const validation = validateFlexibleProviderObject(attempt, session);
    if (!validation.ok || !/^cs_live_[A-Za-z0-9_]+$/.test(String(session.id || '')) || !session.url) {
      const [updated] = await sql`
        UPDATE flexible_package_purchase_attempts
           SET status = 'review_required', failure_code = 'STRIPE_CHECKOUT_EVIDENCE_MISMATCH',
               review_required_at = NOW(), updated_at = NOW()
         WHERE id = ${attempt.id}::uuid AND school_id = ${scope.schoolId}
         RETURNING *
      `;
      return res.status(202).json({ ok: true, attempt: publicAttempt(updated) });
    }
    const expiresAt = Number.isFinite(Number(session.expires_at))
      ? new Date(Number(session.expires_at) * 1000).toISOString() : null;
    const [pending] = await sql`
      UPDATE flexible_package_purchase_attempts
         SET status = CASE WHEN status = 'submitting' THEN 'pending' ELSE status END,
             stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, ${session.id}),
             stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ${validation.paymentIntentId}),
             stripe_checkout_url = COALESCE(stripe_checkout_url, ${session.url}),
             provider_expires_at = COALESCE(provider_expires_at, ${expiresAt}::timestamptz),
             checkout_created_at = COALESCE(checkout_created_at, NOW()), updated_at = NOW()
       WHERE id = ${attempt.id}::uuid AND school_id = ${scope.schoolId}
         AND status IN ('submitting','pending','paid')
         AND (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id = ${session.id})
         AND (stripe_payment_intent_id IS NULL OR ${validation.paymentIntentId}::text IS NULL
           OR stripe_payment_intent_id = ${validation.paymentIntentId})
       RETURNING *
    `;
    if (!pending) {
      const [current] = await sql`
        SELECT * FROM flexible_package_purchase_attempts
         WHERE id = ${attempt.id}::uuid AND school_id = ${scope.schoolId}
         LIMIT 1
      `;
      if (current) return res.status(202).json({ ok: true, attempt: publicAttempt(current) });
      throw new Error('Flexible Hours Checkout attempt disappeared before local persistence');
    }
    return res.status(201).json({ ok: true, url: session.url, attempt: publicAttempt(pending) });
  } catch (error) {
    if (attempt?.id) {
      await sql`
        UPDATE flexible_package_purchase_attempts
           SET status = 'review_required', failure_code = 'LOCAL_CHECKOUT_RECORD_AMBIGUOUS',
               review_required_at = NOW(), updated_at = NOW()
         WHERE id = ${attempt.id}::uuid AND school_id = ${scope.schoolId} AND status = 'submitting'
      `.catch(() => {});
    }
    reportError('/api/flexible-packages?action=create-checkout', error);
    return errorResponse(res, 500, 'SERVER_ERROR', 'Failed to start Flexible Hours Checkout');
  }
}

async function handleAttemptStatus(req, res) {
  if (req.method !== 'GET') return errorResponse(res, 405, 'METHOD_NOT_ALLOWED', 'GET required');
  const scope = learnerScope(req, res);
  if (!scope) return;
  const attemptId = String(req.query?.attempt_id || '');
  if (!isUuid(attemptId)) return errorResponse(res, 400, 'INVALID_ATTEMPT_ID', 'A valid attempt is required');
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [attempt] = await sql`
      SELECT * FROM flexible_package_purchase_attempts
       WHERE id = ${attemptId}::uuid AND learner_id = ${scope.learner.id}
         AND school_id = ${scope.schoolId} LIMIT 1
    `;
    if (!attempt) return errorResponse(res, 404, 'ATTEMPT_NOT_FOUND', 'Purchase attempt not found');
    const [source] = await sql`
      SELECT source.id, remaining.remaining_units, remaining.refundable_value_pence
        FROM flexible_package_purchases purchase
        JOIN flexible_package_sources source ON source.purchase_id = purchase.id AND source.school_id = ${scope.schoolId}
        JOIN flexible_package_source_remaining remaining ON remaining.source_id = source.id AND remaining.school_id = ${scope.schoolId}
       WHERE purchase.attempt_id = ${attemptId}::uuid AND purchase.school_id = ${scope.schoolId}
         AND purchase.learner_id = ${scope.learner.id} LIMIT 1
    `;
    return res.json({ ok: true, attempt: publicAttempt(attempt), entitlement_created: !!source, source: source || null });
  } catch (error) {
    reportError('/api/flexible-packages?action=attempt-status', error);
    return errorResponse(res, 500, 'SERVER_ERROR', 'Failed to load Flexible Hours status');
  }
}

async function handleAdminOverview(req, res) {
  if (req.method !== 'GET') return errorResponse(res, 405, 'METHOD_NOT_ALLOWED', 'GET required');
  const scope = adminScope(req, res);
  if (!scope) return;
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const purchases = await sql`
      SELECT purchase.id, purchase.learner_id, learner.name AS learner_name, source.id AS source_id,
             purchase.product_slug, purchase.product_version_id, purchase.amount_pence,
             purchase.total_units, purchase.rate_pence_per_unit, purchase.paid_at,
             remaining.remaining_units, remaining.refundable_value_pence
        FROM flexible_package_purchases purchase
        LEFT JOIN learner_users learner ON learner.id = purchase.learner_id AND learner.school_id = ${scope.schoolId}
        JOIN flexible_package_sources source ON source.purchase_id = purchase.id AND source.school_id = ${scope.schoolId}
        JOIN flexible_package_source_remaining remaining ON remaining.source_id = source.id AND remaining.school_id = ${scope.schoolId}
       WHERE purchase.school_id = ${scope.schoolId}
       ORDER BY purchase.paid_at DESC, purchase.id DESC LIMIT 200
    `;
    const allocations = await sql`
      SELECT allocation.id, allocation.booking_id, allocation.learner_id,
             allocation.instructor_id, instructor.name AS instructor_name,
             allocation.units_allocated, allocation.contribution_pence, allocation.created_at,
             (returned.id IS NOT NULL) AS returned
        FROM flexible_package_booking_allocations allocation
        JOIN instructors instructor ON instructor.id = allocation.instructor_id AND instructor.school_id = ${scope.schoolId}
        LEFT JOIN flexible_package_allocation_returns returned
          ON returned.allocation_id = allocation.id AND returned.school_id = ${scope.schoolId}
       WHERE allocation.school_id = ${scope.schoolId}
       ORDER BY allocation.created_at DESC, allocation.id DESC LIMIT 200
    `;
    const exceptions = await sql`
      SELECT id, learner_id, event_type, attempt_id, purchase_id, source_id, booking_id, detail, created_at
        FROM flexible_package_state_events
       WHERE school_id = ${scope.schoolId}
         AND event_type IN ('reconciliation_contradiction','manual_review_required')
       ORDER BY created_at DESC, id DESC LIMIT 200
    `;
    const attemptExceptions = await sql`
      SELECT attempt.id, attempt.learner_id, learner.name AS learner_name,
             attempt.product_slug, attempt.amount_pence,
             CASE
               WHEN attempt.status IN ('created','submitting','pending')
                AND attempt.review_after <= NOW() THEN 'review_required'
               ELSE attempt.status
             END AS operational_status,
             attempt.failure_code, attempt.review_after, attempt.created_at, attempt.updated_at
        FROM flexible_package_purchase_attempts attempt
        LEFT JOIN learner_users learner
          ON learner.id = attempt.learner_id AND learner.school_id = ${scope.schoolId}
       WHERE attempt.school_id = ${scope.schoolId}
         AND (attempt.status = 'review_required'
           OR (attempt.status IN ('created','submitting','pending') AND attempt.review_after <= NOW()))
       ORDER BY attempt.updated_at DESC, attempt.id DESC LIMIT 200
    `;
    const reconciliation = await sql`
      SELECT source.id AS source_id, source.learner_id, source.initial_units,
             COALESCE(reduced.units, 0)::int AS reduced_units,
             COALESCE(spent.units, 0)::int AS spent_units,
             (source.initial_units - COALESCE(reduced.units, 0) - COALESCE(spent.units, 0))::int AS raw_remaining_units,
             ((source.initial_units - COALESCE(reduced.units, 0) - COALESCE(spent.units, 0))
               * source.rate_pence_per_unit)::int AS raw_refundable_value_pence,
             (COALESCE(reduced.units, 0) < 0 OR COALESCE(spent.units, 0) < 0
               OR source.initial_units - COALESCE(reduced.units, 0) - COALESCE(spent.units, 0) < 0) AS contradictory
        FROM flexible_package_sources source
        LEFT JOIN LATERAL (
          SELECT SUM(reduction.units_reduced) AS units
            FROM flexible_package_source_reductions reduction
           WHERE reduction.school_id = source.school_id AND reduction.source_id = source.id
        ) reduced ON TRUE
        LEFT JOIN LATERAL (
          SELECT SUM(allocation.units_allocated) AS units
            FROM flexible_package_booking_allocations allocation
           WHERE allocation.school_id = source.school_id AND allocation.source_id = source.id
             AND NOT EXISTS (
               SELECT 1 FROM flexible_package_allocation_returns returned
                WHERE returned.school_id = allocation.school_id AND returned.allocation_id = allocation.id
             )
        ) spent ON TRUE
       WHERE source.school_id = ${scope.schoolId}
       ORDER BY source.id
    `;
    const reductions = await sql`
      SELECT reduction.id, reduction.learner_id, reduction.source_id, reduction.units_reduced,
             reduction.rate_pence_per_unit, reduction.gross_refund_pence,
             reduction.stripe_fee_deduction_pence, reduction.learner_refund_pence,
             reduction.provider_refund_id, reduction.evidence_reference, reduction.created_at
        FROM flexible_package_source_reductions reduction
       WHERE reduction.school_id = ${scope.schoolId}
       ORDER BY reduction.created_at DESC, reduction.id DESC LIMIT 200
    `;
    return res.json({
      ok: true,
      read_only: true,
      purchases,
      allocations,
      reductions,
      exceptions,
      attempt_exceptions: attemptExceptions,
      reconciliation,
    });
  } catch (error) {
    reportError('/api/flexible-packages?action=admin-overview', error);
    return errorResponse(res, 500, 'SERVER_ERROR', 'Failed to load Flexible Hours operations');
  }
}

async function handleRecordRefundEvidence(req, res) {
  if (req.method !== 'POST') return errorResponse(res, 405, 'METHOD_NOT_ALLOWED', 'POST required');
  const scope = adminScope(req, res);
  if (!scope) return;
  const sourceId = Number(req.body?.source_id);
  const units = Number(req.body?.units);
  const providerRefundId = String(req.body?.provider_refund_id || '').trim();
  const evidenceReference = String(req.body?.evidence_reference || '').trim();
  const reason = String(req.body?.reason || '').trim();
  const requestIp = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0 || !Number.isSafeInteger(units) || units <= 0) {
    return errorResponse(res, 400, 'INVALID_REFUND_REDUCTION', 'A source and positive whole number of 30-minute units are required');
  }
  if (!/^re_[A-Za-z0-9_]+$/.test(providerRefundId)
      || evidenceReference.length < 2 || evidenceReference.length > 500
      || reason.length < 2 || reason.length > 1000) {
    return errorResponse(res, 400, 'INVALID_REFUND_EVIDENCE', 'Valid provider refund evidence and an audit reason are required');
  }
  try {
    const result = await withNeonTransaction(process.env.POSTGRES_URL, async client => {
      const sourceResult = await client.query(
        `SELECT source.id, source.learner_id, source.rate_pence_per_unit,
                purchase.stripe_payment_intent_id,
                GREATEST(0, source.initial_units
                  - COALESCE((SELECT SUM(r.units_reduced) FROM flexible_package_source_reductions r
                               WHERE r.school_id = source.school_id AND r.source_id = source.id), 0)
                  - COALESCE((SELECT SUM(a.units_allocated) FROM flexible_package_booking_allocations a
                               WHERE a.school_id = source.school_id AND a.source_id = source.id
                                 AND NOT EXISTS (SELECT 1 FROM flexible_package_allocation_returns ar
                                                  WHERE ar.school_id = a.school_id AND ar.allocation_id = a.id)), 0)
                )::int AS remaining_units
           FROM flexible_package_sources source
           JOIN flexible_package_purchases purchase
             ON purchase.id = source.purchase_id AND purchase.school_id = source.school_id
          WHERE source.id = $1 AND source.school_id = $2
          FOR UPDATE OF source`,
        [sourceId, scope.schoolId]
      );
      const source = sourceResult.rows[0];
      if (!source) return { ok: false, status: 404, code: 'SOURCE_NOT_FOUND', message: 'Flexible Hours source not found' };
      if (!source.stripe_payment_intent_id) {
        return { ok: false, status: 409, code: 'ORIGINAL_PAYMENT_IDENTITY_MISSING', message: 'The original payment identity requires reconciliation before refund evidence can be recorded' };
      }
      if (units > Number(source.remaining_units)) {
        return { ok: false, status: 409, code: 'REFUND_EXCEEDS_UNUSED_VALUE', message: 'Refund evidence exceeds the unused units on this original payment' };
      }
      const gross = units * Number(source.rate_pence_per_unit);
      const inserted = await client.query(
        `INSERT INTO flexible_package_source_reductions (
           school_id, learner_id, source_id, units_reduced, rate_pence_per_unit,
           gross_refund_pence, stripe_fee_deduction_pence, learner_refund_pence,
           kind, provider_refund_id, evidence_reference, recorded_by_admin_id
         ) VALUES ($1,$2,$3,$4,$5,$6,0,$6,'manual_original_method_refund',$7,$8,$9)
         RETURNING id, source_id, units_reduced, learner_refund_pence, provider_refund_id, created_at`,
        [scope.schoolId, source.learner_id, sourceId, units, source.rate_pence_per_unit,
          gross, providerRefundId, evidenceReference, scope.admin.id]
      );
      await client.query(
        `INSERT INTO flexible_package_state_events (school_id, learner_id, event_type, source_id, detail)
         VALUES ($1,$2,'manual_refund_evidence_recorded',$3,$4::jsonb)`,
        [scope.schoolId, source.learner_id, sourceId, JSON.stringify({
          reduction_id: inserted.rows[0].id,
          units,
          unit_minutes: 30,
          learner_refund_pence: gross,
          provider_refund_id: providerRefundId,
          original_payment_intent_id: source.stripe_payment_intent_id,
          provider_call_made_by_application: false,
          reason,
        })]
      );
      await client.query(
        `INSERT INTO audit_log (
           admin_id, admin_email, action, target_type, target_id, details, ip_address, school_id
         ) VALUES ($1,$2,'package.flexible_refund_evidence_recorded','flexible_package_source',$3,$4::jsonb,$5,$6)`,
        [scope.admin.id, scope.admin.email || null, String(sourceId), JSON.stringify({
          reduction_id: inserted.rows[0].id,
          units,
          learner_refund_pence: gross,
          provider_refund_id: providerRefundId,
          reason,
          provider_call_made_by_application: false,
        }), requestIp, scope.schoolId]
      );
      return { ok: true, reduction: inserted.rows[0] };
    });
    if (!result.ok) return errorResponse(res, result.status, result.code, result.message);
    return res.status(201).json({ ...result, provider_call_made_by_application: false });
  } catch (error) {
    if (error?.code === '23505') return errorResponse(res, 409, 'REFUND_EVIDENCE_ALREADY_RECORDED', 'This provider refund identity has already been recorded');
    reportError('/api/flexible-packages?action=record-refund-evidence', error);
    return errorResponse(res, 500, 'SERVER_ERROR', 'Failed to record Flexible Hours refund evidence');
  }
}

async function handleRefundPreview(req, res) {
  if (req.method !== 'GET') return errorResponse(res, 405, 'METHOD_NOT_ALLOWED', 'GET required');
  const scope = adminScope(req, res);
  if (!scope) return;
  const learnerId = Number(req.query?.learner_id);
  if (!Number.isSafeInteger(learnerId) || learnerId <= 0) return errorResponse(res, 400, 'LEARNER_REQUIRED', 'A learner is required');
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const sources = await sql`
      SELECT remaining.source_id, remaining.purchase_id, remaining.remaining_units,
             remaining.unit_minutes, remaining.rate_pence_per_unit,
             remaining.refundable_value_pence, purchase.product_slug,
             purchase.product_version_id, purchase.customer_terms_version,
             purchase.stripe_payment_intent_id
        FROM flexible_package_source_remaining remaining
        JOIN flexible_package_purchases purchase
          ON purchase.id = remaining.purchase_id AND purchase.school_id = ${scope.schoolId}
       WHERE remaining.school_id = ${scope.schoolId}
         AND remaining.learner_id = ${learnerId}
         AND remaining.remaining_units > 0
       ORDER BY remaining.available_at, remaining.source_id
    `;
    if (!sources.length) return errorResponse(res, 404, 'NO_UNUSED_FLEXIBLE_VALUE', 'No unused Flexible Hours value was found');
    const gross = sources.reduce((sum, row) => sum + Number(row.refundable_value_pence), 0);
    return res.json({
      ok: true,
      read_only: true,
      school_id: scope.schoolId,
      learner_id: learnerId,
      sources,
      gross_refund_pence: gross,
      stripe_fee_customer_deduction_pence: 0,
      learner_refund_pence: gross,
      stripe_fee_absorbed_by: 'coachcarter',
      provider_execution: 'manual_original_payment_method_only',
      trusted_basis: 'immutable_source_rate_and_unused_units',
    });
  } catch (error) {
    reportError('/api/flexible-packages?action=refund-preview', error);
    return errorResponse(res, 500, 'SERVER_ERROR', 'Failed to plan Flexible Hours refund');
  }
}

module.exports = async function handler(req, res) {
  const action = String(req.query?.action || '');
  if (action === 'balance') return handleBalance(req, res);
  if (action === 'create-checkout') return handleCreateCheckout(req, res);
  if (action === 'attempt-status') return handleAttemptStatus(req, res);
  if (action === 'admin-overview') return handleAdminOverview(req, res);
  if (action === 'refund-preview') return handleRefundPreview(req, res);
  if (action === 'record-refund-evidence') return handleRecordRefundEvidence(req, res);
  return errorResponse(res, 400, 'UNKNOWN_ACTION', 'Unknown Flexible Hours action');
};

module.exports._test = { publicAttempt, returnBaseUrl };
