#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const { inspect, isReadOnlyDiagnostic } = require('./payout-v2-schema-rollout-review');

const root = path.resolve(__dirname, '..');

function loadEnvLocal() {
  const envPath = path.join(root, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function integer(value) {
  return Number(value || 0);
}

function targetFingerprint(databaseUrl) {
  const parsed = new URL(databaseUrl);
  return crypto
    .createHash('sha256')
    .update(`${parsed.hostname.toLowerCase()}${parsed.pathname}`)
    .digest('hex');
}

function summarize(results) {
  if (results.length !== 11) {
    throw new Error(`Expected 11 read-only diagnostic result sets; received ${results.length}`);
  }

  const [
    schemaPresence,
    legacySources,
    legacyAllocations,
    legacyBookings,
    historicalPayouts,
    ambiguousCohorts,
    crossRoute,
    routeConfiguration,
    tenantViolations,
    localTransfers,
    duplicateTransferIds,
  ] = results.map((result) => (Array.isArray(result) ? result : result.rows));

  const existingV2Objects = schemaPresence
    .filter((row) => row.already_exists)
    .map((row) => row.table_name);
  const positiveLegacyViolations =
    integer(legacySources[0]?.positive_legacy_amount_violations)
    + integer(legacyAllocations[0]?.positive_legacy_contribution_violations)
    + legacyBookings.filter((row) => row.hard_legacy_violation).length;
  const tenantViolationCount = tenantViolations
    .reduce((sum, row) => sum + integer(row.violation_count), 0);
  const unresolvedTransferCount = localTransfers.filter((row) => (
    row.status === 'processing'
    || (row.status === 'completed' && !row.stripe_transfer_id)
  )).length;

  const blockerCounts = {
    existingV2Objects: existingV2Objects.length,
    positiveLegacyViolations,
    crossRouteDuplicateClaims: crossRoute.length,
    tenantScopeViolations: tenantViolationCount,
    unresolvedLocalTransfers: unresolvedTransferCount,
    duplicateStripeTransferIds: duplicateTransferIds.length,
  };
  const blockers = Object.entries(blockerCounts)
    .filter(([, count]) => count > 0)
    .map(([code, count]) => ({ code, count }));

  return {
    expectedV2ObjectCount: schemaPresence.length,
    existingV2Objects,
    blockerCounts,
    blockers,
    informationalCounts: {
      historicalJune19PayoutRows: historicalPayouts.length,
      ambiguousCashExternalCohorts: ambiguousCohorts.length,
      dualRouteConfigurationSchools: routeConfiguration.length,
      completedOrProcessingLocalTransferRows: localTransfers.length,
    },
  };
}

async function run() {
  if (!process.argv.includes('--production-read-only')) {
    throw new Error(
      'Refusing connection: pass --production-read-only after explicit owner approval'
    );
  }

  loadEnvLocal();
  const databaseUrl = process.env.POSTGRES_URL;
  if (!databaseUrl) throw new Error('POSTGRES_URL is not configured');
  if (process.env.POSTGRES_URL_TEST && databaseUrl === process.env.POSTGRES_URL_TEST) {
    throw new Error('Refusing production preflight: POSTGRES_URL equals POSTGRES_URL_TEST');
  }

  const localReview = inspect();
  if (!['READY_FOR_HUMAN_REVIEW', 'READY_TO_REQUEST_SCHEMA_APPLY']
    .includes(localReview.reviewStatus)) {
    throw new Error(`Local rollout review is blocked: ${localReview.failures.join(', ')}`);
  }

  const manifest = JSON.parse(fs.readFileSync(
    path.join(root, 'db', 'rollouts', '035-payout-v2-schema-only.manifest.json'),
    'utf8'
  ));
  const diagnosticSql = fs.readFileSync(
    path.join(root, manifest.diagnostics.preflight),
    'utf8'
  );
  if (!isReadOnlyDiagnostic(diagnosticSql)) {
    throw new Error('Refusing connection: preflight diagnostic is not read-only');
  }

  const diagnosticStatements = diagnosticSql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  if (diagnosticStatements.length !== 11) {
    throw new Error(
      `Refusing connection: expected 11 diagnostic statements; found ${diagnosticStatements.length}`
    );
  }

  const sql = neon(databaseUrl);
  const transactionResults = await sql.transaction((txn) => [
    txn("SET LOCAL statement_timeout = '60s'"),
    txn("SET LOCAL lock_timeout = '5s'"),
    txn("SELECT current_setting('transaction_read_only') AS transaction_read_only"),
    ...diagnosticStatements.map((statement) => txn(statement)),
  ], {
    isolationLevel: 'Serializable',
    readOnly: true,
    deferrable: true,
  });
  const readOnly = transactionResults[2];
  if (readOnly[0]?.transaction_read_only !== 'on') {
    throw new Error('Database did not enforce a read-only transaction');
  }

  const summary = summarize(transactionResults.slice(3));
  const evidence = {
    rolloutId: manifest.rolloutId,
    evidenceType: 'production_read_only_preflight',
    executedAt: new Date().toISOString(),
    targetFingerprint: targetFingerprint(databaseUrl),
    transactionReadOnly: true,
    migrationSha256: localReview.observed.sha256,
    diagnosticsSha256: crypto
      .createHash('sha256')
      .update(diagnosticSql)
      .digest('hex'),
    ...summary,
    status: summary.blockers.length === 0
      ? 'READY_TO_REQUEST_SCHEMA_APPLY'
      : 'BLOCKED',
    approvedToApply: false,
    applied: false,
  };
  evidence.evidenceFingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(evidence))
    .digest('hex');
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (summary.blockers.length > 0) process.exitCode = 2;
}

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      status: 'BLOCKED',
      errorCode: error.code || 'PREFLIGHT_FAILED',
      message: error.message,
      approvedToApply: false,
      applied: false,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { summarize, targetFingerprint };
