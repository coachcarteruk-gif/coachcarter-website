// Destructive only inside one statically named disposable database on a
// separately confirmed non-production Neon branch. Production is refused.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const { Client } = require('pg');
const { validateLedger } = require('../scripts/lib/migration-governance');
const {
  EXPECTED_MARKERS,
  cleanupRehearsal,
  fingerprint,
  installOrRehearse,
  ledgerExists,
  loadPacket,
  postflight,
  preflight,
  readLedgerRows,
} = require('../scripts/lib/migration-ledger');

const ROOT = path.resolve(__dirname, '..');
const DISPOSABLE_DATABASE = 'cc_migration_ledger_phase2_rehearsal';

function loadSafeTestEnvironment() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  const allowed = new Set([
    'POSTGRES_URL',
    'POSTGRES_URL_TEST',
    'POSTGRES_URL_TEST_NON_POOLING',
    'CC_TEST_DB',
    'CC_TEST_DB_CONFIRMED_NON_PRODUCTION',
    'CC_TEST_DB_EXPECTED_HOSTNAME',
  ]);
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || !allowed.has(match[1]) || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function directTestUrl() {
  const raw = process.env.POSTGRES_URL_TEST_NON_POOLING || process.env.POSTGRES_URL_TEST;
  if (!raw) return null;
  const parsed = new URL(raw);
  parsed.hostname = parsed.hostname.replace('-pooler.', '.');
  return parsed.toString();
}

function normalizedTarget(databaseUrl) {
  if (!databaseUrl) return null;
  const parsed = new URL(databaseUrl);
  return `${parsed.hostname.toLowerCase().replace('-pooler.', '.')}|${parsed.pathname}`;
}

function disposableUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${DISPOSABLE_DATABASE}`;
  return parsed.toString();
}

loadSafeTestEnvironment();
const TEST_URL = directTestUrl();
const EXPECTED_HOST = process.env.CC_TEST_DB_EXPECTED_HOSTNAME;
const ENABLED = process.env.CC_TEST_DB === '1'
  && process.env.CC_TEST_DB_CONFIRMED_NON_PRODUCTION === '1'
  && !!TEST_URL
  && !!EXPECTED_HOST;

test.describe.configure({ mode: 'serial' });

test.describe('migration ledger Phase 2 disposable database rehearsal', () => {
  let admin;
  let client;
  let databaseCreated = false;
  const bundle = loadPacket();

  test.beforeAll(async () => {
    test.skip(!ENABLED, 'Requires an explicitly confirmed isolated Neon branch and direct test URL');
    const parsed = new URL(TEST_URL);
    if (parsed.hostname.includes('-pooler') || parsed.hostname !== EXPECTED_HOST) {
      throw new Error('REFUSING: test target is pooled or does not match the confirmed hostname');
    }
    if (normalizedTarget(TEST_URL) === normalizedTarget(process.env.POSTGRES_URL)) {
      throw new Error('REFUSING: the isolated test target matches the production target');
    }

    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    const existing = await admin.query(
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS present',
      [DISPOSABLE_DATABASE]
    );
    if (existing.rows[0].present) {
      throw new Error('REFUSING: the statically named disposable rehearsal database already exists');
    }
    await admin.query('CREATE DATABASE cc_migration_ledger_phase2_rehearsal TEMPLATE template0');
    databaseCreated = true;

    client = new Client({ connectionString: disposableUrl(TEST_URL) });
    await client.connect();
    await client.query(`
      CREATE TABLE public.migration_markers (
        key TEXT PRIMARY KEY,
        completed_at TIMESTAMPTZ NOT NULL,
        notes TEXT
      )
    `);
    for (let index = 0; index < EXPECTED_MARKERS.length; index += 1) {
      await client.query(`
        INSERT INTO public.migration_markers (key, completed_at, notes)
        VALUES ($1, TIMESTAMPTZ '2026-05-20 00:00:00+00' + ($2 * INTERVAL '1 minute'), 'test fixture only')
      `, [EXPECTED_MARKERS[index], index]);
    }
  });

  test.afterAll(async () => {
    if (client) await client.end().catch(() => {});
    if (admin && databaseCreated) {
      await admin.query('DROP DATABASE cc_migration_ledger_phase2_rehearsal WITH (FORCE)');
      const remaining = await admin.query(
        'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS present',
        [DISPOSABLE_DATABASE]
      );
      if (remaining.rows[0].present) throw new Error('Disposable rehearsal database cleanup failed');
    }
    if (admin) await admin.end().catch(() => {});
  });

  test('rehearses the complete installation and proves transaction rollback', async () => {
    const result = await installOrRehearse(client, bundle, fingerprint(disposableUrl(TEST_URL)), { rollback: true });
    expect(result).toMatchObject({ ok: true, rolledBack: true, inserted: 60 });
    expect(await ledgerExists(client)).toBe(false);
  });

  test('installs the 60 honest baseline receipts and is idempotent', async () => {
    const targetFingerprint = fingerprint(disposableUrl(TEST_URL));
    const first = await installOrRehearse(client, bundle, targetFingerprint);
    expect(first).toMatchObject({ committed: true, alreadyInstalled: false, inserted: 60 });
    const second = await installOrRehearse(client, bundle, targetFingerprint);
    expect(second).toMatchObject({ committed: true, alreadyInstalled: true, inserted: 0 });
    const preflightResult = await preflight(client, bundle, targetFingerprint);
    expect(preflightResult).toMatchObject({
      ledger: 'installed',
      baselineRows: 60,
      pendingNumbered: ['061'],
      next: 'ALREADY_INSTALLED_AND_VALID',
    });
    const result = await postflight(client, bundle, targetFingerprint);
    expect(result).toMatchObject({
      rows: 60,
      exactExecutionEvidence: ['035', '039', '060'],
      intentionallyRemoved: ['014', '021'],
      deferred: ['041'],
      pendingNumbered: ['061'],
    });
  });

  test('enforces append-only rows and only running-to-terminal transitions', async () => {
    const migration041 = bundle.manifest.migrations.find(entry => entry.id === '041');
    await client.query('BEGIN');
    try {
      const inserted = await client.query(`
        INSERT INTO public.schema_migration_history (
          migration_id, filename, checksum, status, started_at
        ) VALUES ($1, $2, $3, 'running', statement_timestamp())
        RETURNING attempt_id
      `, [migration041.id, migration041.filename, migration041.checksum]);
      const attemptId = inserted.rows[0].attempt_id;
      await expect(client.query(
        "UPDATE public.schema_migration_history SET filename = '041_changed.sql' WHERE attempt_id = $1",
        [attemptId]
      )).rejects.toMatchObject({ code: '55000' });
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      const running = await client.query(`
        INSERT INTO public.schema_migration_history (
          migration_id, filename, checksum, status, started_at
        ) VALUES ($1, $2, $3, 'running', statement_timestamp())
        RETURNING attempt_id
      `, [migration041.id, migration041.filename, migration041.checksum]);
      await client.query(`
        UPDATE public.schema_migration_history
           SET status = 'failed', executed_at = clock_timestamp(), duration_ms = 1, error_code = '23505'
         WHERE attempt_id = $1 AND status = 'running'
      `, [running.rows[0].attempt_id]);
      const failedRows = await readLedgerRows(client);
      expect(() => validateLedger(bundle.manifest, failedRows)).toThrow(expect.objectContaining({
        code: 'FAILED_MIGRATION_ATTEMPT',
      }));
      await expect(client.query(
        'DELETE FROM public.schema_migration_history WHERE attempt_id = $1',
        [running.rows[0].attempt_id]
      )).rejects.toMatchObject({ code: '55000' });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
    }

    const migration001 = bundle.manifest.migrations.find(entry => entry.id === '001');
    await client.query('BEGIN');
    try {
      const duplicate = await client.query(`
        INSERT INTO public.schema_migration_history (
          migration_id, filename, checksum, status, started_at
        ) VALUES ($1, $2, $3, 'running', statement_timestamp())
        RETURNING attempt_id
      `, [migration001.id, migration001.filename, migration001.checksum]);
      await expect(client.query(`
        UPDATE public.schema_migration_history
           SET status = 'succeeded', executed_at = clock_timestamp(), duration_ms = 0
         WHERE attempt_id = $1
      `, [duplicate.rows[0].attempt_id])).rejects.toMatchObject({ code: '23505' });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
    }

    await client.query('BEGIN');
    try {
      const invalidFailure = await client.query(`
        INSERT INTO public.schema_migration_history (
          migration_id, filename, checksum, status, started_at
        ) VALUES ($1, $2, $3, 'running', statement_timestamp())
        RETURNING attempt_id
      `, [migration041.id, migration041.filename, migration041.checksum]);
      await expect(client.query(`
        UPDATE public.schema_migration_history
           SET status = 'failed', executed_at = clock_timestamp(), duration_ms = 0, error_code = 'raw SQL detail'
         WHERE attempt_id = $1
      `, [invalidFailure.rows[0].attempt_id])).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
    }
  });

  test('rejects checksum drift, out-of-order success, and remains compatible with the Phase 1 planner', async () => {
    const rows = await readLedgerRows(client);
    expect(validateLedger(bundle.manifest, rows)).toMatchObject({
      applied: 60,
      pending: [expect.objectContaining({ id: '061', execution: 'numbered' })],
    });

    const runnerStatus = JSON.parse(execFileSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'migration-runner.js'), '--status'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          POSTGRES_URL_NON_POOLING: disposableUrl(TEST_URL),
          DATABASE_URL_UNPOOLED: '',
        },
      }
    ));
    expect(runnerStatus).toMatchObject({ ok: true, applied: 60, pending: ['061'] });

    const checksumDrift = rows.map(row => ({ ...row }));
    checksumDrift[0].checksum = 'f'.repeat(64);
    expect(() => validateLedger(bundle.manifest, checksumDrift)).toThrow(expect.objectContaining({
      code: 'LEDGER_CHECKSUM_MISMATCH',
    }));

    const first = bundle.manifest.migrations[0];
    const second = bundle.manifest.migrations[1];
    const outOfOrder = rows.filter(row => row.migration_id !== first.id && row.migration_id !== second.id);
    expect(() => validateLedger(bundle.manifest, outOfOrder)).toThrow(expect.objectContaining({
      code: 'OUT_OF_ORDER_LEDGER',
    }));
  });

  test('removes only the reviewed ledger objects on the disposable target', async () => {
    const result = await cleanupRehearsal(client);
    expect(result).toMatchObject({ committed: true });
    expect(await ledgerExists(client)).toBe(false);
    const markersRemain = await client.query('SELECT COUNT(*)::INTEGER AS count FROM public.migration_markers');
    expect(markersRemain.rows[0].count).toBe(10);
  });
});
