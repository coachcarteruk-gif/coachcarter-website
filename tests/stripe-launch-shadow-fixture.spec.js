const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const {
  ACCOUNTING_VERSION,
  SHADOW_MODE,
  CONFIRMATION,
  AUDIT_ACTION,
  StripeLaunchShadowFixtureError,
  validateStripeLaunchShadowFixtureRequest,
  authorizeStripeLaunchShadowFixture,
  createStripeLaunchShadowFixture,
} = require('../api/_stripe-launch-shadow-fixture');

const repoRoot = path.resolve(__dirname, '..');
const fixedNow = '2026-08-04T12:34:56.000Z';
const admin = Object.freeze({ id: 11, email: 'shadow-admin@example.invalid' });

function validBody(overrides = {}) {
  return {
    operator_go: CONFIRMATION,
    command_id: 'shadow-05-step-12-config-v1',
    instructor_id: 21,
    split_bps: 9000,
    weekly_franchise_fee_minor: 9000,
    currency: 'gbp',
    document_version: 'simon-shadow-agreement-v1',
    ...overrides,
  };
}

function validInput(overrides = {}) {
  return validateStripeLaunchShadowFixtureRequest(validBody(overrides));
}

function baseState() {
  return {
    schools: [{ id: 1, active: true }],
    admins: [{ id: admin.id, school_id: 1, email: admin.email, active: true }],
    instructors: [{ id: 21, school_id: 1, active: true }],
    configs: [],
    agreements: [],
    audits: [],
  };
}

function result(rows = [], rowCount = rows.length) {
  return { rows, rowCount };
}

function createTransactionalHarness(initial = baseState(), { failAt = null } = {}) {
  const holder = { state: structuredClone(initial) };

  function clientFor(state) {
    return {
      async query(text, values = []) {
        const statement = text.replace(/\s+/g, ' ').trim();

        if (statement.startsWith('SELECT pg_advisory_xact_lock')) return result([{}], 1);
        if (/FROM schools/i.test(statement)) {
          return result(state.schools.filter((row) => row.id === Number(values[0])));
        }
        if (/FROM admin_users/i.test(statement)) {
          return result(state.admins.filter((row) => (
            row.id === Number(values[0]) && row.school_id === Number(values[1])
          )));
        }
        if (/FROM instructors/i.test(statement)) {
          return result(state.instructors.filter((row) => (
            row.id === Number(values[0]) && row.school_id === Number(values[1])
          )));
        }
        if (statement.startsWith('SELECT') && /FROM stripe_connect_launch_configs/i.test(statement)) {
          return result(structuredClone(state.configs));
        }
        if (statement.startsWith('SELECT') && /FROM instructor_payout_agreement_versions/i.test(statement)) {
          return result(structuredClone(state.agreements.filter((row) => row.school_id === Number(values[0]))));
        }
        if (statement.startsWith('SELECT') && /FROM audit_log/i.test(statement)) {
          return result(structuredClone(state.audits.filter((row) => (
            row.school_id === Number(values[0])
            && row.action === values[1]
            && row.details.command_id === values[2]
          ))));
        }
        if (statement.startsWith('INSERT INTO stripe_connect_launch_configs')) {
          if (failAt === 'config') throw new Error('config insert unavailable');
          const row = {
            id: values[0],
            school_id: Number(values[1]),
            cutover_at: values[2],
            accounting_version: values[3],
            mode: values[4],
            created_by_admin_id: Number(values[5]),
            created_at: values[2],
            activated_at: null,
            paused_at: null,
            pause_reason: null,
          };
          state.configs.push(row);
          return result([structuredClone(row)], 1);
        }
        if (statement.startsWith('INSERT INTO instructor_payout_agreement_versions')) {
          if (failAt === 'agreement') throw new Error('agreement insert unavailable');
          const row = {
            id: values[0],
            school_id: Number(values[1]),
            instructor_id: Number(values[2]),
            version_number: 1,
            starts_at: values[3],
            ends_at: null,
            status: 'active',
            split_bps: Number(values[4]),
            weekly_franchise_fee_minor: Number(values[5]),
            currency: values[6],
            accepted_at: values[3],
            acceptance_evidence_reference: values[7],
            document_version: values[8],
            connect_scope_id: null,
            stripe_configuration_id: null,
            created_by_admin_id: Number(values[9]),
            approved_by_admin_id: Number(values[9]),
            created_at: values[3],
            approved_at: values[3],
            agreement_fingerprint: values[10],
          };
          state.agreements.push(row);
          return result([structuredClone(row)], 1);
        }
        if (statement.startsWith('INSERT INTO audit_log')) {
          if (failAt === 'audit') throw new Error('audit unavailable');
          const row = {
            id: state.audits.length + 1,
            admin_id: Number(values[0]),
            admin_email: values[1],
            action: values[2],
            target_type: values[3],
            target_id: Number(values[4]),
            details: JSON.parse(values[5]),
            ip_address: values[6],
            school_id: Number(values[7]),
          };
          state.audits.push(row);
          return result([], 1);
        }

        throw new Error(`Unhandled fixture test query: ${statement}`);
      },
    };
  }

  const runInTransaction = async (work) => {
    const working = structuredClone(holder.state);
    const value = await work(clientFor(working));
    holder.state = working;
    return value;
  };

  return { holder, runInTransaction };
}

