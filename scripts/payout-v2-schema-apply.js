#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client, neonConfig } = require('@neondatabase/serverless');
const {
  summarize: summarizePreflight,
  targetFingerprint,
} = require('./payout-v2-schema-preflight');
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

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function diagnosticStatements(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function integer(value) {
  return Number(value || 0);
}

function validatePostflight(results) {
  if (results.length !== 11) {
    throw new Error(`Expected 11 postflight result sets; received ${results.length}`);
  }
  const [
    tables,
    rowCounts,
    strictSchoolKeys,
    globalSchoolKeys,
    indexes,
    triggers,
    legacySources,
    legacyAllocations,
    crossRoute,
    duplicateEarnings,
    schoolEngines,
  ] = results.map((result) => result.rows);

  const uniqueTriggers = new Set(triggers.map((row) => row.trigger_name));
  const failures = [];
  if (tables.length !== 25) failures.push(`expected 25 tables; found ${tables.length}`);
  if (
    rowCounts.length !== 25
    || rowCounts.some((row) => integer(row.row_count) !== 0)
  ) {
    failures.push('new payout-v2 tables are not all empty');
  }
  if (
    strictSchoolKeys.length !== 21
    || strictSchoolKeys.some((row) => !row.school_scope_contract_ok)
  ) {
    failures.push('strict tenant-key contract failed');
  }
  if (
    globalSchoolKeys.length !== 4
    || globalSchoolKeys.some((row) => !row.scoped_global_contract_ok)
  ) {
    failures.push('global/school scope contract failed');
  }
  if (indexes.length !== 5) failures.push(`expected 5 critical indexes; found ${indexes.length}`);
  if (uniqueTriggers.size !== 39) {
    failures.push(`expected 39 guard triggers; found ${uniqueTriggers.size}`);
  }
  if (integer(legacySources[0]?.positive_legacy_amount_violations) !== 0) {
    failures.push('positive legacy source value appeared');
  }
  if (integer(legacyAllocations[0]?.positive_legacy_contribution_violations) !== 0) {
    failures.push('positive legacy allocation value appeared');
  }
  if (crossRoute.length !== 0) failures.push('cross-route duplicate claim appeared');
  if (duplicateEarnings.length !== 0) failures.push('duplicate v2 booking earning appeared');
  if (
    schoolEngines.length === 0
    || schoolEngines.some((row) => row.payout_engine_version !== 'v1')
  ) {
    failures.push('one or more schools are not on payout engine v1');
  }
  if (failures.length > 0) {
    throw new Error(`Postflight blocked commit: ${failures.join('; ')}`);
  }

  return {
    tablesPresent: tables.length,
    emptyV2Tables: rowCounts.length,
    strictTenantKeys: strictSchoolKeys.length,
    globalScopeKeys: globalSchoolKeys.length,
    criticalIndexes: indexes.length,
    guardTriggers: uniqueTriggers.size,
    schoolsChecked: schoolEngines.length,
    schoolsOnV1: schoolEngines.length,
    engineTransitions: 0,
    stripeApiCalls: 0,
  };
}

async function run() {
  const production = process.argv.includes('--production-apply-approved');
  const rehearsal = process.argv.includes('--test-rehearsal');
  if (production === rehearsal) {
    throw new Error(
      'Choose exactly one mode: --test-rehearsal or --production-apply-approved'
    );
  }

  loadEnvLocal();
  const databaseUrl = production
    ? process.env.POSTGRES_URL
    : process.env.POSTGRES_URL_TEST;
  if (!databaseUrl) {
    throw new Error(production ? 'POSTGRES_URL is not configured' : 'POSTGRES_URL_TEST is not configured');
  }
  if (
    process.env.POSTGRES_URL
    && process.env.POSTGRES_URL_TEST
    && process.env.POSTGRES_URL === process.env.POSTGRES_URL_TEST
  ) {
    throw new Error('Refusing schema transaction: production and test URLs are equal');
  }

  const manifest = readJson('db/rollouts/035-payout-v2-schema-only.manifest.json');
  const recordedPreflight = readJson(manifest.preflightEvidence.path);
  const localReview = inspect();
  if (localReview.reviewStatus !== 'READY_TO_REQUEST_SCHEMA_APPLY') {
    throw new Error(`Local rollout review is blocked: ${localReview.failures.join(', ')}`);
  }
  if (
    manifest.schemaApplyApproved !== false
    || manifest.deployed !== false
    || recordedPreflight.status !== 'READY_TO_REQUEST_SCHEMA_APPLY'
    || recordedPreflight.blockers.length !== 0
  ) {
    throw new Error('Manifest is not in the expected pre-apply state');
  }

  const migrationSql = read(manifest.migration.path);
  const migrationHash = crypto
    .createHash('sha256')
    .update(Buffer.from(migrationSql))
    .digest('hex');
  if (migrationHash !== manifest.migration.sha256) {
    throw new Error('Migration checksum differs from the reviewed manifest');
  }

  const preflightSql = read(manifest.diagnostics.preflight);
  const postflightSql = read(manifest.diagnostics.postflight);
  if (!isReadOnlyDiagnostic(preflightSql) || !isReadOnlyDiagnostic(postflightSql)) {
    throw new Error('Preflight or postflight diagnostic is not read-only');
  }
  const preflightQueries = diagnosticStatements(preflightSql);
  const postflightQueries = diagnosticStatements(postflightSql);
  if (preflightQueries.length !== 11 || postflightQueries.length !== 11) {
    throw new Error('Unexpected diagnostic statement count');
  }

  neonConfig.webSocketConstructor = globalThis.WebSocket;
  const client = new Client({ connectionString: databaseUrl });
  let transactionStarted = false;
  let committed = false;
  try {
    await client.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '10min'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('coachcarter:payout-v2-schema-035'))"
    );

    const freshPreflightResults = [];
    for (const statement of preflightQueries) {
      freshPreflightResults.push(await client.query(statement));
    }
    const freshPreflight = summarizePreflight(freshPreflightResults);
    if (freshPreflight.blockers.length > 0) {
      throw new Error(
        `Fresh in-transaction preflight blocked apply: ${freshPreflight.blockers
          .map((blocker) => `${blocker.code}=${blocker.count}`)
          .join(', ')}`
      );
    }

    await client.query(migrationSql);

    const postflightResults = [];
    for (const statement of postflightQueries) {
      postflightResults.push(await client.query(statement));
    }
    const postflight = validatePostflight(postflightResults);

    if (production) {
      await client.query('COMMIT');
      committed = true;
    } else {
      await client.query('ROLLBACK');
      transactionStarted = false;
    }

    const evidence = {
      rolloutId: manifest.rolloutId,
      evidenceType: production
        ? 'production_schema_apply'
        : 'test_schema_apply_rehearsal',
      executedAt: new Date().toISOString(),
      targetFingerprint: targetFingerprint(databaseUrl),
      migrationSha256: migrationHash,
      atomicTransaction: true,
      lockTimeout: '10s',
      statementTimeout: '10min',
      freshPreflightBlockers: freshPreflight.blockers,
      postflight,
      committed,
      rolledBack: !production,
      schemaApplyApproved: production,
      payoutV2Activated: false,
      stripeApiCalls: 0,
    };
    evidence.evidenceFingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify(evidence))
      .digest('hex');
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    if (transactionStarted && !committed) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  const keepAlive = setInterval(() => {}, 1000);
  run()
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({
        status: 'BLOCKED',
        errorCode: error.code || 'SCHEMA_APPLY_FAILED',
        message: error.message,
        committed: false,
        payoutV2Activated: false,
        stripeApiCalls: 0,
      }, null, 2)}\n`);
      process.exitCode = 1;
    })
    .finally(() => clearInterval(keepAlive));
}

module.exports = { diagnosticStatements, validatePostflight };
