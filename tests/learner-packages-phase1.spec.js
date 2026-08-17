const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  isLearnerPackagesEnabled,
  buildCatalogueEligibility,
} = require('../api/_learner-packages');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function callPackages(handler, { method = 'GET', action, body = {}, query = {} } = {}) {
  const req = {
    method,
    body,
    query: { action, ...query },
    headers: {},
    url: `/api/packages?action=${action}`,
  };
  const res = makeResponse();
  await handler(req, res);
  return res;
}

function loadPackagesHandler({ sql, admin = null, school = { schoolId: 7 }, session = null, audits = [] }) {
  const moduleEntries = [
    ['@neondatabase/serverless', { neon: () => sql }],
    [path.join(root, 'api', '_auth.js'), {
      requireAuth: () => admin,
      getSchoolId: (actor, req) => actor?.role === 'superadmin'
        ? Number(req?.query?.school_id || req?.body?.school_id)
        : Number(actor?.school_id),
      decodeToken: () => session,
      SESSION_COOKIE_NAMES: { learner: 'cc_learner' },
    }],
    [path.join(root, 'api', '_tenant.js'), { isDevelopmentHost: () => false, resolveSchoolFromRequest: async () => school }],
    [path.join(root, 'api', '_audit.js'), { logAudit: async (_sql, entry) => audits.push(entry) }],
    [path.join(root, 'api', '_error-alert.js'), { reportError: () => {} }],
  ];
  const packagesPath = require.resolve(path.join(root, 'api', 'packages.js'));
  const originals = new Map();
  for (const [request, exports] of moduleEntries) {
    const resolved = require.resolve(request);
    originals.set(resolved, require.cache[resolved]);
    require.cache[resolved] = { exports };
  }
  const originalPackages = require.cache[packagesPath];
  delete require.cache[packagesPath];
  const handler = require(packagesPath);
  for (const [request] of moduleEntries) {
    const resolved = require.resolve(request);
    if (originals.get(resolved)) require.cache[resolved] = originals.get(resolved);
    else delete require.cache[resolved];
  }
  if (originalPackages) require.cache[packagesPath] = originalPackages;
  else delete require.cache[packagesPath];
  return handler;
}

const catalogueProducts = [
  product(1, 'flexible-30-hours', 'flexible_hours', '30-hour flexible package', 165000),
  product(5, 'full-curriculum', 'full_curriculum', 'Full Curriculum Enrolment', 200000),
  product(6, 'manoeuvres', 'manoeuvres', 'Manoeuvres', 15000, null, null, null, 'ordinary'),
  product(7, 'manoeuvres-challenge', 'manoeuvres', 'Manoeuvres Challenge', 15000, null, null, null, 'challenge'),
];

function product(id, slug, productType, name, pricePence, prerequisiteId, prerequisiteSlug, prerequisiteName, variant) {
  const raw = {
    id,
    slug,
    product_type: productType,
    sort_order: id * 10,
    prerequisite_product_id: prerequisiteId || null,
    prerequisite_slug: prerequisiteSlug || null,
    prerequisite_name: prerequisiteName || null,
    product_version_id: id * 100,
    version_number: 1,
    price_pence: pricePence,
    currency: 'GBP',
    content: {
      name,
      short_description: `${name} comparison description.`,
      highlights: ['Server-provided condition one', 'Server-provided condition two'],
      checkout_disclosure: 'Comparison only. Checkout is not available in Phase 1.',
      variant: variant || undefined,
      entitlement: productType === 'flexible_hours' ? { hours: 30, units: 60, unit_minutes: 30, scope: 'school' } : undefined,
    },
    customer_terms_version: 'learner-packages-catalogue-v1-draft',
    effective_from: '2026-08-13T00:00:00.000Z',
  };
  return { ...raw, eligibility: buildCatalogueEligibility(raw) };
}

