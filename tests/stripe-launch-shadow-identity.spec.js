const { test, expect } = require('@playwright/test');

const {
  collectStripeLaunchShadowIdentity,
  identityFingerprint,
  readBoundIdentity,
} = require('../api/_stripe-launch-shadow-identity');
const identityRoute = require('../api/stripe-launch-shadow-identity');
const {
  verifyProviderBoundIdentity,
} = require('../scripts/stripe-launch-shadow-identity-preflight');

const secret = 'shadow-identity-secret-at-least-32-characters';
const baseEnv = Object.freeze({
  STRIPE_LAUNCH_SHADOW_OPERATIONS_ENABLED: 'true',
  STRIPE_LAUNCH_SHADOW_PROJECT_ID: 'prj_Shadow05Identity',
  STRIPE_LAUNCH_SHADOW_SCHOOL_ID: '7',
  STRIPE_LAUNCH_SHADOW_CRON_SECRET: secret,
  STRIPE_LAUNCH_SHADOW_VERCEL_ENV: 'production',
  STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST: 'cc-simon-shadow-05-abc123.vercel.app',
  STRIPE_LAUNCH_SHADOW_NEON_PROJECT_ID: 'shadow-project-12345678',
  STRIPE_LAUNCH_SHADOW_NEON_BRANCH_ID: 'br-shadow-05-abcdef',
  STRIPE_LAUNCH_SHADOW_NEON_ENDPOINT_HOST: 'ep-shadow-05.eu-west-2.aws.neon.tech',
  STRIPE_LAUNCH_SHADOW_NEON_DATABASE_NAME: 'shadowdb',
  STRIPE_MODE: 'test',
  VERCEL_PROJECT_ID: 'prj_Shadow05Identity',
  VERCEL_ENV: 'production',
  VERCEL_URL: 'cc-simon-shadow-05-abc123.vercel.app',
  NEON_PROJECT_ID: 'shadow-project-12345678',
  NEON_BRANCH_ID: 'br-shadow-05-abcdef',
  POSTGRES_URL: 'postgresql://shadow_user:never-print-this-password@ep-shadow-05.eu-west-2.aws.neon.tech/shadowdb?sslmode=require',
});

const sql = async () => [{ database_name: 'shadowdb' }];

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    },
  };
}

