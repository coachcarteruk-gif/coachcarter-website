const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const { requireAuth, getSchoolId, decodeToken, SESSION_COOKIE_NAMES } = require('./_auth');
const { isDevelopmentHost, resolveSchoolFromRequest } = require('./_tenant');
const { logAudit } = require('./_audit');
const { reportError } = require('./_error-alert');
const {
  FEATURE_DISABLED_CODE,
  isLearnerPackagesEnabled,
  buildCatalogueEligibility,
} = require('./_learner-packages');
const {
  MAX_PAY_BY_BANK_PENCE,
  MIN_PAY_BY_BANK_PENCE,
  buildPackageCheckoutParams,
  classifyPackageStripeError,
  createPackageTestStripeClient,
  getPackageTestPaymentConfiguration,
  isLearnerPackagePurchasingEnabled,
  isUuid,
  publicAttemptStatus,
  safeFailureCode,
  validateProviderObject,
} = require('./_learner-package-payments');
const {
  ACTIVE_ENROLMENT_STATUSES,
  FULL_CURRICULUM_SLUG,
  INTERNAL_PHASE_SLUGS,
  operationalTimeZone,
} = require('./_full-curriculum');
const { handleFullCurriculumAction } = require('./_full-curriculum-api');
const {
  CHECKOUT_ACKNOWLEDGEMENT,
  CONSUMER_RIGHTS_DISCLOSURE_VERSION,
  DEFERRED_START_REQUEST,
  EARLY_START_REQUEST,
  OWNER_CERTIFIED_TERMS_VERSION,
  PILOT_CERTIFICATION_VERSION,
  buildConsumerContractSnapshot,
  normaliseConsumerRightsConfig,
} = require('./_full-curriculum-consumer-rights');

function ownerCertifiedPilotTermsReady(product) {
  const pilot = product?.content?.controlled_pilot;
  return product?.customer_terms_version === OWNER_CERTIFIED_TERMS_VERSION
    && pilot?.adult_only === true
    && pilot?.one_active_learner_per_school === true
    && pilot?.owner_certification_version === PILOT_CERTIFICATION_VERSION;
}

function errorResponse(res, status, code, message) {
  return res.status(status).json({ error: true, code, message });
}

function requireMethod(req, res, method) {
  if (req.method === method) return true;
  errorResponse(res, 405, 'METHOD_NOT_ALLOWED', `${method} required`);
  return false;
}

function getAdminActor(req, res) {
  const admin = requireAuth(req, { roles: ['admin'], requireSchool: false });
  if (!admin) {
    errorResponse(res, 401, 'UNAUTHORIZED', 'Admin access required');
    return null;
  }
  return admin;
}

function getAdmin(req, res) {
  const admin = getAdminActor(req, res);
  if (!admin) return null;
  const schoolId = getSchoolId(admin, req);
  if (!Number.isSafeInteger(schoolId) || schoolId <= 0) {
    errorResponse(res, 400, 'SCHOOL_REQUIRED', 'A valid school is required');
    return null;
  }
  return { admin, schoolId };
}

function getLearner(req, res) {
  const learner = requireAuth(req, { roles: ['learner'], requireSchool: true });
  if (!learner) {
    errorResponse(res, 401, 'UNAUTHORIZED', 'Learner sign-in required');
    return null;
  }
  const schoolId = getSchoolId(learner, req);
  if (!Number.isSafeInteger(schoolId) || schoolId <= 0) {
    errorResponse(res, 400, 'SCHOOL_REQUIRED', 'A valid school is required');
    return null;
  }
  return { learner, schoolId };
}

function normaliseBaseUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function packageReturnBaseUrl(req, school) {
  const primaryHost = String(school?.primary_host || '').trim().toLowerCase();
  if (/^[a-z0-9.-]+$/.test(primaryHost) && primaryHost.includes('.')) {
    return `https://${primaryHost}`;
  }
  const forwardedHost = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();
  if (isDevelopmentHost(forwardedHost)) {
    const protocol = forwardedHost.includes('localhost') || forwardedHost.startsWith('127.') ? 'http' : 'https';
    return `${protocol}://${forwardedHost}`;
  }
  return normaliseBaseUrl(process.env.BASE_URL) || 'https://coachcarter.uk';
}

function safeAttempt(attempt) {
  const status = publicAttemptStatus(attempt);
  return {
    id: attempt.id,
    status,
    stored_status: attempt.status,
    test_mode: true,
    product: {
      id: attempt.product_id,
      version_id: attempt.product_version_id,
      slug: attempt.product_slug,
      name: attempt.product_name,
    },
    amount_pence: Number(attempt.amount_pence),
    currency: attempt.currency,
    customer_terms_version: attempt.customer_terms_version,
    early_start_requested: typeof attempt.early_start_requested === 'boolean'
      ? attempt.early_start_requested
      : null,
    adult_age_confirmed: attempt.adult_age_confirmed === true,
    created_at: attempt.created_at,
    checkout_created_at: attempt.checkout_created_at,
    provider_expires_at: attempt.provider_expires_at,
    review_after: attempt.review_after,
    paid_at: attempt.paid_at,
    failed_at: attempt.failed_at,
    expired_at: attempt.expired_at,
    review_required_at: attempt.review_required_at,
    failure_code: attempt.failure_code || null,
    message: status === 'paid'
      ? (attempt.product_slug === FULL_CURRICULUM_SLUG
        ? 'Test payment confirmed by Stripe. Fulfilment is still being checked. Do not start another checkout.'
        : 'Test payment confirmed. This package type has no fulfilment in the current foundation.')
      : status === 'review_required'
        ? 'Payment needs review. Please do not start another checkout.'
        : status === 'failed'
          ? 'The test payment failed. It is safe to start a new attempt.'
          : status === 'expired'
            ? 'The test checkout expired. It is safe to start a new attempt.'
            : 'Waiting for Stripe to confirm the test payment. Do not pay again.',
  };
}

async function recordAttemptState(sql, { attemptId, schoolId, fromStatus, toStatus, source, stripeEventId = null, detail = {} }) {
  if (fromStatus === toStatus) return;
  await sql`
    INSERT INTO package_purchase_attempt_state_events (
      school_id, attempt_id, from_status, to_status, source, stripe_event_id, detail
    ) VALUES (
      ${schoolId}, ${attemptId}::uuid, ${fromStatus}, ${toStatus}, ${source},
      ${stripeEventId}, ${JSON.stringify(detail)}::jsonb
    )
  `;
}