test.describe('Learner Packages Phase 1 contracts', () => {
  test('strict Boolean feature flag defaults off for missing and malformed values', () => {
    expect(isLearnerPackagesEnabled(undefined)).toBe(false);
    expect(isLearnerPackagesEnabled({})).toBe(false);
    expect(isLearnerPackagesEnabled({ features: {} })).toBe(false);
    expect(isLearnerPackagesEnabled({ features: { learner_packages_enabled: 'true' } })).toBe(false);
    expect(isLearnerPackagesEnabled({ features: { learner_packages_enabled: 1 } })).toBe(false);
    expect(isLearnerPackagesEnabled({ features: { learner_packages_enabled: true } })).toBe(true);
  });

  test('eligibility offers only verified Full Curriculum and treats phases as internal stages', () => {
    const open = buildCatalogueEligibility({ slug: 'flexible-30-hours' });
    expect(open).toMatchObject({
      state: 'visible_not_fulfilled',
      purchase_eligible: false,
      checkout_available: false,
      eligibility_determined: true,
    });

    const locked = buildCatalogueEligibility({
      slug: 'phase-1-fundamental',
    });
    expect(locked).toMatchObject({
      state: 'internal_stage',
      purchase_eligible: false,
      checkout_available: false,
    });
    const curriculum = buildCatalogueEligibility({ slug: 'full-curriculum' }, {
      purchasingEnabled: true, sameSchoolLearner: true,
      testBookingStatus: 'verified', testBookingFuture: true, hasActiveEnrolment: false,
      consumerRightsReady: true, pilotAccessApproved: true,
    });
    expect(curriculum).toMatchObject({ state: 'test_checkout_available', purchase_eligible: true, checkout_available: true });
    expect(buildCatalogueEligibility({ slug: 'full-curriculum' }, {
      purchasingEnabled: true, sameSchoolLearner: true,
      testBookingStatus: 'verified', testBookingFuture: true, hasActiveEnrolment: false,
      consumerRightsReady: true,
    })).toMatchObject({
      state: 'controlled_pilot_access_required', purchase_eligible: false, checkout_available: false,
    });
    expect(buildCatalogueEligibility({ slug: 'full-curriculum' }, {
      purchasingEnabled: true, sameSchoolLearner: true, learnerEmailVerified: false,
      testBookingStatus: 'verified', testBookingFuture: true, hasActiveEnrolment: false,
      consumerRightsReady: true, pilotAccessApproved: true,
    })).toMatchObject({
      state: 'email_verification_required', purchase_eligible: false, checkout_available: false,
    });
  });

  test('schema is school-scoped, indexed, immutable by version, and seeds every approved choice', () => {
    for (const source of [read('db/migration.sql'), read('db/migrations/044_learner_packages_catalogue.sql')]) {
      expect(source).toContain('CREATE TABLE IF NOT EXISTS package_products');
      expect(source).toContain('CREATE TABLE IF NOT EXISTS package_product_versions');
      expect(source).toMatch(/school_id\s+INTEGER NOT NULL DEFAULT 1 REFERENCES schools\(id\)/);
      expect(source).toContain('UNIQUE (id, school_id)');
      expect(source).toContain('FOREIGN KEY (prerequisite_product_id, school_id)');
      expect(source).toContain('FOREIGN KEY (product_id, school_id)');
      expect(source).toContain('idx_package_products_school_catalogue');
      expect(source).toContain('idx_package_products_prerequisite');
      expect(source).toContain('idx_package_versions_effective');
      expect(source).toContain('package_product_versions_immutable');
      expect(source).toContain('BEFORE UPDATE OR DELETE ON package_product_versions');
      expect(source).toContain('SELECT seed_learner_package_catalogue(id) FROM schools');
      expect(source).toContain('AFTER INSERT ON schools');
      for (const slug of [
        'flexible-30-hours', 'phase-1-fundamental', 'phase-2-intermediate',
        'phase-3-independent', 'full-curriculum', 'manoeuvres', 'manoeuvres-challenge',
      ]) expect(source).toContain(`'${slug}'`);
    }
  });

  test('public and admin catalogue APIs retain exact school scope, prospective versions, and audit logs', () => {
    const api = read('api/packages.js');
    expect(api).toContain("resolveSchoolFromRequest(req, {");
    expect(api).toContain('allowLegacySchoolIdQuery: true');
    expect(api).toContain('if (!isLearnerPackagesEnabled(schoolRow.config))');
    expect(api).toContain("requireAuth(req, { roles: ['admin'], requireSchool: false })");
    expect(api).toContain('const schoolId = getSchoolId(admin, req)');
    expect(api).toContain('WHERE p.school_id = ${schoolId}');
    expect(api).toContain('WHERE p.school_id = ${scope.schoolId}');
    expect(api).toContain('WHERE school_id = ${scope.schoolId}');
    expect(api).toContain('AND p.school_id = ${scope.schoolId}');
    expect(api).toContain('INSERT INTO package_product_versions');
    expect(api).toContain('COALESCE((\n          SELECT MAX(v.version_number)');
    expect(api).not.toMatch(/UPDATE\s+package_product_versions/i);
    expect(api).not.toMatch(/DELETE\s+FROM\s+package_product_versions/i);
    expect(api).toContain("action: 'package.create_version'");
    expect(api).toContain("action: 'package.update_product'");
    expect(api).toContain("action: 'package.set_feature'");
    expect(api).toContain('await logAudit(sql');
    expect(api).toContain("'{features,learner_packages_enabled}'");
    expect(api).not.toContain('learner_credit_balances');
    expect(api).not.toContain('recurring_slot_blocks');
  });

  test('public API fails closed and returns only the resolved school catalogue', async () => {
    const calls = [];
    const sql = async (strings, ...values) => {
      const statement = strings.join('?');
      calls.push({ statement, values });
      if (statement.includes('FROM schools')) {
        return [{ id: 7, slug: 'north', name: 'North School', config: { features: { learner_packages_enabled: true } } }];
      }
      if (statement.includes('FROM package_products p')) return [catalogueProducts[0]];
      throw new Error(`Unexpected SQL: ${statement}`);
    };
    const handler = loadPackagesHandler({ sql, school: { schoolId: 7 } });
    const response = await callPackages(handler, { action: 'catalogue' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      phase: 'catalogue_only',
      school: { id: 7, slug: 'north' },
      checkout_available: false,
    });
    expect(response.body.products).toHaveLength(1);
    expect(response.body.products[0].eligibility.purchase_eligible).toBe(false);
    expect(calls.filter((call) => call.statement.includes('package_products')).every((call) => call.values.includes(7))).toBe(true);

    const disabledSql = async (strings) => {
      const statement = strings.join('?');
      if (statement.includes('FROM schools')) return [{ id: 7, config: { features: { learner_packages_enabled: 'true' } } }];
      throw new Error('Disabled catalogue must not query products');
    };
    const disabledHandler = loadPackagesHandler({ sql: disabledSql, school: { schoolId: 7 } });
    const disabled = await callPackages(disabledHandler, { action: 'catalogue' });
    expect(disabled.statusCode).toBe(404);
    expect(disabled.body.code).toBe('LEARNER_PACKAGES_DISABLED');
  });

  test('admin API rejects unauthorised mutation and audits a same-school deactivation', async () => {
    const deniedHandler = loadPackagesHandler({ sql: async () => { throw new Error('SQL must not run'); } });
    const denied = await callPackages(deniedHandler, {
      method: 'POST',
      action: 'update-product',
      body: { product_id: 91, active: false },
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.body.code).toBe('UNAUTHORIZED');

    const audits = [];
    const calls = [];
    const sql = async (strings, ...values) => {
      const statement = strings.join('?');
      calls.push({ statement, values });
      if (statement.includes('UPDATE package_products')) {
        return [{ id: 91, school_id: 7, slug: 'phase-1-fundamental', visible: true, active: false, sort_order: 20 }];
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    };
    const handler = loadPackagesHandler({
      sql,
      admin: { id: 4, email: 'admin@example.test', role: 'admin', school_id: 7 },
      audits,
    });
    const response = await callPackages(handler, {
      method: 'POST',
      action: 'update-product',
      body: { product_id: 91, active: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.product).toMatchObject({ school_id: 7, active: false });
    expect(calls[0].statement).toContain('AND school_id = ?');
    expect(calls[0].values).toContain(7);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'package.update_product', schoolId: 7, targetId: 91 });
  });

  test('superadmin package mutations require and preserve an explicit school scope', async () => {
    const admin = { id: 1, email: 'owner@example.test', role: 'superadmin', school_id: null };
    const scopesHandler = loadPackagesHandler({
      sql: async (strings) => {
        const statement = strings.join('?');
        if (statement.includes('FROM schools')) return [{ id: 7, name: 'North School', slug: 'north' }];
        throw new Error(`Unexpected SQL: ${statement}`);
      },
      admin,
    });
    const scopes = await callPackages(scopesHandler, { action: 'admin-scopes' });
    expect(scopes.statusCode).toBe(200);
    expect(scopes.body).toMatchObject({
      requires_explicit_selection: true,
      schools: [{ id: 7, name: 'North School', slug: 'north' }],
    });

    const missingScopeHandler = loadPackagesHandler({
      sql: async () => { throw new Error('SQL must not run without an explicit school'); },
      admin,
    });
    const missingScope = await callPackages(missingScopeHandler, {
      method: 'POST',
      action: 'set-feature',
      body: { enabled: true },
    });
    expect(missingScope.statusCode).toBe(400);
    expect(missingScope.body.code).toBe('SCHOOL_REQUIRED');

    const calls = [];
    const audits = [];
    const sql = async (strings, ...values) => {
      const statement = strings.join('?');
      calls.push({ statement, values });
      if (statement.includes('UPDATE schools')) {
        return [{ id: 7, config: { features: { learner_packages_enabled: true } } }];
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    };
    const handler = loadPackagesHandler({ sql, admin, audits });
    const response = await callPackages(handler, {
      method: 'POST',
      action: 'set-feature',
      query: { school_id: '7' },
      body: { enabled: true },
    });
    expect(response.statusCode).toBe(200);
    expect(calls[0].values).toContain(7);
    expect(audits[0]).toMatchObject({ action: 'package.set_feature', schoolId: 7 });
  });

  test('admin and learner surfaces expose controls and navigation without changing the fixed mobile tabs', () => {
    const adminHtml = read('public/admin/packages.html');
    const adminJs = read('public/admin/packages.js');
    const sidebar = read('public/sidebar.js');
    const lessons = read('public/learner/lessons.html');
    expect(adminHtml).toContain('Learner Packages catalogue enabled');
    expect(adminHtml).toContain('Products and immutable versions');
    expect(adminJs).toContain('/api/packages?action=create-version');
    expect(adminJs).toContain('/api/packages?action=update-product');
    expect(adminJs).toContain('/api/packages?action=set-feature');
    expect(adminJs).toContain('/api/packages?action=admin-scopes');
    expect(adminJs).toContain("url.searchParams.set('school_id',String(selectedSchoolId))");
    expect(adminHtml).toContain('id="school-scope-control"');
    expect(sidebar).toContain("label: 'Packages', href: '/learner/packages.html', featureGate: 'learner_packages'");
    expect(sidebar).toContain("label: 'Lessons', href: '/learner/book.html'");
    const bottomBar = sidebar.slice(sidebar.indexOf('var bottomSections'), sidebar.indexOf('function getBottomTabs'));
    expect(bottomBar).not.toContain("label: 'Packages'");
    expect(lessons).toContain('data-cc-package-link hidden');
    expect(lessons).toContain('Explore Packages');
  });

  test('page meets project includes, thin-client, disclosure, and accessible eligibility contracts', () => {
    const html = read('public/learner/packages.html');
    const js = read('public/learner/packages.js');
    expect(html).toContain('/sidebar.js');
    expect(html).toContain('/shared/branding.js');
    expect(html).toContain('/cookie-consent.js');
    expect(html).toContain('/posthog-loader.js');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(html).toContain('Book a Pay As You Go lesson');
    expect(html).toContain('Before you buy Flexible Hours');
    expect(html).toContain('You can cancel at any time. We will refund any unused hours at the rate you paid. Hours already used or lost through a late cancellation are not refundable.');
    expect(js).toContain("fetch(apiUrl('catalogue'), { credentials: 'include' })");
    expect(js).toContain("disabled aria-describedby=\"");
    expect(js).toContain("apiUrl('submit-test-booking')");
    expect(js).not.toContain('checkout-slot');
    expect(js).not.toContain('/api/credits');
  });

  test('retired Lesson Credit and Reserved Weekly Slot boundaries stay untouched', () => {
    const credits = read('api/credits.js');
    const buyCredits = read('public/learner/buy-credits.html');
    const packagesApi = read('api/packages.js');
    expect(credits).toContain("code: 'CREDIT_PURCHASE_RETIRED'");
    expect(credits).toContain("if (action === 'checkout')");
    expect(buyCredits).not.toContain('/api/packages');
    expect(packagesApi).not.toContain('STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION');
    expect(packagesApi).not.toContain('api/credits');
  });
});

test.describe('Learner Packages Phase 1 page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cc_cookie_consent', JSON.stringify({ analytics: false, version: 1, timestamp: '2026-08-13T09:00:00.000Z' }));
    });
    await page.route('**/api/packages?action=feature-state**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, enabled: true }),
    }));
  });

  test('renders revised customer choices, internal stages, disabled unimplemented actions, and mobile-safe cross-links', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.route('**/api/packages?action=catalogue**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        phase: 'catalogue_only',
        school: { id: 1, slug: 'coachcarter', name: 'CoachCarter Driving School' },
        checkout_available: false,
        products: catalogueProducts,
      }),
    }));
    await page.goto('/learner/packages.html', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Find the package that fits.' })).toBeVisible();
    await expect(page.locator('.product-shell h3')).toHaveText([
      '30 Flexible Hours', 'Full Curriculum', 'Manoeuvres', 'Manoeuvres Challenge',
    ]);
    await expect(page.locator('.product-price').filter({ hasText: '£1,650' })).toBeVisible();
    await expect(page.locator('.product-price').filter({ hasText: '£2,000' })).toBeVisible();
    await expect(page.getByText(/structured weekly programme/i)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Book a Pay As You Go lesson', exact: true })).toBeVisible();
    await expect(page.locator('[data-cc-feature="learner_packages"]')).toBeVisible();

    const layout = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  });

  test('shows a safe feature-off state with no catalogue or purchase control', async ({ page }) => {
    await page.unroute('**/api/packages?action=feature-state**');
    await page.route('**/api/packages?action=feature-state**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, enabled: false }) }));
    await page.route('**/api/packages?action=catalogue**', (route) => route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: true, code: 'LEARNER_PACKAGES_DISABLED', message: 'Packages are not available for this school' }),
    }));
    await page.goto('/learner/packages.html', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Packages are not available here yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse Pay As You Go Lessons' })).toBeVisible();
    await expect(page.locator('[data-cc-feature="learner_packages"]')).toBeHidden();
    await expect(page.locator('.product-shell')).toHaveCount(0);
  });
});
