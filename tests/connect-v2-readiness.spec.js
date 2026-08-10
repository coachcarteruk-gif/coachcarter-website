const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const core = require('../api/_connect-v2');
const routes = require('../api/_connect-v2-routes');
const store = require('../api/_connect-v2-store');
const { createConnectV2WebhookHandler } = require('../api/webhook-connect-v2');

const root = path.resolve(__dirname, '..');

function account(overrides = {}) {
  return {
    id: 'acct_slice4one',
    object: 'v2.core.account',
    livemode: false,
    applied_configurations: ['recipient'],
    dashboard: 'express',
    configuration: {
      recipient: {
        applied: true,
        capabilities: { stripe_balance: { stripe_transfers: { status: 'active', status_details: [] } } },
      },
    },
    defaults: { currency: 'gbp', locales: ['en-GB'], responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
    identity: { country: 'gb', entity_type: 'individual' },
    requirements: { entries: [] },
    future_requirements: { entries: [] },
    metadata: {},
    ...overrides,
  };
}

function scope(overrides = {}) {
  return {
    id: 71,
    school_id: 1,
    owner_type: 'instructor',
    instructor_id: 11,
    stripe_account_id: 'acct_slice4one',
    evidence_json: { configuration_type: 'recipient', dashboard_type: 'express', stripe_mode: 'test', event_context: 'platform', creation_intent_id: '11111111-1111-4111-8111-111111111111', stable_identity: 'cc:connect-v2:1:11:test:recipient' },
    ...overrides,
  };
}

function agreement(overrides = {}) {
  return {
    id: crypto.randomUUID(), school_id: 1, instructor_id: 11, status: 'active',
    starts_at: '2026-08-01T00:00:00.000Z', ends_at: null,
    accepted_at: '2026-08-09T10:00:00.000Z', acceptance_evidence_reference: 'web:evidence',
    approved_at: '2026-08-09T10:01:00.000Z', approved_by_admin_id: 3,
    connect_scope_id: 71, stripe_configuration_id: 'recipient',
    ...overrides,
  };
}

function observation(overrides = {}) {
  return core.normalizeAccountObservation({
    account: account(), schoolId: 1, instructorId: 11, connectScopeId: 71,
    expectedAccountId: 'acct_slice4one', observedAt: '2026-08-09T10:05:00.000Z',
    ...overrides,
  });
}

function responseRecorder() {
  return {
    statusCode: null, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    end() {},
  };
}

function reconciliationPage(data, nextPageUrl = null) {
  return { data, next_page_url: nextPageUrl, previous_page_url: null };
}

function paginatedAccountsClient(firstPage, subsequentPages = {}) {
  const calls = { create: 0, list: [], rawRequest: [] };
  return {
    calls,
    v2: { core: { accounts: {
      create: async () => { calls.create += 1; throw new Error('reconciliation must not create an account'); },
      list: async (params) => {
        calls.list.push(params);
        if (firstPage instanceof Error) throw firstPage;
        return firstPage;
      },
    } } },
    rawRequest: async (method, pageUrl) => {
      calls.rawRequest.push({ method, pageUrl });
      const result = subsequentPages[pageUrl];
      if (result instanceof Error) throw result;
      if (result === undefined) throw new Error(`Unexpected page URL: ${pageUrl}`);
      return result;
    },
  };
}

async function runActiveAccountRoute({ intentState, stripeClient }) {
  const intentId = '11111111-1111-4111-8111-111111111111';
  const command = core.makeCreationCommand({ schoolId: 1, instructorId: 11, mode: 'test', intentId });
  const intent = {
    id: intentId,
    school_id: 1,
    instructor_id: 11,
    stripe_mode: 'test',
    state: intentState,
    stable_identity: command.stableIdentity,
    idempotency_key: command.idempotencyKey,
    request_fingerprint: command.requestFingerprint,
  };
  const originals = {};
  const replacements = {
    loadSchoolAndInstructor: async () => ({ id: 11, school_id: 1, email: 'instructor@example.test', name: 'Test Instructor' }),
    loadSchoolConfig: async () => ({ id: 1, config: { features: { stripe_connect_accounts_v2: true } } }),
    loadInstructorScope: async () => null,
    ensureCreationIntent: async () => intent,
    claimCreationIntent: async () => intent,
    recordCreationAttempt: async (_sql, value) => { replacements.attempts.push(value); },
    setCreationIntentState: async (_sql, value) => { replacements.states.push(value); return intent; },
    registerAccountScope: async (_sql, value) => {
      replacements.scopes.push(value);
      return scope({ stripe_account_id: value.accountId, evidence_json: { ...scope().evidence_json, creation_intent_id: value.intentId } });
    },
    insertObservation: async (_sql, value) => { replacements.observations.push(value); return value; },
    attempts: [],
    states: [],
    scopes: [],
    observations: [],
  };
  for (const [name, replacement] of Object.entries(replacements)) {
    if (typeof replacement !== 'function') continue;
    originals[name] = store[name];
    store[name] = replacement;
  }

  const originalJwtSecret = process.env.JWT_SECRET;
  const secret = 'slice4-route-repair-test-secret';
  process.env.JWT_SECRET = secret;
  const token = jwt.sign({ id: 11, email: 'instructor@example.test', school_id: 1, role: 'instructor' }, secret);
  const csrf = 'b'.repeat(64);
  const req = {
    method: 'POST',
    url: '/api/connect?action=v2-account',
    query: { action: 'v2-account' },
    body: {},
    headers: { cookie: `cc_instructor=${token}; cc_csrf=${csrf}`, 'x-csrf-token': csrf },
  };
  const res = responseRecorder();
  const sql = async () => [];
  try {
    const handler = routes.createConnectV2Handler({
      env: {
        JWT_SECRET: secret,
        STRIPE_MODE: 'test',
        STRIPE_CONNECT_V2_ENABLED: 'true',
        STRIPE_CONNECT_V2_ACCOUNT_CREATION_ENABLED: 'true',
      },
      sql,
      createAccountsClient: () => stripeClient,
    });
    await handler(req, res);
    return { res, replacements, intent };
  } finally {
    Object.assign(store, originals);
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }
}

test.describe('Slice 4 Accounts v2 inactive readiness contract', () => {
  test.describe.configure({ mode: 'serial' });
  test('Connect v2 module import and route factory defer database client construction', () => {
    const output = execFileSync(process.execPath, [
      '-e',
      "require('./api/webhook-connect-v2'); require('./api/_connect-v2-routes').createConnectV2Handler(); process.stdout.write('imported')",
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, POSTGRES_URL: 'ci-placeholder-not-a-database-url' },
    });
    expect(output).toBe('imported');
  });

  test('all enablement gates are exact, school scoped, and live mode has an extra gate', () => {
    const schoolConfig = { features: { stripe_connect_accounts_v2: true } };
    expect(core.evaluateConnectV2Gate({ env: {}, schoolConfig, operation: 'account_create' }).enabled).toBe(false);
    const testEnv = { STRIPE_MODE: 'test', STRIPE_CONNECT_V2_ENABLED: 'true', STRIPE_CONNECT_V2_ACCOUNT_CREATION_ENABLED: 'true' };
    expect(core.evaluateConnectV2Gate({ env: testEnv, schoolConfig, operation: 'account_create' }).enabled).toBe(true);
    expect(core.evaluateConnectV2Gate({ env: testEnv, schoolConfig, operation: 'agreement' }).blockers).toContain('agreement_gate_inactive');
    expect(core.evaluateConnectV2Gate({ env: testEnv, schoolConfig, operation: 'webhook' }).blockers).toContain('webhook_gate_inactive');
    expect(core.evaluateConnectV2Gate({ env: testEnv, schoolConfig: { features: { stripe_connect_accounts_v2: 'true' } }, operation: 'account_create' }).enabled).toBe(false);
    expect(core.evaluateConnectV2Gate({ env: { ...testEnv, STRIPE_MODE: 'live' }, schoolConfig, operation: 'account_create' }).blockers).toContain('live_gate_inactive');
    expect(core.evaluateConnectV2Gate({ env: { ...testEnv, STRIPE_MODE: 'live', STRIPE_CONNECT_V2_LIVE_ENABLED: 'true' }, schoolConfig, operation: 'account_create' }).enabled).toBe(true);
  });

  test('creation identity and Stripe request are deterministic recipient/Express contracts', () => {
    const intentId = '11111111-1111-4111-8111-111111111111';
    const a = core.makeCreationCommand({ schoolId: 1, instructorId: 11, mode: 'test', intentId });
    const b = core.makeCreationCommand({ schoolId: 1, instructorId: 11, mode: 'test', intentId });
    expect(a).toEqual(b);
    expect(a.stableIdentity).toBe('cc:connect-v2:1:11:test:recipient');
    const params = core.buildRecipientAccountCreateParams({ schoolId: 1, instructorId: 11, intentId, mode: 'test', email: 'instructor@example.test', displayName: 'Test Instructor' });
    expect(params.dashboard).toBe('express');
    expect(params.configuration.recipient.capabilities.stripe_balance.stripe_transfers.requested).toBe(true);
    expect(params.defaults.responsibilities).toEqual({ fees_collector: 'application', losses_collector: 'application' });
    expect(params.metadata.cc_stable_identity).toBe(a.stableIdentity);
    expect(params.metadata).not.toHaveProperty('email');
  });

  test('first-page reconciliation uses the Accounts v2 maximum page size and never creates', async () => {
    const matching = account({ metadata: { cc_stable_identity: 'cc:connect-v2:1:11:test:recipient' } });
    const stripe = paginatedAccountsClient(reconciliationPage([matching]));
    const matches = await routes.findReconciliationMatches(stripe, { stable_identity: 'cc:connect-v2:1:11:test:recipient' });
    expect(matches.map((item) => item.id)).toEqual(['acct_slice4one']);
    expect(stripe.calls.list).toEqual([{ applied_configurations: ['recipient'], limit: 20 }]);
    expect(stripe.calls.rawRequest).toEqual([]);
    expect(stripe.calls.create).toBe(0);
  });

  test('later-page reconciliation follows Stripe next_page_url and no request exceeds 20', async () => {
    const next = '/v2/core/accounts?page=page_second&limit=20&applied_configurations=recipient';
    const matching = account({ metadata: { cc_stable_identity: 'cc:connect-v2:1:11:test:recipient' } });
    const stripe = paginatedAccountsClient(
      reconciliationPage([account({ id: 'acct_other' })], next),
      { [next]: reconciliationPage([matching]) },
    );
    const matches = await routes.findReconciliationMatches(stripe, { stable_identity: 'cc:connect-v2:1:11:test:recipient' });
    expect(matches.map((item) => item.id)).toEqual(['acct_slice4one']);
    expect(stripe.calls.list[0].limit).toBeLessThanOrEqual(20);
    expect(stripe.calls.rawRequest).toEqual([{ method: 'GET', pageUrl: next }]);
    for (const call of stripe.calls.rawRequest) {
      expect(Number(new URL(call.pageUrl, 'https://api.stripe.com').searchParams.get('limit'))).toBeLessThanOrEqual(20);
    }
    expect(stripe.calls.create).toBe(0);
  });

  test('pagination terminates when next_page_url is null', async () => {
    const stripe = paginatedAccountsClient(reconciliationPage([account({ id: 'acct_unmatched' })]));
    await expect(routes.findReconciliationMatches(stripe, { stable_identity: 'cc:connect-v2:1:11:test:recipient' })).resolves.toEqual([]);
    expect(stripe.calls.list).toHaveLength(1);
    expect(stripe.calls.rawRequest).toHaveLength(0);
    expect(stripe.calls.create).toBe(0);
  });

  test('provider list and later-page failures remain fail-closed without creation', async () => {
    const listFailure = paginatedAccountsClient(new Error('provider list unavailable'));
    await expect(routes.findReconciliationMatches(listFailure, { stable_identity: 'cc:connect-v2:1:11:test:recipient' })).rejects.toThrow('provider list unavailable');
    expect(listFailure.calls.create).toBe(0);

    const next = '/v2/core/accounts?page=page_failure&limit=20&applied_configurations=recipient';
    const pageFailure = paginatedAccountsClient(reconciliationPage([], next), { [next]: new Error('provider page unavailable') });
    await expect(routes.findReconciliationMatches(pageFailure, { stable_identity: 'cc:connect-v2:1:11:test:recipient' })).rejects.toThrow('provider page unavailable');
    expect(pageFailure.calls.rawRequest).toHaveLength(1);
    expect(pageFailure.calls.create).toBe(0);
  });

  test('malformed, oversized, and cyclic pagination fail promptly without creation', async () => {
    const malformed = paginatedAccountsClient(reconciliationPage([], '/v2/core/accounts?limit=20&applied_configurations=recipient'));
    await expect(routes.findReconciliationMatches(malformed, { stable_identity: 'cc:connect-v2:1:11:test:recipient' })).rejects.toMatchObject({ code: 'CONNECT_V2_RECONCILIATION_INCOMPLETE' });
    expect(malformed.calls.rawRequest).toHaveLength(0);

    const oversizedUrl = '/v2/core/accounts?page=page_oversized&limit=21&applied_configurations=recipient';
    const oversized = paginatedAccountsClient(reconciliationPage([], oversizedUrl));
    await expect(routes.findReconciliationMatches(oversized, { stable_identity: 'cc:connect-v2:1:11:test:recipient' })).rejects.toMatchObject({ code: 'CONNECT_V2_RECONCILIATION_INCOMPLETE' });
    expect(oversized.calls.rawRequest).toHaveLength(0);

    const cycleUrl = '/v2/core/accounts?page=page_cycle&limit=20&applied_configurations=recipient';
    const cyclic = paginatedAccountsClient(reconciliationPage([], cycleUrl), { [cycleUrl]: reconciliationPage([], cycleUrl) });
    await expect(routes.findReconciliationMatches(cyclic, { stable_identity: 'cc:connect-v2:1:11:test:recipient' })).rejects.toMatchObject({ code: 'CONNECT_V2_RECONCILIATION_INCOMPLETE' });
    expect(cyclic.calls.rawRequest).toHaveLength(1);
    expect(cyclic.calls.create).toBe(0);
  });

  test('unexpected list objects fail closed and repeated account objects cannot cycle', async () => {
    const unexpected = paginatedAccountsClient(reconciliationPage([{ id: 'acct_wrongtype', object: 'account', metadata: {} }]));
    await expect(routes.findReconciliationMatches(unexpected, { stable_identity: 'cc:connect-v2:1:11:test:recipient' })).rejects.toMatchObject({ code: 'CONNECT_V2_RECONCILIATION_INCOMPLETE' });

    const next = '/v2/core/accounts?page=page_duplicate&limit=20&applied_configurations=recipient';
    const repeated = account({ id: 'acct_repeated' });
    const duplicate = paginatedAccountsClient(reconciliationPage([repeated], next), { [next]: reconciliationPage([repeated]) });
    await expect(routes.findReconciliationMatches(duplicate, { stable_identity: 'cc:connect-v2:1:11:test:recipient' })).rejects.toMatchObject({ code: 'CONNECT_V2_RECONCILIATION_INCOMPLETE' });
    expect(duplicate.calls.create).toBe(0);
  });

  test('multiple stable-identity matches enter manual review without selecting or creating', async () => {
    const stableIdentity = 'cc:connect-v2:1:11:test:recipient';
    const stripe = paginatedAccountsClient(reconciliationPage([
      account({ id: 'acct_duplicateone', metadata: { cc_stable_identity: stableIdentity } }),
      account({ id: 'acct_duplicatetwo', metadata: { cc_stable_identity: stableIdentity } }),
    ]));
    const { res, replacements } = await runActiveAccountRoute({ intentState: 'reconciling', stripeClient: stripe });
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({ state: 'manual_review', has_account: false });
    expect(replacements.attempts).toHaveLength(1);
    expect(replacements.attempts[0]).toMatchObject({ outcome: 'reconcile_multiple_matches', providerAccountId: 'acct_duplicateone', evidence: { match_count: 2 } });
    expect(replacements.states).toContainEqual(expect.objectContaining({ state: 'manual_review' }));
    expect(replacements.scopes).toHaveLength(0);
    expect(stripe.calls.create).toBe(0);
  });

  test('mapped provider identity rejects wrong tenant, instructor, mode, type, configuration, and stable identity', () => {
    const exact = account({ metadata: {
      cc_connect_intent_id: '11111111-1111-4111-8111-111111111111',
      cc_school_id: '1', cc_instructor_id: '11',
      cc_stable_identity: 'cc:connect-v2:1:11:test:recipient',
    } });
    expect(routes.validateProviderAccount(exact, { schoolId: 1, instructorId: 11, mode: 'test', expectedAccountId: exact.id, expectedIntentId: '11111111-1111-4111-8111-111111111111' })).toBe(exact);
    expect(() => routes.validateProviderAccount({ ...exact, metadata: { ...exact.metadata, cc_school_id: '2' } }, { schoolId: 1, instructorId: 11, mode: 'test', expectedAccountId: exact.id, expectedIntentId: '11111111-1111-4111-8111-111111111111' })).toThrow('Stripe account ownership metadata does not match');
    expect(() => routes.validateProviderAccount({ ...exact, metadata: { ...exact.metadata, cc_instructor_id: '12' } }, { schoolId: 1, instructorId: 11, mode: 'test', expectedAccountId: exact.id, expectedIntentId: '11111111-1111-4111-8111-111111111111' })).toThrow('Stripe account ownership metadata does not match');
    expect(() => routes.validateProviderAccount({ ...exact, metadata: { ...exact.metadata, cc_stable_identity: 'cc:connect-v2:1:12:test:recipient' } }, { schoolId: 1, instructorId: 11, mode: 'test', expectedAccountId: exact.id, expectedIntentId: '11111111-1111-4111-8111-111111111111' })).toThrow('Stripe account ownership metadata does not match');
    expect(() => routes.validateProviderAccount({ ...exact, livemode: true }, { schoolId: 1, instructorId: 11, mode: 'test', expectedAccountId: exact.id, expectedIntentId: '11111111-1111-4111-8111-111111111111' })).toThrow('Stripe account mode does not match');
    expect(() => routes.validateProviderAccount({ ...exact, object: 'account' }, { schoolId: 1, instructorId: 11, mode: 'test', expectedAccountId: exact.id, expectedIntentId: '11111111-1111-4111-8111-111111111111' })).toThrow('Stripe returned an invalid account response');
    expect(() => routes.validateProviderAccount({ ...exact, applied_configurations: ['customer'] }, { schoolId: 1, instructorId: 11, mode: 'test', expectedAccountId: exact.id, expectedIntentId: '11111111-1111-4111-8111-111111111111' })).toThrow('Stripe account is not a recipient with Express dashboard access');
  });

  test('ambiguous intent remains reconciling and cannot create a replacement when no match exists', async () => {
    expect(core.classifyCreationOutcome({ retryable: true })).toBe('provider_ambiguous');
    expect(core.classifyCreationOutcome({ retryable: false })).toBe('provider_failed_confirmed');
    const stripe = paginatedAccountsClient(reconciliationPage([]));
    const { res, replacements } = await runActiveAccountRoute({ intentState: 'reconciling', stripeClient: stripe });
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({ state: 'reconciling', has_account: false });
    expect(replacements.attempts[0]).toMatchObject({ outcome: 'reconcile_no_match', evidence: { match_count: 0 } });
    expect(replacements.scopes).toHaveLength(0);
    expect(stripe.calls.create).toBe(0);
  });

  test('planned intent still creates once when there was no ambiguous provider result', async () => {
    let createCalls = 0;
    let listCalls = 0;
    const stripe = {
      v2: { core: { accounts: {
        list: async () => { listCalls += 1; throw new Error('planned creation must not reconcile'); },
        create: async (params, options) => {
          createCalls += 1;
          expect(options.idempotencyKey).toBe(core.makeCreationCommand({ schoolId: 1, instructorId: 11, mode: 'test', intentId: '11111111-1111-4111-8111-111111111111' }).idempotencyKey);
          return account({ id: 'acct_freshcreation', metadata: params.metadata });
        },
      } } },
    };
    const { res, replacements } = await runActiveAccountRoute({ intentState: 'planned', stripeClient: stripe });
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ state: 'created', has_account: true });
    expect(createCalls).toBe(1);
    expect(listCalls).toBe(0);
    expect(replacements.attempts[0]).toMatchObject({ outcome: 'provider_succeeded', providerAccountId: 'acct_freshcreation' });
    expect(replacements.states).toContainEqual(expect.objectContaining({ state: 'succeeded', providerAccountId: 'acct_freshcreation' }));
  });

  test('readiness rejects tenant, owner, identity, configuration, dashboard, mode, agreement and stale evidence mismatches', () => {
    const obs = observation();
    const base = { schoolId: 1, instructorId: 11, expectedMode: 'test', scope: scope(), observations: [obs], agreement: agreement(), now: new Date('2026-08-09T10:06:00.000Z') };
    expect(core.evaluateReadiness(base)).toMatchObject({ ready: true, payout_activation_changed: false });
    expect(core.evaluateReadiness({ ...base, scope: scope({ school_id: 2 }) }).blockers).toContain('account_school_mismatch');
    expect(core.evaluateReadiness({ ...base, scope: scope({ instructor_id: 12 }) }).blockers).toContain('account_instructor_mismatch');
    expect(core.evaluateReadiness({ ...base, scope: scope({ stripe_account_id: 'acct_wrong' }) }).blockers).toContain('state_account_mismatch');
    expect(core.evaluateReadiness({ ...base, scope: scope({ evidence_json: { ...scope().evidence_json, configuration_type: 'merchant' } }) }).blockers).toContain('account_configuration_mapping_mismatch');
    expect(core.evaluateReadiness({ ...base, observations: [observation({ account: account({ dashboard: 'full' }) })] }).blockers).toContain('dashboard_not_express');
    expect(core.evaluateReadiness({ ...base, observations: [observation({ account: account({ identity: { country: 'us', entity_type: 'individual' } }) })] }).blockers).toContain('identity_country_mismatch');
    expect(core.evaluateReadiness({ ...base, observations: [observation({ account: account({ defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } } }) })] }).blockers).toContain('responsibilities_mismatch');
    expect(core.evaluateReadiness({ ...base, observations: [observation({ account: account({ livemode: true }) })] }).blockers).toContain('state_mode_mismatch');
    expect(core.evaluateReadiness({ ...base, agreement: agreement({ instructor_id: 12 }) }).blockers).toContain('agreement_instructor_mismatch');
    expect(core.evaluateReadiness({ ...base, agreement: agreement({ starts_at: '2026-08-10T00:00:00.000Z' }) }).blockers).toContain('agreement_not_effective');
    expect(core.evaluateReadiness({ ...base, now: new Date('2026-08-09T11:00:00.000Z') }).blockers).toContain('account_state_stale_or_invalid');
  });

  test('newer capability and requirements regressions always defeat historic ready state', () => {
    const ready = observation({ observedAt: '2026-08-09T10:05:00.000Z' });
    const restrictedAccount = account({ configuration: { recipient: { applied: true, capabilities: { stripe_balance: { stripe_transfers: { status: 'restricted', status_details: [] } } } } } });
    const regressed = observation({ account: restrictedAccount, observedAt: '2026-08-09T10:07:00.000Z' });
    const result = core.evaluateReadiness({ schoolId: 1, instructorId: 11, expectedMode: 'test', scope: scope(), observations: [ready, regressed], agreement: agreement(), now: new Date('2026-08-09T10:08:00.000Z') });
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('transfers_capability_not_active');

    const dueAccount = account({ requirements: { entries: [{ awaiting_action_from: 'user', minimum_deadline: { status: 'currently_due' }, errors: [{ code: 'verification_document' }] }] } });
    const due = observation({ account: dueAccount, observedAt: '2026-08-09T10:09:00.000Z' });
    const dueResult = core.evaluateReadiness({ schoolId: 1, instructorId: 11, expectedMode: 'test', scope: scope(), observations: [ready, due], agreement: agreement(), now: new Date('2026-08-09T10:10:00.000Z') });
    expect(dueResult.blockers).toContain('requirements_outstanding');
  });

  test('equal-time contradictory observations fail closed', () => {
    const ready = observation();
    const sameStateDifferentEvent = observation({ eventType: 'v2.core.account.updated' });
    expect(core.selectCurrentObservation([ready, sameStateDifferentEvent]).contradictory).toBe(false);
    const pending = observation({ account: account({ configuration: { recipient: { applied: true, capabilities: { stripe_balance: { stripe_transfers: { status: 'pending', status_details: [] } } } } } }) });
    const result = core.evaluateReadiness({ schoolId: 1, instructorId: 11, expectedMode: 'test', scope: scope(), observations: [ready, pending], agreement: agreement(), now: new Date('2026-08-09T10:06:00.000Z') });
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('account_state_contradictory');
  });

  test('onboarding return and refresh state is signed, expiring, and bound to every scope identity', () => {
    const secret = 'slice4-test-secret-that-is-long-enough';
    const token = core.signOnboardingState({ schoolId: 1, instructorId: 11, scopeId: 71, accountId: 'acct_slice4one', mode: 'test', nonce: crypto.randomUUID(), secret });
    expect(core.verifyOnboardingState(token, { schoolId: 1, instructorId: 11, scopeId: 71, accountId: 'acct_slice4one', mode: 'test', secret }).aud).toBe('connect-v2-onboarding');
    expect(() => core.verifyOnboardingState(token, { schoolId: 2, instructorId: 11, scopeId: 71, accountId: 'acct_slice4one', mode: 'test', secret })).toThrow('CONNECT_V2_STATE_SCOPE_MISMATCH');
    expect(() => core.verifyOnboardingState(`${token}x`, { schoolId: 1, instructorId: 11, scopeId: 71, accountId: 'acct_slice4one', mode: 'test', secret })).toThrow();
  });

  test('thin-event envelope validates signature-bound identity, context, mode and supported type fields', () => {
    const value = core.validateThinEventEnvelope({ id: 'evt_slice4one', type: 'v2.core.account[requirements].updated', livemode: false, context: null, related_object: { id: 'acct_slice4one' } });
    expect(value).toMatchObject({ account_id: 'acct_slice4one', context: 'platform', livemode: false });
    expect(core.serializeEventContext({ toString: () => '' })).toBe('platform');
    expect(() => core.validateThinEventEnvelope({ ...value, id: 'evt_changed', type: 'unknown' })).toThrow('CONNECT_V2_EVENT_UNSUPPORTED');
    expect(() => core.validateThinEventEnvelope({ id: 'evt_x', type: 'v2.core.account.updated', livemode: false, context: 'bad context!', related_object: { id: 'acct_slice4one' } })).toThrow('CONNECT_V2_EVENT_CONTEXT_INVALID');
  });

  test('inactive account route performs no Stripe API call and role enforcement precedes tenant reads', async () => {
    const originals = { loadSchoolAndInstructor: store.loadSchoolAndInstructor, loadSchoolConfig: store.loadSchoolConfig };
    const originalJwtSecret = process.env.JWT_SECRET;
    let accountCalls = 0;
    let schoolReads = 0;
    store.loadSchoolAndInstructor = async (_sql, ids) => ({ id: ids.instructorId, school_id: ids.schoolId, email: 'x@example.test', name: 'X', config: {} });
    store.loadSchoolConfig = async () => { schoolReads += 1; return { id: 1, config: { features: { stripe_connect_accounts_v2: true } } }; };
    const secret = 'slice4-route-test-secret';
    process.env.JWT_SECRET = secret;
    const token = jwt.sign({ id: 11, email: 'x@example.test', school_id: 1, role: 'instructor' }, secret);
    const csrf = 'a'.repeat(64);
    const req = { method: 'POST', url: '/api/connect?action=v2-account', query: { action: 'v2-account' }, body: {}, headers: { cookie: `cc_instructor=${token}; cc_csrf=${csrf}`, 'x-csrf-token': csrf } };
    const res = responseRecorder();
    try {
      const handler = routes.createConnectV2Handler({ env: { JWT_SECRET: secret, STRIPE_MODE: 'live' }, sql: {}, createAccountsClient: () => { accountCalls += 1; return {}; } });
      await handler(req, res);
      expect(res.statusCode).toBe(503);
      expect(res.body.code).toBe('CONNECT_V2_INACTIVE');
      expect(accountCalls).toBe(0);
      expect(schoolReads).toBe(1);

      const badRole = jwt.sign({ id: 11, school_id: 1, role: 'instructor' }, secret);
      const adminReq = { method: 'GET', url: '/api/connect?action=v2-admin-readiness', query: { action: 'v2-admin-readiness', instructor_id: '11' }, headers: { cookie: `cc_instructor=${badRole}` } };
      const adminRes = responseRecorder();
      await handler(adminReq, adminRes);
      expect(adminRes.statusCode).toBe(401);
      expect(schoolReads).toBe(1);
    } finally {
      store.loadSchoolAndInstructor = originals.loadSchoolAndInstructor;
      store.loadSchoolConfig = originals.loadSchoolConfig;
      if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = originalJwtSecret;
    }
  });

  test('verified duplicate events are replay-safe and inactive delivery does not fetch Stripe state', async () => {
    const originals = { loadEventReceipt: store.loadEventReceipt, loadScopeByAccount: store.loadScopeByAccount, loadSchoolConfig: store.loadSchoolConfig };
    let providerFetches = 0;
    const event = { id: 'evt_slice4replay', type: 'v2.core.account.updated', livemode: false, context: null, related_object: { id: 'acct_slice4one' }, fetchRelatedObject: async () => { providerFetches += 1; return account(); } };
    const envelope = core.validateThinEventEnvelope(event);
    const fakeClient = { parseEventNotification: () => event };
    const req = { method: 'POST', headers: { 'stripe-signature': 'signed' }, rawBody: '{}', on() {} };
    try {
      const rejectedRes = responseRecorder();
      await createConnectV2WebhookHandler({ env: { STRIPE_MODE: 'test', STRIPE_CONNECT_V2_WEBHOOK_SECRET: 'whsec_test' }, sql: {}, createClient: () => ({ parseEventNotification: () => { throw new Error('bad signature'); } }) })(req, rejectedRes);
      expect(rejectedRes.statusCode).toBe(400);
      expect(providerFetches).toBe(0);

      store.loadEventReceipt = async () => ({ stripe_account_id: envelope.account_id, event_type: envelope.type, event_context: envelope.context, evidence_json: { event_envelope_fingerprint: envelope.fingerprint } });
      const duplicateRes = responseRecorder();
      await createConnectV2WebhookHandler({ env: { STRIPE_MODE: 'test', STRIPE_CONNECT_V2_WEBHOOK_SECRET: 'whsec_test' }, sql: {}, createClient: () => fakeClient })(req, duplicateRes);
      expect(duplicateRes.body).toEqual({ received: true, duplicate: true });
      expect(providerFetches).toBe(0);

      store.loadEventReceipt = async () => null;
      store.loadScopeByAccount = async () => scope();
      store.loadSchoolConfig = async () => ({ id: 1, config: { features: { stripe_connect_accounts_v2: true } } });
      const inactiveRes = responseRecorder();
      await createConnectV2WebhookHandler({ env: { STRIPE_MODE: 'test', STRIPE_CONNECT_V2_WEBHOOK_SECRET: 'whsec_test', STRIPE_CONNECT_V2_ENABLED: 'true' }, sql: {}, createClient: () => fakeClient })(req, inactiveRes);
      expect(inactiveRes.statusCode).toBe(202);
      expect(inactiveRes.body.reason).toBe('inactive');
      expect(providerFetches).toBe(0);
    } finally {
      Object.assign(store, originals);
    }
  });

  test('migration makes attempts/links append-only, owner mappings unique, and accepted agreements immutable', () => {
    const sql = fs.readFileSync(path.join(root, 'db', 'migrations', '041_connect_v2_onboarding_readiness.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS connect_v2_account_creation_intents');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS connect_v2_account_creation_attempts');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS connect_v2_account_link_events');
    expect(sql).toContain('connect_v2_creation_attempts_append_only');
    expect(sql).toContain('connect_v2_link_events_append_only');
    expect(sql).toContain('uq_payout_v2_scope_instructor_owner');
    expect(sql).toContain("ELSIF OLD.accepted_at IS NOT NULL");
    expect(sql).toContain('accepted payout agreement facts are immutable');
    expect(sql).toContain('payout agreement effective ranges overlap');
    const aggregate = fs.readFileSync(path.join(root, 'db', 'migration.sql'), 'utf8');
    const marker = '-- Stripe Connect Simon launch Slice 4: Accounts v2 onboarding readiness.';
    const start = aggregate.lastIndexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(aggregate.slice(start, start + sql.trim().length)).toBe(sql.trim());
  });

  test('Slice 4 modules contain no payout, transfer, refund, earning, cutover, or retirement activation mutation', () => {
    const text = [
      '_connect-v2.js', '_connect-v2-store.js', '_connect-v2-routes.js', 'webhook-connect-v2.js',
    ].map((file) => fs.readFileSync(path.join(root, 'api', file), 'utf8')).join('\n');
    expect(text).not.toMatch(/INSERT\s+INTO\s+(?:payout_runs|stripe_launch_transfer_intents|refund_intents|stripe_launch_booking_earnings)/i);
    expect(text).not.toMatch(/UPDATE\s+schools[\s\S]{0,100}retire_incompatible_products/i);
    expect(text).not.toMatch(/payouts_paused\s*=/i);
  });
});