function uuidSequence() {
  const values = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
  ];
  return () => values.shift();
}

async function createFixture(harness, overrides = {}) {
  return createStripeLaunchShadowFixture({
    schoolId: 1,
    admin,
    req: { headers: { 'x-forwarded-for': '192.0.2.10' } },
    input: validInput(overrides),
    runInTransaction: harness.runInTransaction,
    now: () => new Date(fixedNow),
    randomUUID: uuidSequence(),
  });
}

test.describe('Stripe launch shadow fixture request contract', () => {
  test('normalises an explicit, bounded agreement request', () => {
    expect(validateStripeLaunchShadowFixtureRequest(validBody({ currency: 'GBP' }))).toEqual({
      commandId: 'shadow-05-step-12-config-v1',
      instructorId: 21,
      splitBps: 9000,
      weeklyFranchiseFeeMinor: 9000,
      currency: 'gbp',
      documentVersion: 'simon-shadow-agreement-v1',
    });
  });

  for (const [name, patch] of [
    ['missing confirmation', { operator_go: undefined }],
    ['bad command', { command_id: '../unsafe' }],
    ['invalid instructor', { instructor_id: 0 }],
    ['invalid split', { split_bps: 10001 }],
    ['negative fee', { weekly_franchise_fee_minor: -1 }],
    ['missing fee', { weekly_franchise_fee_minor: undefined }],
    ['string fee', { weekly_franchise_fee_minor: '9000' }],
    ['invalid currency', { currency: 'gb' }],
    ['missing document version', { document_version: '' }],
  ]) {
    test(`rejects ${name}`, () => {
      expect(() => validateStripeLaunchShadowFixtureRequest(validBody(patch)))
        .toThrow(StripeLaunchShadowFixtureError);
    });
  }

  test('authorises only the exact enabled test project and auth-derived school', () => {
    const env = {
      STRIPE_LAUNCH_SHADOW_OPERATIONS_ENABLED: 'true',
      STRIPE_LAUNCH_SHADOW_PROJECT_ID: 'prj_shadow_05',
      STRIPE_LAUNCH_SHADOW_SCHOOL_ID: '1',
      STRIPE_LAUNCH_SHADOW_VERCEL_ENV: 'production',
      STRIPE_MODE: 'test',
      VERCEL_ENV: 'production',
      VERCEL_PROJECT_ID: 'prj_shadow_05',
    };
    expect(authorizeStripeLaunchShadowFixture({ schoolId: 1, env })).toEqual({
      schoolId: 1,
      projectId: 'prj_shadow_05',
      vercelEnv: 'production',
    });

    for (const patch of [
      { STRIPE_LAUNCH_SHADOW_OPERATIONS_ENABLED: 'false' },
      { STRIPE_MODE: 'live' },
      { VERCEL_PROJECT_ID: 'prj_other' },
      { VERCEL_ENV: 'preview' },
      { STRIPE_LAUNCH_SHADOW_SCHOOL_ID: '2' },
    ]) {
      expect(authorizeStripeLaunchShadowFixture({ schoolId: 1, env: { ...env, ...patch } })).toBeNull();
    }
    expect(authorizeStripeLaunchShadowFixture({ schoolId: 2, env })).toBeNull();
  });
});

