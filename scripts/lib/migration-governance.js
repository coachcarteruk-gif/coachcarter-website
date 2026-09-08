'use strict';

const crypto = require('crypto');

class MigrationGovernanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MigrationGovernanceError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MigrationGovernanceError(code, message);
}

function canonicalSql(value) {
  return String(value).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function sha256(value) {
  return crypto.createHash('sha256').update(canonicalSql(value), 'utf8').digest('hex');
}

function parseMigrationFilename(filename) {
  const match = /^(\d{3})_([a-z0-9_]+)\.sql$/.exec(filename);
  if (!match) fail('INVALID_FILENAME', `Invalid migration filename: ${filename}`);
  return { prefix: match[1], slug: match[2] };
}

function validateManifest(manifest, diskFiles, readFile) {
  if (!manifest || manifest.version !== 1) fail('INVALID_MANIFEST_VERSION', 'Migration manifest version must be 1');
  if (manifest.checksumAlgorithm !== 'sha256-lf-v1') {
    fail('INVALID_CHECKSUM_ALGORITHM', 'Migration manifest must use sha256-lf-v1');
  }
  if (!Array.isArray(manifest.migrations) || manifest.migrations.length === 0) {
    fail('EMPTY_MANIFEST', 'Migration manifest has no entries');
  }

  const files = [...diskFiles].sort();
  const manifestFiles = manifest.migrations.map(entry => entry.filename).sort();
  if (JSON.stringify(files) !== JSON.stringify(manifestFiles)) {
    fail('FILESET_MISMATCH', 'Manifest filenames do not exactly match db/migrations');
  }

  const ids = new Set();
  const filenames = new Set();
  const orders = new Set();
  const prefixes = new Map();
  let previousOrder = 0;

  for (const entry of manifest.migrations) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) fail('INVALID_IDENTIFIER', 'Every migration requires an id');
    if (ids.has(entry.id)) fail('DUPLICATE_IDENTIFIER', `Duplicate migration id: ${entry.id}`);
    ids.add(entry.id);

    if (filenames.has(entry.filename)) fail('DUPLICATE_FILENAME', `Duplicate migration filename: ${entry.filename}`);
    filenames.add(entry.filename);

    if (!Number.isInteger(entry.order) || entry.order <= previousOrder || orders.has(entry.order)) {
      fail('OUT_OF_ORDER_MANIFEST', `Migration order is not strictly increasing at ${entry.id}`);
    }
    previousOrder = entry.order;
    orders.add(entry.order);

    const parsed = parseMigrationFilename(entry.filename);
    if (entry.prefix !== parsed.prefix) fail('PREFIX_MISMATCH', `Prefix mismatch for ${entry.id}`);
    if (!['baseline', 'deferred', 'numbered'].includes(entry.execution)) {
      fail('INVALID_EXECUTION_CLASS', `Invalid execution class for ${entry.id}`);
    }
    if (!/^[a-f0-9]{64}$/.test(entry.checksum)) fail('INVALID_CHECKSUM', `Invalid checksum for ${entry.id}`);

    const migrationSql = readFile(entry.filename);
    const actualChecksum = sha256(migrationSql);
    if (actualChecksum !== entry.checksum) fail('CHECKSUM_MISMATCH', `Checksum mismatch for ${entry.id}`);
    if (entry.execution === 'numbered' && /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im.test(canonicalSql(migrationSql))) {
      fail('EMBEDDED_TRANSACTION_CONTROL', `Numbered migration contains transaction control: ${entry.id}`);
    }

    const group = prefixes.get(entry.prefix) || [];
    group.push(entry.id);
    prefixes.set(entry.prefix, group);
  }

  const declaredCollisions = manifest.legacyPrefixCollisions || {};
  for (const [prefix, group] of prefixes) {
    if (group.length < 2) continue;
    const declared = declaredCollisions[prefix];
    if (!declared || JSON.stringify(declared) !== JSON.stringify(group)) {
      fail('DUPLICATE_PREFIX', `Undeclared duplicate migration prefix: ${prefix}`);
    }
  }
  for (const [prefix, declared] of Object.entries(declaredCollisions)) {
    if (JSON.stringify(prefixes.get(prefix) || []) !== JSON.stringify(declared)) {
      fail('STALE_PREFIX_COLLISION', `Legacy prefix collision declaration is stale: ${prefix}`);
    }
  }

  return { count: manifest.migrations.length, collisions: declaredCollisions };
}

