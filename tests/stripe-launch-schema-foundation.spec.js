const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(
  root,
  'db',
  'migrations',
  '039_stripe_launch_schema_foundation.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');
const aggregateSql = fs.readFileSync(path.join(root, 'db', 'migration.sql'), 'utf8');
const preDiagnosticSql = fs.readFileSync(
  path.join(root, 'db', 'diagnostics', 'stripe-launch-schema-foundation-pre-migration.sql'),
  'utf8'
);
const postDiagnosticSql = fs.readFileSync(
  path.join(root, 'db', 'diagnostics', 'stripe-launch-schema-foundation-post-migration.sql'),
  'utf8'
);
const manifest = JSON.parse(fs.readFileSync(
  path.join(root, 'db', 'rollouts', '039-stripe-launch-schema-foundation.manifest.json'),
  'utf8'
));
const rehearsal = JSON.parse(fs.readFileSync(
  path.join(root, 'db', 'rollouts', '039-stripe-launch-schema-foundation.rehearsal.json'),
  'utf8'
));
const preflightEvidence = JSON.parse(fs.readFileSync(
  path.join(root, 'db', 'rollouts', '039-stripe-launch-schema-foundation.preflight.json'),
  'utf8'
));
const recoveryEvidence = JSON.parse(fs.readFileSync(
  path.join(root, 'db', 'rollouts', '039-stripe-launch-schema-foundation.recovery.json'),
  'utf8'
));
const applyEvidence = JSON.parse(fs.readFileSync(
  path.join(root, 'db', 'rollouts', '039-stripe-launch-schema-foundation.apply.json'),
  'utf8'
));
const postflightEvidence = JSON.parse(fs.readFileSync(
  path.join(root, 'db', 'rollouts', '039-stripe-launch-schema-foundation.postflight.json'),
  'utf8'
));
const { inspect, isReadOnlyDiagnostic } = require(
  '../scripts/stripe-launch-schema-foundation-review'
);

const STATUS = 'SCHEMA_APPLIED_INACTIVE';
const TABLES = [
  'stripe_connect_launch_configs',
  'stripe_connect_launch_events',
  'instructor_payout_agreement_versions',
  'lesson_payment_contracts',
  'lesson_outcome_revisions',
  'lesson_issue_tokens',
  'lesson_issue_reports',
  'lesson_issue_actions',
  'refund_intents',
  'refund_attempts',
  'connect_account_state_events',
  'payout_runs',
  'instructor_payout_batches',
  'instructor_payout_obligations',
  'instructor_payout_obligation_applications',
  'stripe_launch_booking_earnings',
  'stripe_launch_transfer_intents',
  'stripe_launch_transfer_attempts',
  'payout_batch_earning_dispositions',
  'payout_statements',
  'payout_statement_delivery_attempts',
  'payment_disputes',
  'payment_dispute_events',
  'dispute_evidence_pack_versions',
  'dispute_notification_attempts',
  'financial_job_occurrences',
];

