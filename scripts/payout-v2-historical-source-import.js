#!/usr/bin/env node

/**
 * Operator-gated Payout v2 historical funding-source import.
 *
 * Dry-run is the default. Apply/test-rollback require an exact reviewed plan,
 * explicit totals, operator evidence, a command confirmation phrase, and a
 * separate environment gate. This script never calls a Stripe mutation.
 */

const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');
const { neon, Client, neonConfig } = require('@neondatabase/serverless');
const {
  PAYOUT_V2_HISTORICAL_IMPORT_VERSION,
  buildHistoricalImportPlan,
  assertExpectedPlan,
  applyHistoricalImportPlan,
} = require('../api/_payout-v2-historical-import');

const MUTATION_ENV_GATE = 'PAYOUT_V2_REVIEWED_HISTORICAL_IMPORT';
const APPLY_CONFIRMATION = 'APPLY_PAYOUT_V2_HISTORICAL_IMPORT';
const ROLLBACK_CONFIRMATION = 'TEST_ROLLBACK_PAYOUT_V2_HISTORICAL_IMPORT';

function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function parseArgs(argv) {
  const args = {};
  for (const entry of argv) {
    if (!entry.startsWith('--')) throw new Error(`Unexpected argument: ${entry}`);
    const separator = entry.indexOf('=');
    const key = separator === -1 ? entry.slice(2) : entry.slice(2, separator);
    const value = separator === -1 ? true : entry.slice(separator + 1);
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      throw new Error(`Duplicate argument: --${key}`);
    }
    args[key] = value;
  }
  return args;
}

function explicitInteger(args, key) {
  if (!Object.prototype.hasOwnProperty.call(args, key)) {
    throw new Error(`--${key}=... is required`);
  }
  const value = Number(args[key]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`--${key} must be a non-negative safe integer`);
  }
  return value;
}

function makeSqlTag(client) {
  return async (strings, ...values) => {
    let text = strings[0];
    for (let index = 0; index < values.length; index += 1) {
      text += `$${index + 1}${strings[index + 1]}`;
    }
    const result = await client.query(text, values);
    return result.rows;
  };
}

function requireMutationGates(mode, args) {
  if (process.env.PAYOUT_V2_IMPORT_MUTATION_ENABLED !== MUTATION_ENV_GATE) {
    throw new Error(
      `Set PAYOUT_V2_IMPORT_MUTATION_ENABLED=${MUTATION_ENV_GATE} for explicit mutation modes`
    );
  }
  const expectedConfirmation = mode === 'apply'
    ? APPLY_CONFIRMATION
    : ROLLBACK_CONFIRMATION;
  if (args.confirm !== expectedConfirmation) {
    throw new Error(`--confirm=${expectedConfirmation} is required for --mode=${mode}`);
  }
}

