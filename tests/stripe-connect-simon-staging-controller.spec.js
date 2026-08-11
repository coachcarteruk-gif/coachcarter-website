const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const controller = require('../scripts/stripe-connect-simon-staging-controller');

const root = path.resolve(__dirname, '..');
const controllerPath = path.join(root, 'scripts', 'stripe-connect-simon-staging-controller.js');

function expectedDeployment() {
  return {
    projectId: 'prj_IsolatedProject123',
    customEnvironmentId: 'env_CustomStaging123',
    customEnvironmentSlug: 'staging',
    commitSha: 'a'.repeat(40),
    alias: 'coachcarter-simon-staging.vercel.app',
    target: null,
  };
}

function metadata(overrides = {}) {
  return {
    id: 'dpl_ExactScalar123',
    readyState: 'READY',
    projectId: 'prj_IsolatedProject123',
    target: null,
    meta: { gitCommitSha: 'a'.repeat(40), gitDirty: null },
    customEnvironment: { id: 'env_CustomStaging123', slug: 'staging' },
    alias: ['coachcarter-simon-staging.vercel.app'],
    url: 'fresh-deployment.vercel.app',
    ...overrides,
  };
}

function disabledValues(overrides = {}) {
  return {
    STRIPE_CONNECT_V2_ENABLED: 'false',
    STRIPE_CONNECT_V2_ACCOUNT_CREATION_ENABLED: 'false',
    STRIPE_CONNECT_V2_ACCOUNT_LINKS_ENABLED: 'false',
    STRIPE_CONNECT_V2_DASHBOARD_LINKS_ENABLED: 'false',
    STRIPE_CONNECT_V2_AGREEMENTS_ENABLED: 'false',
    STRIPE_CONNECT_V2_WEBHOOK_PROCESSING_ENABLED: 'false',
    STRIPE_MODE: 'test',
    ...overrides,
  };
}

function gateState(values) {
  return {
    values,
    production: { untouched: true, mutationCount: 0 },
  };
}

function retainedIntent() {
  return {
    schoolId: 1,
    instructorId: 3,
    intentId: '3c2349a0-1696-4b57-b732-fc14bbde57df',
    stableIdentity: 'cc:connect-v2:1:3:test:recipient',
    mode: 'test',
    state: 'reconciling',
    providerAccountId: null,
    scopeCount: 0,
    replacementAccountCount: 0,
  };
}

function successResult() {
  return {
    transport: 'certain',
    attempts: 1,
    redirectsFollowed: 0,
    retries: 0,
    authenticated: true,
    csrfBound: true,
    method: 'POST',
    route: '/api/connect?action=v2-account',
    httpStatus: 200,
    applicationVersion: 2,
    applicationState: 'succeeded',
    hasAccount: true,
    firstStripeAction: 'accounts_v2_list',
    matchCount: 1,
    accountCreateCount: 0,
    directProviderCreateCount: 0,
    intentId: '3c2349a0-1696-4b57-b732-fc14bbde57df',
    stableIdentity: 'cc:connect-v2:1:3:test:recipient',
  };
}

function postflight() {
  return {
    schoolId: 1,
    instructorId: 3,
    intentId: '3c2349a0-1696-4b57-b732-fc14bbde57df',
    stableIdentity: 'cc:connect-v2:1:3:test:recipient',
    intentState: 'succeeded',
    matchCount: 1,
    accountCreateCount: 0,
    directProviderCreateCount: 0,
    replacementAccountCount: 0,
    scopeCount: 1,
  };
}

