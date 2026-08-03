#!/usr/bin/env node
'use strict';

const { neon } = require('@neondatabase/serverless');
const {
  StripeLaunchShadowIdentityError,
  identityFingerprint,
  parsePostgresTarget,
  readBoundIdentity,
} = require('../api/_stripe-launch-shadow-identity');

function fail(code, fields) {
  throw new StripeLaunchShadowIdentityError(code, fields);
}

function requiredSecret(env, name, minimumLength = 1) {
  const value = env[name];
  if (typeof value !== 'string' || value.length < minimumLength) {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_VERIFIER_MISSING', [name.toLowerCase()]);
  }
  return value;
}

async function fetchJson(fetchImpl, url, { token, headers = {} } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_PROVIDER_UNAVAILABLE', ['provider_response']);
  }
  if (!response?.ok) {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_PROVIDER_REJECTED', ['provider_response']);
  }
  try {
    return await response.json();
  } catch {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_PROVIDER_MALFORMED', ['provider_response']);
  }
}

function pooledHostFor(endpoint) {
  const host = typeof endpoint?.host === 'string' ? endpoint.host.toLowerCase() : '';
  const endpointId = typeof endpoint?.id === 'string' ? endpoint.id : '';
  if (!host || !/^ep-[a-z0-9-]+$/.test(endpointId)) return null;
  const dot = host.indexOf('.');
  if (dot <= 0) return null;
  if (host.slice(0, dot) !== endpointId) return null;
  return `${endpointId}-pooler${host.slice(dot)}`;
}

function verifyProviderBoundIdentity({
  schoolId,
  bound,
  application,
  direct,
  vercelDeployment,
  neonBranchResponse,
  neonEndpointsResponse,
  neonDatabasesResponse,
}) {
  const mismatches = [];
  if (application?.ok !== true) mismatches.push('application.ok');
  if (Number(application?.school_id) !== Number(schoolId)) mismatches.push('application.school_id');

  for (const provider of ['vercel', 'neon']) {
    for (const [field, expected] of Object.entries(bound[provider])) {
      if (application?.identity?.[provider]?.[field] !== expected) {
        mismatches.push(`application.${provider}.${field}`);
      }
    }
  }
  if (direct?.endpoint_host !== bound.neon.endpoint_host) {
    mismatches.push('direct.neon.endpoint_host');
  }
  if (direct?.database_name !== bound.neon.database_name) {
    mismatches.push('direct.neon.database_name');
  }

  const deploymentProjectId = vercelDeployment?.projectId || vercelDeployment?.project?.id || null;
  const deploymentEnvironment = vercelDeployment?.target || vercelDeployment?.environment || null;
  const deploymentHost = typeof vercelDeployment?.url === 'string'
    ? vercelDeployment.url.toLowerCase()
    : null;
  if (deploymentProjectId !== bound.vercel.project_id) mismatches.push('provider.vercel.project_id');
  if (deploymentEnvironment !== bound.vercel.environment) mismatches.push('provider.vercel.environment');
  if (deploymentHost !== bound.vercel.deployment_host) mismatches.push('provider.vercel.deployment_host');

  const neonBranch = neonBranchResponse?.branch || neonBranchResponse;
  if (neonBranch?.id !== bound.neon.branch_id) mismatches.push('provider.neon.branch_id');
  if (neonBranch?.project_id && neonBranch.project_id !== bound.neon.project_id) {
    mismatches.push('provider.neon.project_id');
  }

  const endpoints = Array.isArray(neonEndpointsResponse?.endpoints)
    ? neonEndpointsResponse.endpoints
    : [];
  const endpoint = endpoints.find((candidate) => {
    const candidateHosts = [candidate?.host?.toLowerCase(), pooledHostFor(candidate)].filter(Boolean);
    return candidate?.project_id === bound.neon.project_id
      && candidate?.branch_id === bound.neon.branch_id
      && candidateHosts.includes(bound.neon.endpoint_host);
  });
  if (!endpoint) mismatches.push('provider.neon.endpoint_host');

  const databases = Array.isArray(neonDatabasesResponse?.databases)
    ? neonDatabasesResponse.databases
    : [];
  const database = databases.find((candidate) => (
    candidate?.name === bound.neon.database_name
    && (!candidate.branch_id || candidate.branch_id === bound.neon.branch_id)
  ));
  if (!database) mismatches.push('provider.neon.database_name');

  const fingerprint = identityFingerprint(Number(schoolId), bound);
  if (application?.identity_fingerprint !== fingerprint) {
    mismatches.push('application.identity_fingerprint');
  }
  if (mismatches.length > 0) {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH', mismatches);
  }

  return {
    status: 'PASSED',
    school_id: Number(schoolId),
    identity: bound,
    identity_fingerprint: fingerprint,
    transaction_read_only: true,
    approved_to_create_resources: false,
    approved_to_create_checkout: false,
  };
}

