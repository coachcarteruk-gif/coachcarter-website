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
  '035-payout-v2-schema-only.manifest.json'
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function stripLineComments(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

function count(sql, pattern) {
  return (sql.match(pattern) || []).length;
}

function inspect() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const migrationBuffer = fs.readFileSync(path.join(root, manifest.migration.path));
  const migration = migrationBuffer.toString('utf8');
  const aggregate = read('db/migration.sql');
  const preflight = read(manifest.diagnostics.preflight);
  const postflight = read(manifest.diagnostics.postflight);
  const executableMigration = stripLineComments(migration);
  const marker = '-- Instructor Payout v2: inactive, append-only ledger foundation.';

  const observed = {
    sha256: crypto.createHash('sha256').update(migrationBuffer).digest('hex'),
    bytes: migrationBuffer.length,
    lines: migration.split(/\r?\n/).filter((line, index, lines) => (
      index < lines.length - 1 || line.length > 0
    )).length,
    tables: count(migration, /^CREATE TABLE IF NOT EXISTS\s+/gim),
    indexes: count(migration, /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+/gim),
    functions: count(migration, /^CREATE OR REPLACE FUNCTION\s+/gim),
    triggers: count(migration, /^CREATE (?:CONSTRAINT )?TRIGGER\s+/gim),
    dmlStatements: count(
      executableMigration,
      /^\s*(?:INSERT\s+INTO|UPDATE\s+[a-z_]|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|COPY\s+)/gim
    ),
    stripeApiCalls: count(
      executableMigration,
      /\b(?:require\s*\(\s*['"]stripe['"]|stripe\.(?:transfers|payouts|paymentIntents|charges)\.)/gi
    ),
  };

  const checks = {
    manifestRecordsInactiveSchema:
      manifest.status === 'schema_applied_inactive'
      && manifest.reviewPacketApproved === true
      && manifest.productionPreflightApproved === true
      && manifest.schemaApplyApproved === true
      && manifest.deployed === true,
    checksumMatches: observed.sha256 === manifest.migration.sha256,
    byteCountMatches: observed.bytes === manifest.migration.bytes,
    lineCountMatches: observed.lines === manifest.migration.lines,
    tableCountMatches: observed.tables === manifest.expectedSchemaEffects.tables,
    indexCountMatches: observed.indexes === manifest.expectedSchemaEffects.indexes,
    functionCountMatches: observed.functions === manifest.expectedSchemaEffects.functions,
    triggerCountMatches: observed.triggers === manifest.expectedSchemaEffects.triggers,
    noDml: observed.dmlStatements === 0,
    noStripeApiCalls: observed.stripeApiCalls === 0,
    engineDefaultsToV1:
      migration.includes("ADD COLUMN IF NOT EXISTS payout_engine_version TEXT NOT NULL DEFAULT 'v1'"),
    noEngineActivationDml:
      !/\bUPDATE\s+schools\s+SET\s+payout_engine_version\s*=\s*['"]v2['"]/i
        .test(executableMigration),
    aggregateSuffixMatches:
      aggregate.includes(marker)
      && aggregate.slice(aggregate.indexOf(marker)).trim() === migration.trim(),
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
    reviewStatus: failures.length === 0 ? 'SCHEMA_APPLIED_INACTIVE' : 'BLOCKED',
    approved: manifest.schemaApplyApproved,
    deployed: manifest.deployed,
    migration: manifest.migration.path,
    observed,
    checks,
    failures,
    nextAction: failures.length === 0
      ? 'Schema step complete; do not ingest data or activate payout v2 without separate approval.'
      : 'Resolve every verifier failure and regenerate the reviewed manifest.',
  };
}

function isReadOnlyDiagnostic(sql) {
  const executable = stripLineComments(sql);
  return /\bSELECT\b/i.test(executable)
    && !/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|MERGE|CALL|COPY)\b/i
      .test(executable);
}

function main() {
  const report = inspect();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failures.length > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { inspect, isReadOnlyDiagnostic };
