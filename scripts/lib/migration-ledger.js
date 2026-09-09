'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  MigrationGovernanceError,
  canonicalSql,
  validateLedger,
  validateManifest,
} = require('./migration-governance');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');
const MANIFEST_PATH = path.join(MIGRATIONS_DIR, 'manifest.json');
const BASELINE_PATH = path.join(ROOT, 'db', 'migration-governance', 'production-baseline.json');
const LEDGER_DDL_PATH = path.join(ROOT, 'db', 'migration-governance', 'schema-migration-history.sql');
const ADVISORY_LOCK_KEY = 'coachcarter:migration-ledger-phase-2';

const EXPECTED_MARKERS = [
  'per_instructor_credits_step_1c_backfill',
  'per_instructor_credits_step_2a',
  'per_instructor_credits_step_2b',
  'per_instructor_credits_step_2c',
  'per_instructor_credits_step_2_5',
  'per_instructor_credits_step_2c_grandfather',
  'per_instructor_credits_step_2c_reattribute',
  'per_instructor_credits_step_2c_no_lcb_backfill',
  'credits_credit_returned_retro_fix',
  'per_instructor_credits_step_4',
];

const EXPECTED_COLUMNS = [
  'attempt_id',
  'migration_id',
  'filename',
  'checksum',
  'checksum_algorithm',
  'record_kind',
  'evidence_kind',
  'status',
  'started_at',
  'executed_at',
  'duration_ms',
  'error_code',
  'execution_context',
];

const EXPECTED_COLUMN_SIGNATURES = [
  ['attempt_id', 'bigint', 'NO', 'YES', 'ALWAYS', null, null],
  ['migration_id', 'text', 'NO', 'NO', null, null, null],
  ['filename', 'text', 'NO', 'NO', null, null, null],
  ['checksum', 'character', 'NO', 'NO', null, 64, null],
  ['checksum_algorithm', 'text', 'NO', 'NO', null, null, "'sha256-lf-v1'::text"],
  ['record_kind', 'text', 'NO', 'NO', null, null, "'execution'::text"],
  ['evidence_kind', 'text', 'NO', 'NO', null, null, "'numbered_execution'::text"],
  ['status', 'text', 'NO', 'NO', null, null, null],
  ['started_at', 'timestamp with time zone', 'NO', 'NO', null, null, null],
  ['executed_at', 'timestamp with time zone', 'YES', 'NO', null, null, null],
  ['duration_ms', 'bigint', 'YES', 'NO', null, null, null],
  ['error_code', 'text', 'YES', 'NO', null, null, null],
  ['execution_context', 'jsonb', 'YES', 'NO', null, null, null],
];

const EXPECTED_CONSTRAINTS = [
  'schema_migration_history_checksum_algorithm_check',
  'schema_migration_history_checksum_check',
  'schema_migration_history_context_check',
  'schema_migration_history_evidence_kind_check',
  'schema_migration_history_filename_check',
  'schema_migration_history_migration_id_check',
  'schema_migration_history_pkey',
  'schema_migration_history_record_evidence_check',
  'schema_migration_history_record_kind_check',
  'schema_migration_history_status_check',
  'schema_migration_history_terminal_state_check',
];

const EXPECTED_INDEXES = [
  'schema_migration_history_pkey',
  'schema_migration_history_success_filename_uniq',
  'schema_migration_history_success_migration_uniq',
];

const EXPECTED_TRIGGERS = [
  'schema_migration_history_guard_truncate',
  'schema_migration_history_guard_update_delete',
];

function fail(code, message) {
  throw new MigrationGovernanceError(code, message);
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJson(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableJson(value));
}

function loadPacket() {
  const manifestText = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(manifestText);
  const diskFiles = fs.readdirSync(MIGRATIONS_DIR).filter(file => file.endsWith('.sql'));
  validateManifest(
    manifest,
    diskFiles,
    filename => {
      try {
        return fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      } catch (error) {
        if (!['EACCES', 'EPERM'].includes(error.code)) throw error;
        return execFileSync('git', ['show', `:db/migrations/${filename}`], {
          cwd: ROOT,
          encoding: 'utf8',
        });
      }
    }
  );
  const baselineText = fs.readFileSync(BASELINE_PATH, 'utf8');
  const packet = JSON.parse(baselineText);
  validateBaselinePacket(packet, manifest, sha256Bytes(canonicalSql(manifestText)));
  return {
    manifest,
    packet,
    packetChecksum: sha256Bytes(canonicalSql(baselineText)),
    ddl: fs.readFileSync(LEDGER_DDL_PATH, 'utf8'),
    ddlChecksum: sha256Bytes(canonicalSql(fs.readFileSync(LEDGER_DDL_PATH, 'utf8'))),
  };
}