function successfulRows(rows) {
  return rows.filter(row => row.status === 'succeeded');
}

function validateLedger(manifest, rows) {
  if (!Array.isArray(rows)) fail('INVALID_LEDGER', 'Migration ledger rows must be an array');
  const entryById = new Map(manifest.migrations.map(entry => [entry.id, entry]));
  const successById = new Map();

  for (const row of rows) {
    const entry = entryById.get(row.migration_id);
    if (!entry) fail('UNKNOWN_LEDGER_MIGRATION', `Ledger contains unknown migration id: ${row.migration_id}`);
    if (!['running', 'succeeded', 'failed'].includes(row.status)) {
      fail('INVALID_LEDGER_STATUS', `Invalid ledger status for ${row.migration_id}`);
    }
    if (row.status === 'running') fail('UNRESOLVED_MIGRATION_ATTEMPT', `Unresolved migration attempt: ${row.migration_id}`);
    if (row.status === 'failed') fail('FAILED_MIGRATION_ATTEMPT', `Failed migration attempt requires review: ${row.migration_id}`);
    if (!row.executed_at || !Number.isFinite(Number(row.duration_ms)) || Number(row.duration_ms) < 0) {
      fail('INCOMPLETE_LEDGER_SUCCESS', `Successful ledger row is incomplete: ${row.migration_id}`);
    }
    if (successById.has(row.migration_id)) fail('DUPLICATE_LEDGER_SUCCESS', `Duplicate successful ledger row: ${row.migration_id}`);
    if (row.filename !== entry.filename) fail('LEDGER_FILENAME_MISMATCH', `Ledger filename mismatch for ${row.migration_id}`);
    if (row.checksum !== entry.checksum) fail('LEDGER_CHECKSUM_MISMATCH', `Ledger checksum mismatch for ${row.migration_id}`);
    successById.set(row.migration_id, row);
  }

  const required = manifest.migrations.filter(entry => entry.execution !== 'deferred');
  let missingSeen = false;
  const pending = [];
  for (const entry of required) {
    if (successById.has(entry.id)) {
      if (missingSeen) fail('OUT_OF_ORDER_LEDGER', `Migration ${entry.id} succeeded after an earlier gap`);
    } else {
      missingSeen = true;
      pending.push(entry);
    }
  }

  return { applied: successfulRows(rows).length, pending };
}

function safeDatabaseErrorCode(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code)
    ? error.code
    : 'MIGRATION_ERROR';
}

async function executeMigration(client, entry, sqlText, options = {}) {
  const startedAt = options.now ? options.now() : new Date();
  const insert = await client.query(
    `INSERT INTO schema_migration_history
       (migration_id, filename, checksum, status, started_at)
     VALUES ($1, $2, $3, 'running', $4)
     RETURNING attempt_id`,
    [entry.id, entry.filename, entry.checksum, startedAt]
  );
  const attemptId = insert.rows[0].attempt_id;
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '10min'");
    await client.query(sqlText);
    const finishedAt = options.now ? options.now() : new Date();
    const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
    const updated = await client.query(
      `UPDATE schema_migration_history
          SET status = 'succeeded', executed_at = $2, duration_ms = $3
        WHERE attempt_id = $1 AND status = 'running'`,
      [attemptId, finishedAt, durationMs]
    );
    if (updated.rowCount !== 1) fail('LEDGER_FINALIZE_FAILED', `Could not finalize migration ${entry.id}`);
    await client.query('COMMIT');
    transactionOpen = false;
    return { migrationId: entry.id, durationMs };
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    const finishedAt = options.now ? options.now() : new Date();
    const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
    await client.query(
      `UPDATE schema_migration_history
          SET status = 'failed', executed_at = $2, duration_ms = $3, error_code = $4
        WHERE attempt_id = $1 AND status = 'running'`,
      [attemptId, finishedAt, durationMs, safeDatabaseErrorCode(error)]
    ).catch(() => {});
    fail('MIGRATION_EXECUTION_FAILED', `Migration ${entry.id} failed; review the private database logs`);
  }
}

module.exports = {
  MigrationGovernanceError,
  canonicalSql,
  executeMigration,
  parseMigrationFilename,
  safeDatabaseErrorCode,
  sha256,
  validateLedger,
  validateManifest,
};
