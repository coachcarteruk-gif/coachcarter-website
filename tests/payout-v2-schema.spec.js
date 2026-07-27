const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const migrationPath = path.resolve(
  __dirname,
  '..',
  'db',
  'migrations',
  '035_payout_v2_ledger_foundation.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');
const aggregateSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'migration.sql'),
  'utf8'
);
const preDiagnosticSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'diagnostics', 'payout-v2-ledger-foundation-pre-migration.sql'),
  'utf8'
);
const postDiagnosticSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'diagnostics', 'payout-v2-ledger-foundation-post-migration.sql'),
  'utf8'
);
const sourceDiagnosticSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'diagnostics', 'payout-v2-source-ingestion-reconciliation.sql'),
  'utf8'
);
const recoveryDiagnosticSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'diagnostics', 'payout-v2-recovery-reconciliation.sql'),
  'utf8'
);
const transferDiagnosticSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'diagnostics', 'payout-v2-transfer-reconciliation.sql'),
  'utf8'
);
const protectedBalanceDiagnosticSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'db', 'diagnostics', 'payout-v2-protected-balance.sql'),
  'utf8'
);

const V2_TABLES = [
  'payout_funding_sources',
  'payout_source_import_runs',
  'booking_earnings',
  'booking_earning_sources',
  'payout_batches',
  'payout_batch_earnings',
  'payout_transfers',
  'payout_transfer_attempts',
  'payout_transfer_sources',
  'payout_adjustments',
  'stripe_event_receipts',
  'payout_v2_connected_account_scopes',
  'connected_bank_payouts',
  'payout_v2_stripe_evidence_events',
  'payout_v2_stripe_evidence_transfer_links',
  'connected_bank_payout_transfer_links',
];

const SLICE_6_TABLES = [
  'payout_v2_liquidity_config_versions',
  'payout_v2_refund_obligation_events',
  'payout_v2_protected_balance_snapshots',
  'payout_v2_operator_evidence',
  'payout_v2_protected_balance_alert_events',
];

