#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(
  root,
  'db',
  'rollouts',
  'payout-v2-source-ingestion-application.manifest.json'
);
const schemaManifestPath = path.join(
  root,
  'db',
  'rollouts',
  '035-payout-v2-schema-only.manifest.json'
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function fileEvidence(relativePath) {
  const buffer = fs.readFileSync(path.join(root, relativePath));
  return {
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

function inspect() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const schemaManifest = JSON.parse(fs.readFileSync(schemaManifestPath, 'utf8'));
  const migrationEvidence = fileEvidence(schemaManifest.migration.path);
  const webhook = read('api/webhook.js');
  const sourceWriter = read('api/_payout-v2-source-writer.js');
  const receipts = read('api/_stripe-event-receipts.js');
  const stripeEvidence = read('api/_stripe-fee.js');
  const slots = read('api/slots.js');
  const packet = read(manifest.review.packet);
  const vercel = read('vercel.json');
  const liveRouteSources = [
    'api/admin.js',
    'api/cron-payouts.js',
    'api/webhook.js',
    'api/slots.js',
    'api/offers.js',
    'api/credits.js',
    'api/instructor.js',
    'api/requests.js',
    'api/_payout-helpers.js',
  ].map((file) => `${file}\n${read(file)}`).join('\n');

  const artifactChecks = manifest.applicationArtifacts.map((artifact) => {
    const observed = fileEvidence(artifact.path);
    return {
      path: artifact.path,
      expected: {
        bytes: artifact.bytes,
        sha256: artifact.sha256,
      },
      observed,
      matches:
        observed.bytes === artifact.bytes
        && observed.sha256 === artifact.sha256,
    };
  });

  const signatureIndex = webhook.indexOf('stripe.webhooks.constructEvent');
  const scopeValidationIndex = webhook.indexOf(
    'await validatePayoutV2ReceiptScope(event, sql, schoolId)'
  );
  const receiptClaimIndex = webhook.indexOf('payoutV2Receipt = await claimPayoutV2Receipt(event)');
  const forbiddenLiveImports = [
    '_payout-v2-transfer-executor',
    '_payout-v2-cutover',
    '_payout-v2-historical-import',
    '_payout-v2-recovery',
    '_payout-v2-materializer',
    '_payout-v2-authority',
    '_payout-v2-protected-balance',
    '_payout-v2-webhook',
  ];

  const checks = {
    preparedOnly:
      manifest.status === 'prepared_not_approved_not_deployed'
      && manifest.approved === false
      && manifest.deployed === false,
    schemaAppliedInactive:
      schemaManifest.status === 'schema_applied_inactive'
      && schemaManifest.deployed === true
      && schemaManifest.migration.sha256
        === manifest.schemaPrerequisite.migrationSha256,
    reviewedMigrationUnchanged:
      migrationEvidence.sha256 === manifest.schemaPrerequisite.migrationSha256,
    allApplicationArtifactsMatch:
      artifactChecks.length > 0 && artifactChecks.every((item) => item.matches),
    signatureBeforeAnyReceiptOrBusinessWork:
      signatureIndex >= 0
      && receiptClaimIndex > signatureIndex,
    canonicalScopeBeforeReceiptClaim:
      scopeValidationIndex >= 0
      && webhook.indexOf('claimStripeEventReceipt({') > scopeValidationIndex
      && webhook.includes("err.code = 'PAYOUT_V2_EVENT_SCOPE_MISMATCH'"),
    allFourPaymentTypesCovered:
      manifest.paymentTypes.every((paymentType) => webhook.includes(paymentType))
      && webhook.includes('PAYOUT_V2_SOURCE_KINDS.CREDIT_PURCHASE')
      && webhook.includes('PAYOUT_V2_SOURCE_KINDS.DIRECT_BOOKING'),
    capturedRequestWaitsForAcceptedLocalSource:
      webhook.includes("lr.status = 'accepted'")
      && webhook.includes('lr.booking_id IS NOT NULL')
      && webhook.includes('PAYOUT_V2_REQUEST_SOURCE_NOT_READY'),
    requestMetadataCopiedToPaymentIntent:
      slots.includes('payment_intent_data: {')
      && slots.includes('metadata: requestPaymentMetadata'),
    positiveStripeEvidenceIsExact:
      sourceWriter.includes("paymentIntentStatus !== 'succeeded'")
      && sourceWriter.includes('chargePaymentIntentId !== paymentIntentId')
      && sourceWriter.includes('balanceTransactionSourceId !== chargeId')
      && sourceWriter.includes("stripeEvidence.source !== 'balance_transaction'")
      && sourceWriter.includes("funding_class: isStripeBacked ? 'stripe_backed' : 'manual_review'"),
    missingEvidenceIsZeroValueManualReview:
      sourceWriter.includes("source_status: isStripeBacked ? 'available' : 'manual_review'")
      && sourceWriter.includes('const netPence = isStripeBacked ? safeGrossPence - safeFeePence : 0'),
    legacyAlwaysZeroPayable:
      sourceWriter.includes("funding_class: 'legacy_pre_connect_settled'")
      && sourceWriter.includes('payable_pool_pence: 0')
      && sourceWriter.includes('refundable_pool_pence: 0'),
    noLivePricePayoutEvidence:
      !/lesson_types\.price_pence|custom_hourly_rate|hourly_rate_pence|bulk_hourly_pence|list_price_pence/
        .test(sourceWriter),
    receiptRetryLeaseAndDedupPresent:
      receipts.includes('processed_at = NOW()')
      && receipts.includes('COALESCE(')
      && receipts.includes("conflict.code = 'PAYOUT_V2_EVENT_RECEIPT_CONFLICT'"),
    stripeEvidenceHelperIsReadOnly:
      stripeEvidence.includes('paymentIntents.retrieve')
      && stripeEvidence.includes('charges.retrieve')
      && stripeEvidence.includes('balanceTransactions.retrieve')
      && !/\.(?:create|capture|cancel|confirm|refund)\s*\(/.test(stripeEvidence),
    v2ExecutionRoutesRemainUnreachable:
      forbiddenLiveImports.every((moduleName) => !liveRouteSources.includes(moduleName))
      && forbiddenLiveImports.every((moduleName) => !vercel.includes(moduleName)),
    v1RemainsRequired:
      manifest.schemaPrerequisite.requiredEngineVersion === 'v1'
      && manifest.authority.payoutEngineVersionChange === false,
    noHistoricalOrMoneyAuthority:
      manifest.authority.historicalImport === false
      && manifest.authority.openingRecoveryAdjustment === false
      && manifest.authority.payoutTransferExecution === false
      && manifest.authority.stripeMutationAdded === false,
    packetHasTerminalStatus:
      packet.includes('PREPARED — NOT APPROVED — NOT DEPLOYED')
      && packet.includes('payout_engine_version')
      && packet.includes('Rollback'),
  };

  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    rolloutId: manifest.rolloutId,
    reviewStatus: failures.length === 0
      ? 'PREPARED_NOT_APPROVED_NOT_DEPLOYED'
      : 'BLOCKED',
    approved: manifest.approved,
    deployed: manifest.deployed,
    schemaPrerequisite: {
      rolloutId: schemaManifest.rolloutId,
      status: schemaManifest.status,
      migrationSha256: migrationEvidence.sha256,
    },
    artifactChecks,
    checks,
    failures,
    nextAction: failures.length === 0
      ? 'Request application rollout review only; do not deploy, import, recover, activate, or move money.'
      : 'Resolve every verifier failure and regenerate the reviewed manifest.',
  };
}

function main() {
  const report = inspect();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failures.length > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { inspect };