async function setAttemptStatus(sql, { attempt, status, failureCode = null, failureMessage = null, detail = {} }) {
  const rows = await sql`
    UPDATE package_purchase_attempts
       SET status = ${status},
           failure_code = ${failureCode},
           failure_message = ${failureMessage},
           failed_at = CASE WHEN ${status} = 'failed' THEN NOW() ELSE failed_at END,
           review_required_at = CASE WHEN ${status} = 'review_required' THEN NOW() ELSE review_required_at END,
           updated_at = NOW()
     WHERE id = ${attempt.id}::uuid
       AND school_id = ${attempt.school_id}
       AND status = ${attempt.status}
     RETURNING *
  `;
  const updated = rows[0];
  if (updated) {
    await recordAttemptState(sql, {
      attemptId: attempt.id,
      schoolId: attempt.school_id,
      fromStatus: attempt.status,
      toStatus: updated.status,
      source: 'checkout_api',
      detail,
    });
  }
  return updated || attempt;
}

function actorType(admin) {
  if (admin.role === 'superadmin') return 'superadmin';
  if (admin.role === 'instructor') return 'instructor_admin';
  return 'admin';
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePricePence(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 999999 ? parsed : null;
}

function parseEffectiveFrom(value) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) return null;
  if (parsed.getTime() < Date.now() - 5 * 60 * 1000) return null;
  return parsed.toISOString();
}

function normaliseVersionContent(value, fallback) {
  if (value === undefined) return fallback;
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const encoded = JSON.stringify(value);
  if (encoded.length > 30000) return null;
  return value;
}

async function loadPublicProducts(sql, schoolId) {
  return sql`
    SELECT
      p.id,
      p.slug,
      p.product_type,
      p.sort_order,
      p.prerequisite_product_id,
      prerequisite.slug AS prerequisite_slug,
      prerequisite_version.content->>'name' AS prerequisite_name,
      version.id AS product_version_id,
      version.version_number,
      version.price_pence,
      version.currency,
      version.content,
      version.customer_terms_version,
      version.effective_from
    FROM package_products p
    JOIN LATERAL (
      SELECT v.*
      FROM package_product_versions v
      WHERE v.school_id = ${schoolId}
        AND v.product_id = p.id
        AND v.effective_from <= NOW()
      ORDER BY v.effective_from DESC, v.version_number DESC
      LIMIT 1
    ) version ON TRUE
    LEFT JOIN package_products prerequisite
      ON prerequisite.id = p.prerequisite_product_id
     AND prerequisite.school_id = ${schoolId}
    LEFT JOIN LATERAL (
      SELECT pv.content
      FROM package_product_versions pv
      WHERE pv.school_id = ${schoolId}
        AND pv.product_id = prerequisite.id
        AND pv.effective_from <= NOW()
      ORDER BY pv.effective_from DESC, pv.version_number DESC
      LIMIT 1
    ) prerequisite_version ON TRUE
    WHERE p.school_id = ${schoolId}
      AND p.active = TRUE
      AND p.visible = TRUE
    ORDER BY p.sort_order, p.id
  `;
}

async function handleCatalogue(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const school = await resolveSchoolFromRequest(req, {
      sql,
      allowLegacySchoolIdQuery: true,
    });
    if (!school) return errorResponse(res, 404, 'SCHOOL_NOT_FOUND', 'School not found');

    const [schoolRow] = await sql`
      SELECT id, slug, name, primary_host, config
      FROM schools
      WHERE id = ${school.schoolId}
        AND active = TRUE
      LIMIT 1
    `;
    if (!schoolRow) return errorResponse(res, 404, 'SCHOOL_NOT_FOUND', 'School not found');
    if (!isLearnerPackagesEnabled(schoolRow.config)) {
      return errorResponse(res, 404, FEATURE_DISABLED_CODE, 'Packages are not available for this school');
    }

    const products = await loadPublicProducts(sql, school.schoolId);
    const session = decodeToken(req, { preferredCookies: [SESSION_COOKIE_NAMES.learner] });
    const role = session?.role || (session ? 'learner' : null);
    const sameSchoolLearner = role === 'learner' && Number(session.school_id || 1) === school.schoolId
      ? session
      : null;
    const purchasingEnabled = isLearnerPackagePurchasingEnabled(schoolRow.config);
    const schoolTimezone = operationalTimeZone(schoolRow.config);
    let latestTestBooking = null;
    let hasActiveEnrolment = false;
    let pilotAccessApproved = false;
    if (sameSchoolLearner) {
      const testBookings = await sql`
        SELECT id, verification_status, test_date, test_time, test_centre, verified_at,
               (((test_date + test_time) AT TIME ZONE ${schoolTimezone}) > NOW()) AS is_future
          FROM full_curriculum_test_bookings
         WHERE school_id = ${school.schoolId}
           AND learner_id = ${sameSchoolLearner.id}
           AND attempt_number = 1
         ORDER BY CASE verification_status WHEN 'verified' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                  created_at DESC
         LIMIT 1
      `;
      latestTestBooking = testBookings[0] || null;
      const active = await sql`
        SELECT id FROM full_curriculum_enrolments
         WHERE school_id = ${school.schoolId}
           AND learner_id = ${sameSchoolLearner.id}
           AND status = ANY(${ACTIVE_ENROLMENT_STATUSES}::text[])
         LIMIT 1
      `;
      hasActiveEnrolment = !!active[0];
      const pilotAccess = await sql`
        SELECT id FROM full_curriculum_pilot_access
         WHERE school_id = ${school.schoolId}
           AND learner_id = ${sameSchoolLearner.id}
           AND certification_version = ${PILOT_CERTIFICATION_VERSION}
           AND active = TRUE
         LIMIT 1
      `;
      pilotAccessApproved = !!pilotAccess[0];
    }

    return res.json({
      ok: true,
      phase: purchasingEnabled ? 'full_curriculum_test_foundation' : 'catalogue_only',
      school: { id: schoolRow.id, slug: schoolRow.slug, name: schoolRow.name },
      viewer: {
        signed_in_as_learner: !!sameSchoolLearner,
        learner_id: sameSchoolLearner?.id || null,
      },
      checkout_available: purchasingEnabled && !!sameSchoolLearner
        && latestTestBooking?.verification_status === 'verified'
        && latestTestBooking?.is_future === true
        && !hasActiveEnrolment
        && pilotAccessApproved
        && products.some(product => product.slug === FULL_CURRICULUM_SLUG
          && normaliseConsumerRightsConfig(product.content, product.price_pence).ok
          && ownerCertifiedPilotTermsReady(product)),
      purchasing_test_enabled: purchasingEnabled,
      payment_method: purchasingEnabled ? 'pay_by_bank_test' : null,
      products: products.map((product) => {
        const consumerRights = normaliseConsumerRightsConfig(product.content, product.price_pence);
        const ownerCertified = ownerCertifiedPilotTermsReady(product);
        return {
          ...product,
          consumer_rights: product.slug === FULL_CURRICULUM_SLUG ? {
            ready: consumerRights.ok && ownerCertified,
            disclosure_version: CONSUMER_RIGHTS_DISCLOSURE_VERSION,
            checkout_acknowledgement: CHECKOUT_ACKNOWLEDGEMENT,
            early_start_request: EARLY_START_REQUEST,
            deferred_start_request: DEFERRED_START_REQUEST,
          } : null,
          eligibility: buildCatalogueEligibility(product, {
          purchasingEnabled,
          sameSchoolLearner: !!sameSchoolLearner,
          testBookingStatus: latestTestBooking?.verification_status || 'missing',
          testBookingFuture: latestTestBooking?.is_future === true,
          hasActiveEnrolment,
          pilotAccessApproved,
          consumerRightsReady: consumerRights.ok && ownerCertified,
          }),
        };
      }),
      full_curriculum_eligibility: {
        test_booking: latestTestBooking,
        has_active_enrolment: hasActiveEnrolment,
        controlled_pilot_access: pilotAccessApproved,
      },
    });
  } catch (err) {
    reportError('/api/packages?action=catalogue', err);
    return errorResponse(res, 500, 'SERVER_ERROR', 'Failed to load the package catalogue');
  }
}

