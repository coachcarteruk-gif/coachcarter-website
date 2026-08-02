const { safeEqual } = require('./_auth');

const SHADOW_OPERATIONS = Object.freeze({
  RECONCILE_PAYMENTS: 'reconcile_payments',
  EXPIRE_REQUESTS: 'expire_requests',
});

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function bearerToken(req) {
  const header = req?.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

/**
 * Authenticate one deliberately narrow shadow operation. This is separate
 * from CRON_SECRET so a shadow project never needs a production/global cron
 * credential. Project, test-mode, tenant and operation bindings all fail
 * closed; callers must still verify that the school's launch config is live.
 */
function authorizeStripeLaunchShadowOperation(req, {
  operation,
  env = process.env,
} = {}) {
  if (!Object.values(SHADOW_OPERATIONS).includes(operation)) return null;
  if (env.STRIPE_LAUNCH_SHADOW_OPERATIONS_ENABLED !== 'true') return null;
  if (env.STRIPE_MODE !== 'test') return null;

  const expectedProjectId = env.STRIPE_LAUNCH_SHADOW_PROJECT_ID;
  const currentProjectId = env.VERCEL_PROJECT_ID;
  if (!expectedProjectId || !currentProjectId || !safeEqual(currentProjectId, expectedProjectId)) {
    return null;
  }

  const configuredSchoolId = positiveInteger(env.STRIPE_LAUNCH_SHADOW_SCHOOL_ID);
  const requestedSchoolId = positiveInteger(req?.query?.school_id);
  if (!configuredSchoolId || requestedSchoolId !== configuredSchoolId) return null;

  const secret = env.STRIPE_LAUNCH_SHADOW_CRON_SECRET;
  const supplied = bearerToken(req);
  if (typeof secret !== 'string' || secret.length < 32 || !supplied || !safeEqual(supplied, secret)) {
    return null;
  }

  return {
    operation,
    projectId: currentProjectId,
    schoolId: configuredSchoolId,
  };
}

module.exports = {
  SHADOW_OPERATIONS,
  authorizeStripeLaunchShadowOperation,
};
