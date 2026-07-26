#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const { diagnosticStatements, validatePostflight } = require('./payout-v2-schema-apply');
const { isReadOnlyDiagnostic } = require('./payout-v2-schema-rollout-review');
const { targetFingerprint } = require('./payout-v2-schema-preflight');

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

async function run() {
  if (!process.argv.includes('--production-read-only')) {
    throw new Error('Refusing connection: pass --production-read-only');
  }
  loadEnvLocal();
  const databaseUrl = process.env.POSTGRES_URL;
  if (!databaseUrl) throw new Error('POSTGRES_URL is not configured');
  if (process.env.POSTGRES_URL_TEST && databaseUrl === process.env.POSTGRES_URL_TEST) {
    throw new Error('Refusing production postflight: production and test URLs are equal');
  }

  const manifest = JSON.parse(fs.readFileSync(
    path.join(root, 'db', 'rollouts', '035-payout-v2-schema-only.manifest.json'),
    'utf8'
  ));
  const postflightSql = fs.readFileSync(
    path.join(root, manifest.diagnostics.postflight),
    'utf8'
  );
  if (!isReadOnlyDiagnostic(postflightSql)) {
    throw new Error('Refusing connection: postflight diagnostic is not read-only');
  }
  const statements = diagnosticStatements(postflightSql);
  if (statements.length !== 11) {
    throw new Error(`Expected 11 postflight statements; found ${statements.length}`);
  }

  const sql = neon(databaseUrl);
  const results = await sql.transaction((txn) => [
    txn("SELECT current_setting('transaction_read_only') AS transaction_read_only"),
    ...statements.map((statement) => txn(statement)),
  ], {
    isolationLevel: 'Serializable',
    readOnly: true,
    deferrable: true,
  });
  if (results[0][0]?.transaction_read_only !== 'on') {
    throw new Error('Database did not enforce a read-only postflight transaction');
  }

  const postflight = validatePostflight(
    results.slice(1).map((rows) => ({ rows }))
  );
  const evidence = {
    rolloutId: manifest.rolloutId,
    evidenceType: 'production_schema_postflight',
    executedAt: new Date().toISOString(),
    targetFingerprint: targetFingerprint(databaseUrl),
    transactionReadOnly: true,
    migrationSha256: manifest.migration.sha256,
    diagnosticsSha256: crypto
      .createHash('sha256')
      .update(postflightSql)
      .digest('hex'),
    postflight,
    status: 'SCHEMA_APPLIED_INACTIVE',
    payoutV2Activated: false,
    stripeApiCalls: 0,
  };
  evidence.evidenceFingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(evidence))
    .digest('hex');
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      status: 'POSTFLIGHT_FAILED',
      errorCode: error.code || 'POSTFLIGHT_FAILED',
      message: error.message,
      payoutV2Activated: false,
      stripeApiCalls: 0,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