async function handleFeatureState(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const school = await resolveSchoolFromRequest(req, {
      sql,
      allowLegacySchoolIdQuery: true,
    });
    if (!school) return res.json({ ok: true, enabled: false });
    const [row] = await sql`
      SELECT config
      FROM schools
      WHERE id = ${school.schoolId}
        AND active = TRUE
      LIMIT 1
    `;
    return res.json({
      ok: true,
      enabled: isLearnerPackagesEnabled(row?.config),
      purchasing_test_enabled: isLearnerPackagePurchasingEnabled(row?.config),
    });
  } catch (err) {
    reportError('/api/packages?action=feature-state', err);
    return res.json({ ok: true, enabled: false, purchasing_test_enabled: false });
  }
}

async function handleAdminScopes(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  const admin = getAdminActor(req, res);
  if (!admin) return;
  const isSuperadmin = admin.role === 'superadmin';
  const schoolId = isSuperadmin ? null : getSchoolId(admin, req);
  if (!isSuperadmin && (!Number.isSafeInteger(schoolId) || schoolId <= 0)) {
    return errorResponse(res, 400, 'SCHOOL_REQUIRED', 'A valid school is required');
  }
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const schools = isSuperadmin
      ? await sql`
          SELECT id, name, slug
          FROM schools
          WHERE active = TRUE
          ORDER BY name, id
        `
      : await sql`
          SELECT id, name, slug
          FROM schools
          WHERE id = ${schoolId}
            AND active = TRUE
          LIMIT 1
        `;
    return res.json({
      ok: true,
      requires_explicit_selection: isSuperadmin,
      schools,
    });
  } catch (err) {
    reportError('/api/packages?action=admin-scopes', err);
    return errorResponse(res, 500, 'SERVER_ERROR', 'Failed to load package school scopes');
  }
}

async function handleAdminList(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  const scope = getAdmin(req, res);
  if (!scope) return;
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [school] = await sql`
      SELECT id, name, slug, config
      FROM schools
      WHERE id = ${scope.schoolId}
      LIMIT 1
    `;
    if (!school) return errorResponse(res, 404, 'SCHOOL_NOT_FOUND', 'School not found');
    const products = await sql`
      SELECT p.id, p.slug, p.product_type, p.prerequisite_product_id,
             prerequisite.slug AS prerequisite_slug,
             p.visible, p.active, p.sort_order, p.created_at, p.updated_at
      FROM package_products p
      LEFT JOIN package_products prerequisite
        ON prerequisite.id = p.prerequisite_product_id
       AND prerequisite.school_id = ${scope.schoolId}
      WHERE p.school_id = ${scope.schoolId}
      ORDER BY p.sort_order, p.id
    `;
    const versions = await sql`
      SELECT id, product_id, version_number, price_pence, currency, content,
             customer_terms_version, effective_from, created_by_actor_type,
             created_by_actor_id, created_at
      FROM package_product_versions
      WHERE school_id = ${scope.schoolId}
      ORDER BY product_id, effective_from DESC, version_number DESC
    `;
    return res.json({
      ok: true,
      feature_enabled: isLearnerPackagesEnabled(school.config),
      purchasing_test_enabled: isLearnerPackagePurchasingEnabled(school.config),
      school: { id: school.id, name: school.name, slug: school.slug },
      products: products.map((product) => ({
        ...product,
        versions: versions.filter((version) => Number(version.product_id) === Number(product.id)),
      })),
    });
  } catch (err) {
    reportError('/api/packages?action=admin-list', err);
    return errorResponse(res, 500, 'SERVER_ERROR', 'Failed to load package administration');
  }
}

async function handleCreateVersion(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  const scope = getAdmin(req, res);
  if (!scope) return;
  const productId = parsePositiveInteger(req.body?.product_id);
  const pricePence = parsePricePence(req.body?.price_pence);
  const effectiveFrom = parseEffectiveFrom(req.body?.effective_from);
  if (!productId || !pricePence || !effectiveFrom) {
    return errorResponse(res, 400, 'INVALID_VERSION', 'product_id, a valid GBP price, and a current or future effective_from are required');
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const [product] = await sql`
      SELECT p.id, p.slug,
             current.content,
             current.customer_terms_version
      FROM package_products p
      LEFT JOIN LATERAL (
        SELECT v.content, v.customer_terms_version
        FROM package_product_versions v
        WHERE v.product_id = p.id
          AND v.school_id = ${scope.schoolId}
        ORDER BY v.version_number DESC
        LIMIT 1
      ) current ON TRUE
      WHERE p.id = ${productId}
        AND p.school_id = ${scope.schoolId}
    `;
    if (!product) return errorResponse(res, 404, 'PRODUCT_NOT_FOUND', 'Package product not found');
    if (INTERNAL_PHASE_SLUGS.includes(product.slug)) {
      return errorResponse(res, 409, 'INTERNAL_PHASE_NOT_PURCHASABLE', 'Internal Full Curriculum phases cannot receive new customer-facing price versions');
    }

    const content = normaliseVersionContent(req.body?.content, product.content);
    const termsVersion = String(req.body?.customer_terms_version || product.customer_terms_version || '').trim();
    if (!content || !termsVersion || termsVersion.length > 120) {
      return errorResponse(res, 400, 'INVALID_VERSION_CONTENT', 'Valid version content and customer terms version are required');
    }
    if (product.slug === FULL_CURRICULUM_SLUG) {
      const consumerRights = normaliseConsumerRightsConfig(content, pricePence);
      if (!consumerRights.ok) {
        return errorResponse(res, 400, consumerRights.code, 'Full Curriculum versions require approved purchase-price teaching, retake and assessment allocations whose caps do not exceed the package price');
      }
    }

    const rows = await sql`
      INSERT INTO package_product_versions (
        school_id, product_id, version_number, price_pence, currency, content,
        customer_terms_version, effective_from, created_by_actor_type, created_by_actor_id
      )
      SELECT
        ${scope.schoolId},
        p.id,
        COALESCE((
          SELECT MAX(v.version_number)
          FROM package_product_versions v
          WHERE v.school_id = ${scope.schoolId}
            AND v.product_id = p.id
        ), 0) + 1,
        ${pricePence},
        'GBP',
        ${JSON.stringify(content)}::jsonb,
        ${termsVersion},
        ${effectiveFrom}::timestamptz,
        ${actorType(scope.admin)},
        ${scope.admin.id}
      FROM package_products p
      WHERE p.id = ${productId}
        AND p.school_id = ${scope.schoolId}
      RETURNING *
    `;
    const version = rows[0];
    if (!version) return errorResponse(res, 404, 'PRODUCT_NOT_FOUND', 'Package product not found');
    await logAudit(sql, {
      adminId: scope.admin.id,
      adminEmail: scope.admin.email,
      action: 'package.create_version',
      targetType: 'package_product',
      targetId: productId,
      details: {
        slug: product.slug,
        version_id: version.id,
        version_number: version.version_number,
        price_pence: version.price_pence,
        effective_from: version.effective_from,
      },
      schoolId: scope.schoolId,
      req,
    });
    return res.status(201).json({ ok: true, version });
  } catch (err) {
    if (err.code === '23505') {
      return errorResponse(res, 409, 'VERSION_CONFLICT', 'Another version was created at the same time; reload and try again');
    }
    reportError('/api/packages?action=create-version', err);
    return errorResponse(res, 500, 'SERVER_ERROR', 'Failed to create package version');
  }
}

