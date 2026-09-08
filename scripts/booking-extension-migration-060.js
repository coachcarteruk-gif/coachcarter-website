#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client, neonConfig } = require('@neondatabase/serverless');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(root, 'db', 'migrations', '060_booking_extension_offers.sql');
const extensionColumns = [
  'extension_booking_id',
  'extension_minutes',
  'extension_base_list_price_pence',
];

function loadEnvLocal() {
  const envPath = path.join(root, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function fingerprint(databaseUrl) {
  const parsed = new URL(databaseUrl);
  return crypto.createHash('sha256')
    .update(`${parsed.hostname.toLowerCase()}|${parsed.pathname}|${decodeURIComponent(parsed.username)}`)
    .digest('hex');
}

function targetSummary(databaseUrl) {
  const parsed = new URL(databaseUrl);
  return {
    host: parsed.hostname,
    database: parsed.pathname.replace(/^\//, ''),
    role: decodeURIComponent(parsed.username),
    direct: !parsed.hostname.includes('-pooler'),
    fingerprint: fingerprint(databaseUrl),
  };
}

function normaliseEndpointHost(hostname) {
  return hostname.toLowerCase().replace('-pooler.', '.');
}

function productionUrl() {
  const directUrl = process.env.POSTGRES_URL_NON_POOLING;
  const runtimeUrl = process.env.POSTGRES_URL;
  if (!directUrl || !runtimeUrl) {
    throw new Error('POSTGRES_URL_NON_POOLING and POSTGRES_URL are both required');
  }
  const direct = new URL(directUrl);
  const runtime = new URL(runtimeUrl);
  if (direct.hostname.includes('-pooler')) throw new Error('Production DDL target is pooled, not direct');
  if (
    normaliseEndpointHost(direct.hostname) !== normaliseEndpointHost(runtime.hostname)
    || direct.pathname !== runtime.pathname
    || direct.username !== runtime.username
  ) {
    throw new Error('Direct production credential does not match the configured runtime endpoint/database/role');
  }
  if (process.env.POSTGRES_URL_TEST && directUrl === process.env.POSTGRES_URL_TEST) {
    throw new Error('Production DDL target equals POSTGRES_URL_TEST');
  }
  return directUrl;
}

async function inspect(client) {
  const identity = await client.query(`
    SELECT current_database() AS database_name, current_user AS role_name,
           current_setting('transaction_read_only') AS transaction_read_only
  `);
  const columns = await client.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'lesson_offers'
       AND column_name = ANY($1::text[])
     ORDER BY column_name
  `, [extensionColumns]);
  const extensionConstraints = await client.query(`
    SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
     WHERE conrelid = 'public.lesson_offers'::regclass
       AND conname IN (
         'lesson_offers_extension_booking_school_fkey',
         'lesson_offers_extension_shape_check'
       )
     ORDER BY conname
  `);
  const extensionIndexes = await client.query(`
    SELECT c.relname AS index_name, i.indisvalid, i.indisunique,
           pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE i.indrelid = 'public.lesson_offers'::regclass
       AND c.relname IN (
         'uq_lesson_offers_pending_extension',
         'idx_lesson_offers_extension_booking'
       )
     ORDER BY c.relname
  `);
  const refundConstraints = await client.query(`
    SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
     WHERE conrelid = 'public.refund_events'::regclass
       AND contype = 'c'
       AND (
         pg_get_constraintdef(oid) ILIKE '%refund_type%'
         OR pg_get_constraintdef(oid) ILIKE '%status%'
       )
     ORDER BY conname
  `);
  const invalidObjects = await client.query(`
    SELECT
      (SELECT COUNT(*)::int
         FROM pg_index
        WHERE indrelid IN ('public.lesson_offers'::regclass, 'public.refund_events'::regclass)
          AND NOT indisvalid) AS invalid_indexes,
      (SELECT COUNT(*)::int
         FROM pg_constraint
        WHERE conrelid IN ('public.lesson_offers'::regclass, 'public.refund_events'::regclass)
          AND NOT convalidated) AS unvalidated_constraints
  `);
  const refundViolations = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE refund_type NOT IN (
        'credit_purchase', 'repeat_offer_partial', 'direct_slot', 'direct_offer',
        'manual_record', 'booking_extension_unfulfilled'
      ))::int AS invalid_refund_types,
      COUNT(*) FILTER (WHERE status NOT IN (
        'previewed', 'processing', 'manual_review', 'blocked', 'executed'
      ))::int AS invalid_refund_statuses
      FROM refund_events
  `);
  const rowCounts = await client.query(`
    SELECT
      (SELECT COUNT(*)::bigint FROM lesson_offers)::text AS lesson_offers,
      (SELECT COUNT(*)::bigint FROM refund_events)::text AS refund_events
  `);

  let extensionViolations = null;
  if (columns.rowCount === 3) {
    extensionViolations = await client.query(`
      SELECT COUNT(*)::int AS invalid_extension_rows
        FROM lesson_offers
       WHERE NOT (
         (extension_booking_id IS NULL AND extension_minutes IS NULL AND extension_base_list_price_pence IS NULL)
         OR
         (extension_booking_id IS NOT NULL
           AND extension_minutes IS NOT NULL
           AND extension_base_list_price_pence IS NOT NULL
           AND extension_minutes BETWEEN 30 AND 180
           AND extension_minutes % 30 = 0
           AND extension_base_list_price_pence >= 0)
       )
    `);
  }

  return {
    identity: identity.rows[0],
    columns: columns.rows,
    extensionConstraints: extensionConstraints.rows,
    extensionIndexes: extensionIndexes.rows,
    refundConstraints: refundConstraints.rows,
    invalidObjects: invalidObjects.rows[0],
    refundViolations: refundViolations.rows[0],
    extensionViolations: extensionViolations?.rows[0] || { invalid_extension_rows: 0 },
    rowCounts: rowCounts.rows[0],
  };
}

function validatePreflight(evidence) {
  const failures = [];
  const count = evidence.columns.length;
  if (count !== 0) failures.push(count === 3 ? 'migration_060_already_present' : `partial_extension_columns_${count}_of_3`);
  if (evidence.extensionConstraints.length !== 0) failures.push('preexisting_extension_constraints');
  if (evidence.extensionIndexes.length !== 0) failures.push('preexisting_extension_indexes');
  const typeChecks = evidence.refundConstraints.filter(row => row.definition.toLowerCase().includes('refund_type'));
  const statusChecks = evidence.refundConstraints.filter(row => row.definition.toLowerCase().includes('status'));
  if (typeChecks.length !== 1 || typeChecks[0]?.conname !== 'refund_events_refund_type_check') {
    failures.push(`unexpected_refund_type_checks_${typeChecks.map(row => row.conname).join(',') || 'none'}`);
  }
  if (statusChecks.length !== 1 || statusChecks[0]?.conname !== 'refund_events_status_check') {
    failures.push(`unexpected_refund_status_checks_${statusChecks.map(row => row.conname).join(',') || 'none'}`);
  }
  if (Number(evidence.invalidObjects.invalid_indexes) !== 0) failures.push('invalid_indexes_present');
  if (Number(evidence.invalidObjects.unvalidated_constraints) !== 0) failures.push('unvalidated_constraints_present');
  if (Number(evidence.refundViolations.invalid_refund_types) !== 0) failures.push('invalid_refund_type_rows');
  if (Number(evidence.refundViolations.invalid_refund_statuses) !== 0) failures.push('invalid_refund_status_rows');
  return failures;
}

function validatePostflight(evidence, beforeCounts = null) {
  const failures = [];
  if (evidence.columns.length !== 3) failures.push(`extension_columns_${evidence.columns.length}_of_3`);
  const fk = evidence.extensionConstraints.find(row => row.conname === 'lesson_offers_extension_booking_school_fkey');
  const shape = evidence.extensionConstraints.find(row => row.conname === 'lesson_offers_extension_shape_check');
  if (!fk || !fk.convalidated || !fk.definition.includes('FOREIGN KEY (extension_booking_id, school_id)')) failures.push('tenant_safe_extension_fk_missing');
  if (!shape || !shape.convalidated || !shape.definition.includes('extension_minutes IS NOT NULL') || !shape.definition.includes('extension_base_list_price_pence IS NOT NULL')) failures.push('strict_extension_shape_missing');
  if (evidence.extensionIndexes.length !== 2 || evidence.extensionIndexes.some(row => !row.indisvalid)) failures.push('extension_indexes_invalid_or_missing');
  const unique = evidence.extensionIndexes.find(row => row.index_name === 'uq_lesson_offers_pending_extension');
  if (!unique?.indisunique) failures.push('pending_extension_unique_index_missing');
  const typeCheck = evidence.refundConstraints.find(row => row.conname === 'refund_events_refund_type_check');
  const statusCheck = evidence.refundConstraints.find(row => row.conname === 'refund_events_status_check');
  if (!typeCheck?.convalidated || !typeCheck.definition.includes('booking_extension_unfulfilled')) failures.push('extension_refund_type_missing');
  if (!statusCheck?.convalidated || !statusCheck.definition.includes('processing')) failures.push('processing_refund_status_missing');
  if (Number(evidence.invalidObjects.invalid_indexes) !== 0) failures.push('invalid_indexes_present');
  if (Number(evidence.invalidObjects.unvalidated_constraints) !== 0) failures.push('unvalidated_constraints_present');
  if (Number(evidence.refundViolations.invalid_refund_types) !== 0 || Number(evidence.refundViolations.invalid_refund_statuses) !== 0) failures.push('refund_rows_violate_contract');
  if (Number(evidence.extensionViolations.invalid_extension_rows) !== 0) failures.push('extension_rows_violate_contract');
  if (beforeCounts && (beforeCounts.lesson_offers !== evidence.rowCounts.lesson_offers || beforeCounts.refund_events !== evidence.rowCounts.refund_events)) failures.push('row_counts_changed_during_schema_apply');
  return failures;
}

function publicEvidence(mode, target, evidence, failures, migrationSha256, recoveryId = null) {
  return {
    mode,
    executedAt: new Date().toISOString(),
    target,
    databaseIdentity: evidence.identity,
    migrationSha256,
    recoveryId,
    extensionColumnCount: evidence.columns.length,
    extensionConstraintNames: evidence.extensionConstraints.map(row => row.conname),
    extensionIndexNames: evidence.extensionIndexes.map(row => row.index_name),
    refundConstraintNames: evidence.refundConstraints.map(row => row.conname),
    invalidIndexes: Number(evidence.invalidObjects.invalid_indexes),
    unvalidatedConstraints: Number(evidence.invalidObjects.unvalidated_constraints),
    invalidRefundTypes: Number(evidence.refundViolations.invalid_refund_types),
    invalidRefundStatuses: Number(evidence.refundViolations.invalid_refund_statuses),
    invalidExtensionRows: Number(evidence.extensionViolations.invalid_extension_rows),
    rowCounts: evidence.rowCounts,
    failures,
  };
}

async function run() {
  loadEnvLocal();
  const modes = [
    '--test-rehearsal',
    '--test-apply-approved',
    '--production-preflight',
    '--production-apply-approved',
    '--production-postflight',
  ].filter(mode => process.argv.includes(mode));
  if (modes.length !== 1) throw new Error('Choose exactly one supported mode');
  const mode = modes[0];
  const production = mode.startsWith('--production');
  const apply = mode.includes('apply-approved');
  const rehearsal = mode === '--test-rehearsal';
  const databaseUrl = production ? productionUrl() : process.env.POSTGRES_URL_TEST;
  if (!databaseUrl) throw new Error('POSTGRES_URL_TEST is not configured');
  if (!production && process.env.POSTGRES_URL && databaseUrl === process.env.POSTGRES_URL) {
    throw new Error('Test target equals POSTGRES_URL');
  }
  const target = targetSummary(databaseUrl);
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  const migrationSha256 = crypto.createHash('sha256').update(migrationSql).digest('hex');
  const recoveryId = process.env.BOOKING_EXTENSION_RECOVERY_ID || null;
  if (mode === '--production-apply-approved') {
    if (!recoveryId) throw new Error('BOOKING_EXTENSION_RECOVERY_ID is required for production apply');
    if (process.env.BOOKING_EXTENSION_MIGRATION_TARGET_FINGERPRINT !== target.fingerprint) {
      throw new Error('Production target fingerprint was not explicitly approved');
    }
  }

  neonConfig.webSocketConstructor = globalThis.WebSocket;
  const client = new Client({ connectionString: databaseUrl });
  let transactionOpen = false;
  try {
    await client.connect();
    if (apply || rehearsal) {
      await client.query('BEGIN');
      transactionOpen = true;
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query("SET LOCAL statement_timeout = '60s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('coachcarter:booking-extension-060'))");
      const before = await inspect(client);
      const preflightFailures = validatePreflight(before);
      if (preflightFailures.length) throw new Error(`Preflight blocked apply: ${preflightFailures.join(', ')}`);
      await client.query(migrationSql);
      const after = await inspect(client);
      const postflightFailures = validatePostflight(after, before.rowCounts);
      if (postflightFailures.length) throw new Error(`Postflight blocked commit: ${postflightFailures.join(', ')}`);
      if (rehearsal) {
        await client.query('ROLLBACK');
        transactionOpen = false;
      } else {
        await client.query('COMMIT');
        transactionOpen = false;
      }
      process.stdout.write(`${JSON.stringify(publicEvidence(mode, target, after, [], migrationSha256, recoveryId), null, 2)}\n`);
      return;
    }

    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE');
    transactionOpen = true;
    const evidence = await inspect(client);
    const failures = mode === '--production-preflight'
      ? validatePreflight(evidence)
      : validatePostflight(evidence);
    await client.query('ROLLBACK');
    transactionOpen = false;
    process.stdout.write(`${JSON.stringify(publicEvidence(mode, target, evidence, failures, migrationSha256), null, 2)}\n`);
    if (failures.length) process.exitCode = 2;
  } finally {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'BLOCKED', message: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  fingerprint,
  normaliseEndpointHost,
  validatePostflight,
  validatePreflight,
};
