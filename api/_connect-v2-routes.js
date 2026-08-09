'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { requireAuth, getSchoolId } = require('./_auth');
const { logAuditRequired } = require('./_audit');
const {
  classifyStripeError,
  createAccountsV2StripeClient,
  createPlatformStripeClient,
  STRIPE_CLIENT_PURPOSES,
} = require('./_stripe-clients');
const core = require('./_connect-v2');
const store = require('./_connect-v2-store');

const V2_ACTIONS = new Set([
  'v2-account', 'v2-onboarding-link', 'v2-onboarding-refresh',
  'v2-onboarding-return', 'v2-status', 'v2-dashboard-link',
  'v2-agreements', 'v2-agreement-accept', 'v2-admin-readiness',
  'v2-admin-agreement-draft', 'v2-admin-agreement-activate',
]);

class ConnectV2Error extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ConnectV2Error';
    this.status = status;
    this.code = code;
  }
}

function refuse(status, code, message) {
  throw new ConnectV2Error(status, code, message);
}

function positiveInt(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) refuse(400, 'INVALID_REQUEST', `${name} is invalid`);
  return number;
}

function safeText(value, { min = 1, max = 120, pattern = /^[\w .:/@+-]+$/ } = {}) {
  const text = String(value || '').trim();
  if (text.length < min || text.length > max || !pattern.test(text)) refuse(400, 'INVALID_REQUEST', 'Request value is invalid');
  return text;
}

function expectedMode(env) {
  if (env.STRIPE_MODE !== 'test' && env.STRIPE_MODE !== 'live') {
    refuse(503, 'CONNECT_V2_INACTIVE', 'Accounts v2 is not configured');
  }
  return env.STRIPE_MODE;
}