async function main() {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode || 'dry-run';
  if (!['dry-run', 'apply', 'test-rollback'].includes(mode)) {
    throw new Error('--mode must be dry-run, apply, or test-rollback');
  }
  const schoolId = explicitInteger(args, 'school-id');
  if (schoolId <= 0) throw new Error('--school-id must be greater than zero');
  const operatorIdentity = String(args['operator-identity'] || '').trim();
  const evidenceReference = String(args['evidence-reference'] || '').trim();
  if (!operatorIdentity) throw new Error('--operator-identity is required');
  if (!evidenceReference) throw new Error('--evidence-reference is required');

  const databaseUrl = mode === 'dry-run'
    ? (process.env.POSTGRES_URL_READONLY || process.env.POSTGRES_URL)
    : process.env.POSTGRES_URL;
  if (!databaseUrl) throw new Error('A database URL is required');
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is required for read-only evidence reconciliation');
  }

  const readSql = neon(databaseUrl);
  const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  const plan = await buildHistoricalImportPlan({
    sql: readSql,
    schoolId,
    stripeClient,
    operatorIdentity,
    evidenceReference,
  });

  if (mode === 'dry-run') {
    console.log(JSON.stringify({
      mode,
      mutation_performed: false,
      plan,
      apply_requirements: {
        import_version: PAYOUT_V2_HISTORICAL_IMPORT_VERSION,
        expected_candidate_count: plan.candidate_count,
        expected_totals: plan.totals,
        reviewed_plan_fingerprint: plan.plan_fingerprint,
      },
    }, null, 2));
    return;
  }

  requireMutationGates(mode, args);
  assertExpectedPlan(plan, {
    candidateCount: explicitInteger(args, 'expected-candidate-count'),
    grossCollectedPence: explicitInteger(args, 'expected-gross-pence'),
    stripeFeePence: explicitInteger(args, 'expected-stripe-fee-pence'),
    payablePoolPence: explicitInteger(args, 'expected-payable-pence'),
    refundablePoolPence: explicitInteger(args, 'expected-refundable-pence'),
    reviewedPlanFingerprint: String(args['reviewed-plan-fingerprint'] || '').trim(),
  });

  if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket === 'function') {
    neonConfig.webSocketConstructor = globalThis.WebSocket;
  }
  const client = new Client({ connectionString: databaseUrl });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query(
      'SELECT pg_advisory_xact_lock($1::integer, hashtext($2)::integer)',
      [schoolId, `payout-v2-historical-import:${schoolId}`]
    );
    const sql = makeSqlTag(client);
    const existingRun = await client.query(`
      SELECT id, plan_fingerprint
      FROM payout_source_import_runs
      WHERE school_id = $1
        AND plan_fingerprint = $2
      LIMIT 1
    `, [schoolId, plan.plan_fingerprint]);

    const imported = await applyHistoricalImportPlan(sql, plan);
    if (existingRun.rowCount > 0 && imported.createdCount > 0) {
      const err = new Error(
        'Historical import marker exists but one or more reviewed sources were missing'
      );
      err.code = 'PAYOUT_V2_IMPORT_RUN_INCOMPLETE';
      throw err;
    }
    let importRunCreated = false;
    if (existingRun.rowCount === 0) {
      const run = await client.query(`
        INSERT INTO payout_source_import_runs (
          school_id, import_version, plan_fingerprint, candidate_count,
          totals, operator_identity, evidence_reference,
          created_source_count, existing_source_count, metadata
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::jsonb)
        RETURNING id
      `, [
        schoolId,
        PAYOUT_V2_HISTORICAL_IMPORT_VERSION,
        plan.plan_fingerprint,
        plan.candidate_count,
        JSON.stringify(plan.totals),
        operatorIdentity,
        evidenceReference,
        imported.createdCount,
        imported.existingCount,
        JSON.stringify({ execution_mode: mode }),
      ]);
      await client.query(`
        INSERT INTO audit_log (
          admin_id, admin_email, action, target_type, target_id,
          details, ip_address, school_id
        )
        VALUES (
          NULL, $1, 'payout_v2.historical_source_import',
          'payout_source_import_run', $2, $3::jsonb,
          'local_operator_tool', $4
        )
      `, [
        operatorIdentity,
        String(run.rows[0].id),
        JSON.stringify({
          plan_fingerprint: plan.plan_fingerprint,
          evidence_reference: evidenceReference,
          candidate_count: plan.candidate_count,
          totals: plan.totals,
          created_source_count: imported.createdCount,
          existing_source_count: imported.existingCount,
          execution_mode: mode,
        }),
        schoolId,
      ]);
      importRunCreated = true;
    }

    if (mode === 'test-rollback') {
      await client.query('ROLLBACK');
      transactionOpen = false;
    } else {
      await client.query('COMMIT');
      transactionOpen = false;
    }
    console.log(JSON.stringify({
      mode,
      school_id: schoolId,
      plan_fingerprint: plan.plan_fingerprint,
      mutation_performed: mode === 'apply' && importRunCreated,
      transaction_rolled_back: mode === 'test-rollback',
      idempotent_no_op: existingRun.rowCount > 0,
      created_source_count: imported.createdCount,
      existing_source_count: imported.existingCount,
      import_run_created: importRunCreated && mode === 'apply',
    }, null, 2));
  } catch (err) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    code: err.code || 'PAYOUT_V2_IMPORT_FAILED',
    message: err.message,
    mismatches: err.mismatches || undefined,
  }, null, 2));
  process.exitCode = 1;
});
