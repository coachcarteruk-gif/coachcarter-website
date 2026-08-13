const { neon } = require('@neondatabase/serverless');
const { requireAuth, getSchoolId, decodeToken, SESSION_COOKIE_NAMES } = require('./_auth');
const { resolveSchoolFromRequest } = require('./_tenant');
const { logAudit } = require('./_audit');
const { reportError } = require('./_error-alert');
const {
  FEATURE_DISABLED_CODE,
  isLearnerPackagesEnabled,
  buildCatalogueEligibility,
} = require('./_learner-packages');

function errorResponse(res, status, code, message) {
  return res.status(status).json({ error: true, code, message });
}

function requireMethod(req, res, method) {
  if (req.method === method) return true;
  errorResponse(res, 405, 'METHOD_NOT_ALLOWED', `${method} required`);
  return false;
}

function getAdmin(req, res) {
  const admin = requireAuth(req, { roles: ['admin'], requireSchool: true });
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
      SELECT id, slug, name, config
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

    return res.json({
      ok: true,
      phase: 'catalogue_only',
      school: { id: schoolRow.id, slug: schoolRow.slug, name: schoolRow.name },
      viewer: {
        signed_in_as_learner: !!sameSchoolLearner,
        learner_id: sameSchoolLearner?.id || null,
      },
      checkout_available: false,
      payment_method: null,
      products: products.map((product) => ({
        ...product,
        eligibility: buildCatalogueEligibility(product),
      })),
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
    return res.json({ ok: true, enabled: isLearnerPackagesEnabled(row?.config) });
  } catch (err) {
    reportError('/api/packages?action=feature-state', err);
    return res.json({ ok: true, enabled: false });
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

    const content = normaliseVersionContent(req.body?.content, product.content);
    const termsVersion = String(req.body?.customer_terms_version || product.customer_terms_version || '').trim();
    if (!content || !termsVersion || termsVersion.length > 120) {
      return errorResponse(res, 400, 'INVALID_VERSION_CONTENT', 'Valid version content and customer terms version are required');
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
      SET visible = CASE WHEN ${hasVisible} THEN ${hasVisible ? req.body.visible : false} ELSE visible END,
          active = CASE WHEN ${hasActive} THEN ${hasActive ? req.body.active : false} ELSE active END,
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

module.exports = async function handler(req, res) {
  const action = req.query.action;
  if (action === 'feature-state') return handleFeatureState(req, res);
  if (action === 'catalogue') return handleCatalogue(req, res);
  if (action === 'admin-list') return handleAdminList(req, res);
  if (action === 'create-version') return handleCreateVersion(req, res);
  if (action === 'update-product') return handleUpdateProduct(req, res);
  if (action === 'set-feature') return handleSetFeature(req, res);
  return errorResponse(res, 400, 'UNKNOWN_ACTION', 'Unknown action');
};

module.exports._test = {
  parsePricePence,
  parseEffectiveFrom,
  normaliseVersionContent,
};
