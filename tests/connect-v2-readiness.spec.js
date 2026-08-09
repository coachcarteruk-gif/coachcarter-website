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

test.describe('Slice 4 Accounts v2 inactive readiness contract', () => {
  test.describe.configure({ mode: 'serial' });
  test('webhook module import defers database client construction', () => {
    const output = execFileSync(process.execPath, [
      '-e',
      "require('./api/webhook-connect-v2'); process.stdout.write('imported')",
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

  test('ambiguous creation is reconciled by stable identity and never creates a replacement', async () => {
    expect(core.classifyCreationOutcome({ retryable: true })).toBe('provider_ambiguous');
    expect(core.classifyCreationOutcome({ retryable: false })).toBe('provider_failed_confirmed');
    let createCalls = 0;
    const matching = account({ metadata: { cc_stable_identity: 'cc:connect-v2:1:11:test:recipient' } });
    const fake = {
      v2: { core: { accounts: {
        create: async () => { createCalls += 1; },
        list: () => ({ async *[Symbol.asyncIterator]() { yield account({ id: 'acct_other' }); yield matching; } }),
      } } },
    };
    const matches = await routes.findReconciliationMatches(fake, { stable_identity: 'cc:connect-v2:1:11:test:recipient' });
    expect(matches.map((item) => item.id)).toEqual(['acct_slice4one']);
    expect(createCalls).toBe(0);
  });

  test('mapped provider identity must retain exact school, instructor, intent, mode and stable metadata', () => {
    const exact = account({ metadata: {
      cc_connect_intent_id: '11111111-1111-4111-8111-111111111111',
      cc_school_id: '1', cc_instructor_id: '11',
      cc_stable_identity: 'cc:connect-v2:1:11:test:recipient',
    } });
    expect(routes.validateProviderAccount(exact, { schoolId: 1, instructorId: 11, mode: 'test', expectedAccountId: exact.id, expectedIntentId: '11111111-1111-4111-8111-111111111111' })).toBe(exact);
    expect(() => routes.validateProviderAccount({ ...exact, metadata: { ...exact.metadata, cc_school_id: '2' } }, { schoolId: 1, instructorId: 11, mode: 'test', expectedAccountId: exact.id, expectedIntentId: '11111111-1111-4111-8111-111111111111' })).toThrow('Stripe account ownership metadata does not match');
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