function fakeAdapter({ post = successResult(), postError = null, failMethod = null } = {}) {
  const state = {
    gates: disabledValues(),
    school: false,
    events: [],
    postCalls: 0,
    deployCalls: 0,
  };
  const maybeFail = (name) => {
    if (failMethod === name) throw new Error('SENSITIVE_SENTINEL_DO_NOT_LEAK');
  };
  const adapter = {
    expectedDeployment: expectedDeployment(),
    async readGateState() {
      maybeFail('readGateState');
      return gateState({ ...state.gates });
    },
    async readSchoolFeature() {
      maybeFail('readSchoolFeature');
      return { schoolId: 1, value: state.school, guarded: true };
    },
    async readRetainedIntent() {
      maybeFail('readRetainedIntent');
      state.events.push('intent:reconciling');
      return retainedIntent();
    },
    async deploy({ phase }) {
      maybeFail('deploy');
      state.deployCalls += 1;
      state.events.push(`deploy:${phase}`);
      return state.deployCalls % 2 === 0
        ? '"https://fresh-deployment.vercel.app"\n'
        : 'https://fresh-deployment.vercel.app\n';
    },
    async resolveDeploymentUrl({ url, readOnly }) {
      maybeFail('resolveDeploymentUrl');
      state.events.push(`resolve:${url}:${readOnly}`);
      return metadata();
    },
    async setStagingGate({ name, value }) {
      maybeFail(`setStagingGate:${name}:${value}`);
      state.events.push(`gate:${name}:${value}`);
      state.gates[name] = value;
    },
    async setSchoolFeature({ value, guarded }) {
      maybeFail(`setSchoolFeature:${value}`);
      state.events.push(`school:${value}:${guarded}`);
      state.school = value;
    },
    async postAuthenticatedCsrfReconciliation({ policy, identity }) {
      maybeFail('postAuthenticatedCsrfReconciliation');
      state.postCalls += 1;
      state.events.push(`post:${policy.redirect}:${policy.retries}:${policy.maxAttempts}:${identity.intentId}`);
      if (postError) throw postError;
      return post;
    },
    async readPostflight() {
      maybeFail('readPostflight');
      return postflight();
    },
  };
  return { adapter, state };
}

