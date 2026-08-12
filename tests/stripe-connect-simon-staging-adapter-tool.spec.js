const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const controller = require('../scripts/stripe-connect-simon-staging-controller');
const tool = require('../scripts/stripe-connect-simon-staging-adapter-tool');

const repositoryRoot = path.resolve(__dirname, '..');

function config(overrides = {}) {
  const base = path.join(os.tmpdir(), 'cc-simon-a8-1-contract');
  return {
    worktree: path.join(base, 'future-worktree'),
    dependencyRepository: repositoryRoot,
    npxCli: path.join(base, 'npx-cli.js'),
    vercelCli: tool.FIXED_IDENTITY.vercelCli,
    scope: tool.FIXED_IDENTITY.scope,
    teamId: tool.FIXED_IDENTITY.teamId,
    projectId: tool.FIXED_IDENTITY.projectId,
    customEnvironmentId: tool.FIXED_IDENTITY.customEnvironmentId,
    customEnvironmentSlug: tool.FIXED_IDENTITY.customEnvironmentSlug,
    expectedAlias: tool.FIXED_IDENTITY.expectedAlias,
    expectedCommit: 'a'.repeat(40),
    expectedBranch: 'codex/simon-staging-reconciliation-mvp-a8-future',
    bridgePrefix: path.join(base, 'bridge', 'cc-simon-a8'),
    ...overrides,
  };
}

function expectedDeployment(adapterConfig = config()) {
  return {
    projectId: adapterConfig.projectId,
    customEnvironmentId: adapterConfig.customEnvironmentId,
    customEnvironmentSlug: 'staging',
    commitSha: adapterConfig.expectedCommit,
    branch: adapterConfig.expectedBranch,
    alias: adapterConfig.expectedAlias,
    target: null,
  };
}

function source(adapterConfig = config(), overrides = {}) {
  return {
    insideWorkTree: true,
    detached: false,
    branch: adapterConfig.expectedBranch,
    symbolicRef: `refs/heads/${adapterConfig.expectedBranch}`,
    headCommitSha: adapterConfig.expectedCommit,
    branchCommitSha: adapterConfig.expectedCommit,
    clean: true,
    statusPorcelain: '',
    ...overrides,
  };
}

function attestation(adapterConfig = config(), phase = 'disabled-preflight', nonce = 'b'.repeat(64)) {
  return controller.buildDeploymentSourceAttestation(
    controller.validateDeploymentSource(source(adapterConfig), expectedDeployment(adapterConfig)),
    phase,
    nonce
  );
}

function processStub(logs = []) {
  return {
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
    env: {},
    stderr: { write: (value) => logs.push(String(value)) },
    once: () => {},
  };
}

function gitOutput(adapterConfig, args) {
  const command = args.join(' ');
  if (command === 'rev-parse --is-inside-work-tree') return 'true\n';
  if (command === 'symbolic-ref HEAD') return `refs/heads/${adapterConfig.expectedBranch}\n`;
  if (command === 'symbolic-ref --short HEAD') return `${adapterConfig.expectedBranch}\n`;
  if (command === 'rev-parse HEAD') return `${adapterConfig.expectedCommit}\n`;
  if (command === `rev-parse refs/heads/${adapterConfig.expectedBranch}`) {
    return `${adapterConfig.expectedCommit}\n`;
  }
  if (command === 'status --porcelain=v1 --untracked-files=all') return '';
  throw new Error(`UNEXPECTED_GIT_COMMAND:${command}`);
}

function deploymentRuntime(adapterConfig = config(), options = {}) {
  const calls = [];
  const logs = [];
  const runtime = {
    process: processStub(logs),
    jsonwebtoken: { sign: () => 'jwt-sensitive-sentinel' },
    spawnSync(command, args, spawnOptions) {
      calls.push({ command, args: [...args], options: spawnOptions });
      if (command === 'git') {
        return { status: 0, stdout: gitOutput(adapterConfig, args), stderr: '' };
      }
      const vercelArgs = args.slice(3);
      if (vercelArgs[0] === 'deploy') {
        return { status: 0, stdout: 'https://fresh-deployment.vercel.app\n', stderr: '' };
      }
      if (vercelArgs[0] === 'env' && vercelArgs[1] === 'update') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (vercelArgs[0] === 'curl') {
        return {
          status: 0,
          stdout: '{"version":2,"state":"succeeded","has_account":true}\n__CC_HTTP_STATUS__:200',
          stderr: '',
        };
      }
      if (vercelArgs[0] === 'api') {
        const apiPath = vercelArgs[1];
        let body;
        if (apiPath === `/v9/projects/${adapterConfig.projectId}`) {
          body = {
            id: adapterConfig.projectId,
            accountId: adapterConfig.teamId,
            customEnvironments: [{
              id: adapterConfig.customEnvironmentId,
              slug: 'staging',
              type: 'preview',
            }],
          };
        } else if (apiPath === `/v10/projects/${adapterConfig.projectId}/env`) {
          body = {
            envs: [{
              id: 'env_record_jwt',
              key: 'JWT_SECRET',
              type: 'sensitive',
              customEnvironmentIds: [adapterConfig.customEnvironmentId],
            }],
          };
        } else if (apiPath.startsWith('/v13/deployments/')) {
          body = options.deploymentMetadata || {
            id: 'dpl_ExactScalar123',
            projectId: adapterConfig.projectId,
            ownerId: adapterConfig.teamId,
          };
        } else {
          throw new Error(`UNEXPECTED_VERCEL_API:${apiPath}`);
        }
        return { status: 0, stdout: JSON.stringify(body), stderr: '' };
      }
      throw new Error(`UNEXPECTED_PROCESS:${command} ${args.join(' ')}`);
    },
  };
  return { runtime, calls, logs };
}

