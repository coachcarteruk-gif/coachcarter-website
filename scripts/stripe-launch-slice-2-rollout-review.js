#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function inspect() {
  const contracts = read('api/_stripe-launch-payment-contracts.js');
  const reconciler = read('api/_stripe-launch-payment-reconciler.js');
  const webhook = read('api/webhook.js');
  const slots = read('api/slots.js');
  const offers = read('api/offers.js');
  const cron = read('api/cron-reconcile-payments.js');
  const requests = read('api/requests.js');
  const shadowAuth = read('api/_stripe-launch-shadow-auth.js');
  const shadowIdentity = read('api/_stripe-launch-shadow-identity.js');
  const shadowIdentityRoute = read('api/stripe-launch-shadow-identity.js');
  const shadowReturnUrls = read('api/_stripe-launch-shadow-return-urls.js');
  const shadowIdentityVerifier = read('scripts/stripe-launch-shadow-identity-preflight.js');
  const magicLink = read('api/magic-link.js');
  const shadow = read('api/_payout-v2-shadow.js');
  const transfers = read('api/_payout-v2-transfer-executor.js');
  const packet = read('docs/stripe-connect-simon-slice-2-rollout-review.md');
  const payoutSourceGuardFix = read('db/migrations/040_stripe_launch_payout_source_fill_once_fix.sql');
  const preflight = read('db/diagnostics/stripe-launch-slice-2-preflight.sql');
  const postflight = read('db/diagnostics/stripe-launch-slice-2-postflight.sql');
  const slice2Sources = [contracts, reconciler].join('\n');

  const origins = [
    'direct_slot',
    'test_date_direct',
    'one_off_offer',
    'captured_request',
  ];
  const forbiddenStripeMutations = /\b(?:transfers|refunds|accounts|accountLinks|paymentIntents)\.(?:create|update|capture|cancel|confirm)\s*\(/;
  const forbiddenSqlMutations = /INSERT INTO\s+(?:stripe_launch_booking_earnings|stripe_launch_transfer_intents|stripe_launch_transfer_attempts|refund_intents|refund_attempts)/i;
  const diagnosticsAreReadOnly = (source) => (
    source.includes('BEGIN TRANSACTION READ ONLY')
    && !/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|CALL)\b/i.test(
      source.replace(/--.*$/gm, '')
    )
  );

  const checks = {
    preparedOnly:
      packet.includes('PREPARED — NOT APPROVED — NOT DEPLOYED')
      && packet.includes('No production command in this packet is authorised'),
    strictShadowGate:
      contracts.includes("const SHADOW_WRITER_MODE = 'shadow'")
      && contracts.includes('mode = ${SHADOW_WRITER_MODE}')
      && webhook.includes('await loadShadowLaunchConfig(sql, schoolId)'),
    exactOriginWhitelist:
      origins.every((origin) => contracts.includes(`'${origin}'`))
      && slots.includes('PAYMENT_ORIGINS.DIRECT_SLOT')
      && slots.includes('PAYMENT_ORIGINS.TEST_DATE_DIRECT')
      && slots.includes('PAYMENT_ORIGINS.CAPTURED_REQUEST')
      && offers.includes('PAYMENT_ORIGINS.ONE_OFF_OFFER')
      && (slots.match(/resolveStripeCheckoutReturnUrls\(\{/g) || []).length === 4
      && (offers.match(/resolveStripeCheckoutReturnUrls\(\{/g) || []).length === 1,
    unsupportedShapesDoNotWrite:
      webhook.includes("reason: 'unsupported_launch_payment_shape'")
      && webhook.includes('if (launchContract)')
      && !webhook.includes('writeStripeFundingSource({'),
    exactEvidenceRequired:
      contracts.includes('missing_stripe_payment_created_at')
      && contracts.includes('missing_stripe_funds_available_at')
      && contracts.includes('missing_balance_transaction_status')
      && contracts.includes('credit_transaction_stripe_fee_contradiction')
      && contracts.includes('booking_contribution_stripe_fee_contradiction')
      && contracts.includes('payment_does_not_map_to_exactly_one_active_lesson'),
    tenantScopeAndAtomicLink:
      contracts.includes('WHERE ct.id = $1 AND ct.school_id = $2')
      && contracts.includes('WHERE b.id = $2 AND b.school_id = $3')
      && contracts.includes('withNeonTransaction')
      && contracts.includes('lesson_payment_contract_id = COALESCE'),
    replayAndReconciliation:
      contracts.includes('ON CONFLICT (id) DO NOTHING')
      && contracts.includes('ON CONFLICT (school_id, source_fingerprint) DO NOTHING')
      && reconciler.includes("c.evidence_status = 'pending'")
      && reconciler.includes('SELECT DISTINCT ON (ct.school_id, ct.id)')
      && reconciler.includes("THEN 'captured_request'")
      && reconciler.includes("THEN 'one_off_offer'")
      && reconciler.includes("THEN 'test_date_direct'")
      && reconciler.includes("ELSE 'direct_slot'")
      && reconciler.includes('stripeEvidenceFetcher')
      && cron.includes('reconcilePendingLaunchPaymentContracts'),
    shadowOperationsFailClosed:
      shadowAuth.includes("env.STRIPE_MODE !== 'test'")
      && shadowAuth.includes("IDENTITY_PREFLIGHT: 'identity_preflight'")
      && shadowAuth.includes('STRIPE_LAUNCH_SHADOW_PROJECT_ID')
      && shadowAuth.includes('STRIPE_LAUNCH_SHADOW_SCHOOL_ID')
      && shadowAuth.includes('STRIPE_LAUNCH_SHADOW_CRON_SECRET')
      && shadowIdentityRoute.includes('operation: SHADOW_OPERATIONS.IDENTITY_PREFLIGHT')
      && shadowIdentity.includes('SELECT current_database() AS database_name')
      && shadowIdentity.includes('STRIPE_LAUNCH_SHADOW_NEON_BRANCH_ID')
      && shadowIdentity.includes('STRIPE_LAUNCH_SHADOW_NEON_ENDPOINT_HOST')
      && shadowReturnUrls.includes('collectStripeLaunchShadowIdentity')
      && shadowReturnUrls.includes('preflight.identity.vercel.deployment_host')
      && cron.includes('logAuditRequired')
      && requests.includes('logAuditRequired')
      && cron.includes('schoolId: shadowAuth.schoolId')
      && requests.includes('runRequestExpiry(sql, { schoolId: shadowAuth?.schoolId || null })'),
    instructorLoginIsScopedAndAudited:
      magicLink.includes('AND school_id = ${linkRecord.school_id}')
      && magicLink.includes("action: 'instructor-email-code-login'"),
    legacyEnginesExcludeLaunchSources:
      shadow.includes("metadata->>'launch_accounting_version') IS DISTINCT FROM 'simon_launch_v1'")
      && (transfers.match(/metadata->>'launch_accounting_version'\) IS DISTINCT FROM 'simon_launch_v1'/g) || []).length === 2,
    noMoneyOrConnectMutation:
      !forbiddenStripeMutations.test(slice2Sources)
      && !forbiddenSqlMutations.test(slice2Sources),
    diagnosticsReadOnly:
      diagnosticsAreReadOnly(preflight)
      && diagnosticsAreReadOnly(postflight)
      && shadowIdentityVerifier.includes("method: 'GET'")
      && shadowIdentityVerifier.includes('readOnly: true')
      && shadowIdentityVerifier.includes("approved_to_create_resources: false")
      && !forbiddenStripeMutations.test(shadowIdentityVerifier),
    correctiveMigrationIsNarrowAndInert:
      payoutSourceGuardFix.includes('CREATE OR REPLACE FUNCTION stripe_launch_guard_payout_source_update()')
      && payoutSourceGuardFix.includes('to_jsonb(OLD)->>fill_column IS NOT NULL')
      && !/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|COPY)\b/gim.test(payoutSourceGuardFix),
    rollbackPreservesEvidence:
      packet.includes('Do not delete or rewrite contract, source, receipt, booking-credit')
      && packet.includes('redeploy the prior'),
  };
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  return {
    rollout: 'stripe_connect_simon_slice_2',
    status: failures.length === 0
      ? 'PREPARED_NOT_APPROVED_NOT_DEPLOYED'
      : 'BLOCKED',
    checks,
    failures,
    nextAction: failures.length === 0
      ? 'Review and merge the focused identity/return-URL prerequisite repair before separately authorising any fresh shadow-05 resource creation; do not change production configuration or Stripe state.'
      : 'Resolve every failed review check before requesting rollout approval.',
  };
}

function main() {
  const result = inspect();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.failures.length > 0) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { inspect };