async function queryDirectDatabaseIdentity(connectionString) {
  const connection = parsePostgresTarget(connectionString);
  const sql = neon(connectionString);
  let results;
  try {
    results = await sql.transaction((txn) => [
      txn`SELECT current_setting('transaction_read_only') AS transaction_read_only`,
      txn`SELECT current_database() AS database_name`,
    ], {
      isolationLevel: 'Serializable',
      readOnly: true,
      deferrable: true,
    });
  } catch {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_DATABASE_UNAVAILABLE', ['direct.neon.database_query']);
  }
  if (results?.[0]?.[0]?.transaction_read_only !== 'on') {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_READ_ONLY_REQUIRED', ['direct.neon.transaction']);
  }
  const observedName = results?.[1]?.[0]?.database_name;
  if (typeof observedName !== 'string' || !observedName) {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_PROVIDER_MALFORMED', ['direct.neon.database_name']);
  }
  return {
    endpoint_host: connection.endpoint_host,
    database_name: observedName,
  };
}

async function runIdentityPreflight({
  env = process.env,
  fetchImpl = global.fetch,
  directDatabaseQuery = queryDirectDatabaseIdentity,
  readOnlyConfirmed = process.argv.includes('--read-only'),
} = {}) {
  if (!readOnlyConfirmed) {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_READ_ONLY_REQUIRED', ['command.read_only']);
  }
  if (typeof fetchImpl !== 'function') {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_VERIFIER_MISSING', ['fetch']);
  }

  const bound = readBoundIdentity(env);
  const schoolId = Number(env.STRIPE_LAUNCH_SHADOW_SCHOOL_ID);
  if (!Number.isSafeInteger(schoolId) || schoolId <= 0) {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_VERIFIER_MISSING', ['school_id']);
  }
  const shadowSecret = requiredSecret(env, 'STRIPE_LAUNCH_SHADOW_CRON_SECRET', 32);
  const vercelToken = requiredSecret(env, 'VERCEL_TOKEN');
  const neonApiKey = requiredSecret(env, 'NEON_API_KEY');
  const directDatabaseUrl = requiredSecret(env, 'STRIPE_LAUNCH_SHADOW_DIRECT_DATABASE_URL');

  const appHeaders = {};
  if (env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    appHeaders['x-vercel-protection-bypass'] = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  const application = await fetchJson(
    fetchImpl,
    `https://${bound.vercel.deployment_host}/api/stripe-launch-shadow-identity?school_id=${schoolId}`,
    { token: shadowSecret, headers: appHeaders }
  );
  const direct = await directDatabaseQuery(directDatabaseUrl);

  const vercelTeam = env.VERCEL_TEAM_ID
    ? `?teamId=${encodeURIComponent(env.VERCEL_TEAM_ID)}`
    : '';
  const vercelDeployment = await fetchJson(
    fetchImpl,
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(bound.vercel.deployment_host)}${vercelTeam}`,
    { token: vercelToken }
  );

  const neonBase = `https://console.neon.tech/api/v2/projects/${encodeURIComponent(bound.neon.project_id)}`;
  const neonHeaders = { Authorization: `Bearer ${neonApiKey}` };
  const [neonBranchResponse, neonEndpointsResponse, neonDatabasesResponse] = await Promise.all([
    fetchJson(fetchImpl, `${neonBase}/branches/${encodeURIComponent(bound.neon.branch_id)}`, { headers: neonHeaders }),
    fetchJson(fetchImpl, `${neonBase}/endpoints`, { headers: neonHeaders }),
    fetchJson(
      fetchImpl,
      `${neonBase}/branches/${encodeURIComponent(bound.neon.branch_id)}/databases`,
      { headers: neonHeaders }
    ),
  ]);

  return verifyProviderBoundIdentity({
    schoolId,
    bound,
    application,
    direct,
    vercelDeployment,
    neonBranchResponse,
    neonEndpointsResponse,
    neonDatabasesResponse,
  });
}

if (require.main === module) {
  runIdentityPreflight()
    .then((evidence) => process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`))
    .catch((error) => {
      const known = error instanceof StripeLaunchShadowIdentityError;
      process.stderr.write(`${JSON.stringify({
        status: 'BLOCKED',
        code: known ? error.code : 'STRIPE_LAUNCH_SHADOW_IDENTITY_PREFLIGHT_FAILED',
        fields: known ? error.fields : [],
        approved_to_create_resources: false,
        approved_to_create_checkout: false,
      }, null, 2)}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  queryDirectDatabaseIdentity,
  runIdentityPreflight,
  verifyProviderBoundIdentity,
};
