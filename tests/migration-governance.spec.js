const { test, expect } = require('@playwright/test');
const {
  MigrationGovernanceError,
  executeMigration,
  sha256,
  validateLedger,
  validateManifest,
} = require('../scripts/lib/migration-governance');
const { fingerprint, loadRepository } = require('../scripts/migration-runner');

function entry(overrides = {}) {
  const sql = overrides.sql || 'SELECT 1;\n';
  return {
    id: '061',
    order: 1,
    prefix: '061',
    filename: '061_test.sql',
    checksum: sha256(sql),
    execution: 'numbered',
    ...overrides,
  };
}

function manifest(entries, collisions = {}) {
  return {
    version: 1,
    checksumAlgorithm: 'sha256-lf-v1',
    legacyPrefixCollisions: collisions,
    migrations: entries,
  };
}

function expectCode(fn, code) {
  expect(fn).toThrow(MigrationGovernanceError);
  expect(fn).toThrow(expect.objectContaining({ code }));
}

test.describe('migration governance', () => {
  test('the checked-in manifest covers 61 historical files plus pending numbered 061', () => {
    const repository = loadRepository({ allowIndexFallback: true });
    expect(repository.result.count).toBe(62);
    expect(repository.manifest.legacyPrefixCollisions['026']).toEqual(['026a', '026b']);
    expect(repository.manifest.migrations.find(item => item.id === '026a').filename)
      .toBe('026_public_tenant_resolution.sql');
    expect(repository.manifest.migrations.find(item => item.id === '026b').filename)
      .toBe('026_weekly_availability_transmission.sql');
    expect(repository.manifest.migrations.find(item => item.id === '041').execution).toBe('deferred');
    expect(repository.manifest.migrations.find(item => item.id === '061').execution).toBe('numbered');
  });

  test('checksums are canonical across CRLF and LF worktrees', () => {
    expect(sha256('SELECT 1;\r\n')).toBe(sha256('SELECT 1;\n'));
  });

  test('target fingerprints bind host, port, database, and user without exposing credentials', () => {
    const first = fingerprint('postgresql://runner:secret@db.example:5432/coachcarter?sslmode=require');
    const second = fingerprint('postgresql://runner:different@db.example:5432/coachcarter?sslmode=require');
    const otherPort = fingerprint('postgresql://runner:secret@db.example:5433/coachcarter?sslmode=require');
    expect(first).toBe(second);
    expect(first).not.toBe(otherPort);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('secret');
  });

  test('manifest validation fails closed on duplicate identifiers', () => {
    const sql = 'SELECT 1;\n';
    const entries = [entry({ id: '061' }), entry({ id: '061', order: 2, prefix: '062', filename: '062_test.sql' })];
    expectCode(() => validateManifest(manifest(entries), entries.map(item => item.filename), () => sql), 'DUPLICATE_IDENTIFIER');
  });

  test('manifest validation fails closed on checksum drift', () => {
    const item = entry({ checksum: '0'.repeat(64) });
    expectCode(() => validateManifest(manifest([item]), [item.filename], () => 'SELECT 1;\n'), 'CHECKSUM_MISMATCH');
  });

  test('manifest validation fails closed on order changes', () => {
    const entries = [entry({ order: 2 }), entry({ id: '062', order: 1, prefix: '062', filename: '062_test.sql' })];
    expectCode(() => validateManifest(manifest(entries), entries.map(item => item.filename), () => 'SELECT 1;\n'), 'OUT_OF_ORDER_MANIFEST');
  });

  test('manifest validation rejects undeclared prefix collisions and embedded transaction control', () => {
    const first = entry({ id: '061a', filename: '061_first.sql' });
    const second = entry({ id: '061b', order: 2, filename: '061_second.sql' });
    expectCode(
      () => validateManifest(manifest([first, second]), [first.filename, second.filename], () => 'SELECT 1;\n'),
      'DUPLICATE_PREFIX'
    );
    const transactional = entry({ sql: 'BEGIN;\nSELECT 1;\nCOMMIT;\n', checksum: sha256('BEGIN;\nSELECT 1;\nCOMMIT;\n') });
    expectCode(
      () => validateManifest(manifest([transactional]), [transactional.filename], () => transactional.sql),
      'EMBEDDED_TRANSACTION_CONTROL'
    );
  });

  test('ledger planning fails closed on checksum mismatch, failed attempts, and out-of-order success', () => {
    const one = entry({ id: '061' });
    const two = entry({ id: '062', order: 2, prefix: '062', filename: '062_test.sql' });
    const currentManifest = manifest([one, two]);
    expectCode(() => validateLedger(currentManifest, [{
      migration_id: one.id, filename: one.filename, checksum: 'f'.repeat(64), status: 'succeeded', executed_at: new Date(), duration_ms: 1,
    }]), 'LEDGER_CHECKSUM_MISMATCH');
    expectCode(() => validateLedger(currentManifest, [{
      migration_id: one.id, filename: one.filename, checksum: one.checksum, status: 'failed',
    }]), 'FAILED_MIGRATION_ATTEMPT');
    expectCode(() => validateLedger(currentManifest, [{
      migration_id: two.id, filename: two.filename, checksum: two.checksum, status: 'succeeded', executed_at: new Date(), duration_ms: 1,
    }]), 'OUT_OF_ORDER_LEDGER');
  });

  test('deferred migrations do not create a false ordering gap', () => {
    const one = entry({ id: '061', execution: 'deferred' });
    const two = entry({ id: '062', order: 2, prefix: '062', filename: '062_test.sql' });
    const plan = validateLedger(manifest([one, two]), [{
      migration_id: two.id, filename: two.filename, checksum: two.checksum, status: 'succeeded', executed_at: new Date(), duration_ms: 1,
    }]);
    expect(plan.pending).toEqual([]);
  });

  test('migration execution commits SQL and its success record together', async () => {
    const calls = [];
    const client = {
      async query(sql) {
        calls.push(sql);
        if (sql.startsWith('INSERT INTO schema_migration_history')) return { rows: [{ attempt_id: 7 }] };
        if (sql.startsWith('UPDATE schema_migration_history')) return { rows: [], rowCount: 1 };
        return { rows: [] };
      },
    };
    const times = [new Date('2026-09-08T12:00:00Z'), new Date('2026-09-08T12:00:01Z')];
    const result = await executeMigration(client, entry(), 'SELECT 1;', { now: () => times.shift() });
    expect(result).toEqual({ migrationId: '061', durationMs: 1000 });
    expect(calls).toContain('BEGIN');
    expect(calls).toContain('SELECT 1;');
    expect(calls).toContain('COMMIT');
    expect(calls.some(sql => sql.includes("status = 'succeeded'"))).toBe(true);
  });

  test('migration execution rolls back, records only a safe code, and stops', async () => {
    const calls = [];
    const parameters = [];
    const client = {
      async query(sql, params = []) {
        calls.push(sql);
        parameters.push(params);
        if (sql.startsWith('INSERT INTO schema_migration_history')) return { rows: [{ attempt_id: 9 }] };
        if (sql === 'BROKEN SQL') throw Object.assign(new Error('secret raw SQL detail'), { code: '23505' });
        return { rows: [] };
      },
    };
    const times = [new Date('2026-09-08T12:00:00Z'), new Date('2026-09-08T12:00:02Z')];
    await expect(executeMigration(client, entry(), 'BROKEN SQL', { now: () => times.shift() }))
      .rejects.toMatchObject({ code: 'MIGRATION_EXECUTION_FAILED' });
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
    expect(parameters.flat()).toContain('23505');
    expect(JSON.stringify(parameters)).not.toContain('secret raw SQL detail');
  });
});