async function handleUpdateProduct(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  const scope = getAdmin(req, res);
  if (!scope) return;
  const productId = parsePositiveInteger(req.body?.product_id);
  const hasVisible = typeof req.body?.visible === 'boolean';
  const hasActive = typeof req.body?.active === 'boolean';
  const sortOrder = Number(req.body?.sort_order);
  const hasSortOrder = Number.isSafeInteger(sortOrder) && sortOrder >= 0 && sortOrder <= 10000;
  if (!productId || (!hasVisible && !hasActive && !hasSortOrder)) {
    return errorResponse(res, 400, 'INVALID_PRODUCT_UPDATE', 'product_id and at least one valid visibility, active, or sort-order change are required');
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`
      UPDATE package_products
      SET visible = CASE WHEN slug = ANY(${INTERNAL_PHASE_SLUGS}::text[]) THEN FALSE
                         WHEN ${hasVisible} THEN ${hasVisible ? req.body.visible : false} ELSE visible END,
          active = CASE WHEN slug = ANY(${INTERNAL_PHASE_SLUGS}::text[]) THEN FALSE
                        WHEN ${hasActive} THEN ${hasActive ? req.body.active : false} ELSE active END,
          sort_order = CASE WHEN ${hasSortOrder} THEN ${hasSortOrder ? sortOrder : 0} ELSE sort_order END,
          updated_at = NOW()
      WHERE id = ${productId}
        AND school_id = ${scope.schoolId}
      RETURNING *
    `;
    const product = rows[0];
    if (!product) return errorResponse(res, 404, 'PRODUCT_NOT_FOUND', 'Package product not found');
    await logAudit(sql, {
      adminId: scope.admin.id,
      adminEmail: scope.admin.email,
      action: 'package.update_product',
      targetType: 'package_product',
      targetId: productId,
      details: {
        visible: product.visible,
        active: product.active,
        sort_order: product.sort_order,
      },
      schoolId: scope.schoolId,
      req,
    });
    return res.json({ ok: true, product });
  } catch (err) {
    reportError('/api/packages?action=update-product', err);
    return errorResponse(res, 500, 'SERVER_ERROR', 'Failed to update package product');
  }
}

async function handleSetFeature(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  const scope = getAdmin(req, res);
  if (!scope) return;
  if (typeof req.body?.enabled !== 'boolean') {
    return errorResponse(res, 400, 'BOOLEAN_REQUIRED', 'enabled must be a Boolean');
  }
  const enabled = req.body.enabled;
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`
      UPDATE schools
      SET config = jsonb_set(
            jsonb_set(
              CASE WHEN jsonb_typeof(COALESCE(config, '{}'::jsonb)) = 'object'
                   THEN COALESCE(config, '{}'::jsonb)
                   ELSE '{}'::jsonb
              END,
              '{features}',
              CASE WHEN jsonb_typeof(config->'features') = 'object'
                   THEN config->'features'
                   ELSE '{}'::jsonb
              END,
              TRUE
            ),
            '{features,learner_packages_enabled}',
            ${JSON.stringify(enabled)}::jsonb,
            TRUE
          ),
          updated_at = NOW()
      WHERE id = ${scope.schoolId}
      RETURNING id, config
    `;
    if (!rows.length) return errorResponse(res, 404, 'SCHOOL_NOT_FOUND', 'School not found');
    await logAudit(sql, {
      adminId: scope.admin.id,
      adminEmail: scope.admin.email,
      action: 'package.set_feature',
      targetType: 'school',
      targetId: scope.schoolId,
      details: { learner_packages_enabled: enabled },
      schoolId: scope.schoolId,
      req,
    });
    return res.json({ ok: true, feature_enabled: isLearnerPackagesEnabled(rows[0].config) });
  } catch (err) {
    reportError('/api/packages?action=set-feature', err);
    return errorResponse(res, 500, 'SERVER_ERROR', 'Failed to update the learner Packages feature');
  }
}

async function handleSetPurchasingFeature(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  const scope = getAdmin(req, res);
  if (!scope) return;
  if (typeof req.body?.enabled !== 'boolean') {
    return errorResponse(res, 400, 'BOOLEAN_REQUIRED', 'enabled must be a Boolean');
  }
  const enabled = req.body.enabled;
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`
      UPDATE schools
      SET config = jsonb_set(
            jsonb_set(
              CASE WHEN jsonb_typeof(COALESCE(config, '{}'::jsonb)) = 'object'
                   THEN COALESCE(config, '{}'::jsonb)
                   ELSE '{}'::jsonb
              END,
              '{features}',
              CASE WHEN jsonb_typeof(config->'features') = 'object'
                   THEN config->'features'
                   ELSE '{}'::jsonb
              END,
              TRUE
            ),
            '{features,learner_package_purchasing_test_enabled}',
            ${JSON.stringify(enabled)}::jsonb,
            TRUE
          ),
          updated_at = NOW()
      WHERE id = ${scope.schoolId}
      RETURNING id, config
    `;
    if (!rows.length) return errorResponse(res, 404, 'SCHOOL_NOT_FOUND', 'School not found');
    await logAudit(sql, {
      adminId: scope.admin.id,
      adminEmail: scope.admin.email,
      action: 'package.set_purchasing_feature',
      targetType: 'school',
      targetId: scope.schoolId,
      details: { learner_package_purchasing_test_enabled: enabled },
      schoolId: scope.schoolId,
      req,
    });
    return res.json({
      ok: true,
      purchasing_test_enabled: isLearnerPackagePurchasingEnabled(rows[0].config),
    });
  } catch (err) {
    reportError('/api/packages?action=set-purchasing-feature', err);
    return errorResponse(res, 500, 'SERVER_ERROR', 'Failed to update test package purchasing');
  }
}

