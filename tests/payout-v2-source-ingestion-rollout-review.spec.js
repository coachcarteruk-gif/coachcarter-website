const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  inspect,
} = require('../scripts/payout-v2-source-ingestion-rollout-review');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(
  path.join(
    root,
    'db',
    'rollouts',
    'payout-v2-source-ingestion-application.manifest.json'
  ),
  'utf8'
));
const packet = fs.readFileSync(
  path.join(root, manifest.review.packet),
  'utf8'
);

test.describe('Payout v2 source-ingestion application rollout review', () => {
  test('rollout is prepared but has no approval or deployment authority', () => {
    expect(manifest.status).toBe('prepared_not_approved_not_deployed');
    expect(manifest.approved).toBe(false);
    expect(manifest.deployed).toBe(false);
    expect(manifest.authority).toMatchObject({
      payoutEngineVersionChange: false,
      payoutTransferExecution: false,
      payoutCronConnection: false,
      adminPayoutV2MutationRoute: false,
      historicalImport: false,
      openingRecoveryAdjustment: false,
      stripeMutationAdded: false,
    });
  });

  test('machine verifier passes every fail-closed application check', () => {
    const report = inspect();
    expect(report.reviewStatus).toBe('PREPARED_NOT_APPROVED_NOT_DEPLOYED');
    expect(report.approved).toBe(false);
    expect(report.deployed).toBe(false);
    expect(report.failures).toEqual([]);
    expect(report.artifactChecks.every((item) => item.matches)).toBe(true);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
  });

  test('packet preserves v1 authority and explicitly excludes money actions', () => {
    expect(packet).toContain('PREPARED — NOT APPROVED — NOT DEPLOYED');
    expect(packet).toContain("payout_engine_version = 'v1'");
    expect(packet).toContain('The only route that writes a Payout v2 row');
    expect(packet).toContain('`POST /api/webhook`');
    expect(packet).toContain('historical source import');
    expect(packet).toContain('£414');
    expect(packet).toContain('live Stripe mutations');
    expect(packet).toContain('fresh global');
    expect(packet).toContain('never be guessed or defaulted to zero');
  });

  test('manifest covers all four payment source types and exact schema prerequisite', () => {
    expect(manifest.paymentTypes).toEqual([
      'credit_purchase',
      'slot_booking',
      'lesson_offer',
      'lesson_request_hold',
    ]);
    expect(manifest.schemaPrerequisite).toEqual({
      rolloutId: '035-payout-v2-schema-only',
      status: 'schema_applied_inactive',
      migrationSha256:
        '7ac172db071fdbc86ff43e98f2e31eb2c03eb5295ba704a52fafec2865a92749',
      requiredEngineVersion: 'v1',
    });
  });
});
