#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Client } = require('pg');
const {
  MigrationGovernanceError,
  executeMigration,
  validateLedger,
  validateManifest,
} = require('./lib/migration-governance');

const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'db', 'migrations');
const manifestPath = path.join(migrationsDir, 'manifest.json');

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

function loadRepository(options = {}) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const diskFiles = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql'));
  const readFile = filename => {
    try {
      return fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
    } catch (error) {
      if (!['EACCES', 'EPERM'].includes(error.code)) throw error;
      if (options.allowIndexFallback) {
        return execFileSync('git', ['show', `:db/migrations/${filename}`], {
          cwd: root,
          encoding: 'utf8',
        });
      }
      throw new MigrationGovernanceError('MIGRATION_FILE_UNREADABLE', `Migration file is unreadable: ${filename}`);
    }
  };
  const result = validateManifest(manifest, diskFiles, readFile);
  return { manifest, readFile, result };
}

function fingerprint(databaseUrl) {
  const parsed = new URL(databaseUrl);
  return crypto.createHash('sha256')
    .update(`${parsed.host.toLowerCase()}|${parsed.pathname}|${decodeURIComponent(parsed.username)}`)
    .digest('hex');
}

function directDatabaseUrl() {
  const databaseUrl = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL_UNPOOLED;
  if (!databaseUrl) throw new MigrationGovernanceError('DIRECT_URL_MISSING', 'A direct database URL is required');
  const parsed = new URL(databaseUrl);
  if (parsed.hostname.includes('-pooler')) {
    throw new MigrationGovernanceError('POOLED_URL_REFUSED', 'The migration runner refuses pooled database URLs');
  }
  if (['require', 'verify-ca'].includes(parsed.searchParams.get('sslmode'))) {
    parsed.searchParams.set('sslmode', 'verify-full');
  }
  return parsed.toString();
}

async function readLedger(client) {
  const exists = await client.query("SELECT to_regclass('public.schema_migration_history') IS NOT NULL AS present");
  if (!exists.rows[0].present) {
    throw new MigrationGovernanceError('MIGRATION_LEDGER_MISSING', 'Authoritative migration ledger is not installed');
  }
  const result = await client.query(
    `SELECT migration_id, filename, checksum, status, started_at, executed_at, duration_ms, error_code
       FROM schema_migration_history
      ORDER BY attempt_id`
  );
  return result.rows;
}

async function run() {
  const modes = ['--check', '--status', '--apply-approved'].filter(mode => process.argv.includes(mode));
  if (modes.length !== 1) {
    throw new MigrationGovernanceError('MODE_REQUIRED', 'Choose exactly one of --check, --status, or --apply-approved');
  }

  const repository = loadRepository({ allowIndexFallback: modes[0] !== '--apply-approved' });
  if (modes[0] === '--check') {
    process.stdout.write(`${JSON.stringify({ ok: true, migrations: repository.result.count, collisions: repository.result.collisions }, null, 2)}\n`);
    return;
  }

  loadEnvLocal();
  const databaseUrl = directDatabaseUrl();
  const targetFingerprint = fingerprint(databaseUrl);
  const apply = modes[0] === '--apply-approved';
  if (apply && process.env.MIGRATION_RUNNER_APPLY !== 'approved') {
    throw new MigrationGovernanceError('APPLY_NOT_APPROVED', 'MIGRATION_RUNNER_APPLY=approved is required');
  }
  if (apply && process.env.MIGRATION_RUNNER_TARGET_FINGERPRINT !== targetFingerprint) {
    throw new MigrationGovernanceError('TARGET_NOT_APPROVED', 'Approved target fingerprint does not match');
  }

  const client = new Client({ connectionString: databaseUrl });
  client.on('error', () => {});
  let lockHeld = false;
  try {
    await client.connect();
    if (!apply) await client.query('BEGIN TRANSACTION READ ONLY');
    if (apply) {
      await client.query("SELECT pg_advisory_lock(hashtext('coachcarter:authoritative-migrations'))");
      lockHeld = true;
    }
    const rows = await readLedger(client);
    const plan = validateLedger(repository.manifest, rows);
    if (!apply) {
      await client.query('ROLLBACK');
      process.stdout.write(`${JSON.stringify({ ok: true, targetFingerprint, applied: plan.applied, pending: plan.pending.map(entry => entry.id) }, null, 2)}\n`);
      return;
    }
    for (const entry of plan.pending) {
      if (entry.execution !== 'numbered') {
        throw new MigrationGovernanceError('BASELINE_REQUIRED', `Migration ${entry.id} requires an approved historical baseline`);
      }
      await executeMigration(client, entry, repository.readFile(entry.filename));
    }
    process.stdout.write(`${JSON.stringify({ ok: true, targetFingerprint, applied: plan.pending.map(entry => entry.id) }, null, 2)}\n`);
  } finally {
    if (lockHeld) await client.query("SELECT pg_advisory_unlock(hashtext('coachcarter:authoritative-migrations'))").catch(() => {});
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  run().catch(error => {
    const code = error instanceof MigrationGovernanceError ? error.code : 'MIGRATION_RUNNER_FAILED';
    process.stderr.write(`${JSON.stringify({ ok: false, code, error: 'Migration runner blocked' })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { directDatabaseUrl, fingerprint, loadRepository, readLedger };
