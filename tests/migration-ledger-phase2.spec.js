const { test, expect } = require('@playwright/test');
const { MigrationGovernanceError } = require('../scripts/lib/migration-governance');
const { validateLedger } = require('../scripts/lib/migration-governance');
const {
  assertNonSecretContext,
  directDatabaseUrl,
  fingerprint,
  loadPacket,
  requireMutationApproval,
} = require('../scripts/lib/migration-ledger');
const { selectedMode } = require('../scripts/migration-ledger-rehearsal');

function expectCode(fn, code) {
  expect(fn).toThrow(MigrationGovernanceError);
  expect(fn).toThrow(expect.objectContaining({ code }));
}

test.describe('migration ledger Phase 2 packet and gates', () => {
  test('covers all 61 entries while preserving exact, removed, and deferred evidence classes', () => {
    const bundle = loadPacket();
    expect(bundle.packet.entries).toHaveLength(61);
    expect(bundle.packet.legacyMarkerEvidence).toHaveLength(10);
    expect(bundle.packet.entries.filter(entry => entry.evidenceClass === 'exact_execution').map(entry => entry.id))
      .toEqual(['035', '039', '060']);
    expect(bundle.packet.entries.filter(entry => entry.evidenceClass === 'intentionally_removed').map(entry => entry.id))
      .toEqual(['014', '021']);
    expect(bundle.packet.entries.find(entry => entry.id === '041')).toMatchObject({
      disposition: 'deferred',
      evidenceClass: 'deferred',
    });
    expect(bundle.packet.entries.find(entry => entry.id === '026a').filename)
      .toBe('026_public_tenant_resolution.sql');
    expect(bundle.packet.entries.find(entry => entry.id === '026b').filename)
      .toBe('026_weekly_availability_transmission.sql');
    expect(bundle.packet.entries.find(entry => entry.id === '060').evidence.historicalExecutionTimestamp)
      .toBeNull();
  });

  test('defaults to read-only preflight and refuses pooled URLs', () => {
    expect(selectedMode([])).toBe('preflight');
    expect(selectedMode(['--dry-run'])).toBe('preflight');
    expectCode(() => selectedMode(['--install']), 'UNKNOWN_ARGUMENT');
    expectCode(
      () => directDatabaseUrl({ MIGRATION_LEDGER_DIRECT_URL: 'postgresql://owner:pw@ep-example-pooler.test/db' }),
      'POOLED_URL_REFUSED'
    );
  });

  test('fingerprints bind the target but never the password', () => {
    const first = fingerprint('postgresql://owner:first@ep-example.test:5432/db');
    const second = fingerprint('postgresql://owner:second@ep-example.test:5432/db');
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('first');
  });

  test('requires an exact target-bound approval for every mutation mode', () => {
    const target = 'a'.repeat(64);
    expectCode(() => requireMutationApproval('install', target, {}), 'MUTATION_NOT_APPROVED');
    expectCode(() => requireMutationApproval('install', target, {
      MIGRATION_LEDGER_MUTATION_APPROVAL: 'INSTALL_BASELINE',
      MIGRATION_LEDGER_TARGET_FINGERPRINT: 'b'.repeat(64),
      MIGRATION_LEDGER_TARGET_CLASS: 'isolated_rehearsal',
    }), 'TARGET_NOT_APPROVED');
    expect(() => requireMutationApproval('install', target, {
      MIGRATION_LEDGER_MUTATION_APPROVAL: 'INSTALL_BASELINE',
      MIGRATION_LEDGER_TARGET_FINGERPRINT: target,
      MIGRATION_LEDGER_TARGET_CLASS: 'isolated_rehearsal',
    })).not.toThrow();
  });

  test('production additionally requires separate approval and a Neon snapshot', () => {
    const target = 'a'.repeat(64);
    const base = {
      MIGRATION_LEDGER_MUTATION_APPROVAL: 'INSTALL_BASELINE',
      MIGRATION_LEDGER_TARGET_FINGERPRINT: target,
      MIGRATION_LEDGER_TARGET_CLASS: 'production',
    };
    expectCode(() => requireMutationApproval('install', target, base), 'PRODUCTION_APPROVAL_REQUIRED');
    expectCode(() => requireMutationApproval('install', target, {
      ...base,
      MIGRATION_LEDGER_PRODUCTION_APPROVAL: 'SEPARATELY_APPROVED_PRODUCTION_BASELINE',
    }), 'PRODUCTION_SNAPSHOT_REQUIRED');
    expect(() => requireMutationApproval('install', target, {
      ...base,
      MIGRATION_LEDGER_PRODUCTION_APPROVAL: 'SEPARATELY_APPROVED_PRODUCTION_BASELINE',
      MIGRATION_LEDGER_NEON_SNAPSHOT: 'snap-reviewed-example',
    })).not.toThrow();
  });

  test('refuses secret-bearing execution context', () => {
    expectCode(() => assertNonSecretContext({ databaseUrl: 'redacted' }), 'SECRET_CONTEXT_KEY_REFUSED');
    expectCode(() => assertNonSecretContext({ value: 'postgresql://owner:pw@example/db' }), 'SECRET_CONTEXT_VALUE_REFUSED');
    expect(() => assertNonSecretContext({ commit: 'abc123', targetFingerprint: 'f'.repeat(64) })).not.toThrow();
  });

  test('the Phase 1 planner rejects unknown and duplicate successful ledger rows', () => {
    const bundle = loadPacket();
    const first = bundle.manifest.migrations[0];
    const success = {
      migration_id: first.id,
      filename: first.filename,
      checksum: first.checksum,
      status: 'succeeded',
      executed_at: new Date(),
      duration_ms: 0,
    };
    expectCode(() => validateLedger(bundle.manifest, [{
      ...success,
      migration_id: '999',
    }]), 'UNKNOWN_LEDGER_MIGRATION');
    expectCode(() => validateLedger(bundle.manifest, [success, { ...success }]), 'DUPLICATE_LEDGER_SUCCESS');
  });
});
