const crypto = require('crypto');

const VERCEL_ENVIRONMENTS = new Set(['production', 'preview', 'development']);
const VERCEL_PROJECT_ID_PATTERN = /^prj_[A-Za-z0-9]+$/;
const VERCEL_DEPLOYMENT_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/;
const NEON_PROJECT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const NEON_BRANCH_ID_PATTERN = /^br-[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
const NEON_ENDPOINT_HOST_PATTERN = /^ep-[a-z0-9-]+(?:-pooler)?\.[a-z0-9-]+\.(?:aws|azure)\.neon\.tech$/;
const DATABASE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;

class StripeLaunchShadowIdentityError extends Error {
  constructor(code, fields, message = 'Stripe launch shadow identity preflight failed') {
    super(message);
    this.name = 'StripeLaunchShadowIdentityError';
    this.code = code;
    this.fields = [...new Set(fields || [])].sort();
  }
}

function fail(code, fields) {
  throw new StripeLaunchShadowIdentityError(code, fields);
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function exactString(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
    ? value
    : null;
}

function normalizedHost(value, pattern) {
  const candidate = exactString(value)?.toLowerCase() || null;
  return candidate && pattern.test(candidate) ? candidate : null;
}

function normalizedId(value, pattern) {
  const candidate = exactString(value) || null;
  return candidate && pattern.test(candidate) ? candidate : null;
}

function databaseName(value) {
  const candidate = exactString(value) || null;
  return candidate && DATABASE_NAME_PATTERN.test(candidate) ? candidate : null;
}

function parsePostgresTarget(connectionString) {
  if (typeof connectionString !== 'string' || !connectionString) {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_MISSING', ['neon.connection']);
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_MALFORMED', ['neon.connection']);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_MALFORMED', ['neon.connection']);
  }

  const endpointHost = normalizedHost(parsed.hostname, NEON_ENDPOINT_HOST_PATTERN);
  let parsedDatabaseName = null;
  try {
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length === 1) parsedDatabaseName = databaseName(decodeURIComponent(pathParts[0]));
  } catch {
    parsedDatabaseName = null;
  }
  const malformed = [];
  if (!endpointHost) malformed.push('neon.endpoint_host');
  if (!parsedDatabaseName) malformed.push('neon.database_name');
  if (malformed.length > 0) fail('STRIPE_LAUNCH_SHADOW_IDENTITY_MALFORMED', malformed);

  return {
    endpoint_host: endpointHost,
    database_name: parsedDatabaseName,
  };
}

function readBoundIdentity(env) {
  const identity = {
    vercel: {
      project_id: normalizedId(env.STRIPE_LAUNCH_SHADOW_PROJECT_ID, VERCEL_PROJECT_ID_PATTERN),
      environment: VERCEL_ENVIRONMENTS.has(env.STRIPE_LAUNCH_SHADOW_VERCEL_ENV)
        ? env.STRIPE_LAUNCH_SHADOW_VERCEL_ENV
        : null,
      deployment_host: normalizedHost(
        env.STRIPE_LAUNCH_SHADOW_DEPLOYMENT_HOST,
        VERCEL_DEPLOYMENT_HOST_PATTERN
      ),
    },
    neon: {
      project_id: normalizedId(
        env.STRIPE_LAUNCH_SHADOW_NEON_PROJECT_ID,
        NEON_PROJECT_ID_PATTERN
      ),
      branch_id: normalizedId(
        env.STRIPE_LAUNCH_SHADOW_NEON_BRANCH_ID,
        NEON_BRANCH_ID_PATTERN
      ),
      endpoint_host: normalizedHost(
        env.STRIPE_LAUNCH_SHADOW_NEON_ENDPOINT_HOST,
        NEON_ENDPOINT_HOST_PATTERN
      ),
      database_name: databaseName(env.STRIPE_LAUNCH_SHADOW_NEON_DATABASE_NAME),
    },
  };
  const missing = [];
  for (const [provider, values] of Object.entries(identity)) {
    for (const [field, value] of Object.entries(values)) {
      if (!value) missing.push(`${provider}.${field}`);
    }
  }
  if (missing.length > 0) fail('STRIPE_LAUNCH_SHADOW_IDENTITY_MISSING', missing);
  return identity;
}