async function withProcessEnv(values, callback) {
  const prior = new Map();
  for (const [key, value] of Object.entries(values)) {
    prior.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test.describe('Stripe launch shadow deployment/database identity', () => {
  test('accepts an exact provider-derived Vercel and Neon binding', async () => {
    const result = await collectStripeLaunchShadowIdentity({
      env: { ...baseEnv },
      sql,
      schoolId: 7,
    });
    expect(result.identity).toEqual({
      vercel: {
        project_id: 'prj_Shadow05Identity',
        environment: 'production',
        deployment_host: 'cc-simon-shadow-05-abc123.vercel.app',
      },
      neon: {
        project_id: 'shadow-project-12345678',
        branch_id: 'br-shadow-05-abcdef',
        endpoint_host: 'ep-shadow-05.eu-west-2.aws.neon.tech',
        database_name: 'shadowdb',
      },
    });
    expect(result.identity_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  for (const [name, patch, code, field] of [
    ['missing branch identity', { NEON_BRANCH_ID: '' }, 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISSING', 'neon.branch_id'],
    ['wrong Vercel project', { VERCEL_PROJECT_ID: 'prj_OtherProject' }, 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH', 'vercel.project_id'],
    ['wrong Vercel environment', { VERCEL_ENV: 'preview' }, 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH', 'vercel.environment'],
    ['wrong Neon project', { NEON_PROJECT_ID: 'other-project-87654321' }, 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH', 'neon.project_id'],
    ['wrong Neon branch', { NEON_BRANCH_ID: 'br-other-branch-abcdef' }, 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH', 'neon.branch_id'],
    ['wrong endpoint host', { POSTGRES_URL: 'postgresql://u:p@ep-other-05.eu-west-2.aws.neon.tech/shadowdb' }, 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH', 'neon.endpoint_host'],
  ]) {
    test(`fails closed for ${name}`, async () => {
      await expect(collectStripeLaunchShadowIdentity({
        env: { ...baseEnv, ...patch },
        sql,
        schoolId: 7,
      })).rejects.toMatchObject({ code, fields: expect.arrayContaining([field]) });
    });
  }

  test('fails closed when the URL database and connected database disagree', async () => {
    await expect(collectStripeLaunchShadowIdentity({
      env: { ...baseEnv },
      sql: async () => [{ database_name: 'otherdb' }],
      schoolId: 7,
    })).rejects.toMatchObject({
      code: 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH',
      fields: expect.arrayContaining(['neon.database_name', 'neon.connection_database_name']),
    });
  });

  test('rejects the shadow-04-style deployment/database cross-binding', async () => {
    await expect(collectStripeLaunchShadowIdentity({
      env: {
        ...baseEnv,
        VERCEL_URL: 'cc-simon-s2-shadow-04-old.vercel.app',
        POSTGRES_URL: 'postgresql://u:p@ep-shadow-04.eu-west-2.aws.neon.tech/legacydb',
      },
      sql: async () => [{ database_name: 'legacydb' }],
      schoolId: 7,
    })).rejects.toMatchObject({
      code: 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH',
      fields: expect.arrayContaining([
        'vercel.deployment_host',
        'neon.endpoint_host',
        'neon.database_name',
      ]),
    });
  });

  test('fails closed at the school and test-mode boundary', async () => {
    await expect(collectStripeLaunchShadowIdentity({
      env: { ...baseEnv },
      sql,
      schoolId: 8,
    })).rejects.toMatchObject({
      code: 'STRIPE_LAUNCH_SHADOW_IDENTITY_BOUNDARY_MISMATCH',
      fields: ['school_id'],
    });
    await expect(collectStripeLaunchShadowIdentity({
      env: { ...baseEnv, STRIPE_MODE: 'live' },
      sql,
      schoolId: 7,
    })).rejects.toMatchObject({
      code: 'STRIPE_LAUNCH_SHADOW_IDENTITY_BOUNDARY_MISMATCH',
      fields: ['stripe.mode'],
    });
  });

  test('returns only sanitized identity evidence', async () => {
    const result = await collectStripeLaunchShadowIdentity({ env: { ...baseEnv }, sql, schoolId: 7 });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('never-print-this-password');
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('STRIPE_LAUNCH_SHADOW_CRON_SECRET');
  });

  test('protected route rejects public, wrong-project, and wrong-tenant calls', async () => {
    await withProcessEnv(baseEnv, async () => {
      for (const [reqPatch, envPatch] of [
        [{ headers: {}, query: { school_id: '7' } }, {}],
        [{ headers: { authorization: `Bearer ${secret}` }, query: { school_id: '8' } }, {}],
        [{ headers: { authorization: `Bearer ${secret}` }, query: { school_id: '7' } }, { VERCEL_PROJECT_ID: 'prj_OtherProject' }],
      ]) {
        const res = responseRecorder();
        await withProcessEnv(envPatch, async () => identityRoute({
          method: 'GET',
          headers: { authorization: `Bearer ${secret}` },
          query: { school_id: '7' },
          sql,
          ...reqPatch,
        }, res));
        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ error: 'Unauthorised' });
      }
    });
  });

  test('protected route exposes a sanitized pass and a field-only environment mismatch', async () => {
    await withProcessEnv(baseEnv, async () => {
      const req = {
        method: 'GET',
        headers: { authorization: `Bearer ${secret}` },
        query: { school_id: '7' },
        sql,
      };
      const passed = responseRecorder();
      await identityRoute(req, passed);
      expect(passed.statusCode).toBe(200);
      expect(passed.body).toMatchObject({ ok: true, school_id: 7 });
      expect(JSON.stringify(passed.body)).not.toContain('never-print-this-password');

      const blocked = responseRecorder();
      await withProcessEnv({ VERCEL_ENV: 'preview' }, async () => identityRoute(req, blocked));
      expect(blocked.statusCode).toBe(409);
      expect(blocked.body).toEqual({
        ok: false,
        code: 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH',
        fields: ['vercel.environment'],
      });
    });
  });

  test('direct verifier independently matches Vercel deployment and Neon control-plane evidence', () => {
    const bound = readBoundIdentity(baseEnv);
    const fingerprint = identityFingerprint(7, bound);
    const evidence = verifyProviderBoundIdentity({
      schoolId: 7,
      bound,
      application: {
        ok: true,
        school_id: 7,
        identity: bound,
        identity_fingerprint: fingerprint,
      },
      direct: {
        endpoint_host: bound.neon.endpoint_host,
        database_name: bound.neon.database_name,
      },
      vercelDeployment: {
        projectId: bound.vercel.project_id,
        target: bound.vercel.environment,
        url: bound.vercel.deployment_host,
      },
      neonBranchResponse: {
        branch: { id: bound.neon.branch_id, project_id: bound.neon.project_id },
      },
      neonEndpointsResponse: {
        endpoints: [{
          project_id: bound.neon.project_id,
          branch_id: bound.neon.branch_id,
          host: bound.neon.endpoint_host,
          pooler_enabled: false,
        }],
      },
      neonDatabasesResponse: {
        databases: [{ name: bound.neon.database_name, branch_id: bound.neon.branch_id }],
      },
    });
    expect(evidence).toMatchObject({
      status: 'PASSED',
      school_id: 7,
      transaction_read_only: true,
      approved_to_create_resources: false,
      approved_to_create_checkout: false,
    });
    expect(JSON.stringify(evidence)).not.toContain('secret');
  });

  test('direct verifier rejects a provider-side branch mismatch', () => {
    const bound = readBoundIdentity(baseEnv);
    expect(() => verifyProviderBoundIdentity({
      schoolId: 7,
      bound,
      application: {
        ok: true,
        school_id: 7,
        identity: bound,
        identity_fingerprint: identityFingerprint(7, bound),
      },
      direct: {
        endpoint_host: bound.neon.endpoint_host,
        database_name: bound.neon.database_name,
      },
      vercelDeployment: {
        projectId: bound.vercel.project_id,
        target: bound.vercel.environment,
        url: bound.vercel.deployment_host,
      },
      neonBranchResponse: { branch: { id: 'br-other-branch-abcdef' } },
      neonEndpointsResponse: { endpoints: [] },
      neonDatabasesResponse: { databases: [{ name: bound.neon.database_name }] },
    })).toThrow(expect.objectContaining({
      code: 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH',
      fields: expect.arrayContaining(['provider.neon.branch_id']),
    }));
  });

  test('direct verifier rejects provider-side Vercel project and environment mismatch', () => {
    const bound = readBoundIdentity(baseEnv);
    expect(() => verifyProviderBoundIdentity({
      schoolId: 7,
      bound,
      application: {
        ok: true,
        school_id: 7,
        identity: bound,
        identity_fingerprint: identityFingerprint(7, bound),
      },
      direct: {
        endpoint_host: bound.neon.endpoint_host,
        database_name: bound.neon.database_name,
      },
      vercelDeployment: {
        projectId: 'prj_OtherProject',
        target: 'preview',
        url: bound.vercel.deployment_host,
      },
      neonBranchResponse: {
        branch: { id: bound.neon.branch_id, project_id: bound.neon.project_id },
      },
      neonEndpointsResponse: {
        endpoints: [{
          project_id: bound.neon.project_id,
          branch_id: bound.neon.branch_id,
          host: bound.neon.endpoint_host,
          pooler_enabled: false,
        }],
      },
      neonDatabasesResponse: {
        databases: [{ name: bound.neon.database_name, branch_id: bound.neon.branch_id }],
      },
    })).toThrow(expect.objectContaining({
      code: 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH',
      fields: expect.arrayContaining([
        'provider.vercel.project_id',
        'provider.vercel.environment',
      ]),
    }));
  });
});