function tableBlock(tableName) {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${tableName}`);
  const next = sql.indexOf('CREATE TABLE IF NOT EXISTS ', start + 1);
  return sql.slice(start, next === -1 ? sql.length : next);
}

function executableSql(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

function walkFiles(startPath) {
  if (!fs.existsSync(startPath)) return [];
  const output = [];
  for (const entry of fs.readdirSync(startPath, { withFileTypes: true })) {
    const absolute = path.join(startPath, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(absolute));
    else output.push(absolute);
  }
  return output;
}

test.describe('Stripe launch Slice 1 inert schema foundation', () => {
  test('Slice 0 prerequisites remain exact', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    expect(packageJson.dependencies.stripe).toBe('22.4.0');
    expect(packageLock.packages['node_modules/stripe'].version).toBe('22.4.0');
    expect(fs.existsSync(path.join(root, 'api', '_stripe-clients.js'))).toBe(true);
  });

  test('creates the complete 26-table Section 4 foundation', () => {
    expect((sql.match(/^CREATE TABLE IF NOT EXISTS\s+/gim) || [])).toHaveLength(26);
    for (const table of TABLES) {
      expect(sql, table).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\s*\\(`)
      );
    }
  });

  test('every launch table has explicit school scope and no school default', () => {
    for (const table of TABLES) {
      const block = tableBlock(table);
      expect(block, table).toMatch(/school_id\s+INTEGER(?:\s+NOT NULL)?\s+REFERENCES schools\(id\)/);
      expect(block, table).not.toMatch(/school_id[^,\n]*DEFAULT/i);
    }
    expect(tableBlock('financial_job_occurrences')).toContain(
      "CHECK ((scope_kind = 'global' AND school_id IS NULL)"
    );
    expect(tableBlock('financial_job_occurrences')).toContain(
      "OR (scope_kind = 'school' AND school_id IS NOT NULL))"
    );
  });

  test('tenant-owned relationships are composite and cross-school safe', () => {
    const required = [
      'FOREIGN KEY (instructor_id, school_id)',
      'REFERENCES instructors(id, school_id)',
      'FOREIGN KEY (learner_id, school_id)',
      'REFERENCES learner_users(id, school_id)',
      'FOREIGN KEY (booking_id, school_id)',
      'REFERENCES lesson_bookings(id, school_id)',
      'FOREIGN KEY (lesson_payment_contract_id, school_id)',
      'REFERENCES lesson_payment_contracts(id, school_id)',
      'FOREIGN KEY (payout_run_id, school_id)',
      'REFERENCES payout_runs(id, school_id)',
      'FOREIGN KEY (payout_batch_id, school_id)',
      'REFERENCES instructor_payout_batches(id, school_id)',
      'FOREIGN KEY (funding_source_id, school_id)',
      'REFERENCES payout_funding_sources(id, school_id)',
    ];
    for (const fragment of required) expect(sql).toContain(fragment);
    expect(sql).toContain('uq_admin_users_id_school_launch');
    expect(sql).toContain('FOREIGN KEY (actor_admin_id, school_id)');
    expect(sql).toContain('FOREIGN KEY (created_by_admin_id, school_id)');
    expect(sql).toContain('REFERENCES admin_users(id, school_id)');
    expect(sql).not.toMatch(/REFERENCES admin_users\(id\)(?!,)/);
  });

  test('existing records receive nullable bridges only and no hidden defaults', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS lesson_payment_contract_id UUID');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS slot_released_at TIMESTAMPTZ');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS slot_release_reason TEXT');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS stripe_payment_created_at TIMESTAMPTZ');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS stripe_funds_available_at TIMESTAMPTZ');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS payment_origin TEXT');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS source_booking_id INTEGER');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS evidence_completeness TEXT');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS contradiction_code TEXT');
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS\s+(?:lesson_payment_contract_id|slot_released_at|slot_release_reason|stripe_payment_created_at|stripe_funds_available_at|payment_origin|source_booking_id|evidence_completeness|contradiction_code)[^;]*DEFAULT/i);
    expect(sql).not.toMatch(/(?:school_id|instructor_id|currency|mode)[^,\n]*DEFAULT/i);
  });

  test('agreements, contracts, evidence, batches and statements are immutable', () => {
    expect(sql).toContain('stripe_launch_guard_agreement_write');
    expect(sql).toContain('stripe_launch_guard_contract_update');
    expect(sql).toContain('stripe_launch_guard_payout_source_update');
    expect(sql).toContain('stripe_launch_reject_change');
    expect(sql).toContain("'payout_statements', 'payout_statement_delivery_attempts'");
    expect(sql).toContain("'stripe_connect_launch_events', 'lesson_outcome_revisions'");
    expect(sql).toContain('instructor_payout_batches_immutable_facts');
    expect(sql).toContain("'stripe_launch_booking_earnings'");
    expect(sql).toContain("'payment_dispute_events', 'dispute_evidence_pack_versions'");
    expect(sql).toContain('financial_job_occurrences_immutable_facts');
  });

  test('identities and idempotency claims are unique and versioned', () => {
    expect(sql).toContain('uq_lesson_payment_contracts_pi_global');
    expect(sql).toContain('uq_lesson_payment_contracts_charge_global');
    expect(sql).toContain('uq_refund_intents_stripe_refund');
    expect(sql).toContain('uq_connect_state_events_stripe_event');
    expect(sql).toContain('uq_stripe_launch_transfer_id');
    expect(sql).toContain('UNIQUE (stripe_idempotency_key)');
    expect(sql).toContain('UNIQUE (school_id, stable_identity)');
    expect(sql).toContain("fingerprint ~ '^sha256:[0-9a-f]{64}$'");
    expect(sql).toContain('accounting_version');
    expect(sql).toContain('planner_version');
    expect(sql).toContain('document_version');
    expect(sql).toContain('template_version');
  });

  test('integer-pence conservation and over-application are database guarded', () => {
    expect(sql).toContain('stripe_launch_validate_earning_dispositions');
    expect(sql).toContain('earning dispositions do not conserve instructor share');
    expect(sql).toContain('stripe_launch_validate_transfer_total');
    expect(sql).toContain('transfer allocations do not equal immutable transfer amount');
    expect(sql).toContain('stripe_launch_validate_batch_totals');
    expect(sql).toContain('instructor payout batch child rows do not conserve locked totals');
    expect(sql).toContain('stripe_launch_validate_run_totals');
    expect(sql).toContain('payout run batches do not conserve locked totals');
    expect(sql).toContain('obligation applications exceed immutable principal');
    expect(sql).toContain('obligation reversal is not bounded to a prior application');
    expect(sql).toContain('refund intents exceed immutable contract gross amount');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
  });

  test('closed vocabularies and guarded state/mode transitions fail closed', () => {
    expect(sql).toContain("CHECK (mode IN ('disabled', 'shadow', 'approval_pending', 'live', 'paused'))");
    expect(sql).toContain('stripe_launch_guard_config_update');
    expect(sql).toContain('invalid launch mode transition');
    expect(sql).toContain('stripe_launch_guard_state_transition');
    expect(sql).toContain('invalid % state transition % -> %');
    expect(postDiagnosticSql).toContain("payout_engine_version <> 'v1'");
    expect(sql).toContain("NOT first_live");
    expect(sql).toContain('approval_evidence_reference');
  });

  test('migration is DDL-only, inert, and contains no Stripe client/API use', () => {
    const executable = executableSql(sql);
    expect(executable).not.toMatch(
      /^\s*(?:INSERT\s+INTO|UPDATE\s+[a-z_]|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|COPY\s+)/gim
    );
    expect(executable).not.toMatch(/\brequire\s*\(\s*['"]stripe['"]/i);
    expect(executable).not.toMatch(
      /\bstripe\.(?:accounts|transfers|payouts|refunds|paymentIntents|charges)\./i
    );
    expect(executable).not.toMatch(/\bUPDATE\s+schools\b/i);
    expect(executable).not.toMatch(/\bINSERT\s+INTO\s+stripe_connect_launch_configs\b/i);
  });

  test('numbered migration remains an exact canonical aggregate segment', () => {
    const marker = '-- Stripe Connect Simon launch: inert Slice 1 schema foundation.';
    const normalizedAggregate = aggregateSql.replace(/\r\n/g, '\n');
    const normalizedMigration = sql.replace(/\r\n/g, '\n').trim();
    const start = normalizedAggregate.lastIndexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(normalizedAggregate.slice(start, start + normalizedMigration.length))
      .toBe(normalizedMigration);
  });

  test('preflight and postflight diagnostics are read-only and fail closed', () => {
    for (const diagnostic of [preDiagnosticSql, postDiagnosticSql]) {
      expect(isReadOnlyDiagnostic(diagnostic)).toBe(true);
      expect(executableSql(diagnostic)).not.toMatch(
        /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|MERGE|CALL|COPY|DO)\b/i
      );
    }
    expect(preDiagnosticSql).toContain('historic_fingerprint');
    expect(preDiagnosticSql).toContain('slice_1_relation_collision');
    expect(postDiagnosticSql).toContain('slice_1_zero_launch_rows');
    expect(postDiagnosticSql).toContain('slice_1_function_inventory');
    expect(postDiagnosticSql).toContain('slice_1_trigger_inventory');
    expect(postDiagnosticSql).toContain('slice_1_nullable_bridge_columns');
  });

  test('rollout artifacts record schema apply without operational authority', () => {
    expect(manifest.status).toBe(STATUS);
    expect(rehearsal.status).toBe('PASSED_AND_ROLLED_BACK');
    expect(manifest.reviewPacketApproved).toBe(true);
    expect(manifest.productionPreflightApproved).toBe(true);
    expect(manifest.schemaApplyApproved).toBe(true);
    expect(manifest.deployed).toBe(true);
    expect(rehearsal.databaseRehearsalExecuted).toBe(true);
    expect(rehearsal.rolledBack).toBe(true);
    expect(rehearsal.committedToDatabase).toBe(false);
    expect(rehearsal.authorityGranted).toBe(false);
    expect(preflightEvidence.status).toBe('PASSED');
    expect(preflightEvidence.applied).toBe(true);
    expect(recoveryEvidence.historyRetentionHours).toBe(6);
    expect(applyEvidence.committed).toBe(true);
    expect(applyEvidence.payoutEngineActivated).toBe(false);
    expect(applyEvidence.stripeApiCalls).toBe(0);
    expect(postflightEvidence.status).toBe(STATUS);
    expect(postflightEvidence.postflight.launchRows).toBe(0);
    expect(postflightEvidence.postflight.historicFingerprintsUnchanged).toBe(true);
    expect(manifest.operationalAuthorityNotGranted).toHaveLength(6);
    const review = inspect();
    expect(review.failures).toEqual([]);
    expect(review.reviewStatus).toBe(STATUS);
  });

  test('only the explicitly reviewed Slice 2 modules and shadow fixture writer import the Slice 1 schema', () => {
    const applicationFiles = [
      ...walkFiles(path.join(root, 'api')),
      ...walkFiles(path.join(root, 'js')),
      ...walkFiles(path.join(root, 'public')),
    ].filter((file) => /\.(?:js|cjs|mjs|html)$/i.test(file));
    const launchNamePattern = new RegExp(`\\b(?:${TABLES.join('|')})\\b`, 'i');
    const violations = applicationFiles
      .filter((file) => launchNamePattern.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file));
    expect(violations.sort()).toEqual([
      path.join('api', '_stripe-launch-payment-contracts.js'),
      path.join('api', '_stripe-launch-payment-reconciler.js'),
      path.join('api', '_stripe-launch-shadow-fixture.js'),
    ].sort());
  });
});
