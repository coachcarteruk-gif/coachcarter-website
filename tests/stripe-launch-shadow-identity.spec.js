const { test, expect } = require('@playwright/test');

const {
  collectStripeLaunchShadowIdentity,
  identityFingerprint,
  readApplicationBoundIdentity,
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

const operatorEnv = Object.freeze({
  ...baseEnv,
  STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST: 'cc-simon-shadow-05-abc123.vercel.app',
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

  for (const [name, endpointHost] of [
    ['current direct AWS host', 'ep-frosty-truth-zatfdzrb.c-2.eu-west-2.aws.neon.tech'],
    ['current pooled AWS host', 'ep-frosty-truth-zatfdzrb-pooler.c-2.eu-west-2.aws.neon.tech'],
    ['existing direct AWS host', 'ep-shadow-05.eu-west-2.aws.neon.tech'],
    ['existing pooled AWS host', 'ep-shadow-05-pooler.eu-west-2.aws.neon.tech'],
    ['existing direct Azure host', 'ep-shadow-05.westeurope.azure.neon.tech'],
  ]) {
    test(`accepts the ${name} format`, async () => {
      const env = {
        ...baseEnv,
        STRIPE_LAUNCH_SHADOW_NEON_ENDPOINT_HOST: endpointHost,
        POSTGRES_URL: `postgresql://shadow_user:test-only@${endpointHost}/shadowdb?sslmode=require`,
      };
      const result = await collectStripeLaunchShadowIdentity({ env, sql, schoolId: 7 });
      expect(result.identity.neon.endpoint_host).toBe(endpointHost);
    });
  }

  for (const [name, endpointHost] of [
    ['zero cell number', 'ep-frosty-truth-zatfdzrb.c-0.eu-west-2.aws.neon.tech'],
    ['non-numeric cell', 'ep-frosty-truth-zatfdzrb.c-two.eu-west-2.aws.neon.tech'],
    ['wrong cloud', 'ep-frosty-truth-zatfdzrb.c-2.eu-west-2.gcp.neon.tech'],
    ['wrong domain', 'ep-frosty-truth-zatfdzrb.c-2.eu-west-2.aws.neon.com'],
    ['suffix injection', 'ep-frosty-truth-zatfdzrb.c-2.eu-west-2.aws.neon.tech.evil.example'],
    ['leading whitespace', ' ep-frosty-truth-zatfdzrb.c-2.eu-west-2.aws.neon.tech'],
    ['credentials', 'shadow_user@ep-frosty-truth-zatfdzrb.c-2.eu-west-2.aws.neon.tech'],
    ['port', 'ep-frosty-truth-zatfdzrb.c-2.eu-west-2.aws.neon.tech:5432'],
    ['path', 'ep-frosty-truth-zatfdzrb.c-2.eu-west-2.aws.neon.tech/neondb'],
    ['unrelated host', 'database.example.com'],
  ]) {
    test(`rejects a Neon endpoint host with ${name}`, () => {
      expect(() => readBoundIdentity({
        ...operatorEnv,
        STRIPE_LAUNCH_SHADOW_NEON_ENDPOINT_HOST: endpointHost,
      })).toThrow(expect.objectContaining({
        code: 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISSING',
        fields: ['neon.endpoint_host'],
      }));
    });
  }

  test('uses runtime VERCEL_URL only for the application bootstrap while the operator binding remains explicit', () => {
    expect(readApplicationBoundIdentity(baseEnv).vercel.deployment_host)
      .toBe('cc-simon-shadow-05-abc123.vercel.app');
    expect(() => readBoundIdentity(baseEnv)).toThrow(expect.objectContaining({
      code: 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISSING',
      fields: ['vercel.deployment_host'],
    }));
    expect(readBoundIdentity(operatorEnv).vercel.deployment_host)
      .toBe('cc-simon-shadow-05-abc123.vercel.app');
  });

  for (const [name, patch, code, field] of [
    ['missing branch identity', { NEON_BRANCH_ID: '' }, 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISSING', 'neon.branch_id'],
    ['wrong Vercel project', { VERCEL_PROJECT_ID: 'prj_OtherProject' }, 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH', 'vercel.project_id'],
    ['wrong Vercel environment', { VERCEL_ENV: 'preview' }, 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH', 'vercel.environment'],
    ['wrong configured Vercel deployment host', { STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST: 'cc-simon-shadow-05-wrong.vercel.app' }, 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH', 'vercel.deployment_host'],
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
    const bound = readBoundIdentity(operatorEnv);
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

  test('direct verifier accepts the provider-derived pooled host when Neon reports deprecated pooling as disabled', () => {
    const endpointId = 'ep-frosty-truth-zatfdzrb';
    const directEndpointHost = `${endpointId}.c-2.eu-west-2.aws.neon.tech`;
    const pooledEndpointHost = `${endpointId}-pooler.c-2.eu-west-2.aws.neon.tech`;
    const bound = readBoundIdentity({
      ...operatorEnv,
      STRIPE_LAUNCH_SHADOW_NEON_ENDPOINT_HOST: pooledEndpointHost,
      POSTGRES_URL: `postgresql://shadow_user:test-only@${pooledEndpointHost}/shadowdb?sslmode=require`,
    });
    const providerEvidence = {
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
      neonBranchResponse: {
        branch: { id: bound.neon.branch_id, project_id: bound.neon.project_id },
      },
      neonEndpointsResponse: {
        endpoints: [{
          id: endpointId,
          project_id: bound.neon.project_id,
          branch_id: bound.neon.branch_id,
          host: directEndpointHost,
          region_id: 'aws-eu-west-2',
          pooler_enabled: false,
          proxy_host: 'c-2.eu-west-2.aws.neon.tech',
        }],
      },
      neonDatabasesResponse: {
        databases: [{ name: bound.neon.database_name, branch_id: bound.neon.branch_id }],
      },
    };
    const evidence = verifyProviderBoundIdentity(providerEvidence);

    expect(evidence).toMatchObject({
      status: 'PASSED',
      identity: { neon: { endpoint_host: pooledEndpointHost } },
      approved_to_create_resources: false,
      approved_to_create_checkout: false,
    });
    expect(() => verifyProviderBoundIdentity({
      ...providerEvidence,
      neonEndpointsResponse: {
        endpoints: [{
          ...providerEvidence.neonEndpointsResponse.endpoints[0],
          id: 'ep-unrelated-provider-endpoint',
        }],
      },
    })).toThrow(expect.objectContaining({
      code: 'STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH',
      fields: ['provider.neon.endpoint_host'],
    }));
  });

  test('direct verifier rejects a provider-side branch mismatch', () => {
    const bound = readBoundIdentity(operatorEnv);
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
    const bound = readBoundIdentity(operatorEnv);
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

  test('direct verifier rejects an application and provider deployment host that differ from the operator binding', () => {
    const bound = readBoundIdentity(operatorEnv);
    const wrongHostIdentity = {
      ...bound,
      vercel: {
        ...bound.vercel,
        deployment_host: 'cc-simon-shadow-05-old.vercel.app',
      },
    };
    expect(() => verifyProviderBoundIdentity({
      schoolId: 7,
      bound,
      application: {
        ok: true,
        school_id: 7,
        identity: wrongHostIdentity,
        identity_fingerprint: identityFingerprint(7, wrongHostIdentity),
      },
      direct: {
        endpoint_host: bound.neon.endpoint_host,
        database_name: bound.neon.database_name,
      },
      vercelDeployment: {
        projectId: bound.vercel.project_id,
        target: bound.vercel.environment,
        url: wrongHostIdentity.vercel.deployment_host,
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
        'application.vercel.deployment_host',
        'provider.vercel.deployment_host',
        'application.identity_fingerprint',
      ]),
    }));
  });
});