async function loadOwnedAttempt(sql, { attemptId, learnerId, schoolId }) {
  const rows = await sql`
    SELECT *
      FROM package_purchase_attempts
     WHERE id = ${attemptId}::uuid
       AND learner_id = ${learnerId}
       AND school_id = ${schoolId}
     LIMIT 1
  `;
  return rows[0] || null;
}

async function handleAttemptStatus(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  const scope = getLearner(req, res);
  if (!scope) return;
  const attemptId = String(req.query?.attempt_id || '').trim();
  if (!isUuid(attemptId)) {
    return errorResponse(res, 400, 'INVALID_ATTEMPT_ID', 'A valid purchase attempt is required');
  }
  try {
    const sql = neon(process.env.POSTGRES_URL);
    const attempt = await loadOwnedAttempt(sql, {
      attemptId,
      learnerId: scope.learner.id,
      schoolId: scope.schoolId,
    });
    // Ownership and cross-tenant misses intentionally share one response.
    if (!attempt) return errorResponse(res, 404, 'ATTEMPT_NOT_FOUND', 'Purchase attempt not found');
    const fulfilment = await sql`
      SELECT e.id, e.status, e.current_phase, e.matching_deadline,
             e.programme_start_at, e.base_entitlement_end_at,
             e.approved_entitlement_end_at
        FROM learner_package_purchases p
        JOIN full_curriculum_enrolments e
          ON e.purchase_id = p.id AND e.school_id = ${scope.schoolId}
       WHERE p.attempt_id = ${attemptId}::uuid
         AND p.school_id = ${scope.schoolId}
         AND p.learner_id = ${scope.learner.id}
       LIMIT 1
    `;
    return res.json({ ok: true, attempt: safeAttempt(attempt), fulfilment_created: !!fulfilment[0], enrolment: fulfilment[0] || null });
  } catch (err) {
    reportError('/api/packages?action=attempt-status', err);
    return errorResponse(res, 500, 'SERVER_ERROR', 'Failed to load purchase status');
  }
}

async function findExistingAttempt(sql, { clientRequestId, learnerId, schoolId, productId }) {
  const byRequest = await sql`
    SELECT a.*, evidence.early_start_requested, evidence.disclosure_version,
           evidence.adult_age_confirmed
      FROM package_purchase_attempts a
      LEFT JOIN full_curriculum_consumer_contract_evidence evidence
        ON evidence.attempt_id = a.id AND evidence.school_id = ${schoolId}
     WHERE a.school_id = ${schoolId}
       AND a.learner_id = ${learnerId}
       AND a.client_request_id = ${clientRequestId}::uuid
     LIMIT 1
  `;
  if (byRequest[0]) return byRequest[0];
  const active = await sql`
    SELECT a.*, evidence.early_start_requested, evidence.disclosure_version,
           evidence.adult_age_confirmed
      FROM package_purchase_attempts a
      LEFT JOIN full_curriculum_consumer_contract_evidence evidence
        ON evidence.attempt_id = a.id AND evidence.school_id = ${schoolId}
     WHERE a.school_id = ${schoolId}
       AND a.learner_id = ${learnerId}
       AND a.product_id = ${productId}
       AND a.status IN ('created', 'submitting', 'pending', 'paid', 'review_required')
     ORDER BY a.created_at DESC
     LIMIT 1
  `;
  return active[0] || null;
}

function existingAttemptResponse(res, attempt, requestedProductId, earlyStartRequested, disclosureVersion, adultAgeConfirmed) {
  if (Number(attempt.product_id) !== Number(requestedProductId)) {
    return errorResponse(res, 409, 'IDEMPOTENCY_SCOPE_MISMATCH', 'This request identity belongs to another package');
  }
  if (attempt.early_start_requested !== earlyStartRequested
      || attempt.adult_age_confirmed !== adultAgeConfirmed
      || attempt.disclosure_version !== disclosureVersion) {
    return errorResponse(res, 409, 'IDEMPOTENCY_CONSENT_MISMATCH', 'This checkout identity belongs to a different recorded start choice or disclosure version');
  }
  const response = { ok: true, reused: true, attempt: safeAttempt(attempt) };
  if (attempt.status === 'pending' && attempt.stripe_checkout_url) {
    return res.status(200).json({ ...response, url: attempt.stripe_checkout_url });
  }
  if (['created', 'submitting', 'pending', 'review_required'].includes(attempt.status)) {
    return res.status(202).json(response);
  }
  if (attempt.status === 'paid') {
    return res.status(202).json({
      ...response,
      code: 'PACKAGE_PAYMENT_ALREADY_CONFIRMED',
      fulfilment_pending: true,
    });
  }
  return res.status(409).json(response);
}