function validateBaselinePacket(packet, manifest, actualManifestChecksum) {
  if (!packet || packet.version !== 1) fail('INVALID_BASELINE_PACKET', 'Baseline packet version must be 1');
  if (packet.packetId !== 'coachcarter-production-history-v1') {
    fail('INVALID_BASELINE_PACKET_ID', 'Unexpected baseline packet identity');
  }
  if (packet.manifestChecksum !== actualManifestChecksum) {
    fail('BASELINE_MANIFEST_CHECKSUM_MISMATCH', 'Baseline packet does not match the migration manifest');
  }
  if (!Array.isArray(packet.entries) || packet.entries.length !== manifest.migrations.length) {
    fail('BASELINE_ENTRY_COUNT_MISMATCH', 'Baseline packet must cover every manifest entry');
  }

  const allowedEvidence = new Set([
    'exact_execution',
    'structural_equivalence',
    'intentionally_removed',
    'deferred',
  ]);
  for (let index = 0; index < manifest.migrations.length; index += 1) {
    const entry = manifest.migrations[index];
    const baseline = packet.entries[index];
    if (!baseline || baseline.id !== entry.id || baseline.filename !== entry.filename) {
      fail('BASELINE_ORDER_MISMATCH', `Baseline packet is out of order at ${entry.id}`);
    }
    if (baseline.checksum !== entry.checksum) {
      fail('BASELINE_CHECKSUM_MISMATCH', `Baseline checksum mismatch at ${entry.id}`);
    }
    if (!allowedEvidence.has(baseline.evidenceClass)) {
      fail('INVALID_BASELINE_EVIDENCE', `Invalid baseline evidence class at ${entry.id}`);
    }
    if (entry.execution === 'deferred') {
      if (baseline.disposition !== 'deferred' || baseline.evidenceClass !== 'deferred') {
        fail('DEFERRED_BASELINE_MISMATCH', `Deferred migration ${entry.id} cannot be baselined as successful`);
      }
    } else if (baseline.disposition !== 'baseline' || baseline.evidenceClass === 'deferred') {
      fail('INVALID_BASELINE_DISPOSITION', `Migration ${entry.id} requires an honest baseline disposition`);
    }
    assertNonSecretContext(baseline.evidence || {});
  }

  const exactIds = packet.entries
    .filter(entry => entry.evidenceClass === 'exact_execution')
    .map(entry => entry.id);
  if (JSON.stringify(exactIds) !== JSON.stringify(['035', '039', '060'])) {
    fail('EXACT_EVIDENCE_SET_MISMATCH', 'Only migrations 035, 039, and 060 have exact execution evidence');
  }
  if (packet.entries.find(entry => entry.id === '026a').filename !== '026_public_tenant_resolution.sql'
      || packet.entries.find(entry => entry.id === '026b').filename !== '026_weekly_availability_transmission.sql') {
    fail('LEGACY_026_IDENTITY_MISMATCH', 'The stable 026a/026b identities must be preserved');
  }

  if (!Array.isArray(packet.legacyMarkerEvidence)) {
    fail('BASELINE_MARKERS_MISSING', 'Legacy marker evidence list is required');
  }
  const markerKeys = packet.legacyMarkerEvidence.map(marker => marker.key);
  if (JSON.stringify(markerKeys) !== JSON.stringify(EXPECTED_MARKERS)) {
    fail('BASELINE_MARKER_SET_MISMATCH', 'Legacy marker evidence set or order changed');
  }
  for (const marker of packet.legacyMarkerEvidence) {
    if (marker.evidenceClass !== 'exact_marker_row'
        || marker.completedAtSource !== 'production.migration_markers.completed_at'
        || Object.prototype.hasOwnProperty.call(marker, 'completedAt')) {
      fail('INVALID_MARKER_EVIDENCE', `Marker ${marker.key} must source its real production timestamp at preflight`);
    }
  }
  return { entries: packet.entries.length, markers: markerKeys.length };
}