test.describe('Simon staging reconciliation controller', () => {
  test('defaults to an offline dry-run with no operational request budget', () => {
    expect(controller.offlinePlan()).toEqual({
      controllerVersion: 1,
      mode: 'offline-dry-run',
      completed: true,
      postCount: 0,
      shutdownComplete: false,
    });
    expect(controller.parseArguments([])).toEqual({ operational: false, adapterPath: null, approval: null });
  });

  test('accepts only plain or JSON-string scalar Vercel deployment URLs', () => {
    expect(controller.parseDeploymentUrlOutput('https://fresh-deployment.vercel.app\n')).toBe('https://fresh-deployment.vercel.app');
    expect(controller.parseDeploymentUrlOutput('"https://fresh-deployment.vercel.app"\n')).toBe('https://fresh-deployment.vercel.app');

    const rejected = [
      '',
      '[]',
      '["https://fresh-deployment.vercel.app"]',
      'https://example.com',
      'http://fresh-deployment.vercel.app',
      'not-a-url',
      'log line\nhttps://fresh-deployment.vercel.app',
      'https://one.vercel.app\nhttps://two.vercel.app',
      'https://fresh-deployment.vercel.app/path',
    ];
    for (const value of rejected) {
      expect(() => controller.parseDeploymentUrlOutput(value)).toThrow(controller.ControllerError);
    }
    expect(() => controller.parseDeploymentUrlOutput(['https://fresh-deployment.vercel.app'])).toThrow('DEPLOY_OUTPUT_NOT_SCALAR');
  });

  test('selects exactly one scalar deployment ID and rejects arrays or polluted values', () => {
    expect(controller.selectDeploymentId({ id: 'dpl_ExactScalar123' })).toBe('dpl_ExactScalar123');
    expect(() => controller.selectDeploymentId({ id: ['dpl_One', 'dpl_Two'] })).toThrow('DEPLOYMENT_ID_NOT_SCALAR');
    expect(() => controller.selectDeploymentId({ id: 'log-output\ndpl_ExactScalar123' })).toThrow('DEPLOYMENT_ID_NOT_SCALAR');
    expect(() => controller.selectDeploymentId({})).toThrow('DEPLOYMENT_ID_NOT_SCALAR');
  });

  test('resolves URL read-only and validates exact isolated non-production metadata', async () => {
    const { adapter, state } = fakeAdapter();
    const selected = await controller.deployAndValidate(adapter, 'contract-test');
    expect(selected).toEqual({ id: 'dpl_ExactScalar123', url: 'https://fresh-deployment.vercel.app' });
    expect(state.events).toContain('resolve:https://fresh-deployment.vercel.app:true');

    const mutations = [
      { projectId: 'prj_WrongProject' },
      { target: 'production' },
      { meta: { gitCommitSha: 'b'.repeat(40), gitDirty: null } },
      { meta: { gitCommitSha: 'a'.repeat(40), gitDirty: false } },
      { customEnvironment: { id: 'env_Wrong', slug: 'staging' } },
      { customEnvironment: { id: 'env_CustomStaging123', slug: 'preview' } },
      { alias: ['coachcarter-simon-staging.vercel.app', 'production.example.test'] },
      { url: 'wrong-deployment.vercel.app' },
    ];
    for (const override of mutations) {
      expect(() => controller.validateDeploymentMetadata(
        metadata(override),
        expectedDeployment(),
        'https://fresh-deployment.vercel.app'
      )).toThrow(controller.ControllerError);
    }
  });

  test('requires all six named gates present and exact false in disabled state', () => {
    expect(controller.validateGateState(gateState(disabledValues()), { enabled: false })).toBe(true);
    expect(controller.validateGateState(gateState(disabledValues({ STRIPE_CONNECT_V2_LIVE_ENABLED: 'false' })), { enabled: false })).toBe(true);

    const missing = disabledValues();
    delete missing.STRIPE_CONNECT_V2_AGREEMENTS_ENABLED;
    expect(() => controller.validateGateState(gateState(missing), { enabled: false })).toThrow('DISABLED_GATE_MISSING');
    expect(() => controller.validateGateState(gateState(disabledValues({ STRIPE_CONNECT_V2_ACCOUNT_LINKS_ENABLED: 'False' })), { enabled: false })).toThrow('DISABLED_GATE_NOT_FALSE');
    expect(() => controller.validateGateState(gateState(disabledValues({ STRIPE_CONNECT_V2_LIVE_ENABLED: 'true' })), { enabled: false })).toThrow('LIVE_GATE_NOT_DISABLED');
    expect(() => controller.validateGateState({ values: disabledValues(), production: { untouched: false, mutationCount: 0 } }, { enabled: false })).toThrow('PRODUCTION_NOT_PROVEN_UNTOUCHED');
  });

  test('enables only global, account creation, and the guarded school Boolean', async () => {
    const { adapter, state } = fakeAdapter();
    const result = await controller.runOperationalController({ adapter });
    expect(result).toMatchObject({ completed: true, postCount: 1, shutdownComplete: true });

    const enableSequence = state.events.filter((event) => event.startsWith('gate:') || event.startsWith('school:')).slice(0, 3);
    expect(enableSequence).toEqual([
      'gate:STRIPE_CONNECT_V2_ENABLED:true',
      'gate:STRIPE_CONNECT_V2_ACCOUNT_CREATION_ENABLED:true',
      'school:true:true',
    ]);
    expect(state.gates).toEqual(disabledValues());
    expect(state.school).toBe(false);
  });

  test('uses one authenticated CSRF-bound POST with redirects and retries disabled', async () => {
    const { adapter, state } = fakeAdapter();
    await controller.runOperationalController({ adapter });
    expect(state.postCalls).toBe(1);
    expect(state.events.filter((event) => event.startsWith('post:'))).toEqual([
      'post:manual:0:1:3c2349a0-1696-4b57-b732-fc14bbde57df',
    ]);
    expect(controller.REQUEST_POLICY).toMatchObject({
      authenticated: true,
      csrfBound: true,
      redirect: 'manual',
      maxRedirects: 0,
      retries: 0,
      maxAttempts: 1,
    });
  });

  test('retained reconciling intent reaches listing before any creation path', async () => {
    const { adapter, state } = fakeAdapter();
    await controller.runOperationalController({ adapter });
    expect(state.events.indexOf('intent:reconciling')).toBeLessThan(state.events.findIndex((event) => event.startsWith('post:')));
    expect(successResult()).toMatchObject({ firstStripeAction: 'accounts_v2_list', accountCreateCount: 0, directProviderCreateCount: 0 });
    expect(Object.keys(adapter).some((name) => /(?:create.*account|account.*create|provider.*create)/i.test(name))).toBe(false);

    const forbidden = { ...adapter, createProviderAccount: async () => ({}) };
    await expect(controller.runOperationalController({ adapter: forbidden })).rejects.toThrow('DIRECT_PROVIDER_CREATION_SURFACE_FORBIDDEN');
  });

  test('stops on duplicate, mismatch, or ambiguous application outcomes without retry', async () => {
    const outcomes = [
      { ...successResult(), matchCount: 2 },
      { ...successResult(), stableIdentity: 'cc:connect-v2:1:4:test:recipient' },
      { ...successResult(), httpStatus: 202, applicationState: 'reconciling', hasAccount: false, matchCount: 0 },
    ];
    for (const post of outcomes) {
      const { adapter, state } = fakeAdapter({ post });
      await expect(controller.runOperationalController({ adapter })).rejects.toThrow(controller.ControllerError);
      expect(state.postCalls).toBe(1);
      expect(state.gates).toEqual(disabledValues());
      expect(state.school).toBe(false);
    }
  });

  test('runs mandatory ordered shutdown after success, failure, thrown exception, and ambiguous transport', async () => {
    const cases = [
      fakeAdapter(),
      fakeAdapter({ post: { ...successResult(), matchCount: 2 } }),
      fakeAdapter({ failMethod: 'readPostflight' }),
      fakeAdapter({ postError: new Error('SENSITIVE_SENTINEL_DO_NOT_LEAK') }),
    ];

    for (let index = 0; index < cases.length; index += 1) {
      const { adapter, state } = cases[index];
      if (index === 0) await controller.runOperationalController({ adapter });
      else await expect(controller.runOperationalController({ adapter })).rejects.toThrow(controller.ControllerError);
      const shutdown = state.events.filter((event) => event.includes(':false')).slice(-3);
      expect(shutdown).toEqual([
        'gate:STRIPE_CONNECT_V2_ACCOUNT_CREATION_ENABLED:false',
        'gate:STRIPE_CONNECT_V2_ENABLED:false',
        'school:false:true',
      ]);
      expect(state.gates).toEqual(disabledValues());
      expect(state.school).toBe(false);
      expect(state.deployCalls).toBeGreaterThanOrEqual(2);
    }
  });

  test('redacts adapter errors and does not persist authentication material', async () => {
    const events = [];
    const { adapter } = fakeAdapter({ postError: new Error('SENSITIVE_SENTINEL_DO_NOT_LEAK') });
    let message = '';
    try {
      await controller.runOperationalController({ adapter, report: (event) => events.push(event) });
    } catch (error) {
      message = error.message;
    }
    expect(message).toBe('RECONCILIATION_TRANSPORT_UNCERTAIN');
    expect(JSON.stringify(events)).not.toContain('SENSITIVE_SENTINEL_DO_NOT_LEAK');

    const source = fs.readFileSync(controllerPath, 'utf8');
    expect(source).not.toMatch(/writeFile|appendFile|createWriteStream/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/(?:postgres(?:ql)?:\/\/|BEGIN [A-Z ]*PRIVATE KEY|Bearer\s+[A-Za-z0-9._-]+)/);
    expect(source).not.toContain('response.body');
  });
});
