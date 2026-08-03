const { neon } = require('@neondatabase/serverless');
const {
  SHADOW_OPERATIONS,
  authorizeStripeLaunchShadowOperation,
} = require('./_stripe-launch-shadow-auth');
const {
  collectStripeLaunchShadowIdentity,
  StripeLaunchShadowIdentityError,
} = require('./_stripe-launch-shadow-identity');
const { reportError } = require('./_error-alert');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const shadowAuth = authorizeStripeLaunchShadowOperation(req, {
    operation: SHADOW_OPERATIONS.IDENTITY_PREFLIGHT,
  });
  if (!shadowAuth) return res.status(401).json({ error: 'Unauthorised' });

  try {
    const sql = req.sql || req._sql || neon(process.env.POSTGRES_URL);
    const result = await collectStripeLaunchShadowIdentity({
      sql,
      schoolId: shadowAuth.schoolId,
    });
    return res.json({
      ok: true,
      school_id: shadowAuth.schoolId,
      ...result,
    });
  } catch (err) {
    if (err instanceof StripeLaunchShadowIdentityError) {
      const status = err.code === 'STRIPE_LAUNCH_SHADOW_IDENTITY_DATABASE_UNAVAILABLE' ? 503 : 409;
      return res.status(status).json({
        ok: false,
        code: err.code,
        fields: err.fields,
      });
    }
    reportError('/api/stripe-launch-shadow-identity', err);
    return res.status(500).json({
      ok: false,
      code: 'STRIPE_LAUNCH_SHADOW_IDENTITY_PREFLIGHT_FAILED',
    });
  }
};