async function handleCreateCheckout(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  const scope = getLearner(req, res);
  if (!scope) return;
  const productId = parsePositiveInteger(req.body?.product_id);
  const clientRequestId = String(req.body?.client_request_id || '').trim().toLowerCase();
  const termsAccepted = req.body?.consumer_terms_accepted === true;
  const adultAgeConfirmed = req.body?.adult_age_confirmed === true;
  const earlyStartRequested = req.body?.early_start_requested;
  const disclosureVersion = String(req.body?.disclosure_version || '').trim();
  if (!productId || !isUuid(clientRequestId)) {
    return errorResponse(res, 400, 'INVALID_CHECKOUT_REQUEST', 'product_id and a valid client_request_id are required');
  }
  if (!termsAccepted || !adultAgeConfirmed || typeof earlyStartRequested !== 'boolean'
      || disclosureVersion !== CONSUMER_RIGHTS_DISCLOSURE_VERSION) {
    return errorResponse(res, 400, 'CONSUMER_RIGHTS_ACKNOWLEDGEMENT_REQUIRED', 'Confirm you are 18 or over, accept the current terms and make an explicit programme-start choice');
  }

  let stripe;
  let paymentMethodConfiguration;
  try {
    stripe = createPackageTestStripeClient();
    paymentMethodConfiguration = getPackageTestPaymentConfiguration();
  } catch (err) {
    return errorResponse(
      res,
      503,
      err.code || 'PACKAGE_TEST_STRIPE_NOT_CONFIGURED',
      'Test-mode Pay by Bank is not configured. No purchase attempt was created.'
    );
  }

  const sql = neon(process.env.POSTGRES_URL);
  let attempt;
  try {
    const [school] = await sql`
      SELECT id, name, slug, primary_host, config
        FROM schools
       WHERE id = ${scope.schoolId}
         AND active = TRUE
       LIMIT 1
    `;
    if (!school) return errorResponse(res, 404, 'SCHOOL_NOT_FOUND', 'School not found');
    if (!isLearnerPackagesEnabled(school.config)) {
      return errorResponse(res, 404, FEATURE_DISABLED_CODE, 'Packages are not available for this school');
    }
    if (!isLearnerPackagePurchasingEnabled(school.config)) {
      return errorResponse(res, 404, 'PACKAGE_TEST_PURCHASING_DISABLED', 'Package purchasing is not enabled for this school');
    }

    const [learner] = await sql`
      SELECT id, email, name, email_verified
        FROM learner_users
       WHERE id = ${scope.learner.id}
         AND school_id = ${scope.schoolId}
       LIMIT 1
    `;
    if (!learner || learner.email_verified !== true || !learner.email) {
      return errorResponse(res, 403, 'VERIFIED_LEARNER_REQUIRED', 'A verified same-school learner email is required');
    }

    const products = await sql`
      SELECT p.id AS product_id, p.slug AS product_slug, p.product_type,
             p.prerequisite_product_id,
             v.id AS product_version_id, v.version_number, v.price_pence,
             v.currency, v.content, v.customer_terms_version, v.effective_from
        FROM package_products p
        JOIN LATERAL (
          SELECT pv.*
            FROM package_product_versions pv
           WHERE pv.school_id = ${scope.schoolId}
             AND pv.product_id = p.id
             AND pv.effective_from <= NOW()
           ORDER BY pv.effective_from DESC, pv.version_number DESC
           LIMIT 1
        ) v ON TRUE
       WHERE p.id = ${productId}
         AND p.school_id = ${scope.schoolId}
         AND p.active = TRUE
         AND p.visible = TRUE
       LIMIT 1
    `;
    const product = products[0];
    if (!product) return errorResponse(res, 404, 'PRODUCT_NOT_FOUND', 'Package product not found');
    if (product.product_slug !== FULL_CURRICULUM_SLUG) {
      return errorResponse(res, 409, 'PACKAGE_FULFILMENT_UNAVAILABLE', 'Only Full Curriculum has approved test-mode fulfilment in this foundation');
    }
    const amountPence = Number(product.price_pence);
    if (!Number.isSafeInteger(amountPence) || amountPence < MIN_PAY_BY_BANK_PENCE || amountPence > MAX_PAY_BY_BANK_PENCE) {
      return errorResponse(res, 409, 'PACKAGE_AMOUNT_UNSUPPORTED', 'This package amount is outside the approved Pay by Bank test range');
    }
    if (product.currency !== 'GBP') {
      return errorResponse(res, 409, 'PACKAGE_CURRENCY_UNSUPPORTED', 'Only GBP package versions are supported');
    }
    const content = product.content && typeof product.content === 'object' && !Array.isArray(product.content)
      ? product.content
      : null;
    const productName = String(content?.name || '').trim();
    if (!content || !productName) {
      return errorResponse(res, 409, 'PACKAGE_VERSION_INVALID', 'The active package version is incomplete');
    }
    const consumerRights = normaliseConsumerRightsConfig(content, amountPence);
    if (!consumerRights.ok) {
      return errorResponse(res, 409, consumerRights.code, 'Full Curriculum purchasing is blocked until the approved consumer-rights values are configured in an immutable product version');
    }
    if (!ownerCertifiedPilotTermsReady({ ...product, content })) {
      return errorResponse(res, 409, 'OWNER_CERTIFIED_TERMS_REQUIRED', 'Full Curriculum controlled-pilot purchasing requires the exact owner-certified prospective terms version');
    }
    const contractEvidence = buildConsumerContractSnapshot({
      amountPence,
      currency: product.currency,
      customerTermsVersion: product.customer_terms_version,
      config: consumerRights.config,
      earlyStartRequested,
      adultAgeConfirmed,
    });
    const schoolTimezone = operationalTimeZone(school.config);

    const verifiedBookings = await sql`
      SELECT id, test_date, test_time, test_centre, verified_at,
             (test_date + test_time) AT TIME ZONE ${schoolTimezone} AS test_at
        FROM full_curriculum_test_bookings
       WHERE school_id = ${scope.schoolId}
         AND learner_id = ${scope.learner.id}
         AND attempt_number = 1
         AND verification_status = 'verified'
         AND ((test_date + test_time) AT TIME ZONE ${schoolTimezone}) > NOW()
       ORDER BY verified_at DESC, id DESC
       LIMIT 1
    `;
    const verifiedTestBooking = verifiedBookings[0];
    if (!verifiedTestBooking) {
      return errorResponse(res, 409, 'VERIFIED_FUTURE_TEST_REQUIRED', 'A manually verified future DVSA practical car test booking is required');
    }
    const activeEnrolments = await sql`
      SELECT id FROM full_curriculum_enrolments
       WHERE school_id = ${scope.schoolId}
         AND learner_id = ${scope.learner.id}
         AND status = ANY(${ACTIVE_ENROLMENT_STATUSES}::text[])
       LIMIT 1
    `;
    if (activeEnrolments[0]) {
      return errorResponse(res, 409, 'ACTIVE_FULL_CURRICULUM_EXISTS', 'This learner already has an active Full Curriculum enrolment');
    }
    const pilotAccess = await sql`
      SELECT id FROM full_curriculum_pilot_access
       WHERE school_id = ${scope.schoolId}
         AND learner_id = ${scope.learner.id}
         AND certification_version = ${PILOT_CERTIFICATION_VERSION}
         AND active = TRUE
       LIMIT 1
    `;
    if (!pilotAccess[0]) {
      return errorResponse(res, 403, 'CONTROLLED_PILOT_ACCESS_REQUIRED', 'Full Curriculum purchasing is limited to the learner approved for the controlled pilot');
    }

    const attemptId = crypto.randomUUID();
    const idempotencyKey = `cc-package-test-checkout-${attemptId}`;
    const inserted = await sql`
      INSERT INTO package_purchase_attempts (
        id, school_id, learner_id, product_id, product_version_id,
        product_slug, product_name, product_description, product_snapshot,
        amount_pence, currency, customer_terms_version, stripe_mode, status,
        client_request_id, idempotency_key, full_curriculum_test_booking_id,
        eligibility_snapshot, stripe_payment_method_configuration_id
      ) VALUES (
        ${attemptId}::uuid, ${scope.schoolId}, ${scope.learner.id},
        ${product.product_id}, ${product.product_version_id}, ${product.product_slug},
        ${productName}, ${String(content.short_description || '')},
        ${JSON.stringify(content)}::jsonb, ${amountPence}, 'GBP',
        ${product.customer_terms_version}, 'test', 'created',
        ${clientRequestId}::uuid, ${idempotencyKey}, ${verifiedTestBooking.id},
        ${JSON.stringify({
          verification_status: 'verified',
          verified_at: verifiedTestBooking.verified_at,
          test_date: verifiedTestBooking.test_date,
          test_time: verifiedTestBooking.test_time,
           test_centre: verifiedTestBooking.test_centre,
           test_at: verifiedTestBooking.test_at,
           timezone: schoolTimezone,
           checked_at: new Date().toISOString(),
        })}::jsonb, ${paymentMethodConfiguration}
      )
      ON CONFLICT (school_id, learner_id, client_request_id) DO NOTHING
      RETURNING *
    `;
    attempt = inserted[0];
    if (!attempt) {
      const existing = await findExistingAttempt(sql, {
        clientRequestId,
        learnerId: scope.learner.id,
        schoolId: scope.schoolId,
        productId,
      });
      if (!existing) throw new Error('Purchase attempt conflict could not be resolved safely');
      return existingAttemptResponse(res, existing, productId, earlyStartRequested, disclosureVersion, adultAgeConfirmed);
    }
    await recordAttemptState(sql, {
      attemptId: attempt.id,
      schoolId: scope.schoolId,
      fromStatus: null,
      toStatus: 'created',
      source: 'checkout_api',
      detail: { test_mode: true },
    });
    await sql`
      WITH evidence AS (
        INSERT INTO full_curriculum_consumer_contract_evidence (
          school_id, attempt_id, learner_id, customer_terms_version,
          policy_version, disclosure_version, refund_calculation_version,
          disclosure_snapshot, disclosure_sha256,
          checkout_acknowledgement_sha256, early_start_requested,
          adult_age_confirmed, start_request_text, start_request_sha256, actor_type, actor_id,
          acknowledged_at
        ) VALUES (
          ${scope.schoolId}, ${attempt.id}::uuid, ${scope.learner.id},
          ${product.customer_terms_version}, ${consumerRights.config.policyVersion},
          ${consumerRights.config.disclosureVersion},
          ${consumerRights.config.refundCalculationVersion},
          ${JSON.stringify(contractEvidence.snapshot)}::jsonb,
          ${contractEvidence.snapshotSha256},
          ${contractEvidence.acknowledgementSha256}, ${earlyStartRequested}, TRUE,
          ${contractEvidence.snapshot.start_request_text},
          ${contractEvidence.startRequestSha256}, 'learner', ${scope.learner.id}, NOW()
        )
        ON CONFLICT (school_id, attempt_id) DO NOTHING
        RETURNING id
      )
      INSERT INTO full_curriculum_contract_events (
        school_id, attempt_id, event_type, actor_type, actor_id, detail, occurred_at
      )
      SELECT ${scope.schoolId}, ${attempt.id}::uuid, 'checkout_evidence_recorded',
             'system', NULL,
             jsonb_build_object(
               'disclosure_version', ${consumerRights.config.disclosureVersion}::text,
               'early_start_requested', ${earlyStartRequested}::boolean
             ), NOW()
        FROM evidence
      ON CONFLICT DO NOTHING
    `;

    const claimed = await sql`
      UPDATE package_purchase_attempts
         SET status = 'submitting', submission_started_at = NOW(), updated_at = NOW()
       WHERE id = ${attempt.id}::uuid
         AND school_id = ${scope.schoolId}
         AND status = 'created'
       RETURNING *
    `;
    if (!claimed[0]) {
      const existing = await loadOwnedAttempt(sql, {
        attemptId: attempt.id,
        learnerId: scope.learner.id,
        schoolId: scope.schoolId,
      });
      return existingAttemptResponse(res, existing, productId, earlyStartRequested, disclosureVersion, adultAgeConfirmed);
    }
    await recordAttemptState(sql, {
      attemptId: attempt.id,
      schoolId: scope.schoolId,
      fromStatus: 'created',
      toStatus: 'submitting',
      source: 'checkout_api',
    });
    attempt = claimed[0];

    const checkoutParams = buildPackageCheckoutParams({
      attempt,
      learnerEmail: learner.email,
      returnBaseUrl: packageReturnBaseUrl(req, school),
      paymentMethodConfiguration,
    });

    let session;
    try {
      session = await stripe.checkout.sessions.create(checkoutParams, {
        idempotencyKey: attempt.idempotency_key,
      });
    } catch (stripeError) {
      const classification = classifyPackageStripeError(stripeError);
      const status = classification.ambiguous ? 'review_required' : 'failed';
      attempt = await setAttemptStatus(sql, {
        attempt,
        status,
        failureCode: classification.ambiguous ? 'STRIPE_RESPONSE_AMBIGUOUS' : classification.code,
        failureMessage: classification.ambiguous
          ? 'Stripe response was ambiguous; exact reconciliation is required before retry.'
          : 'Stripe rejected the Checkout creation request.',
        detail: { provider_request_id: classification.requestId },
      });
      return res.status(classification.ambiguous ? 202 : 502).json({
        ok: classification.ambiguous,
        attempt: safeAttempt(attempt),
      });
    }

    const validation = validateProviderObject(attempt, session);
    if (!validation.ok || !/^cs_test_[A-Za-z0-9_]+$/.test(String(session.id || '')) || !session.url) {
      attempt = await setAttemptStatus(sql, {
        attempt,
        status: 'review_required',
        failureCode: 'STRIPE_CHECKOUT_EVIDENCE_MISMATCH',
        failureMessage: 'Stripe Checkout evidence did not match the durable attempt.',
        detail: { contradictions: validation.contradictions },
      });
      return res.status(202).json({ ok: true, attempt: safeAttempt(attempt) });
    }

    const providerExpiresAt = Number.isFinite(Number(session.expires_at))
      ? new Date(Number(session.expires_at) * 1000).toISOString()
      : null;
    const pendingRows = await sql`
      UPDATE package_purchase_attempts
         SET status = 'pending',
             stripe_checkout_session_id = ${session.id},
             stripe_payment_intent_id = ${validation.paymentIntentId},
             stripe_checkout_url = ${session.url},
             provider_expires_at = ${providerExpiresAt}::timestamptz,
             checkout_created_at = NOW(),
             updated_at = NOW()
       WHERE id = ${attempt.id}::uuid
         AND school_id = ${scope.schoolId}
         AND status = 'submitting'
       RETURNING *
    `;
    if (!pendingRows[0]) {
      const current = await loadOwnedAttempt(sql, {
        attemptId: attempt.id,
        learnerId: scope.learner.id,
        schoolId: scope.schoolId,
      });
      return res.status(202).json({ ok: true, attempt: safeAttempt(current) });
    }
    await recordAttemptState(sql, {
      attemptId: attempt.id,
      schoolId: scope.schoolId,
      fromStatus: 'submitting',
      toStatus: 'pending',
      source: 'checkout_api',
      detail: { checkout_session_attached: true },
    });
    return res.status(201).json({
      ok: true,
      url: session.url,
      attempt: safeAttempt(pendingRows[0]),
    });
  } catch (err) {
    if (err.code === '23505' && attempt == null) {
      try {
        const existing = await findExistingAttempt(sql, {
          clientRequestId,
          learnerId: scope.learner.id,
          schoolId: scope.schoolId,
          productId,
        });
        if (existing) return existingAttemptResponse(res, existing, productId, earlyStartRequested, disclosureVersion, adultAgeConfirmed);
      } catch (_) {}
    }
    if (attempt && attempt.status === 'submitting') {
      try {
        attempt = await setAttemptStatus(sql, {
          attempt,
          status: 'review_required',
          failureCode: 'LOCAL_CHECKOUT_RECORD_AMBIGUOUS',
          failureMessage: 'Checkout may exist but local evidence could not be completed.',
        });
        return res.status(202).json({ ok: true, attempt: safeAttempt(attempt) });
      } catch (_) {}
    }
    if (attempt && attempt.status === 'created') {
      try {
        attempt = await setAttemptStatus(sql, {
          attempt,
          status: 'failed',
          failureCode: 'CONTRACT_EVIDENCE_WRITE_FAILED',
          failureMessage: 'The required consumer-contract evidence could not be completed.',
        });
      } catch (_) {}
    }
    reportError('/api/packages?action=create-checkout', err);
    return errorResponse(res, 500, 'SERVER_ERROR', 'Failed to start test package checkout');
  }
}