function assertNonSecretContext(value, pathParts = []) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNonSecretContext(item, [...pathParts, String(index)]));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/(?:password|secret|token|credential|connection|string|database[_-]?url|postgres[_-]?url)/i.test(key)) {
        fail('SECRET_CONTEXT_KEY_REFUSED', `Execution context contains a prohibited key at ${[...pathParts, key].join('.')}`);
      }
      assertNonSecretContext(item, [...pathParts, key]);
    }
    return;
  }
  if (typeof value === 'string' && /(?:postgres(?:ql)?:\/\/|sk_(?:live|test)_|whsec_|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i.test(value)) {
    fail('SECRET_CONTEXT_VALUE_REFUSED', `Execution context contains a prohibited value at ${pathParts.join('.')}`);
  }
}

function directDatabaseUrl(env = process.env) {
  const databaseUrl = env.MIGRATION_LEDGER_DIRECT_URL;
  if (!databaseUrl) fail('DIRECT_URL_MISSING', 'MIGRATION_LEDGER_DIRECT_URL is required');
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail('DIRECT_URL_INVALID', 'The direct database URL is invalid');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    fail('DIRECT_URL_INVALID', 'The direct database URL must use PostgreSQL');
  }
  if (parsed.hostname.toLowerCase().includes('-pooler')) {
    fail('POOLED_URL_REFUSED', 'Ledger tooling refuses pooled database URLs');
  }
  // pg 8 currently treats sslmode=require/verify-ca as verify-full but warns
  // that pg 9 will weaken those aliases to libpq semantics. Keep this operator
  // path explicitly certificate- and hostname-verifying across that change.
  if (['require', 'verify-ca'].includes(parsed.searchParams.get('sslmode'))) {
    parsed.searchParams.set('sslmode', 'verify-full');
  }
  return parsed.toString();
}

function fingerprint(databaseUrl) {
  const parsed = new URL(databaseUrl);
  return crypto.createHash('sha256')
    .update(`${parsed.hostname.toLowerCase()}|${parsed.port || '5432'}|${parsed.pathname}|${decodeURIComponent(parsed.username)}`)
    .digest('hex');
}

function requireMutationApproval(mode, targetFingerprint, env = process.env) {
  const expectedPhrase = {
    install: 'INSTALL_BASELINE',
    rehearse: 'REHEARSE_AND_ROLL_BACK',
    cleanup: 'REMOVE_REHEARSAL_LEDGER',
  }[mode];
  if (!expectedPhrase || env.MIGRATION_LEDGER_MUTATION_APPROVAL !== expectedPhrase) {
    fail('MUTATION_NOT_APPROVED', `Mutation mode requires ${expectedPhrase}`);
  }
  if (env.MIGRATION_LEDGER_TARGET_FINGERPRINT !== targetFingerprint) {
    fail('TARGET_NOT_APPROVED', 'Approved target fingerprint does not match');
  }
  if (!['isolated_rehearsal', 'production'].includes(env.MIGRATION_LEDGER_TARGET_CLASS)) {
    fail('TARGET_CLASS_REQUIRED', 'Target class must be isolated_rehearsal or production');
  }
  if (mode === 'cleanup' && env.MIGRATION_LEDGER_TARGET_CLASS !== 'isolated_rehearsal') {
    fail('PRODUCTION_CLEANUP_REFUSED', 'Ledger cleanup is restricted to isolated rehearsal targets');
  }
  if (env.MIGRATION_LEDGER_TARGET_CLASS === 'production') {
    if (env.MIGRATION_LEDGER_PRODUCTION_APPROVAL !== 'SEPARATELY_APPROVED_PRODUCTION_BASELINE') {
      fail('PRODUCTION_APPROVAL_REQUIRED', 'Production requires a separate explicit approval phrase');
    }
    if (!/^snap-[a-z0-9-]+$/.test(env.MIGRATION_LEDGER_NEON_SNAPSHOT || '')) {
      fail('PRODUCTION_SNAPSHOT_REQUIRED', 'A recorded Neon snapshot ID is required for production');
    }
  }
}

async function setLocalSafetyTimeouts(client) {
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SET LOCAL statement_timeout = '10min'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '2min'");
}

async function acquireTransactionLock(client) {
  const lock = await client.query(
    'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired',
    [ADVISORY_LOCK_KEY]
  );
  if (!lock.rows[0].acquired) fail('ADVISORY_LOCK_UNAVAILABLE', 'Another migration-ledger operation holds the advisory lock');
}

async function ledgerExists(client) {
  const result = await client.query("SELECT to_regclass('public.schema_migration_history') IS NOT NULL AS present");
  return result.rows[0].present;
}