test.describe('Payout v2 schema contracts', () => {
  test('creates every inactive ledger table', () => {
    for (const table of [...V2_TABLES, ...SLICE_6_TABLES]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\s*\\(`));
    }
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS payout_engine_version TEXT NOT NULL DEFAULT 'v1'");
  });

  test('Slice 6 scope is explicit and tenant records cannot omit school_id', () => {
    expect(sql).toContain("CHECK ((scope_kind = 'global' AND school_id IS NULL)");
    expect(sql).toContain("OR (scope_kind = 'school' AND school_id IS NOT NULL))");
    const refundBlock = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS payout_v2_refund_obligation_events'),
      sql.indexOf('CREATE TABLE IF NOT EXISTS payout_v2_protected_balance_snapshots')
    );
    expect(refundBlock).toMatch(/school_id INTEGER NOT NULL REFERENCES schools\(id\)/);
    expect(refundBlock).not.toMatch(/school_id[^,\n]*DEFAULT/i);
  });

  test('Slice 6 evidence is append-only, idempotent, and globally guarded', () => {
    expect(sql).toContain('payout_v2_liquidity_config_versions_append_only');
    expect(sql).toContain('payout_v2_refund_obligation_events_append_only');
    expect(sql).toContain('payout_v2_protected_balance_snapshots_append_only');
    expect(sql).toContain('payout_v2_operator_evidence_append_only');
    expect(sql).toContain('payout_v2_protected_balance_alert_events_append_only');
    expect(sql).toContain('snapshot_identity TEXT NOT NULL UNIQUE');
    expect(sql).toContain('logical_identity TEXT NOT NULL UNIQUE');
    expect(sql).toContain('uq_payout_v2_operator_external_identity');
    expect(sql).toContain('event_identity TEXT NOT NULL UNIQUE');
  });

  test('risk reserve is additive configured evidence with no commercial default', () => {
    const block = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS payout_v2_liquidity_config_versions'),
      sql.indexOf('CREATE TABLE IF NOT EXISTS payout_v2_refund_obligation_events')
    );
    expect(block).toContain('risk_reserve_pence INTEGER NOT NULL');
    expect(block).not.toMatch(/risk_reserve_pence[^,\n]*DEFAULT/i);
    expect(block).toContain('config_fingerprint');
    expect(block).toContain('effective_at');
  });

  test('numbered migration is mirrored exactly in the aggregate migration', () => {
    const marker = '-- Instructor Payout v2: inactive, append-only ledger foundation.';
    expect(aggregateSql.includes(marker)).toBe(true);
    expect(aggregateSql.slice(aggregateSql.indexOf(marker)).trim()).toBe(sql.trim());
  });

  test('all new tables require explicit school scope with no school default', () => {
    for (const table of V2_TABLES) {
      const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
      const nextTable = sql.indexOf('CREATE TABLE IF NOT EXISTS ', start + 1);
      const block = sql.slice(start, nextTable === -1 ? sql.length : nextTable);
      expect(block).toMatch(/school_id\s+INTEGER NOT NULL REFERENCES schools\(id\)/);
      expect(block).not.toMatch(/school_id[^,\n]*DEFAULT/i);
    }
  });

  test('tenant equality is enforced on financial foreign keys', () => {
    expect(sql).toContain('FOREIGN KEY (booking_id, school_id)');
    expect(sql).toContain('REFERENCES lesson_bookings(id, school_id)');
    expect(sql).toContain('FOREIGN KEY (instructor_id, school_id)');
    expect(sql).toContain('REFERENCES instructors(id, school_id)');
    expect(sql).toContain('FOREIGN KEY (funding_source_id, school_id)');
    expect(sql).toContain('REFERENCES payout_funding_sources(id, school_id)');
    expect(sql).toContain('FOREIGN KEY (payout_batch_id, school_id)');
    expect(sql).toContain('REFERENCES payout_batches(id, school_id)');
  });

  test('one booking earning and one batch claim span both payout routes', () => {
    expect(sql).toContain("CHECK (payout_route IN ('instructor_direct', 'school'))");
    expect(sql).toContain('UNIQUE (school_id, booking_id)');
    expect(sql).toContain('UNIQUE (school_id, booking_earning_id)');
    expect(sql).not.toContain('UNIQUE (school_id, booking_id, payout_route)');
  });

  test('legacy and settled funding are structurally zero-payable', () => {
    expect(sql).toContain("'legacy_pre_connect_settled'");
    expect(sql).toContain("'external_cash_settled'");
    expect(sql).toContain("OR payable_pool_pence = 0");
    expect(sql).toContain('funding class % cannot contribute to instructor payout');
    expect(sql).toContain('NEW.instructor_earning_contribution_pence <> 0');
  });

  test('Stripe sources require identity and transfers have retry-safe identities', () => {
    expect(sql).toContain("funding_class <> 'stripe_backed'");
    expect(sql).toContain('stripe_payment_intent_id');
    expect(sql).toContain('stripe_charge_id');
    expect(sql).toContain("metadata->>'fee_evidence' = 'stripe_balance_transaction'");
    expect(sql).toContain('UNIQUE (school_id, stripe_event_id)');
    expect(sql).toContain('UNIQUE (stripe_event_id)');
    expect(sql).toContain('UNIQUE (idempotency_key)');
    expect(sql).toContain('UNIQUE (school_id, logical_transfer_fingerprint)');
    expect(sql).toContain('uq_payout_transfers_stripe_id');
    expect(sql).toContain('UNIQUE (school_id, evidence_fingerprint)');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON payout_transfer_attempts');
  });

  test('calculation versions and fingerprints are persisted and validated', () => {
    expect(sql.match(/calculation_version\s+TEXT NOT NULL/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("calculation_fingerprint ~ '^sha256:[0-9a-f]{64}$'");
    expect(sql).toContain("plan_fingerprint ~ '^sha256:[0-9a-f]{64}$'");
    expect(sql).toContain('plan_json                JSONB NOT NULL');
  });

  test('ledger facts reject updates/deletes and operational records reject deletes', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION payout_v2_reject_change()');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON payout_funding_sources');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON payout_source_import_runs');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON booking_earnings');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON payout_adjustments');
    expect(sql).toContain('BEFORE DELETE ON payout_transfers');
    expect(sql).toContain('BEFORE DELETE ON connected_bank_payouts');
    expect(sql).toContain('payout_v2_connected_account_scopes_append_only');
    expect(sql).toContain('payout_v2_stripe_evidence_events_append_only');
    expect(sql).toContain('connected_bank_payout_transfer_links_append_only');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION payout_v2_guard_operational_update()');
    expect(sql).toContain('payout_batches_immutable_facts');
    expect(sql).toContain('payout_transfers_immutable_facts');
  });

  test('future-payout recovery is append-only, capped, and conserved by batch', () => {
    expect(sql).toContain('recovery_deducted_pence');
    expect(sql).toContain("'recovery_application'");
    expect(sql).toContain('parent_adjustment_id');
    expect(sql).toContain('uq_payout_recovery_application_batch');
    expect(sql).toContain("metadata->>'recovery_policy' = 'full_available_offset'");
    expect(sql).toContain("(jsonb_typeof(metadata->'source_legacy_booking_ids') = 'array') IS TRUE");
    expect(sql).toContain("metadata->>'source_stripe_transfer_id' LIKE 'tr\\_%'");
    expect(sql).toContain('recovery applications exceed the original recovery obligation');
    expect(sql).toContain('recovery applications do not conserve recovery deduction');
  });

  test('deferred conservation and source-cap guards fail closed', () => {
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql).toContain('booking_earnings_totals_guard');
    expect(sql).toContain('source allocations do not conserve totals');
    expect(sql).toContain('allocations exceed payable pool');
    expect(sql).toContain('transfers exceed allocated payable value');
    expect(sql).toContain('source allocations do not equal transfer amount');
    expect(sql).toContain('payout_transfers_totals_guard');
  });

  test('pre/post diagnostics are read-only', () => {
    for (const diagnostic of [
      preDiagnosticSql,
      postDiagnosticSql,
      sourceDiagnosticSql,
      recoveryDiagnosticSql,
      transferDiagnosticSql,
      protectedBalanceDiagnosticSql,
    ]) {
      const executable = diagnostic
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
      expect(executable).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|MERGE|CALL)\b/i
      );
      expect(executable).toMatch(/\bSELECT\b/i);
    }
  });

  test('recovery diagnostic derives balances and remains school-scoped', () => {
    expect(recoveryDiagnosticSql).toContain('remaining_recovery_pence');
    expect(recoveryDiagnosticSql).toContain('batch_recovery_pence');
    expect(recoveryDiagnosticSql).toContain('child.school_id = parent.school_id');
    expect(recoveryDiagnosticSql).toContain('pa.school_id = pb.school_id');
    expect(recoveryDiagnosticSql).not.toMatch(/school_id\s*=\s*1\b/i);
  });
});
