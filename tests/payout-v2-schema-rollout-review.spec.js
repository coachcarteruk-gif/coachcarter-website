const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { inspect } = require('../scripts/payout-v2-schema-rollout-review');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(
  path.join(root, 'db', 'rollouts', '035-payout-v2-schema-only.manifest.json'),
  'utf8'
));
const migration = fs.readFileSync(path.join(root, manifest.migration.path));
const runbook = fs.readFileSync(
  path.join(root, 'docs', 'payout-v2-schema-rollout-review.md'),
  'utf8'
);
const preflightEvidence = JSON.parse(fs.readFileSync(
  path.join(root, 'db', 'rollouts', '035-payout-v2-schema-only.preflight.json'),
  'utf8'
));
const applyEvidence = JSON.parse(fs.readFileSync(
  path.join(root, 'db', 'rollouts', '035-payout-v2-schema-only.apply.json'),
  'utf8'
));
const postflightEvidence = JSON.parse(fs.readFileSync(
  path.join(root, 'db', 'rollouts', '035-payout-v2-schema-only.postflight.json'),
  'utf8'
));
const preflightRunner = fs.readFileSync(
  path.join(root, 'scripts', 'payout-v2-schema-preflight.js'),
  'utf8'
);
const applyRunner = fs.readFileSync(
  path.join(root, 'scripts', 'payout-v2-schema-apply.js'),
  'utf8'
);

test.describe('Payout v2 schema-only rollout review', () => {
  test('schema is recorded as applied but remains inactive', () => {
    expect(manifest.status).toBe('schema_applied_inactive');
    expect(manifest.reviewPacketApproved).toBe(true);
    expect(manifest.productionPreflightApproved).toBe(true);
    expect(manifest.schemaApplyApproved).toBe(true);
    expect(manifest.deployed).toBe(true);
  });

  test('reviewed artifact fingerprint matches its exact bytes', () => {
    const sha256 = crypto.createHash('sha256').update(migration).digest('hex');
    expect(sha256).toBe(manifest.migration.sha256);
    expect(migration.length).toBe(manifest.migration.bytes);
  });

  test('local verifier passes every fail-closed check', () => {
    const report = inspect();
    expect(report.reviewStatus).toBe('SCHEMA_APPLIED_INACTIVE');
    expect(report.approved).toBe(true);
    expect(report.deployed).toBe(true);
    expect(report.failures).toEqual([]);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
  });

  test('runbook excludes activation, money movement, and the broad runner', () => {
    expect(runbook).toContain('SCHEMA APPLIED — INACTIVE — ENGINE V1');
    expect(runbook).toContain('schema-only step is complete');
    expect(runbook).toContain('does not');
    expect(runbook).toContain('Do **not** use `/api/migrate` or `db/migration.sql`');
    expect(runbook).toContain(manifest.migration.sha256);
  });

  test('execution contract is atomic and fail-fast', () => {
    expect(manifest.execution.atomicTransactionRequired).toBe(true);
    expect(manifest.execution.onErrorStopRequired).toBe(true);
    expect(manifest.execution.lockTimeoutRequired).toBe(true);
    expect(manifest.execution.allowedArtifact).toBe(
      'db/migrations/035_payout_v2_ledger_foundation.sql'
    );
  });

  test('production preflight is database-enforced read-only and cannot apply', () => {
    expect(preflightRunner).toContain("process.argv.includes('--production-read-only')");
    expect(preflightRunner).toContain('sql.transaction');
    expect(preflightRunner).toContain('readOnly: true');
    expect(preflightRunner).toContain("transaction_read_only') AS transaction_read_only");
    expect(preflightRunner).toContain('approvedToApply: false');
    expect(preflightRunner).toContain('applied: false');
    expect(preflightRunner).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE\s+schools|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE)\b/i
    );
  });

  test('recorded production evidence has zero blockers and cannot authorise apply', () => {
    expect(preflightEvidence.transactionReadOnly).toBe(true);
    expect(preflightEvidence.migrationSha256).toBe(manifest.migration.sha256);
    expect(preflightEvidence.blockers).toEqual([]);
    expect(Object.values(preflightEvidence.blockerCounts)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(preflightEvidence.status).toBe('READY_TO_REQUEST_SCHEMA_APPLY');
    expect(preflightEvidence.approvedToApply).toBe(false);
    expect(preflightEvidence.applied).toBe(false);
    expect(manifest.preflightEvidence.evidenceFingerprint)
      .toBe(preflightEvidence.evidenceFingerprint);
  });

  test('schema apply runner is exact, atomic, postflight-gated, and Stripe-free', () => {
    expect(applyRunner).toContain("'--production-apply-approved'");
    expect(applyRunner).toContain("'--test-rehearsal'");
    expect(applyRunner).toContain("await client.query('BEGIN')");
    expect(applyRunner).toContain("await client.query('COMMIT')");
    expect(applyRunner).toContain("await client.query('ROLLBACK')");
    expect(applyRunner).toContain('Migration checksum differs from the reviewed manifest');
    expect(applyRunner).toContain('Postflight blocked commit');
    expect(applyRunner).not.toMatch(/\brequire\s*\(\s*['"]stripe['"]\s*\)/i);
    expect(applyRunner).not.toContain('api/migrate');
  });

  test('committed apply and independent postflight evidence remain inactive', () => {
    expect(applyEvidence.committed).toBe(true);
    expect(applyEvidence.migrationSha256).toBe(manifest.migration.sha256);
    expect(applyEvidence.freshPreflightBlockers).toEqual([]);
    expect(applyEvidence.postflight.emptyV2Tables).toBe(25);
    expect(applyEvidence.postflight.schoolsOnV1).toBe(
      applyEvidence.postflight.schoolsChecked
    );
    expect(applyEvidence.payoutV2Activated).toBe(false);
    expect(applyEvidence.stripeApiCalls).toBe(0);
    expect(postflightEvidence.status).toBe('SCHEMA_APPLIED_INACTIVE');
    expect(postflightEvidence.transactionReadOnly).toBe(true);
    expect(postflightEvidence.postflight.emptyV2Tables).toBe(25);
    expect(postflightEvidence.postflight.guardTriggers).toBe(39);
    expect(postflightEvidence.payoutV2Activated).toBe(false);
    expect(postflightEvidence.stripeApiCalls).toBe(0);
  });
});