async function readLedgerRows(client) {
  const result = await client.query(`
    SELECT migration_id, filename, checksum, status, started_at, executed_at,
           duration_ms, error_code, record_kind, evidence_kind, execution_context
      FROM public.schema_migration_history
     ORDER BY attempt_id
  `);
  return result.rows;
}

async function inspectLedgerSchema(client) {
  const [columns, constraints, indexes, triggers, guardFunction] = await Promise.all([
    client.query(`
      SELECT column_name, data_type, is_nullable, is_identity,
             identity_generation, character_maximum_length, column_default
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'schema_migration_history'
       ORDER BY ordinal_position
    `),
    client.query(`
      SELECT conname
        FROM pg_constraint
       WHERE conrelid = 'public.schema_migration_history'::regclass
         AND contype <> 'n'
       ORDER BY conname
    `),
    client.query(`
      SELECT indexname
        FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'schema_migration_history'
       ORDER BY indexname
    `),
    client.query(`
      SELECT tgname AS trigger_name
        FROM pg_trigger
       WHERE tgrelid = 'public.schema_migration_history'::regclass
         AND NOT tgisinternal
       ORDER BY tgname
    `),
    client.query(`
      SELECT to_regprocedure('public.guard_schema_migration_history_append_only()') IS NOT NULL AS present
    `),
  ]);
  return {
    columns: columns.rows.map(row => row.column_name),
    columnSignatures: columns.rows.map(row => [
      row.column_name,
      row.data_type,
      row.is_nullable,
      row.is_identity,
      row.identity_generation,
      row.character_maximum_length === null ? null : Number(row.character_maximum_length),
      row.column_default,
    ]),
    constraints: constraints.rows.map(row => row.conname),
    indexes: indexes.rows.map(row => row.indexname),
    triggers: triggers.rows.map(row => row.trigger_name),
    guardFunction: guardFunction.rows[0].present,
  };
}

function verifyLedgerSchema(schema) {
  const checks = [
    ['columns', EXPECTED_COLUMNS],
    ['constraints', EXPECTED_CONSTRAINTS],
    ['indexes', EXPECTED_INDEXES],
    ['triggers', EXPECTED_TRIGGERS],
  ];
  for (const [field, expected] of checks) {
    if (JSON.stringify(schema[field]) !== JSON.stringify(expected)) {
      const missing = expected.filter(value => !schema[field].includes(value));
      const unexpected = schema[field].filter(value => !expected.includes(value));
      fail(
        'LEDGER_SCHEMA_MISMATCH',
        `Ledger ${field} do not match the reviewed DDL (missing: ${missing.join(',') || 'none'}; unexpected: ${unexpected.join(',') || 'none'})`
      );
    }
  }
  if (stableStringify(schema.columnSignatures) !== stableStringify(EXPECTED_COLUMN_SIGNATURES)) {
    fail('LEDGER_SCHEMA_MISMATCH', 'Ledger column types or nullability do not match the reviewed DDL');
  }
  if (!schema.guardFunction) fail('LEDGER_SCHEMA_MISMATCH', 'Ledger guard function is missing');
}

async function readLegacyMarkerEvidence(client, packet) {
  const exists = await client.query("SELECT to_regclass('public.migration_markers') IS NOT NULL AS present");
  if (!exists.rows[0].present) fail('MIGRATION_MARKERS_MISSING', 'Historical migration marker table is missing');
  const keys = packet.legacyMarkerEvidence.map(marker => marker.key);
  const result = await client.query(`
    SELECT key, completed_at
      FROM public.migration_markers
     WHERE key = ANY($1::text[])
     ORDER BY array_position($1::text[], key)
  `, [keys]);
  if (result.rows.length !== keys.length
      || result.rows.some((row, index) => row.key !== keys[index] || !row.completed_at)) {
    fail('BASELINE_MARKER_EVIDENCE_MISSING', 'One or more required historical marker receipts are missing');
  }
  return result.rows.map(row => ({ key: row.key, completedAt: new Date(row.completed_at).toISOString() }));
}

function baselineContext(entry, packet, packetChecksum, ddlChecksum, markerEvidence, targetFingerprint) {
  const context = {
    schema: 'coachcarter-migration-baseline-context-v1',
    packetId: packet.packetId,
    packetChecksum,
    ledgerDdlChecksum: ddlChecksum,
    targetFingerprint,
    timestampSemantics: 'ledger baseline recording; historical times appear only inside evidence when proved',
    evidence: entry.evidence || {},
  };
  if (entry.id === '001') context.legacyMarkerEvidence = markerEvidence;
  assertNonSecretContext(context);
  return context;
}

