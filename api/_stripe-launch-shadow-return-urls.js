const {
  PAYMENT_CONTRACT_SCHEMA_VERSION,
  PAYMENT_ORIGINS,
} = require('./_stripe-launch-payment-contracts');
const {
  collectStripeLaunchShadowIdentity,
  StripeLaunchShadowIdentityError,
} = require('./_stripe-launch-shadow-identity');

const SUPPORTED_ORIGINS = new Set(Object.values(PAYMENT_ORIGINS));

function launchOrigin(launchMetadata) {
  const metadata = launchMetadata || {};
  const hasCandidate = typeof metadata.payment_contract_candidate_id === 'string'
    && metadata.payment_contract_candidate_id.length > 0;
  const hasSchema = typeof metadata.payment_contract_schema_version === 'string'
    && metadata.payment_contract_schema_version.length > 0;
  const hasOrigin = typeof metadata.payment_origin === 'string'
    && metadata.payment_origin.length > 0;
  if (!hasCandidate && !hasSchema && !hasOrigin) return null;
  if (
    !hasCandidate
    || metadata.payment_contract_schema_version !== PAYMENT_CONTRACT_SCHEMA_VERSION
    || !SUPPORTED_ORIGINS.has(metadata.payment_origin)
  ) {
    throw new StripeLaunchShadowIdentityError(
      'STRIPE_LAUNCH_SHADOW_RETURN_URL_EVIDENCE_INVALID',
      ['payment_candidate']
    );
  }
  return metadata.payment_origin;
}

function shadowReturnPath(value, field) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    throw new StripeLaunchShadowIdentityError(
      'STRIPE_LAUNCH_SHADOW_RETURN_URL_PATH_INVALID',
      [field]
    );
  }
  const parsed = new URL(value, 'https://shadow.invalid');
  if (parsed.origin !== 'https://shadow.invalid') {
    throw new StripeLaunchShadowIdentityError(
      'STRIPE_LAUNCH_SHADOW_RETURN_URL_PATH_INVALID',
      [field]
    );
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function resolveStripeCheckoutReturnUrls({
  env = process.env,
  sql,
  schoolId,
  launchMetadata,
  legacyBaseUrl,
  successPath,
  cancelPath,
} = {}) {
  const origin = launchOrigin(launchMetadata);
  if (!origin) {
    return {
      successUrl: `${legacyBaseUrl}${successPath}`,
      cancelUrl: `${legacyBaseUrl}${cancelPath}`,
      shadow: false,
    };
  }

  const safeSuccessPath = shadowReturnPath(successPath, 'success_url');
  const safeCancelPath = shadowReturnPath(cancelPath, 'cancel_url');
  const preflight = await collectStripeLaunchShadowIdentity({ env, sql, schoolId });
  const baseUrl = `https://${preflight.identity.vercel.deployment_host}`;
  return {
    successUrl: `${baseUrl}${safeSuccessPath}`,
    cancelUrl: `${baseUrl}${safeCancelPath}`,
    shadow: true,
    paymentOrigin: origin,
    identityFingerprint: preflight.identity_fingerprint,
  };
}

module.exports = {
  resolveStripeCheckoutReturnUrls,
};