async function handleAttemptDiagnostics(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  const scope = getAdmin(req, res);
  if (!scope) return;
  const attemptId = req.query?.attempt_id ? String(req.query.attempt_id).trim() : null;
  if (attemptId && !isUuid(attemptId)) {
    return errorResponse(res, 400, 'INVALID_ATTEMPT_ID', 'A valid purchase attempt is required');
  }
  try {
    const sql = neon(process.env.POSTGRES_URL);
    if (!attemptId) {
      const rows = await sql`
        SELECT id, learner_id, product_id, product_version_id, product_name,
               amount_pence, currency, status, created_at, review_after,
               stripe_checkout_session_id IS NOT NULL AS has_checkout_identity,
               stripe_payment_intent_id IS NOT NULL AS has_payment_intent_identity,
               failure_code
          FROM package_purchase_attempts
         WHERE school_id = ${scope.schoolId}
           AND (
             status = 'review_required'
             OR (status IN ('submitting', 'pending') AND review_after <= NOW())
           )
         ORDER BY review_after, created_at
         LIMIT 100
      `;
      return res.json({
        ok: true,
        read_only: true,
        review_required: rows.map(row => ({ ...row, status: publicAttemptStatus(row) })),
      });
    }

    const rows = await sql`
      SELECT * FROM package_purchase_attempts
       WHERE id = ${attemptId}::uuid
         AND school_id = ${scope.schoolId}
       LIMIT 1
    `;
    const attempt = rows[0];
    if (!attempt) return errorResponse(res, 404, 'ATTEMPT_NOT_FOUND', 'Purchase attempt not found');
    if (!attempt.stripe_checkout_session_id) {
      return res.json({
        ok: true,
        read_only: true,
        attempt: safeAttempt(attempt),
        diagnostic: {
          state: 'review_required',
          code: 'NO_EXACT_PROVIDER_IDENTITY',
          safe_to_retry: false,
        },
      });
    }
    let stripe;
    try {
      stripe = createPackageTestStripeClient();
    } catch (err) {
      return errorResponse(res, 503, err.code || 'PACKAGE_TEST_STRIPE_NOT_CONFIGURED', 'Test Stripe diagnostics are not configured');
    }
    const session = await stripe.checkout.sessions.retrieve(attempt.stripe_checkout_session_id);
    const validation = validateProviderObject(attempt, session);
    let state = 'provider_pending';
    if (!validation.ok) state = 'review_required';
    else if (session.payment_status === 'paid') state = attempt.status === 'paid' ? 'consistent_paid' : 'proven_paid_local_not_paid';
    else if (session.status === 'expired') state = attempt.status === 'expired' ? 'consistent_expired' : 'provider_expired_local_not_expired';
    return res.json({
      ok: true,
      read_only: true,
      attempt: safeAttempt(attempt),
      diagnostic: {
        state,
        safe_to_retry: validation.ok && session.status === 'expired' && session.payment_status !== 'paid',
        provider: {
          object_type: 'checkout.session',
          livemode: session.livemode === true,
          status: session.status,
          payment_status: session.payment_status,
          amount_matches: Number(session.amount_total) === Number(attempt.amount_pence),
          currency_matches: String(session.currency || '').toUpperCase() === attempt.currency,
        },
        contradictions: validation.contradictions,
      },
    });
  } catch (err) {
    reportError('/api/packages?action=attempt-diagnostics', err);
    return errorResponse(res, 500, safeFailureCode(err.code, 'PACKAGE_DIAGNOSTIC_FAILED'), 'Failed to inspect package payment evidence');
  }
}

module.exports = async function handler(req, res) {
  const action = req.query.action;
  if (await handleFullCurriculumAction(req, res)) return;
  if (action === 'feature-state') return handleFeatureState(req, res);
  if (action === 'catalogue') return handleCatalogue(req, res);
  if (action === 'admin-scopes') return handleAdminScopes(req, res);
  if (action === 'admin-list') return handleAdminList(req, res);
  if (action === 'create-version') return handleCreateVersion(req, res);
  if (action === 'update-product') return handleUpdateProduct(req, res);
  if (action === 'set-feature') return handleSetFeature(req, res);
  if (action === 'set-purchasing-feature') return handleSetPurchasingFeature(req, res);
  if (action === 'create-checkout') return handleCreateCheckout(req, res);
  if (action === 'attempt-status') return handleAttemptStatus(req, res);
  if (action === 'attempt-diagnostics') return handleAttemptDiagnostics(req, res);
  return errorResponse(res, 400, 'UNKNOWN_ACTION', 'Unknown action');
};

module.exports._test = {
  parsePricePence,
  parseEffectiveFrom,
  normaliseVersionContent,
  packageReturnBaseUrl,
  safeAttempt,
};