test.describe('Stripe launch shadow fixture transaction', () => {
  test('creates exactly one config, one agreement and one required audit', async () => {
    const harness = createTransactionalHarness();
    const created = await createFixture(harness);

    expect(created).toMatchObject({
      ok: true,
      idempotent_replay: false,
      school_id: 1,
      instructor_id: 21,
      accounting_version: ACCOUNTING_VERSION,
      mode: SHADOW_MODE,
    });
    expect(harness.holder.state.configs).toHaveLength(1);
    expect(harness.holder.state.configs[0]).toMatchObject({
      school_id: 1,
      accounting_version: 'simon_launch_v1',
      mode: 'shadow',
      created_by_admin_id: admin.id,
    });
    expect(harness.holder.state.agreements).toHaveLength(1);
    expect(harness.holder.state.agreements[0]).toMatchObject({
      school_id: 1,
      instructor_id: 21,
      status: 'active',
      split_bps: 9000,
      weekly_franchise_fee_minor: 9000,
      currency: 'gbp',
      ends_at: null,
      created_by_admin_id: admin.id,
      approved_by_admin_id: admin.id,
    });
    expect(harness.holder.state.audits).toHaveLength(1);
    expect(harness.holder.state.audits[0]).toMatchObject({
      admin_id: admin.id,
      action: AUDIT_ACTION,
      target_type: 'stripe_launch_shadow_fixture',
      target_id: 21,
      school_id: 1,
    });
    expect(harness.holder.state.audits[0].details).toMatchObject({
      command_id: 'shadow-05-step-12-config-v1',
      launch_config_id: created.launch_config_id,
      agreement_version_id: created.agreement_version_id,
    });
  });

  test('replays the exact command without duplicate rows', async () => {
    const harness = createTransactionalHarness();
    const first = await createFixture(harness);
    const replay = await createFixture(harness);

    expect(replay).toEqual({ ...first, idempotent_replay: true });
    expect(harness.holder.state.configs).toHaveLength(1);
    expect(harness.holder.state.agreements).toHaveLength(1);
    expect(harness.holder.state.audits).toHaveLength(1);
  });

  test('rejects changed input under an existing command identity', async () => {
    const harness = createTransactionalHarness();
    await createFixture(harness);
    await expect(createFixture(harness, { split_bps: 8500 })).rejects.toMatchObject({
      code: 'SHADOW_FIXTURE_IDEMPOTENCY_CONFLICT',
      status: 409,
    });
  });

  test('rejects replay when stored payment-time agreement evidence changed', async () => {
    const harness = createTransactionalHarness();
    await createFixture(harness);
    harness.holder.state.agreements[0].starts_at = '2026-08-04T12:35:56.000Z';

    await expect(createFixture(harness)).rejects.toMatchObject({
      code: 'SHADOW_FIXTURE_IDEMPOTENCY_CONFLICT',
      status: 409,
    });
  });

  test('rejects any partial or pre-existing launch state', async () => {
    const configState = baseState();
    configState.configs.push({
      id: 'existing-config', school_id: 1, accounting_version: 'simon_launch_v1', mode: 'shadow',
      created_by_admin_id: admin.id,
    });
    await expect(createFixture(createTransactionalHarness(configState))).rejects.toMatchObject({
      code: 'SHADOW_FIXTURE_STATE_NOT_EMPTY',
    });

    const agreementState = baseState();
    agreementState.agreements.push({ id: 'existing-agreement', school_id: 1, instructor_id: 21 });
    await expect(createFixture(createTransactionalHarness(agreementState))).rejects.toMatchObject({
      code: 'SHADOW_FIXTURE_STATE_NOT_EMPTY',
    });

    const otherSchoolState = baseState();
    otherSchoolState.configs.push({ id: 'other-config', school_id: 2 });
    await expect(createFixture(createTransactionalHarness(otherSchoolState))).rejects.toMatchObject({
      code: 'SHADOW_FIXTURE_STATE_NOT_EMPTY',
    });
  });

  test('rejects an instructor outside the authenticated school', async () => {
    const state = baseState();
    state.instructors[0].school_id = 2;
    await expect(createFixture(createTransactionalHarness(state))).rejects.toMatchObject({
      code: 'SHADOW_INSTRUCTOR_NOT_FOUND',
      status: 404,
    });
  });

  test('rolls back both rows when the required audit write fails', async () => {
    const harness = createTransactionalHarness(baseState(), { failAt: 'audit' });
    await expect(createFixture(harness)).rejects.toThrow('audit unavailable');
    expect(harness.holder.state.configs).toHaveLength(0);
    expect(harness.holder.state.agreements).toHaveLength(0);
    expect(harness.holder.state.audits).toHaveLength(0);
  });

  for (const failure of ['config', 'agreement']) {
    test(`rolls back the complete transaction when the ${failure} insert fails`, async () => {
      const harness = createTransactionalHarness(baseState(), { failAt: failure });
      await expect(createFixture(harness)).rejects.toThrow(`${failure} insert unavailable`);
      expect(harness.holder.state.configs).toHaveLength(0);
      expect(harness.holder.state.agreements).toHaveLength(0);
      expect(harness.holder.state.audits).toHaveLength(0);
    });
  }
});

test('admin route is authenticated, auth-school scoped, shadow gated and sanitized', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'api', 'admin.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'api', '_stripe-launch-shadow-fixture.js'), 'utf8');

  expect(source).toContain("action === 'configure-stripe-launch-shadow-fixture'");
  expect(source).toContain('const admin = verifyAdminJWT(req);');
  expect(source).toContain('const schoolId = admin.school_id;');
  expect(source).toContain('authorizeStripeLaunchShadowFixture({ schoolId })');
  expect(source).toContain('connectionString: process.env.POSTGRES_URL');
  expect(source).not.toContain('req.body.school_id');
  expect(moduleSource).toContain('logAuditRequired(clientSqlTag(client)');
  expect(moduleSource).toContain('SELECT pg_advisory_xact_lock');
  expect(moduleSource).not.toMatch(/require\(['"]stripe['"]\)|stripe\./i);
  expect(source).not.toContain("reportError('/api/admin?action=configure-stripe-launch-shadow-fixture', err)");
});