function verifyBaselineRows(bundle, rows, markerEvidence, targetFingerprint) {
  const expected = bundle.packet.entries.filter(entry => entry.disposition === 'baseline');
  if (rows.length !== expected.length || rows.some(row => row.migration_id === '041')) {
    fail('BASELINE_DISPOSITION_MISMATCH', 'Ledger does not contain exactly the reviewed 60 baseline receipts');
  }
  for (let index = 0; index < expected.length; index += 1) {
    const entry = expected[index];
    const row = rows[index];
    const expectedContext = baselineContext(
      entry,
      bundle.packet,
      bundle.packetChecksum,
      bundle.ddlChecksum,
      markerEvidence,
      targetFingerprint
    );
    if (row.migration_id !== entry.id
        || row.record_kind !== 'baseline'
        || row.evidence_kind !== entry.evidenceClass
        || stableStringify(row.execution_context) !== stableStringify(expectedContext)) {
      fail('BASELINE_EVIDENCE_MISMATCH', `Ledger baseline evidence mismatch at ${entry.id}`);
    }
  }
}

async function installBaselineInTransaction(client, bundle, targetFingerprint, options = {}) {
  const alreadyPresent = await ledgerExists(client);
  if (alreadyPresent) {
    if (options.requireMissing) fail('LEDGER_ALREADY_PRESENT', 'Rehearsal requires a target without the ledger');
    verifyLedgerSchema(await inspectLedgerSchema(client));
    const rows = await readLedgerRows(client);
    const plan = validateLedger(bundle.manifest, rows);
    if (plan.pending.length !== 0 || rows.length !== bundle.manifest.migrations.length - 1) {
      fail('BASELINE_INCOMPLETE', 'Existing ledger is not the complete reviewed baseline');
    }
    const markerEvidence = await readLegacyMarkerEvidence(client, bundle.packet);
    verifyBaselineRows(bundle, rows, markerEvidence, targetFingerprint);
    return { alreadyInstalled: true, inserted: 0, rows, markerEvidence };
  }

  const markerEvidence = await readLegacyMarkerEvidence(client, bundle.packet);
  await client.query(bundle.ddl);
  verifyLedgerSchema(await inspectLedgerSchema(client));

  let inserted = 0;
  for (const entry of bundle.packet.entries) {
    if (entry.disposition === 'deferred') continue;
    const context = baselineContext(
      entry,
      bundle.packet,
      bundle.packetChecksum,
      bundle.ddlChecksum,
      markerEvidence,
      targetFingerprint
    );
    await client.query(`
      INSERT INTO public.schema_migration_history (
        migration_id, filename, checksum, checksum_algorithm,
        record_kind, evidence_kind, status,
        started_at, executed_at, duration_ms, execution_context
      ) VALUES (
        $1, $2, $3, 'sha256-lf-v1',
        'baseline', $4, 'succeeded',
        statement_timestamp(), clock_timestamp(),
        GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - statement_timestamp())) * 1000)::BIGINT),
        $5::jsonb
      )
    `, [entry.id, entry.filename, entry.checksum, entry.evidenceClass, JSON.stringify(context)]);
    inserted += 1;
  }

  const rows = await readLedgerRows(client);
  const plan = validateLedger(bundle.manifest, rows);
  if (plan.pending.length !== 0 || rows.length !== bundle.manifest.migrations.length - 1) {
    fail('BASELINE_POSTCONDITION_FAILED', 'Baseline rows failed postcondition validation');
  }
  verifyBaselineRows(bundle, rows, markerEvidence, targetFingerprint);
  return { alreadyInstalled: false, inserted, rows, markerEvidence };
}