function requestIp(req) {
  return String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

function auditEntry(req, user, schoolId, action, targetType, targetId, details = {}) {
  const isAdminActor = user.role === 'admin' || user.role === 'superadmin' || user.isAdmin === true;
  return {
    adminId: isAdminActor ? user.id : null,
    adminEmail: user.email || null,
    action,
    targetType,
    targetId: String(targetId),
    details: { ...details, actor_role: user.role || 'instructor', actor_user_id: user.id },
    schoolId,
    req,
  };
}

function hydrateObservation(row) {
  const summary = row?.requirements_summary || {};
  const evidence = row?.evidence_json || {};
  return row ? {
    ...row,
    livemode: evidence.livemode,
    applied_configurations: evidence.applied_configurations,
    recipient_applied: evidence.recipient_applied,
    identity_country: evidence.identity_country,
    fees_collector: evidence.fees_collector,
    losses_collector: evidence.losses_collector,
    requirements: summary.current,
    future_requirements: summary.future,
    state_fingerprint: evidence.state_fingerprint,
    observed_at: new Date(row.observed_at).toISOString(),
  } : null;
}

function validateMappedScope(scope, { schoolId, instructorId, mode }) {
  if (!scope) refuse(409, 'CONNECT_V2_ACCOUNT_MISSING', 'No Accounts v2 account is mapped');
  if (Number(scope.school_id) !== Number(schoolId) || Number(scope.instructor_id) !== Number(instructorId) || scope.owner_type !== 'instructor') {
    refuse(403, 'CONNECT_V2_SCOPE_MISMATCH', 'Account scope does not match');
  }
  if (scope.evidence_json?.configuration_type !== 'recipient' || scope.evidence_json?.dashboard_type !== 'express') {
    refuse(409, 'CONNECT_V2_MAPPING_UNSUPPORTED', 'Mapped account is not the reviewed recipient/Express configuration');
  }
  if (!/^[0-9a-f-]{36}$/i.test(scope.evidence_json?.creation_intent_id || '')) refuse(409, 'CONNECT_V2_MAPPING_EVIDENCE_MISSING', 'Mapped account identity evidence is incomplete');
  if (scope.evidence_json?.stable_identity !== core.makeStableIdentity({ schoolId, instructorId, mode })) refuse(409, 'CONNECT_V2_MAPPING_EVIDENCE_MISMATCH', 'Mapped account identity evidence does not match');
  if (scope.evidence_json?.stripe_mode !== mode) refuse(409, 'CONNECT_V2_MODE_MISMATCH', 'Mapped account mode does not match');
  return scope;
}

function validateProviderAccount(account, { schoolId, instructorId, intentId, expectedIntentId, mode, expectedAccountId = null }) {
  if (!account || account.object !== 'v2.core.account' || !/^acct_[A-Za-z0-9]+$/.test(account.id || '')) refuse(502, 'CONNECT_V2_PROVIDER_CONTRACT_INVALID', 'Stripe returned an invalid account response');
  if (expectedAccountId && account.id !== expectedAccountId) refuse(409, 'CONNECT_V2_PROVIDER_IDENTITY_MISMATCH', 'Stripe account identity does not match');
  if (account.livemode !== (mode === 'live')) refuse(409, 'CONNECT_V2_MODE_MISMATCH', 'Stripe account mode does not match');
  const metadata = account.metadata || {};
  const requiredIntentId = intentId || expectedIntentId;
  if (requiredIntentId && (metadata.cc_connect_intent_id !== String(requiredIntentId) || metadata.cc_school_id !== String(schoolId) || metadata.cc_instructor_id !== String(instructorId) || metadata.cc_stable_identity !== core.makeStableIdentity({ schoolId, instructorId, mode }))) {
    refuse(409, 'CONNECT_V2_PROVIDER_IDENTITY_MISMATCH', 'Stripe account ownership metadata does not match');
  }
  if (!account.applied_configurations?.includes('recipient') || account.configuration?.recipient?.applied !== true || account.dashboard !== 'express') {
    refuse(409, 'CONNECT_V2_PROVIDER_CONFIGURATION_MISMATCH', 'Stripe account is not a recipient with Express dashboard access');
  }
  return account;
}

async function findReconciliationMatches(stripe, intent) {
  const matches = [];
  const page = stripe.v2.core.accounts.list({ applied_configurations: ['recipient'], limit: 100 });
  if (page && typeof page[Symbol.asyncIterator] === 'function') {
    for await (const account of page) {
      if (account?.metadata?.cc_stable_identity === intent.stable_identity) matches.push(account);
      if (matches.length > 1) break;
    }
  } else {
    const resolved = await page;
    for (const account of resolved?.data || []) {
      if (account?.metadata?.cc_stable_identity === intent.stable_identity) matches.push(account);
    }
    if (resolved?.next_page_url) refuse(409, 'CONNECT_V2_RECONCILIATION_INCOMPLETE', 'Account reconciliation requires operator review');
  }
  return matches;
}

async function observeAccount(sql, scope, account, options = {}) {
  const observation = core.normalizeAccountObservation({
    account,
    schoolId: scope.school_id,
    instructorId: scope.instructor_id,
    connectScopeId: scope.id,
    expectedAccountId: scope.stripe_account_id,
    ...options,
  });
  await store.insertObservation(sql, observation);
  return observation;
}

async function loadReadiness(sql, { schoolId, instructorId, mode }) {
  const [scope, rows, agreement] = await Promise.all([
    store.loadInstructorScope(sql, { schoolId, instructorId }),
    store.loadObservations(sql, { schoolId, instructorId }),
    store.loadCurrentAgreement(sql, { schoolId, instructorId }),
  ]);
  const observations = rows.map(hydrateObservation);
  return {
    scope,
    agreement,
    observations,
    readiness: core.evaluateReadiness({ schoolId, instructorId, expectedMode: mode, scope, observations, agreement }),
  };
}

function defaultDependencies() {
  const env = process.env;
  let sql;
  return {
    env,
    getSql: () => {
      if (sql) return sql;
      if (!env.POSTGRES_URL) return null;
      sql = neon(env.POSTGRES_URL);
      return sql;
    },
    createAccountsClient: (mode) => createAccountsV2StripeClient({ expectedMode: mode }),
    createDashboardClient: (mode) => createPlatformStripeClient({ purpose: STRIPE_CLIENT_PURPOSES.CONNECT_V1, expectedMode: mode }),
    now: () => new Date(),
  };
}

async function gateFor(sql, env, schoolId, operation) {
  const school = await store.loadSchoolConfig(sql, schoolId);
  if (!school) refuse(404, 'SCHOOL_NOT_FOUND', 'School not found');
  const gate = core.evaluateConnectV2Gate({ env, schoolConfig: school.config, operation });
  if (!gate.enabled) refuse(503, 'CONNECT_V2_INACTIVE', 'Accounts v2 operation is inactive');
  return gate;
}

async function reconcileIntent({ sql, stripe, intent, schoolId, instructorId, mode }) {
  const matches = await findReconciliationMatches(stripe, intent);
  const outcome = matches.length === 0 ? 'reconcile_no_match' : matches.length === 1 ? 'reconciled_existing' : 'reconcile_multiple_matches';
  await store.recordCreationAttempt(sql, { schoolId, instructorId, intentId: intent.id, outcome, providerAccountId: matches[0]?.id || null, evidence: { match_count: matches.length } });
  if (matches.length === 0) return { state: 'reconciling', account: null };
  if (matches.length > 1) {
    await store.setCreationIntentState(sql, { schoolId, instructorId, intentId: intent.id, state: 'manual_review', expectedStates: ['submitting', 'reconciling'] });
    return { state: 'manual_review', account: null };
  }
  const account = validateProviderAccount(matches[0], { schoolId, instructorId, intentId: intent.id, mode });
  const scope = await store.registerAccountScope(sql, { schoolId, instructorId, accountId: account.id, mode, intentId: intent.id });
  await store.setCreationIntentState(sql, { schoolId, instructorId, intentId: intent.id, state: 'succeeded', providerAccountId: account.id, connectScopeId: scope.id, expectedStates: ['submitting', 'reconciling'] });
  await observeAccount(sql, scope, account, { eventType: 'api.creation_reconciliation' });
  return { state: 'succeeded', account, scope };
}

function createConnectV2Handler(overrides = {}) {
  const deps = { ...defaultDependencies(), ...overrides };
  let sqlResolved = false;
  let resolvedSql;
  const getSql = () => {
    if (!sqlResolved) {
      resolvedSql = Object.prototype.hasOwnProperty.call(deps, 'sql')
        ? deps.sql
        : deps.getSql();
      sqlResolved = true;
    }
    return resolvedSql;
  };

  return async function handleConnectV2(req, res) {
    const action = req.query?.action;
    if (!V2_ACTIONS.has(action)) return false;
    try {
      const env = deps.env;
      const instructorOnly = !action.startsWith('v2-admin-');
      const requiredRoles = action === 'v2-admin-agreement-activate' ? ['superadmin'] : instructorOnly ? ['instructor'] : ['admin'];
      const user = requireAuth(req, { roles: requiredRoles, requireSchool: true });
      if (!user) {
        res.status(401).json({ error: true, code: 'AUTH_REQUIRED', message: 'Not authenticated' });
        return true;
      }
      const schoolId = getSchoolId(user, req);
      if (!schoolId) refuse(403, 'SCHOOL_SCOPE_REQUIRED', 'A school scope is required');
      const instructorId = instructorOnly ? positiveInt(user.id, 'instructor') : positiveInt(req.query?.instructor_id || req.body?.instructor_id, 'instructor_id');
      const sql = getSql();
      if (!sql) refuse(503, 'CONNECT_V2_DATABASE_UNAVAILABLE', 'Accounts v2 database is unavailable');
      const mode = expectedMode(env);

      if (action === 'v2-status') {
        if (req.method !== 'GET') refuse(405, 'METHOD_NOT_ALLOWED', 'GET required');
        const school = await store.loadSchoolConfig(sql, schoolId);
        const gate = core.evaluateConnectV2Gate({ env, schoolConfig: school?.config, operation: 'status' });
        const agreementGate = core.evaluateConnectV2Gate({ env, schoolConfig: school?.config, operation: 'agreement' });
        const model = await loadReadiness(sql, { schoolId, instructorId, mode });
        res.status(200).json({ version: 2, active: gate.enabled, agreement_actions_active: agreementGate.enabled, gate_blockers: gate.blockers, ...model.readiness });
        return true;
      }

      if (action === 'v2-account') {
        if (req.method !== 'POST') refuse(405, 'METHOD_NOT_ALLOWED', 'POST required');
        const context = await store.loadSchoolAndInstructor(sql, { schoolId, instructorId });
        if (!context) refuse(404, 'INSTRUCTOR_NOT_FOUND', 'Instructor not found');
        await gateFor(sql, env, schoolId, 'account_create');
        const existingScope = await store.loadInstructorScope(sql, { schoolId, instructorId });
        if (existingScope) {
          validateMappedScope(existingScope, { schoolId, instructorId, mode });
          await logAuditRequired(sql, auditEntry(req, user, schoolId, 'connect_v2.account_retrieved', 'instructor', instructorId, { connect_scope_id: existingScope.id, stripe_mode: mode }));
          const mappedAccount = await deps.createAccountsClient(mode).v2.core.accounts.retrieve(existingScope.stripe_account_id, {
            include: ['configuration.recipient', 'defaults', 'identity', 'requirements', 'future_requirements'],
          });
          validateProviderAccount(mappedAccount, { schoolId, instructorId, mode, expectedAccountId: existingScope.stripe_account_id, expectedIntentId: existingScope.evidence_json.creation_intent_id });
          await observeAccount(sql, existingScope, mappedAccount, { eventType: 'api.account_retrieved' });
          const mappedIntent = await store.loadCreationIntent(sql, { schoolId, instructorId, mode });
          if (mappedIntent && ['submitting', 'reconciling'].includes(mappedIntent.state)) {
            await store.setCreationIntentState(sql, { schoolId, instructorId, intentId: mappedIntent.id, state: 'succeeded', providerAccountId: existingScope.stripe_account_id, connectScopeId: existingScope.id, expectedStates: ['submitting', 'reconciling'] });
          }
          res.status(200).json({ version: 2, state: 'existing', has_account: true });
          return true;
        }
        const intentId = crypto.randomUUID();
        const commandFacts = core.makeCreationCommand({ schoolId, instructorId, mode, intentId });
        await logAuditRequired(sql, auditEntry(req, user, schoolId, 'connect_v2.account_create_requested', 'instructor', instructorId, { stable_identity: commandFacts.stableIdentity, request_fingerprint: commandFacts.requestFingerprint, stripe_mode: mode }));
        const intent = await store.ensureCreationIntent(sql, { ...commandFacts, intentId, schoolId, instructorId, mode, actorId: user.id });
        const expectedIntent = intent && core.makeCreationCommand({ schoolId, instructorId, mode, intentId: intent.id });
        if (!intent || intent.stable_identity !== expectedIntent.stableIdentity || intent.idempotency_key !== expectedIntent.idempotencyKey || intent.request_fingerprint !== expectedIntent.requestFingerprint) refuse(409, 'CONNECT_V2_INTENT_CONFLICT', 'Creation identity requires operator review');
        if (intent.state === 'succeeded') {
          res.status(200).json({ version: 2, state: 'existing', has_account: true });
          return true;
        }
        if (['submitting', 'reconciling'].includes(intent.state)) {
          const reconciled = await reconcileIntent({ sql, stripe: deps.createAccountsClient(mode), intent, schoolId, instructorId, mode });
          res.status(reconciled.state === 'succeeded' ? 200 : 202).json({ version: 2, state: reconciled.state, has_account: reconciled.state === 'succeeded' });
          return true;
        }
        if (intent.state !== 'planned') refuse(409, 'CONNECT_V2_MANUAL_REVIEW', 'Creation identity requires operator review');
        const claimed = await store.claimCreationIntent(sql, { schoolId, instructorId, intentId: intent.id });
        if (!claimed) refuse(409, 'CONNECT_V2_INTENT_BUSY', 'Creation identity is already being processed');
        const stripe = deps.createAccountsClient(mode);
        let account;
        try {
          account = await stripe.v2.core.accounts.create(buildCreateParams(context, intent, mode), { idempotencyKey: intent.idempotency_key });
          validateProviderAccount(account, { schoolId, instructorId, intentId: intent.id, mode });
        } catch (error) {
          if (error instanceof ConnectV2Error) {
            await store.setCreationIntentState(sql, { schoolId, instructorId, intentId: intent.id, state: 'manual_review', expectedStates: ['submitting'] });
            throw error;
          }
          const classification = classifyStripeError(error);
          const outcome = core.classifyCreationOutcome(classification);
          const state = outcome === 'provider_ambiguous' ? 'reconciling' : 'failed_confirmed';
          await store.recordCreationAttempt(sql, { schoolId, instructorId, intentId: intent.id, outcome, providerRequestId: classification.requestId, errorClass: classification.category, evidence: { retryable: classification.retryable, provider_code: classification.code } });
          await store.setCreationIntentState(sql, { schoolId, instructorId, intentId: intent.id, state, errorClass: classification.category, expectedStates: ['submitting'] });
          if (state === 'reconciling') {
            res.status(202).json({ version: 2, state: 'reconciling', has_account: false });
            return true;
          }
          refuse(502, 'CONNECT_V2_PROVIDER_REJECTED', 'Stripe rejected the account request');
        }
        await store.recordCreationAttempt(sql, { schoolId, instructorId, intentId: intent.id, outcome: 'provider_succeeded', providerAccountId: account.id, providerRequestId: account.lastResponse?.requestId || null, evidence: { livemode: account.livemode } });
        const scope = await store.registerAccountScope(sql, { schoolId, instructorId, accountId: account.id, mode, intentId: intent.id });
        await store.setCreationIntentState(sql, { schoolId, instructorId, intentId: intent.id, state: 'succeeded', providerAccountId: account.id, connectScopeId: scope.id, expectedStates: ['submitting'] });
        await observeAccount(sql, scope, account, { eventType: 'api.account_created' });
        res.status(201).json({ version: 2, state: 'created', has_account: true });
        return true;
      }

      if (action === 'v2-onboarding-link' || action === 'v2-onboarding-refresh') {
        if (!['POST', 'GET'].includes(req.method) || (action === 'v2-onboarding-link' && req.method !== 'POST')) refuse(405, 'METHOD_NOT_ALLOWED', 'Invalid method');
        const context = await store.loadSchoolAndInstructor(sql, { schoolId, instructorId });
        if (!context) refuse(404, 'INSTRUCTOR_NOT_FOUND', 'Instructor not found');
        await gateFor(sql, env, schoolId, 'account_link');
        const scope = validateMappedScope(await store.loadInstructorScope(sql, { schoolId, instructorId }), { schoolId, instructorId, mode });
        if (action === 'v2-onboarding-refresh') {
          core.verifyOnboardingState(req.query?.state, { schoolId, instructorId, scopeId: scope.id, accountId: scope.stripe_account_id, mode, secret: env.JWT_SECRET });
          await logAuditRequired(sql, auditEntry(req, user, schoolId, 'connect_v2.onboarding_refresh', 'instructor', instructorId, { connect_scope_id: scope.id, stripe_mode: mode }));
          const refreshEvidence = await store.recordLinkEvent(sql, { schoolId, instructorId, scopeId: scope.id, accountId: scope.stripe_account_id, action: 'refresh_validated', token: req.query.state });
          if (!refreshEvidence) refuse(409, 'CONNECT_V2_STATE_REPLAY', 'Onboarding refresh state has already been used');
        }
        const token = core.signOnboardingState({ schoolId, instructorId, scopeId: scope.id, accountId: scope.stripe_account_id, mode, nonce: crypto.randomUUID(), secret: env.JWT_SECRET });
        const baseUrl = String(env.BASE_URL || 'https://coachcarter.uk').replace(/\/$/, '');
        const state = encodeURIComponent(token);
        const params = { account: scope.stripe_account_id, use_case: { type: 'account_onboarding', account_onboarding: { configurations: ['recipient'], collection_options: { fields: 'eventually_due', future_requirements: 'include' }, refresh_url: `${baseUrl}/api/connect?action=v2-onboarding-refresh&state=${state}`, return_url: `${baseUrl}/api/connect?action=v2-onboarding-return&state=${state}` } } };
        await logAuditRequired(sql, auditEntry(req, user, schoolId, 'connect_v2.account_link_created', 'instructor', instructorId, { connect_scope_id: scope.id, stripe_mode: mode }));
        const link = await deps.createAccountsClient(mode).v2.core.accountLinks.create(params);
        if (link?.object !== 'v2.core.account_link' || link.account !== scope.stripe_account_id || link.livemode !== (mode === 'live') || typeof link.url !== 'string') refuse(502, 'CONNECT_V2_PROVIDER_CONTRACT_INVALID', 'Stripe returned an invalid Account Link');
        await store.recordLinkEvent(sql, { schoolId, instructorId, scopeId: scope.id, accountId: scope.stripe_account_id, action: 'created', token, expiresAt: link.expires_at || null });
        if (action === 'v2-onboarding-refresh' && !String(req.headers?.accept || '').includes('application/json')) {
          res.statusCode = 303; res.setHeader('Location', link.url); res.end(); return true;
        }
        res.status(200).json({ version: 2, url: link.url, expires_at: link.expires_at || null });
        return true;
      }

      if (action === 'v2-onboarding-return') {
        if (req.method !== 'GET') refuse(405, 'METHOD_NOT_ALLOWED', 'GET required');
        const scope = validateMappedScope(await store.loadInstructorScope(sql, { schoolId, instructorId }), { schoolId, instructorId, mode });
        core.verifyOnboardingState(req.query?.state, { schoolId, instructorId, scopeId: scope.id, accountId: scope.stripe_account_id, mode, secret: env.JWT_SECRET });
        await gateFor(sql, env, schoolId, 'status');
        await logAuditRequired(sql, auditEntry(req, user, schoolId, 'connect_v2.onboarding_return', 'instructor', instructorId, { connect_scope_id: scope.id, stripe_mode: mode }));
        const returnEvidence = await store.recordLinkEvent(sql, { schoolId, instructorId, scopeId: scope.id, accountId: scope.stripe_account_id, action: 'return_validated', token: req.query.state });
        if (!returnEvidence) refuse(409, 'CONNECT_V2_STATE_REPLAY', 'Onboarding return state has already been used');
        const account = await deps.createAccountsClient(mode).v2.core.accounts.retrieve(scope.stripe_account_id, { include: ['configuration.recipient', 'defaults', 'identity', 'requirements', 'future_requirements'] });
        validateProviderAccount(account, { schoolId, instructorId, mode, expectedAccountId: scope.stripe_account_id, expectedIntentId: scope.evidence_json.creation_intent_id });
        await observeAccount(sql, scope, account, { eventType: 'api.onboarding_return' });
        if (!String(req.headers?.accept || '').includes('application/json')) {
          res.statusCode = 303; res.setHeader('Location', '/instructor/earnings.html?connect_v2=returned'); res.end(); return true;
        }
        const model = await loadReadiness(sql, { schoolId, instructorId, mode });
        res.status(200).json({ version: 2, ...model.readiness });
        return true;
      }

      if (action === 'v2-dashboard-link') {
        if (req.method !== 'POST') refuse(405, 'METHOD_NOT_ALLOWED', 'POST required');
        await gateFor(sql, env, schoolId, 'dashboard_link');
        const scope = validateMappedScope(await store.loadInstructorScope(sql, { schoolId, instructorId }), { schoolId, instructorId, mode });
        await logAuditRequired(sql, auditEntry(req, user, schoolId, 'connect_v2.dashboard_link_created', 'instructor', instructorId, { connect_scope_id: scope.id, stripe_mode: mode }));
        const link = await deps.createDashboardClient(mode).accounts.createLoginLink(scope.stripe_account_id);
        if (!link || typeof link.url !== 'string') refuse(502, 'CONNECT_V2_PROVIDER_CONTRACT_INVALID', 'Stripe returned an invalid dashboard link');
        res.status(200).json({ version: 2, url: link.url });
        return true;
      }

      if (action === 'v2-agreements') {
        if (req.method !== 'GET') refuse(405, 'METHOD_NOT_ALLOWED', 'GET required');
        const versions = await store.loadAgreementVersions(sql, { schoolId, instructorId });
        res.status(200).json({ version: 2, agreements: versions });
        return true;
      }

      if (action === 'v2-agreement-accept') {
        if (req.method !== 'POST') refuse(405, 'METHOD_NOT_ALLOWED', 'POST required');
        await gateFor(sql, env, schoolId, 'agreement');
        const agreementId = safeText(req.body?.agreement_id, { max: 36, pattern: /^[0-9a-f-]{36}$/i });
        const agreementFingerprint = safeText(req.body?.agreement_fingerprint, { max: 71, pattern: /^sha256:[0-9a-f]{64}$/ });
        const evidenceReference = `web:${crypto.randomUUID()}:${core.fingerprint({ school_id: schoolId, instructor_id: instructorId, agreement_id: agreementId, agreement_fingerprint: agreementFingerprint, ip: requestIp(req), user_agent: String(req.headers?.['user-agent'] || '').slice(0, 160) })}`;
        await logAuditRequired(sql, auditEntry(req, user, schoolId, 'connect_v2.agreement_accepted', 'instructor', instructorId, { agreement_id: agreementId, agreement_fingerprint: agreementFingerprint }));
        const agreement = await store.acceptAgreement(sql, { schoolId, instructorId, agreementId, agreementFingerprint, evidenceReference });
        if (!agreement) refuse(409, 'AGREEMENT_ACCEPTANCE_CONFLICT', 'Agreement could not be accepted');
        res.status(200).json({ version: 2, accepted: true, agreement_id: agreement.id });
        return true;
      }

      if (action === 'v2-admin-agreement-draft') {
        if (req.method !== 'POST') refuse(405, 'METHOD_NOT_ALLOWED', 'POST required');
        await gateFor(sql, env, schoolId, 'agreement');
        const splitBps = Number(req.body?.split_bps);
        const weeklyFeeMinor = Number(req.body?.weekly_franchise_fee_minor);
        if (!Number.isSafeInteger(splitBps) || splitBps < 0 || splitBps > 10000 || !Number.isSafeInteger(weeklyFeeMinor) || weeklyFeeMinor < 0) refuse(400, 'INVALID_AGREEMENT_TERMS', 'Agreement terms are invalid');
        const startsAt = new Date(req.body?.starts_at);
        const endsAt = req.body?.ends_at ? new Date(req.body.ends_at) : null;
        if (Number.isNaN(startsAt.getTime()) || (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt))) refuse(400, 'INVALID_AGREEMENT_PERIOD', 'Agreement period is invalid');
        const currency = safeText(req.body?.currency, { min: 3, max: 3, pattern: /^[a-z]{3}$/ });
        const documentVersion = safeText(req.body?.document_version, { max: 80, pattern: /^[A-Za-z0-9_.:-]+$/ });
        if (!await store.loadSchoolAndInstructor(sql, { schoolId, instructorId })) refuse(404, 'INSTRUCTOR_NOT_FOUND', 'Instructor not found');
        await logAuditRequired(sql, auditEntry(req, user, schoolId, 'connect_v2.agreement_draft_created', 'instructor', instructorId, { split_bps: splitBps, weekly_franchise_fee_minor: weeklyFeeMinor, currency, document_version: documentVersion }));
        const agreement = await store.createAgreementDraft(sql, { schoolId, instructorId, adminId: user.id, startsAt: startsAt.toISOString(), endsAt: endsAt?.toISOString() || null, splitBps, weeklyFeeMinor, currency, documentVersion });
        res.status(201).json({ version: 2, agreement_id: agreement.id, agreement_fingerprint: agreement.agreement_fingerprint, agreement_version: agreement.version_number, status: agreement.status });
        return true;
      }

      if (action === 'v2-admin-agreement-activate') {
        if (req.method !== 'POST') refuse(405, 'METHOD_NOT_ALLOWED', 'POST required');
        await gateFor(sql, env, schoolId, 'agreement');
        const agreementId = safeText(req.body?.agreement_id, { max: 36, pattern: /^[0-9a-f-]{36}$/i });
        const agreementFingerprint = safeText(req.body?.agreement_fingerprint, { max: 71, pattern: /^sha256:[0-9a-f]{64}$/ });
        const scope = validateMappedScope(await store.loadInstructorScope(sql, { schoolId, instructorId }), { schoolId, instructorId, mode });
        const versions = await store.loadAgreementVersions(sql, { schoolId, instructorId });
        const candidate = versions.find((item) => item.id === agreementId && item.agreement_fingerprint === agreementFingerprint);
        if (!candidate || !candidate.accepted_at || candidate.status !== 'draft') refuse(409, 'AGREEMENT_NOT_ACCEPTED', 'Agreement is not an accepted draft');
        const observations = (await store.loadObservations(sql, { schoolId, instructorId })).map(hydrateObservation);
        const proposed = { ...candidate, status: 'active', connect_scope_id: scope.id, stripe_configuration_id: 'recipient', approved_at: deps.now().toISOString(), approved_by_admin_id: user.id };
        const readiness = core.evaluateReadiness({ schoolId, instructorId, expectedMode: mode, scope, observations, agreement: proposed, now: deps.now() });
        if (!readiness.ready) refuse(409, 'AGREEMENT_ACTIVATION_NOT_READY', 'Current account evidence does not permit agreement activation');
        await logAuditRequired(sql, auditEntry(req, user, schoolId, 'connect_v2.agreement_activated', 'instructor', instructorId, { agreement_id: agreementId, agreement_fingerprint: agreementFingerprint, connect_scope_id: scope.id }));
        const agreement = await store.activateAgreement(sql, { schoolId, instructorId, agreementId, agreementFingerprint, scopeId: scope.id, adminId: user.id });
        if (!agreement) refuse(409, 'AGREEMENT_ACTIVATION_CONFLICT', 'Agreement could not be activated');
        res.status(200).json({ version: 2, activated: true, agreement_id: agreement.id, payout_activation_changed: false });
        return true;
      }

      if (action === 'v2-admin-readiness') {
        if (req.method !== 'GET') refuse(405, 'METHOD_NOT_ALLOWED', 'GET required');
        const ids = req.query?.instructor_id
          ? [{ id: instructorId }]
          : await store.listSchoolInstructors(sql, schoolId);
        const results = [];
        for (const instructor of ids) {
          const model = await loadReadiness(sql, { schoolId, instructorId: Number(instructor.id), mode });
          results.push({ instructor_id: Number(instructor.id), instructor_name: instructor.name || null, ...model.readiness });
        }
        res.status(200).json({ version: 2, school_id: Number(schoolId), readiness: results });
        return true;
      }

      refuse(400, 'UNKNOWN_ACTION', 'Unknown Accounts v2 action');
    } catch (error) {
      const status = error instanceof ConnectV2Error ? error.status : 500;
      const code = error instanceof ConnectV2Error ? error.code : 'CONNECT_V2_INTERNAL_ERROR';
      if (status >= 500) console.error('[connect-v2]', code, error?.name || 'Error');
      res.status(status).json({ error: true, code, message: error instanceof ConnectV2Error ? error.message : 'Accounts v2 request failed' });
      return true;
    }
  };
}

function buildCreateParams(context, intent, mode) {
  return core.buildRecipientAccountCreateParams({
    schoolId: context.school_id,
    instructorId: context.id,
    intentId: intent.id,
    mode,
    email: context.email,
    displayName: context.name,
  });
}

module.exports = {
  ConnectV2Error,
  V2_ACTIONS,
  createConnectV2Handler,
  findReconciliationMatches,
  hydrateObservation,
  validateMappedScope,
  validateProviderAccount,
};
