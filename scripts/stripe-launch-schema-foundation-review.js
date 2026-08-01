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
  '039-stripe-launch-schema-foundation.manifest.json'
);
const status = 'SCHEMA_APPLIED_INACTIVE';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

function count(value, pattern) {
  return (value.match(pattern) || []).length;
}

function isReadOnlyDiagnostic(sql) {
  const executable = stripComments(sql);
  return /\bSELECT\b/i.test(executable)
    && !/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|MERGE|CALL|COPY|DO)\b/i
      .test(executable);
}

function inspect() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const migrationBuffer = fs.readFileSync(path.join(root, manifest.migration.path));
  const migration = migrationBuffer.toString('utf8').replace(/\r\n/g, '\n');
  const canonicalMigrationBuffer = Buffer.from(migration, 'utf8');
  const aggregate = read('db/migration.sql').replace(/\r\n/g, '\n');
  const preflight = read(manifest.diagnostics.preflight).replace(/\r\n/g, '\n');
  const postflight = read(manifest.diagnostics.postflight).replace(/\r\n/g, '\n');
  const rehearsalEvidence = JSON.parse(read(manifest.rehearsalEvidence.path));
  const preflightEvidence = JSON.parse(read(manifest.preflightEvidence.path));
  const recoveryEvidence = JSON.parse(read(manifest.recoveryEvidence.path));
  const applyEvidence = JSON.parse(read(manifest.applyEvidence.path));
  const postflightEvidence = JSON.parse(read(manifest.postflightEvidence.path));
  const executableMigration = stripComments(migration);
  const marker = '-- Stripe Connect Simon launch: inert Slice 1 schema foundation.';
  const markerIndex = aggregate.lastIndexOf(marker);

  const observed = {
    sha256: crypto.createHash('sha256').update(canonicalMigrationBuffer).digest('hex'),
    preflightSha256: crypto.createHash('sha256').update(preflight).digest('hex'),
    postflightSha256: crypto.createHash('sha256').update(postflight).digest('hex'),
    bytes: canonicalMigrationBuffer.length,
    lines: migration.split(/\r?\n/).filter((line, index, lines) => (
      index < lines.length - 1 || line.length > 0
    )).length,
    tables: count(migration, /^CREATE TABLE IF NOT EXISTS\s+/gim),
    indexes: count(migration, /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+/gim),
    functions: count(migration, /^CREATE OR REPLACE FUNCTION\s+/gim),
    literalTriggers: count(migration, /^CREATE (?:CONSTRAINT )?TRIGGER\s+/gim),
    generatedAppendOnlyTriggers: 16,
    dmlStatements: count(
      executableMigration,
      /^\s*(?:INSERT\s+INTO|UPDATE\s+[a-z_]|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|COPY\s+)/gim
    ),
    stripeApiCalls: count(
      executableMigration,
      /\b(?:require\s*\(\s*['"]stripe['"]|stripe\.(?:accounts|transfers|payouts|refunds|paymentIntents|charges)\.)/gi
    ),
  };

  const expected = manifest.expectedSchemaEffects;
  const checks = {
    statusIsSchemaAppliedInactive:
      manifest.status === status
      && manifest.rehearsalEvidence.status === 'PASSED_AND_ROLLED_BACK'
      && manifest.preflightEvidence.status === 'PASSED'
      && manifest.postflightEvidence.status === status,
    productionEvidenceRecorded:
      manifest.reviewPacketApproved === true
      && manifest.productionPreflightApproved === true
      && manifest.schemaApplyApproved === true
      && manifest.deployed === true
      && preflightEvidence.status === 'PASSED'
      && preflightEvidence.applied === true
      && applyEvidence.committed === true
      && applyEvidence.rolledBack === false
      && postflightEvidence.status === status,
    recoveryCoverageRecorded:
      recoveryEvidence.projectName === 'neon-green-elephant'
      && recoveryEvidence.branchName === 'main'
      && recoveryEvidence.historyRetentionHours === 6
      && recoveryEvidence.productionTargetFingerprint === applyEvidence.targetFingerprint,
    evidenceChecksumsMatch:
      preflightEvidence.migrationSha256 === observed.sha256
      && applyEvidence.migrationSha256 === observed.sha256
      && postflightEvidence.migrationSha256 === observed.sha256
      && preflightEvidence.diagnosticsSha256 === observed.preflightSha256
      && postflightEvidence.diagnosticsSha256 === observed.postflightSha256,
    schemaRemainsOperationallyInactive:
      rehearsalEvidence.payoutEngineActivated === false
      && applyEvidence.payoutEngineActivated === false
      && postflightEvidence.payoutEngineActivated === false
      && applyEvidence.stripeApiCalls === 0
      && postflightEvidence.stripeApiCalls === 0
      && manifest.expectedDataEffects.launchRows === 0
      && manifest.expectedDataEffects.engineTransitions === 0
      && manifest.operationalAuthorityNotGranted.length === 6,
    checksumMatches: observed.sha256 === manifest.migration.sha256,
    byteCountMatches: observed.bytes === manifest.migration.bytes,
    lineCountMatches: observed.lines === manifest.migration.lines,
    tableCountMatches: observed.tables === expected.tables,
    indexCountMatches: observed.indexes === expected.indexes,
    functionCountMatches: observed.functions === expected.functions,
    literalTriggerCountMatches: observed.literalTriggers === expected.literalTriggers,
    runtimeTriggerCountMatches:
      observed.literalTriggers + observed.generatedAppendOnlyTriggers
        === expected.runtimeTriggers,
    noDml: observed.dmlStatements === 0,
    noStripeApiCalls: observed.stripeApiCalls === 0,
    noEngineActivationDml:
      !/\bUPDATE\s+schools\s+SET\s+payout_engine_version\s*=\s*['"]v2['"]/i
        .test(executableMigration),
    noConfigSeed:
      !/\bINSERT\s+INTO\s+stripe_connect_launch_configs\b/i
        .test(executableMigration),
    aggregateSuffixMatches:
      markerIndex >= 0
      && aggregate.slice(markerIndex).trim() === migration.trim(),
    preflightIsReadOnly: isReadOnlyDiagnostic(preflight),
    postflightIsReadOnly: isReadOnlyDiagnostic(postflight),
    broadRunnerIsProhibited:
      manifest.execution.prohibitedEntrypoints.includes('api/migrate.js')
      && manifest.execution.prohibitedEntrypoints.includes('db/migration.sql'),
  };

  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    rolloutId: manifest.rolloutId,
    reviewStatus: failures.length === 0 ? status : 'BLOCKED',
    approved: manifest.schemaApplyApproved,
    deployed: manifest.deployed,
    migration: manifest.migration.path,
    observed,
    checks,
    failures,
    nextAction: failures.length === 0
      ? 'Schema applied and inactive. Separate authority is required before seeding, application writers, Stripe operations, or engine activation.'
      : 'Resolve every verifier failure; do not activate or write the Slice 1 schema.',
  };
}

function main() {
  const report = inspect();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failures.length > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { inspect, isReadOnlyDiagnostic };