function bridgeFs(adapterConfig = config()) {
  const records = new Map();
  return {
    existsSync(file) {
      return records.has(file);
    },
    writeFileSync(file, raw) {
      const request = JSON.parse(String(raw));
      records.set(file, String(raw));
      const responsePath = file.replace('-request.json', '-response.json');
      const data = request.operation === 'preflight'
        ? {
          school: { schoolId: 1, value: false, guarded: true },
          intent: {
            schoolId: 1,
            instructorId: 3,
            intentId: '3c2349a0-1696-4b57-b732-fc14bbde57df',
            stableIdentity: 'cc:connect-v2:1:3:test:recipient',
            mode: 'test',
            state: 'reconciling',
            providerAccountId: null,
            scopeCount: 0,
            replacementAccountCount: 0,
          },
        }
        : {};
      records.set(responsePath, JSON.stringify({
        version: 1,
        sequence: request.sequence,
        ok: true,
        data,
      }));
    },
    readFileSync(file) {
      return records.get(file);
    },
    unlinkSync(file) {
      records.delete(file);
    },
  };
}

test.describe('Simon controller-v3 external adapter generator and conformance', () => {
  test('generates only outside the repository and validates exact bytes plus sealed surface', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-simon-adapter-contract-'));
    const output = path.join(temp, `future${tool.GENERATED_SUFFIX}`);
    try {
      const generated = tool.generateAdapterFile(config(), output);
      const validated = tool.validateGeneratedAdapterFile(config(), output);
      expect(validated.sha256).toBe(generated.sha256);
      expect(validated.methods).toEqual(tool.ADAPTER_METHODS);

      const adapter = require(output);
      expect(Object.keys(adapter).sort()).toEqual(['expectedDeployment', ...tool.ADAPTER_METHODS].sort());
      expect(Object.isFrozen(adapter)).toBe(true);
      expect(Object.keys(adapter).some((name) => /(?:create.*account|account.*create|provider.*create)/i.test(name)))
        .toBe(false);

      fs.appendFileSync(output, '// pollution\n');
      expect(() => tool.validateGeneratedAdapterFile(config(), output)).toThrow('GENERATED_ADAPTER_BYTES_MISMATCH');
      expect(() => tool.generateAdapterFile(
        config(),
        path.join(repositoryRoot, `forbidden${tool.GENERATED_SUFFIX}`)
      )).toThrow('GENERATED_ADAPTER_MUST_REMAIN_OUTSIDE_REPOSITORY');
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  test('rejects unexpected fixed identity, environment, alias, branch, commit, fields, or operational paths', () => {
    for (const [key, expected] of Object.entries(tool.FIXED_IDENTITY)) {
      expect(() => tool.validateConfig(config({ [key]: `${expected}-wrong` })))
        .toThrow(`ADAPTER_CONFIG_${key.toUpperCase()}_MISMATCH`);
      expect(() => tool.createAdapter(config({ [key]: `${expected}-wrong` }), { process: processStub() }))
        .toThrow(`ADAPTER_CONFIG_${key.toUpperCase()}_MISMATCH`);
    }
    expect(() => tool.validateConfig(config({ expectedCommit: 'not-a-commit' })))
      .toThrow('ADAPTER_CONFIG_COMMIT_INVALID');
    expect(() => tool.validateConfig(config({ expectedBranch: 'HEAD' })))
      .toThrow('ADAPTER_CONFIG_BRANCH_INVALID');
    expect(() => tool.validateConfig(config({ worktree: repositoryRoot })))
      .toThrow('ADAPTER_CONFIG_OPERATIONAL_PATH_INSIDE_REPOSITORY');
    expect(() => tool.validateConfig({ ...config(), target: 'production' }))
      .toThrow('ADAPTER_CONFIG_FIELDS_INVALID');
  });

  test('preserves the exact typed source proof and appends the immutable metadata array unchanged and last', async () => {
    const adapterConfig = config();
    const { runtime, calls } = deploymentRuntime(adapterConfig);
    const adapter = tool.createAdapter(adapterConfig, runtime);
    const proof = source(adapterConfig);
    const proofAttestation = attestation(adapterConfig);
    const metaArgs = controller.buildVercelSourceAttestationMetaArgs(proofAttestation);

    const output = await adapter.deploy(Object.freeze({
      environment: 'staging',
      phase: 'disabled-preflight',
      source: proof,
      sourceAttestation: proofAttestation,
      sourceAttestationMetaArgs: metaArgs,
    }));
    expect(output).toBe('https://fresh-deployment.vercel.app\n');

    const deployCall = calls.find((call) => call.args.includes('deploy'));
    const vercelArgs = deployCall.args.slice(3);
    expect(vercelArgs.slice(0, 7)).toEqual([
      'deploy', '--target=staging', '--force', '--yes', '--scope', adapterConfig.scope, '--meta',
    ]);
    expect(vercelArgs.slice(6)).toEqual(metaArgs);
    expect(vercelArgs.slice(-metaArgs.length)).toEqual(metaArgs);
    expect(metaArgs.filter((value) => value === '--meta')).toHaveLength(controller.SOURCE_ATTESTATION_KEYS.length);
    expect(calls.filter((call) => call.args.includes('deploy'))).toHaveLength(1);

    await expect(adapter.deploy(Object.freeze({
      environment: 'staging',
      phase: 'disabled-preflight',
      source: proof,
      sourceAttestation: proofAttestation,
      sourceAttestationMetaArgs: metaArgs,
    }))).rejects.toThrow('SOURCE_ATTESTATION_NONCE_REUSED');
    expect(calls.filter((call) => call.args.includes('deploy'))).toHaveLength(1);
  });

  test('fault injection rejects removed, added, altered, reordered, reconstructed, mutable, or supplemented attestation input before deploy', async () => {
    const adapterConfig = config();
    const proof = source(adapterConfig);
    const proofAttestation = attestation(adapterConfig);
    const exactMetaArgs = controller.buildVercelSourceAttestationMetaArgs(proofAttestation);
    const cases = [];

    cases.push({ metaArgs: Object.freeze(exactMetaArgs.slice(0, -2)) });
    cases.push({ metaArgs: Object.freeze([...exactMetaArgs, '--meta', 'ccSourceUnexpected=forbidden']) });
    cases.push({ metaArgs: Object.freeze([...exactMetaArgs].reverse()) });
    cases.push({ metaArgs: [...exactMetaArgs] });
    const changed = [...exactMetaArgs];
    changed[1] = `${changed[1]}-changed`;
    cases.push({ metaArgs: Object.freeze(changed) });
    cases.push({ attestation: { ...proofAttestation }, metaArgs: exactMetaArgs });
    cases.push({
      attestation: Object.freeze({ ...proofAttestation, ccSourceNonce: 'c'.repeat(64) }),
      metaArgs: exactMetaArgs,
    });

    for (const testCase of cases) {
      const { runtime, calls } = deploymentRuntime(adapterConfig);
      const adapter = tool.createAdapter(adapterConfig, runtime);
      await expect(adapter.deploy(Object.freeze({
        environment: 'staging',
        phase: 'disabled-preflight',
        source: proof,
        sourceAttestation: testCase.attestation || proofAttestation,
        sourceAttestationMetaArgs: testCase.metaArgs,
      }))).rejects.toThrow();
      expect(calls.filter((call) => call.args.includes('deploy'))).toHaveLength(0);
    }

    const { runtime, calls } = deploymentRuntime(adapterConfig);
    const adapter = tool.createAdapter(adapterConfig, runtime);
    await expect(adapter.deploy(Object.freeze({
      environment: 'production',
      phase: 'disabled-preflight',
      source: proof,
      sourceAttestation: proofAttestation,
      sourceAttestationMetaArgs: exactMetaArgs,
    }))).rejects.toThrow('UNAPPROVED_DEPLOYMENT_PHASE');
    await expect(adapter.deploy(Object.freeze({
      environment: 'staging',
      phase: 'disabled-preflight',
      source: source(adapterConfig, { headCommitSha: 'd'.repeat(40) }),
      sourceAttestation: proofAttestation,
      sourceAttestationMetaArgs: exactMetaArgs,
    }))).rejects.toThrow('CONTROLLER_DEPLOYMENT_SOURCE_HEADCOMMITSHA_MISMATCH');
    expect(calls.filter((call) => call.args.includes('deploy'))).toHaveLength(0);
  });

  test('rejects polluted, multi-value, reconstructed, ambiguous URLs and deployment IDs structurally', async () => {
    const adapterConfig = config();
    const invalidUrls = [
      'https://one.vercel.app\nhttps://two.vercel.app',
      'https://fresh-deployment.vercel.app/path',
      'https://user@fresh-deployment.vercel.app',
      'http://fresh-deployment.vercel.app',
      ['https://fresh-deployment.vercel.app'],
    ];
    for (const url of invalidUrls) {
      const { runtime, calls } = deploymentRuntime(adapterConfig);
      const adapter = tool.createAdapter(adapterConfig, runtime);
      await expect(adapter.resolveDeploymentUrl({ url, readOnly: true })).rejects.toThrow();
      expect(calls).toHaveLength(0);
    }

    const good = deploymentRuntime(adapterConfig);
    const goodAdapter = tool.createAdapter(adapterConfig, good.runtime);
    await expect(goodAdapter.resolveDeploymentUrl({
      url: 'https://fresh-deployment.vercel.app',
      readOnly: true,
    })).resolves.toMatchObject({ id: 'dpl_ExactScalar123' });

    const badId = deploymentRuntime(adapterConfig, {
      deploymentMetadata: {
        id: ['dpl_One', 'dpl_Two'],
        projectId: adapterConfig.projectId,
        ownerId: adapterConfig.teamId,
      },
    });
    const badIdAdapter = tool.createAdapter(adapterConfig, badId.runtime);
    await expect(badIdAdapter.resolveDeploymentUrl({
      url: 'https://fresh-deployment.vercel.app',
      readOnly: true,
    })).rejects.toThrow('DEPLOYMENT_ID_NOT_SCALAR');
  });

  test('permits exactly one authenticated application POST with redirects and retries disabled and clears auth in finally', async () => {
    const adapterConfig = config();
    const harness = deploymentRuntime(adapterConfig);
    harness.runtime.fs = bridgeFs(adapterConfig);
    const adapter = tool.createAdapter(adapterConfig, harness.runtime);
    await adapter.readSchoolFeature();

    const phase = 'minimal-enabled';
    const proofAttestation = attestation(adapterConfig, phase, 'd'.repeat(64));
    const metaArgs = controller.buildVercelSourceAttestationMetaArgs(proofAttestation);
    await adapter.deploy(Object.freeze({
      environment: 'staging',
      phase,
      source: source(adapterConfig),
      sourceAttestation: proofAttestation,
      sourceAttestationMetaArgs: metaArgs,
    }));

    const result = await adapter.postAuthenticatedCsrfReconciliation({
      deploymentId: 'dpl_ExactScalar123',
      policy: controller.REQUEST_POLICY,
      identity: controller.EXPECTED_IDENTITY,
    });
    expect(result).toMatchObject({
      attempts: 1,
      redirectsFollowed: 0,
      retries: 0,
      route: '/api/connect?action=v2-account',
      accountCreateCount: 0,
      directProviderCreateCount: 0,
    });
    const curlCalls = harness.calls.filter((call) => call.args.includes('curl'));
    expect(curlCalls).toHaveLength(1);
    expect(curlCalls[0].args).toContain('/api/connect?action=v2-account');
    expect(curlCalls[0].options.input).toContain('max-redirs = 0');
    expect(curlCalls[0].options.input).toContain('retry = 0');
    expect(harness.logs.join('')).not.toContain('jwt-sensitive-sentinel');
    await expect(adapter.postAuthenticatedCsrfReconciliation({
      deploymentId: 'dpl_ExactScalar123',
      policy: controller.REQUEST_POLICY,
      identity: controller.EXPECTED_IDENTITY,
    })).rejects.toThrow('RECONCILIATION_POST_BUDGET_EXCEEDED');
    expect(harness.calls.filter((call) => call.args.includes('curl'))).toHaveLength(1);

    const generatedSource = tool.renderGeneratedAdapter(adapterConfig);
    expect(generatedSource).toContain('finally {\n      clearAuthenticationMaterial();');
    expect(generatedSource).not.toMatch(/console\.|fetch\(|https\.request|net\.connect/);
    expect(generatedSource).not.toMatch(/\/v2\/core\/accounts|stripe\.accounts|accounts\.create/);
    expect(generatedSource).not.toMatch(/writeFileSync\([^)]*(?:jwt|csrf|session)/i);
  });
});