function readRuntimeProviderIdentity(env) {
  const identity = {
    vercel: {
      project_id: normalizedId(env.VERCEL_PROJECT_ID, VERCEL_PROJECT_ID_PATTERN),
      environment: VERCEL_ENVIRONMENTS.has(env.VERCEL_ENV) ? env.VERCEL_ENV : null,
      deployment_host: normalizedHost(env.VERCEL_URL, VERCEL_DEPLOYMENT_HOST_PATTERN),
    },
    neon: {
      project_id: normalizedId(env.NEON_PROJECT_ID, NEON_PROJECT_ID_PATTERN),
      branch_id: normalizedId(env.NEON_BRANCH_ID, NEON_BRANCH_ID_PATTERN),
    },
  };
  const missing = [];
  for (const [provider, values] of Object.entries(identity)) {
    for (const [field, value] of Object.entries(values)) {
      if (!value) missing.push(`${provider}.${field}`);
    }
  }
  if (missing.length > 0) fail('STRIPE_LAUNCH_SHADOW_IDENTITY_MISSING', missing);
  return identity;
}

function identityFingerprint(schoolId, identity) {
  const canonical = JSON.stringify({
    version: 'stripe_launch_shadow_identity_v1',
    school_id: schoolId,
    vercel: identity.vercel,
    neon: identity.neon,
  });
  return `sha256:${crypto.createHash('sha256').update(canonical).digest('hex')}`;
}

async function collectStripeLaunchShadowIdentity({
  env = process.env,
  sql,
  connectionString = env.POSTGRES_URL,
  schoolId,
} = {}) {
  const requestedSchoolId = positiveInteger(schoolId);
  const configuredSchoolId = positiveInteger(env.STRIPE_LAUNCH_SHADOW_SCHOOL_ID);
  const boundaryFailures = [];
  if (env.STRIPE_LAUNCH_SHADOW_OPERATIONS_ENABLED !== 'true') {
    boundaryFailures.push('shadow.operations_enabled');
  }
  if (env.STRIPE_MODE !== 'test') boundaryFailures.push('stripe.mode');
  if (!configuredSchoolId || !requestedSchoolId || configuredSchoolId !== requestedSchoolId) {
    boundaryFailures.push('school_id');
  }
  if (boundaryFailures.length > 0) {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_BOUNDARY_MISMATCH', boundaryFailures);
  }
  if (typeof sql !== 'function') {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_MISSING', ['neon.database_query']);
  }

  const bound = readBoundIdentity(env);
  const runtime = readRuntimeProviderIdentity(env);
  const connection = parsePostgresTarget(connectionString);

  let rows;
  try {
    rows = await sql`SELECT current_database() AS database_name`;
  } catch {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_DATABASE_UNAVAILABLE', ['neon.database_query']);
  }
  const observedDatabaseName = databaseName(rows?.[0]?.database_name);
  if (!observedDatabaseName) {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_MALFORMED', ['neon.database_name']);
  }

  const observed = {
    vercel: runtime.vercel,
    neon: {
      project_id: runtime.neon.project_id,
      branch_id: runtime.neon.branch_id,
      endpoint_host: connection.endpoint_host,
      database_name: observedDatabaseName,
    },
  };
  const mismatches = [];
  for (const provider of ['vercel', 'neon']) {
    for (const field of Object.keys(bound[provider])) {
      if (bound[provider][field] !== observed[provider][field]) {
        mismatches.push(`${provider}.${field}`);
      }
    }
  }
  if (connection.database_name !== observedDatabaseName) {
    mismatches.push('neon.connection_database_name');
  }
  if (mismatches.length > 0) {
    fail('STRIPE_LAUNCH_SHADOW_IDENTITY_MISMATCH', mismatches);
  }

  return {
    identity: observed,
    identity_fingerprint: identityFingerprint(requestedSchoolId, observed),
  };
}

module.exports = {
  StripeLaunchShadowIdentityError,
  collectStripeLaunchShadowIdentity,
  identityFingerprint,
  parsePostgresTarget,
  readBoundIdentity,
};