async function preflight(client, bundle, targetFingerprint) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await setLocalSafetyTimeouts(client);
    await acquireTransactionLock(client);
    const markerEvidence = await readLegacyMarkerEvidence(client, bundle.packet);
    const present = await ledgerExists(client);
    let state = 'absent';
    let rows = [];
    if (present) {
      verifyLedgerSchema(await inspectLedgerSchema(client));
      rows = await readLedgerRows(client);
      const plan = validateLedger(bundle.manifest, rows);
      if (plan.pending.length !== 0 || rows.length !== bundle.manifest.migrations.length - 1) {
        fail('BASELINE_INCOMPLETE', 'Ledger does not contain exactly the reviewed 60 baseline receipts');
      }
      verifyBaselineRows(bundle, rows, markerEvidence, targetFingerprint);
      state = 'installed';
    }
    await client.query('ROLLBACK');
    return {
      ok: true,
      mode: 'preflight',
      targetFingerprint,
      ledger: state,
      manifestEntries: bundle.manifest.migrations.length,
      baselineRows: rows.length,
      deferred: ['041'],
      exactExecutionEvidence: ['035', '039', '060'],
      legacyMarkers: markerEvidence,
      packetChecksum: bundle.packetChecksum,
      ledgerDdlChecksum: bundle.ddlChecksum,
      next: state === 'absent' ? 'READY_FOR_SEPARATE_INSTALL_APPROVAL' : 'ALREADY_INSTALLED_AND_VALID',
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function installOrRehearse(client, bundle, targetFingerprint, options = {}) {
  await client.query('BEGIN');
  try {
    await setLocalSafetyTimeouts(client);
    await acquireTransactionLock(client);
    const result = await installBaselineInTransaction(client, bundle, targetFingerprint, {
      requireMissing: options.rollback === true,
    });
    if (options.rollback) {
      await client.query('ROLLBACK');
      const absent = !(await ledgerExists(client));
      if (!absent) fail('REHEARSAL_ROLLBACK_FAILED', 'Ledger remained after rehearsal rollback');
      return { ok: true, mode: 'rehearse', rolledBack: true, inserted: result.inserted };
    }
    await client.query('COMMIT');
    return {
      ok: true,
      mode: 'install',
      committed: true,
      alreadyInstalled: result.alreadyInstalled,
      inserted: result.inserted,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function postflight(client, bundle, targetFingerprint) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await setLocalSafetyTimeouts(client);
    await acquireTransactionLock(client);
    if (!(await ledgerExists(client))) fail('MIGRATION_LEDGER_MISSING', 'Authoritative migration ledger is not installed');
    verifyLedgerSchema(await inspectLedgerSchema(client));
    const rows = await readLedgerRows(client);
    const plan = validateLedger(bundle.manifest, rows);
    if (plan.pending.length !== 0 || rows.length !== 60) {
      fail('BASELINE_INCOMPLETE', 'Postflight found an incomplete baseline');
    }
    const markerEvidence = await readLegacyMarkerEvidence(client, bundle.packet);
    verifyBaselineRows(bundle, rows, markerEvidence, targetFingerprint);
    const baselineRows = rows.filter(row => row.record_kind === 'baseline');
    await client.query('ROLLBACK');
    return {
      ok: true,
      mode: 'postflight',
      targetFingerprint,
      rows: rows.length,
      exactExecutionEvidence: baselineRows.filter(row => row.evidence_kind === 'exact_execution').map(row => row.migration_id),
      structuralEquivalence: baselineRows.filter(row => row.evidence_kind === 'structural_equivalence').length,
      intentionallyRemoved: baselineRows.filter(row => row.evidence_kind === 'intentionally_removed').map(row => row.migration_id),
      deferred: ['041'],
      status: 'BASELINE_INSTALLED_AND_VALID',
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function cleanupRehearsal(client) {
  await client.query('BEGIN');
  try {
    await setLocalSafetyTimeouts(client);
    await acquireTransactionLock(client);
    if (await ledgerExists(client)) {
      verifyLedgerSchema(await inspectLedgerSchema(client));
      await client.query('DROP TABLE public.schema_migration_history');
      await client.query('DROP FUNCTION public.guard_schema_migration_history_append_only()');
    }
    await client.query('COMMIT');
    return { ok: true, mode: 'cleanup', committed: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

module.exports = {
  ADVISORY_LOCK_KEY,
  BASELINE_PATH,
  EXPECTED_MARKERS,
  LEDGER_DDL_PATH,
  assertNonSecretContext,
  cleanupRehearsal,
  directDatabaseUrl,
  fingerprint,
  inspectLedgerSchema,
  installBaselineInTransaction,
  installOrRehearse,
  ledgerExists,
  loadPacket,
  postflight,
  preflight,
  readLegacyMarkerEvidence,
  readLedgerRows,
  requireMutationApproval,
  validateBaselinePacket,
  verifyBaselineRows,
  verifyLedgerSchema,
};
