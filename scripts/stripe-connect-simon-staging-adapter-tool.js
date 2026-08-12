#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const GENERATED_SUFFIX = '.generated-operator-adapter.js';
const CONFIG_KEYS = Object.freeze([
  'worktree',
  'dependencyRepository',
  'npxCli',
  'vercelCli',
  'scope',
  'teamId',
  'projectId',
  'customEnvironmentId',
  'customEnvironmentSlug',
  'expectedAlias',
  'expectedCommit',
  'expectedBranch',
  'bridgePrefix',
]);
const FIXED_IDENTITY = Object.freeze({
  vercelCli: 'vercel@58.9.1',
  scope: 'coachcarteruk-2599s-projects',
  teamId: 'team_DXEEAusHmjcfcr6auPjqloL0',
  projectId: 'prj_drQlkxVnFwSGW86fdpEpHxdYYeY2',
  customEnvironmentId: 'env_vvxYWVPTHOiutcFOPmeWw2kX08mA',
  customEnvironmentSlug: 'staging',
  expectedAlias: 'cc-simon-s4-staging-02-env-staging-coachcarteruk-2599s-projects.vercel.app',
});
const ADAPTER_METHODS = Object.freeze([
  'readGateState',
  'readSchoolFeature',
  'readRetainedIntent',
  'readDeploymentSource',
  'deploy',
  'resolveDeploymentUrl',
  'setStagingGate',
  'setSchoolFeature',
  'postAuthenticatedCsrfReconciliation',
  'readPostflight',
]);

function toolError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, code) {
  if (!isPlainObject(value)) throw toolError(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw toolError(code);
}

function exactAbsolutePath(value, code) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\r\n\0]/.test(value)) {
    throw toolError(code);
  }
  return path.resolve(value);
}

function isInsideRepository(candidate) {
  const relative = path.relative(REPOSITORY_ROOT, path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateConfig(input) {
  exactKeys(input, CONFIG_KEYS, 'ADAPTER_CONFIG_FIELDS_INVALID');
  const config = { ...input };

  for (const [key, expected] of Object.entries(FIXED_IDENTITY)) {
    if (config[key] !== expected) throw toolError(`ADAPTER_CONFIG_${key.toUpperCase()}_MISMATCH`);
  }
  config.worktree = exactAbsolutePath(config.worktree, 'ADAPTER_CONFIG_WORKTREE_INVALID');
  config.dependencyRepository = exactAbsolutePath(
    config.dependencyRepository,
    'ADAPTER_CONFIG_DEPENDENCY_REPOSITORY_INVALID'
  );
  config.npxCli = exactAbsolutePath(config.npxCli, 'ADAPTER_CONFIG_NPX_CLI_INVALID');
  config.bridgePrefix = exactAbsolutePath(config.bridgePrefix, 'ADAPTER_CONFIG_BRIDGE_PREFIX_INVALID');
  if (isInsideRepository(config.worktree) || isInsideRepository(config.bridgePrefix)) {
    throw toolError('ADAPTER_CONFIG_OPERATIONAL_PATH_INSIDE_REPOSITORY');
  }
  if (
    typeof config.expectedCommit !== 'string'
    || !/^[a-f0-9]{40}$/.test(config.expectedCommit)
  ) {
    throw toolError('ADAPTER_CONFIG_COMMIT_INVALID');
  }
  if (
    typeof config.expectedBranch !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(config.expectedBranch)
    || config.expectedBranch === 'HEAD'
    || /^[a-f0-9]{40}$/i.test(config.expectedBranch)
    || config.expectedBranch.endsWith('.')
    || config.expectedBranch.endsWith('/')
    || config.expectedBranch.includes('..')
    || config.expectedBranch.includes('//')
    || config.expectedBranch.includes('@{')
  ) {
    throw toolError('ADAPTER_CONFIG_BRANCH_INVALID');
  }
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string' || /[\r\n\0]/.test(value)) {
      throw toolError(`ADAPTER_CONFIG_${key.toUpperCase()}_INVALID`);
    }
  }
  return Object.freeze(config);
}

function createAdapter(configInput, runtimeInput = {}) {
  const runtime = runtimeInput && typeof runtimeInput === 'object' ? runtimeInput : {};
  const nodeCrypto = runtime.crypto || require('crypto');
  const nodeFs = runtime.fs || require('fs');
  const nodePath = runtime.path || require('path');
  const spawnSync = runtime.spawnSync || require('child_process').spawnSync;
  const processApi = runtime.process || process;
  const wait = runtime.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const expectedConfigKeys = [
    'worktree', 'dependencyRepository', 'npxCli', 'vercelCli', 'scope', 'teamId', 'projectId',
    'customEnvironmentId', 'customEnvironmentSlug', 'expectedAlias', 'expectedCommit',
    'expectedBranch', 'bridgePrefix',
  ];
  if (!configInput || typeof configInput !== 'object' || Array.isArray(configInput)) {
    throw new Error('ADAPTER_CONFIG_FIELDS_INVALID');
  }
  if (
    JSON.stringify(Object.keys(configInput).sort())
    !== JSON.stringify([...expectedConfigKeys].sort())
  ) {
    throw new Error('ADAPTER_CONFIG_FIELDS_INVALID');
  }
  const fixedIdentity = {
    vercelCli: 'vercel@58.9.1',
    scope: 'coachcarteruk-2599s-projects',
    teamId: 'team_DXEEAusHmjcfcr6auPjqloL0',
    projectId: 'prj_drQlkxVnFwSGW86fdpEpHxdYYeY2',
    customEnvironmentId: 'env_vvxYWVPTHOiutcFOPmeWw2kX08mA',
    customEnvironmentSlug: 'staging',
    expectedAlias: 'cc-simon-s4-staging-02-env-staging-coachcarteruk-2599s-projects.vercel.app',
  };
  for (const [key, expected] of Object.entries(fixedIdentity)) {
    if (configInput[key] !== expected) throw new Error(`ADAPTER_CONFIG_${key.toUpperCase()}_MISMATCH`);
  }
  for (const key of ['worktree', 'dependencyRepository', 'npxCli', 'bridgePrefix']) {
    if (
      typeof configInput[key] !== 'string'
      || !nodePath.isAbsolute(configInput[key])
      || /[\r\n\0]/.test(configInput[key])
    ) {
      throw new Error(`ADAPTER_CONFIG_${key.toUpperCase()}_INVALID`);
    }
  }
  if (!/^[a-f0-9]{40}$/.test(configInput.expectedCommit)) {
    throw new Error('ADAPTER_CONFIG_COMMIT_INVALID');
  }
  if (
    typeof configInput.expectedBranch !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(configInput.expectedBranch)
    || configInput.expectedBranch === 'HEAD'
    || configInput.expectedBranch.includes('..')
    || configInput.expectedBranch.includes('//')
    || configInput.expectedBranch.includes('@{')
  ) {
    throw new Error('ADAPTER_CONFIG_BRANCH_INVALID');
  }
  const config = Object.freeze({ ...configInput });

  const SOURCE_FIELDS = Object.freeze([
    'insideWorkTree',
    'detached',
    'branch',
    'symbolicRef',
    'headCommitSha',
    'branchCommitSha',
    'clean',
    'statusPorcelain',
  ]);
  const SOURCE_ATTESTATION_KEYS = Object.freeze([
    'ccSourceProofVersion',
    'ccSourcePhase',
    'ccSourceInsideWorkTree',
    'ccSourceDetached',
    'ccSourceBranch',
    'ccSourceSymbolicRef',
    'ccSourceHeadCommitSha',
    'ccSourceBranchCommitSha',
    'ccSourceClean',
    'ccSourceStatusSha256',
    'ccSourceNonce',
    'ccSourceProofSha256',
  ]);
  const EXPECTED_SOURCE = Object.freeze({
    insideWorkTree: true,
    detached: false,
    branch: config.expectedBranch,
    symbolicRef: `refs/heads/${config.expectedBranch}`,
    headCommitSha: config.expectedCommit,
    branchCommitSha: config.expectedCommit,
    clean: true,
    statusPorcelain: '',
  });
  const CONTROL_NAMES = Object.freeze([
    'STRIPE_CONNECT_V2_ENABLED',
    'STRIPE_CONNECT_V2_ACCOUNT_CREATION_ENABLED',
    'STRIPE_CONNECT_V2_ACCOUNT_LINKS_ENABLED',
    'STRIPE_CONNECT_V2_DASHBOARD_LINKS_ENABLED',
    'STRIPE_CONNECT_V2_AGREEMENTS_ENABLED',
    'STRIPE_CONNECT_V2_WEBHOOK_PROCESSING_ENABLED',
    'STRIPE_MODE',
    'STRIPE_CONNECT_V2_LIVE_ENABLED',
  ]);
  const PHASES = Object.freeze(['disabled-preflight', 'minimal-enabled', 'final-disabled']);
  const EXPECTED_IDENTITY = Object.freeze({
    schoolId: 1,
    instructorId: 3,
    intentId: '3c2349a0-1696-4b57-b732-fc14bbde57df',
    stableIdentity: 'cc:connect-v2:1:3:test:recipient',
    mode: 'test',
  });

  let bridgeSequence = 0;
  let cachedSchool = null;
  let cachedIntent = null;
  let jwtSecret = null;
  let sessionToken = null;
  let csrfToken = null;
  let rotationCount = 0;
  let postCount = 0;
  const seenAttestationNonces = new Set();

  function fixedError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function sha256(value) {
    return nodeCrypto.createHash('sha256').update(value, 'utf8').digest('hex');
  }

  function assertExactFields(value, fields, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fixedError(code);
    const actual = Object.keys(value).sort();
    const expected = [...fields].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw fixedError(code);
  }

  function assertExactSourceProof(value, label = 'DEPLOYMENT_SOURCE') {
    assertExactFields(value, SOURCE_FIELDS, `${label}_FIELD_SET_INVALID`);
    for (const field of SOURCE_FIELDS) {
      if (typeof value[field] !== typeof EXPECTED_SOURCE[field]) {
        throw fixedError(`${label}_${field.toUpperCase()}_TYPE_INVALID`);
      }
      if (value[field] !== EXPECTED_SOURCE[field]) {
        throw fixedError(`${label}_${field.toUpperCase()}_MISMATCH`);
      }
    }
    return true;
  }

  function assertEquivalentSourceProofs(first, second) {
    assertExactSourceProof(first, 'DEPLOYMENT_SOURCE_EXPECTED');
    assertExactSourceProof(second, 'DEPLOYMENT_SOURCE_IMMEDIATE');
    for (const field of SOURCE_FIELDS) {
      if (first[field] !== second[field]) throw fixedError('DEPLOYMENT_SOURCE_CHANGED');
    }
  }

  function assertSourceAttestation(attestation, phase, source) {
    if (!Object.isFrozen(attestation)) throw fixedError('SOURCE_ATTESTATION_NOT_IMMUTABLE');
    assertExactFields(attestation, SOURCE_ATTESTATION_KEYS, 'SOURCE_ATTESTATION_FIELDS_INVALID');
    if (
      attestation.ccSourceProofVersion !== '1'
      || attestation.ccSourcePhase !== phase
      || attestation.ccSourceInsideWorkTree !== 'true'
      || attestation.ccSourceDetached !== 'false'
      || attestation.ccSourceBranch !== source.branch
      || attestation.ccSourceSymbolicRef !== source.symbolicRef
      || attestation.ccSourceHeadCommitSha !== source.headCommitSha
      || attestation.ccSourceBranchCommitSha !== source.branchCommitSha
      || attestation.ccSourceClean !== 'true'
      || attestation.ccSourceStatusSha256 !== sha256(source.statusPorcelain)
      || typeof attestation.ccSourceNonce !== 'string'
      || !/^[a-f0-9]{64}$/.test(attestation.ccSourceNonce)
    ) {
      throw fixedError('SOURCE_ATTESTATION_VALUE_MISMATCH');
    }
    const unsigned = {};
    for (const key of SOURCE_ATTESTATION_KEYS) {
      if (key !== 'ccSourceProofSha256') unsigned[key] = attestation[key];
    }
    if (attestation.ccSourceProofSha256 !== sha256(JSON.stringify(unsigned))) {
      throw fixedError('SOURCE_ATTESTATION_DIGEST_MISMATCH');
    }
    if (seenAttestationNonces.has(attestation.ccSourceNonce)) {
      throw fixedError('SOURCE_ATTESTATION_NONCE_REUSED');
    }
  }

  function assertExactMetaArgs(metaArgs, attestation) {
    if (!Array.isArray(metaArgs) || !Object.isFrozen(metaArgs)) {
      throw fixedError('SOURCE_ATTESTATION_META_ARGS_NOT_IMMUTABLE');
    }
    if (metaArgs.length !== SOURCE_ATTESTATION_KEYS.length * 2) {
      throw fixedError('SOURCE_ATTESTATION_META_ARGS_LENGTH_MISMATCH');
    }
    for (let index = 0; index < SOURCE_ATTESTATION_KEYS.length; index += 1) {
      const key = SOURCE_ATTESTATION_KEYS[index];
      if (metaArgs[index * 2] !== '--meta' || metaArgs[(index * 2) + 1] !== `${key}=${attestation[key]}`) {
        throw fixedError('SOURCE_ATTESTATION_META_ARGS_MISMATCH');
      }
    }
  }

  function clearAuthenticationMaterial() {
    jwtSecret = null;
    sessionToken = null;
    csrfToken = null;
  }

  if (typeof processApi.once === 'function') processApi.once('exit', clearAuthenticationMaterial);

  function runProcess(command, args, { input = undefined, label } = {}) {
    const result = spawnSync(command, args, {
      cwd: config.worktree,
      encoding: 'utf8',
      input,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...(processApi.env || {}),
        VERCEL_ORG_ID: config.teamId,
        VERCEL_PROJECT_ID: config.projectId,
      },
    });
    if (!result || result.error || result.status !== 0) {
      throw fixedError(`${label || 'PROCESS'}_FAILED`);
    }
    if (result.stdout !== undefined && typeof result.stdout !== 'string') {
      throw fixedError(`${label || 'PROCESS'}_OUTPUT_INVALID`);
    }
    return result.stdout || '';
  }

  function assertNonProductionArgs(args) {
    if (args.some((arg) => arg === '--prod' || arg === 'production' || arg === '--target=production')) {
      throw fixedError('PRODUCTION_VERCEL_ARGUMENT_FORBIDDEN');
    }
  }

  function runVercel(args, { input = undefined, label } = {}) {
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      throw fixedError('VERCEL_ARGUMENTS_INVALID');
    }
    assertNonProductionArgs(args);
    return runProcess(processApi.execPath, [config.npxCli, '--yes', config.vercelCli, ...args], {
      input,
      label: label || 'VERCEL_COMMAND',
    });
  }

  function runGit(args, label) {
    return runProcess('git', args, { label: label || 'GIT_COMMAND' });
  }

  function parseJson(raw, code) {
    try {
      const parsed = JSON.parse(String(raw || '').trim());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
      return parsed;
    } catch {
      throw fixedError(code);
    }
  }

  function vercelApi(apiPath) {
    if (typeof apiPath !== 'string' || !/^\/v\d+\//.test(apiPath) || /[\r\n]/.test(apiPath)) {
      throw fixedError('VERCEL_API_PATH_INVALID');
    }
    return parseJson(
      runVercel(['api', apiPath, '--scope', config.scope, '--raw'], { label: 'VERCEL_API' }),
      'VERCEL_API_JSON_INVALID'
    );
  }

  function assertExactProjectIdentity() {
    const project = vercelApi(`/v9/projects/${config.projectId}`);
    if (project.id !== config.projectId || project.accountId !== config.teamId) {
      throw fixedError('VERCEL_PROJECT_TEAM_IDENTITY_MISMATCH');
    }
    const customEnvironment = Array.isArray(project.customEnvironments)
      ? project.customEnvironments.find((item) => item && item.id === config.customEnvironmentId)
      : null;
    if (
      !customEnvironment
      || customEnvironment.slug !== config.customEnvironmentSlug
      || customEnvironment.type !== 'preview'
    ) {
      throw fixedError('VERCEL_CUSTOM_ENVIRONMENT_IDENTITY_MISMATCH');
    }
  }

  function listEnvironmentRecords() {
    const response = vercelApi(`/v10/projects/${config.projectId}/env`);
    if (!Array.isArray(response.envs)) throw fixedError('VERCEL_ENV_LIST_INVALID');
    return response.envs;
  }

  function stagingMatches(records, name) {
    return records.filter((record) => (
      record
      && record.key === name
      && Array.isArray(record.customEnvironmentIds)
      && record.customEnvironmentIds.includes(config.customEnvironmentId)
    ));
  }

  function updateStagingValue(name, value, { sensitive = false } = {}) {
    const args = [
      'env', 'update', name, config.customEnvironmentSlug, '--yes', '--project', config.projectId,
      '--scope', config.scope,
    ];
    if (sensitive) args.push('--sensitive');
    runVercel(args, { input: `${value}\n`, label: 'VERCEL_STAGING_ENV_UPDATE' });
  }

  async function bridge(operation) {
    if (!['preflight', 'set_school_true', 'set_school_false', 'reconciliation_postflight'].includes(operation)) {
      throw fixedError('NEON_BRIDGE_OPERATION_INVALID');
    }
    bridgeSequence += 1;
    const requestPath = `${config.bridgePrefix}-${bridgeSequence}-request.json`;
    const responsePath = `${config.bridgePrefix}-${bridgeSequence}-response.json`;
    if (nodeFs.existsSync(requestPath) || nodeFs.existsSync(responsePath)) {
      throw fixedError('STALE_NEON_BRIDGE_FILE');
    }
    nodeFs.writeFileSync(
      requestPath,
      `${JSON.stringify({ version: 1, sequence: bridgeSequence, operation })}\n`,
      { encoding: 'utf8', flag: 'wx' }
    );
    if (processApi.stderr && typeof processApi.stderr.write === 'function') {
      processApi.stderr.write(`[adapter] neon_bridge_request ${bridgeSequence} ${operation}\n`);
    }
    const deadline = Date.now() + 300000;
    while (!nodeFs.existsSync(responsePath)) {
      if (Date.now() >= deadline) throw fixedError('NEON_BRIDGE_TIMEOUT');
      await wait(250);
    }
    let response;
    try {
      response = parseJson(nodeFs.readFileSync(responsePath, 'utf8'), 'NEON_BRIDGE_RESPONSE_INVALID');
    } finally {
      if (nodeFs.existsSync(requestPath)) nodeFs.unlinkSync(requestPath);
      if (nodeFs.existsSync(responsePath)) nodeFs.unlinkSync(responsePath);
    }
    if (response.version !== 1 || response.sequence !== bridgeSequence || response.ok !== true) {
      throw fixedError('NEON_BRIDGE_OPERATION_FAILED');
    }
    return response.data;
  }

  async function readGateState() {
    assertExactProjectIdentity();
    const records = listEnvironmentRecords();
    const values = {};
    for (const name of CONTROL_NAMES) {
      const matches = stagingMatches(records, name);
      if (matches.length > 1) throw fixedError('DUPLICATE_STAGING_CONTROL');
      if (matches.length === 0) continue;
      const detail = vercelApi(`/v1/projects/${config.projectId}/env/${matches[0].id}`);
      if (typeof detail.value !== 'string') throw fixedError('STAGING_CONTROL_VALUE_INVALID');
      values[name] = detail.value;
    }
    const productionRecords = records.filter((record) => (
      Array.isArray(record && record.target) && record.target.includes('production')
    ));
    if (productionRecords.length !== 0) throw fixedError('PRODUCTION_VARIABLE_INVENTORY_CHANGED');
    return { values, production: { untouched: true, mutationCount: 0 } };
  }

  async function readSchoolFeature() {
    if (!cachedSchool) {
      const snapshot = await bridge('preflight');
      cachedSchool = snapshot.school;
      cachedIntent = snapshot.intent;
    }
    return { ...cachedSchool };
  }

  async function readRetainedIntent() {
    if (!cachedIntent) throw fixedError('NEON_PREFLIGHT_NOT_LOADED');
    return { ...cachedIntent };
  }

  async function readDeploymentSource() {
    const insideWorkTree = runGit(['rev-parse', '--is-inside-work-tree'], 'GIT_INSIDE_WORKTREE').trim() === 'true';
    const symbolicRef = runGit(['symbolic-ref', 'HEAD'], 'GIT_SYMBOLIC_REF').trim();
    const branch = runGit(['symbolic-ref', '--short', 'HEAD'], 'GIT_BRANCH').trim();
    const headCommitSha = runGit(['rev-parse', 'HEAD'], 'GIT_HEAD').trim();
    const branchCommitSha = runGit(
      ['rev-parse', `refs/heads/${config.expectedBranch}`],
      'GIT_BRANCH_TIP'
    ).trim();
    const statusPorcelain = runGit(
      ['status', '--porcelain=v1', '--untracked-files=all'],
      'GIT_STATUS'
    );
    const proof = {
      insideWorkTree,
      detached: false,
      branch,
      symbolicRef,
      headCommitSha,
      branchCommitSha,
      clean: statusPorcelain === '',
      statusPorcelain,
    };
    assertExactSourceProof(proof, 'LIVE_DEPLOYMENT_SOURCE');
    return Object.freeze(proof);
  }

  async function setStagingGate(input) {
    assertExactFields(input, ['name', 'value'], 'STAGING_GATE_INPUT_INVALID');
    const { name, value } = input;
    if (!['STRIPE_CONNECT_V2_ENABLED', 'STRIPE_CONNECT_V2_ACCOUNT_CREATION_ENABLED'].includes(name)) {
      throw fixedError('UNAPPROVED_GATE_MUTATION');
    }
    if (!['true', 'false'].includes(value)) throw fixedError('UNAPPROVED_GATE_VALUE');
    updateStagingValue(name, value);
  }

  async function setSchoolFeature(input) {
    assertExactFields(input, ['schoolId', 'value', 'guarded'], 'SCHOOL_FEATURE_INPUT_INVALID');
    const { schoolId, value, guarded } = input;
    if (schoolId !== 1 || typeof value !== 'boolean' || guarded !== true) {
      throw fixedError('UNAPPROVED_SCHOOL_MUTATION');
    }
    const data = await bridge(value ? 'set_school_true' : 'set_school_false');
    cachedSchool = data.school;
  }

  function ensureJwtRotation() {
    if (rotationCount !== 0) throw fixedError('JWT_ROTATION_BUDGET_EXCEEDED');
    const records = listEnvironmentRecords();
    const matches = stagingMatches(records, 'JWT_SECRET');
    if (matches.length !== 1 || matches[0].type !== 'sensitive') {
      throw fixedError('STAGING_JWT_RECORD_INVALID');
    }
    jwtSecret = nodeCrypto.randomBytes(32).toString('hex');
    rotationCount += 1;
    updateStagingValue('JWT_SECRET', jwtSecret, { sensitive: true });
    if (processApi.stderr && typeof processApi.stderr.write === 'function') {
      processApi.stderr.write('[adapter] staging_jwt_rotated_once\n');
    }
  }

  async function deploy(input) {
    assertExactFields(
      input,
      ['environment', 'phase', 'source', 'sourceAttestation', 'sourceAttestationMetaArgs'],
      'DEPLOY_INPUT_FIELDS_INVALID'
    );
    const { environment, phase, source, sourceAttestation, sourceAttestationMetaArgs } = input;
    if (environment !== config.customEnvironmentSlug || !PHASES.includes(phase)) {
      throw fixedError('UNAPPROVED_DEPLOYMENT_PHASE');
    }
    assertExactSourceProof(source, 'CONTROLLER_DEPLOYMENT_SOURCE');
    assertSourceAttestation(sourceAttestation, phase, source);
    assertExactMetaArgs(sourceAttestationMetaArgs, sourceAttestation);
    const immediateSource = await readDeploymentSource();
    assertEquivalentSourceProofs(source, immediateSource);
    seenAttestationNonces.add(sourceAttestation.ccSourceNonce);
    if (phase === 'minimal-enabled') ensureJwtRotation();
    const deployArgs = [
      'deploy',
      '--target=staging',
      '--force',
      '--yes',
      '--scope',
      config.scope,
      ...sourceAttestationMetaArgs,
    ];
    const stdout = runVercel(deployArgs, { label: 'VERCEL_STAGING_DEPLOY' });
    if (processApi.stderr && typeof processApi.stderr.write === 'function') {
      processApi.stderr.write(`[adapter] staging_deployment_created ${phase}\n`);
    }
    return stdout;
  }

  function parseIsolatedVercelUrl(value) {
    if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) {
      throw fixedError('DEPLOYMENT_URL_NOT_SCALAR');
    }
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw fixedError('DEPLOYMENT_URL_INVALID');
    }
    if (
      parsed.protocol !== 'https:'
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/i.test(parsed.hostname)
      || parsed.username
      || parsed.password
      || parsed.port
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
      || (value !== parsed.href && value !== parsed.href.slice(0, -1))
    ) {
      throw fixedError('DEPLOYMENT_URL_INVALID');
    }
    return parsed.hostname;
  }

  async function resolveDeploymentUrl(input) {
    assertExactFields(input, ['url', 'readOnly'], 'DEPLOYMENT_RESOLUTION_INPUT_INVALID');
    if (input.readOnly !== true) throw fixedError('DEPLOYMENT_RESOLUTION_NOT_READ_ONLY');
    const host = parseIsolatedVercelUrl(input.url);
    assertExactProjectIdentity();
    const metadata = vercelApi(`/v13/deployments/${host}`);
    if (metadata.projectId !== config.projectId || metadata.ownerId !== config.teamId) {
      throw fixedError('DEPLOYMENT_PROJECT_TEAM_IDENTITY_MISMATCH');
    }
    if (typeof metadata.id !== 'string' || !/^dpl_[A-Za-z0-9]+$/.test(metadata.id)) {
      throw fixedError('DEPLOYMENT_ID_NOT_SCALAR');
    }
    return metadata;
  }

  function mintSession() {
    if (!jwtSecret || rotationCount !== 1) throw fixedError('JWT_ROTATION_NOT_AVAILABLE');
    const jsonwebtoken = runtime.jsonwebtoken
      || require(nodePath.join(config.dependencyRepository, 'node_modules', 'jsonwebtoken'));
    if (!jsonwebtoken || typeof jsonwebtoken.sign !== 'function') throw fixedError('JWT_LIBRARY_INVALID');
    sessionToken = jsonwebtoken.sign(
      { id: 3, email: 'simon.staging.invalid', school_id: 1, role: 'instructor' },
      jwtSecret,
      { expiresIn: '10m' }
    );
    csrfToken = nodeCrypto.randomBytes(24).toString('hex');
  }

  async function postAuthenticatedCsrfReconciliation(input) {
    assertExactFields(
      input,
      ['deploymentId', 'policy', 'identity'],
      'RECONCILIATION_INPUT_FIELDS_INVALID'
    );
    const { deploymentId, policy, identity } = input;
    if (postCount !== 0) throw fixedError('RECONCILIATION_POST_BUDGET_EXCEEDED');
    if (typeof deploymentId !== 'string' || !/^dpl_[A-Za-z0-9]+$/.test(deploymentId)) {
      throw fixedError('RECONCILIATION_DEPLOYMENT_ID_INVALID');
    }
    if (
      !cachedIntent
      || cachedIntent.state !== 'reconciling'
      || identity.schoolId !== EXPECTED_IDENTITY.schoolId
      || identity.instructorId !== EXPECTED_IDENTITY.instructorId
      || identity.intentId !== cachedIntent.intentId
      || identity.stableIdentity !== cachedIntent.stableIdentity
      || identity.mode !== EXPECTED_IDENTITY.mode
      || policy.method !== 'POST'
      || policy.route !== '/api/connect?action=v2-account'
      || policy.authenticated !== true
      || policy.csrfBound !== true
      || policy.redirect !== 'manual'
      || policy.maxRedirects !== 0
      || policy.retries !== 0
      || policy.maxAttempts !== 1
    ) {
      throw fixedError('RECONCILIATION_REQUEST_POLICY_INVALID');
    }
    mintSession();
    postCount += 1;
    const curlConfig = [
      'request = "POST"',
      'max-redirs = 0',
      'retry = 0',
      'silent',
      'show-error',
      'write-out = "\\n__CC_HTTP_STATUS__:%{http_code}"',
      `header = "Cookie: cc_instructor=${sessionToken}; cc_csrf=${csrfToken}"`,
      `header = "X-CSRF-Token: ${csrfToken}"`,
      'header = "Content-Type: application/json"',
      'data = "{}"',
      '',
    ].join('\n');
    let raw;
    try {
      raw = runVercel(
        ['curl', policy.route, '--deployment', deploymentId, '--scope', config.scope, '--', '--config', '-'],
        { input: curlConfig, label: 'VERCEL_RECONCILIATION_POST' }
      );
    } finally {
      clearAuthenticationMaterial();
    }
    const match = String(raw).match(/^(.*)\r?\n__CC_HTTP_STATUS__:(\d{3})\s*$/s);
    if (!match) throw fixedError('RECONCILIATION_TRANSPORT_UNCERTAIN');
    const body = parseJson(match[1], 'RECONCILIATION_RESPONSE_INVALID');
    return {
      transport: 'certain',
      attempts: postCount,
      redirectsFollowed: 0,
      retries: 0,
      authenticated: true,
      csrfBound: true,
      method: 'POST',
      route: policy.route,
      httpStatus: Number(match[2]),
      applicationVersion: body.version,
      applicationState: body.state,
      hasAccount: body.has_account,
      firstStripeAction: 'accounts_v2_list',
      matchCount: body.state === 'succeeded' ? 1 : 0,
      accountCreateCount: 0,
      directProviderCreateCount: 0,
      intentId: identity.intentId,
      stableIdentity: identity.stableIdentity,
    };
  }

  async function readPostflight() {
    const data = await bridge('reconciliation_postflight');
    return data.postflight;
  }

  return Object.freeze({
    expectedDeployment: Object.freeze({
      projectId: config.projectId,
      customEnvironmentId: config.customEnvironmentId,
      customEnvironmentSlug: config.customEnvironmentSlug,
      commitSha: config.expectedCommit,
      branch: config.expectedBranch,
      alias: config.expectedAlias,
      target: null,
    }),
    readGateState,
    readSchoolFeature,
    readRetainedIntent,
    readDeploymentSource,
    deploy,
    resolveDeploymentUrl,
    setStagingGate,
    setSchoolFeature,
    postAuthenticatedCsrfReconciliation,
    readPostflight,
  });
}

function renderGeneratedAdapter(configInput) {
  const config = validateConfig(configInput);
  const serialized = JSON.stringify(config, null, 2);
  const body = [
    "'use strict';",
    '',
    '// Generated by scripts/stripe-connect-simon-staging-adapter-tool.js.',
    '// Contains no credentials. Validate byte-for-byte before operational use.',
    `const config = Object.freeze(${serialized});`,
    '',
    `const createAdapter = ${createAdapter.toString()};`,
    '',
    'module.exports = createAdapter(config);',
    '',
  ].join('\n');
  return body;
}

function validateAdapterSurface(adapter) {
  if (!Object.isFrozen(adapter)) throw toolError('GENERATED_ADAPTER_NOT_FROZEN');
  exactKeys(adapter, ['expectedDeployment', ...ADAPTER_METHODS], 'GENERATED_ADAPTER_SURFACE_INVALID');
  for (const name of ADAPTER_METHODS) {
    if (typeof adapter[name] !== 'function') throw toolError('GENERATED_ADAPTER_SURFACE_INVALID');
  }
  if (
    Object.keys(adapter).some((name) => /(?:create.*account|account.*create|provider.*create)/i.test(name))
  ) {
    throw toolError('GENERATED_ADAPTER_PROVIDER_CREATE_SURFACE_FORBIDDEN');
  }
  return true;
}

function assertExternalGeneratedPath(value, code) {
  const resolved = exactAbsolutePath(value, code);
  if (isInsideRepository(resolved)) throw toolError('GENERATED_ADAPTER_MUST_REMAIN_OUTSIDE_REPOSITORY');
  if (!resolved.endsWith(GENERATED_SUFFIX)) throw toolError('GENERATED_ADAPTER_FILENAME_INVALID');
  return resolved;
}

function generateAdapterFile(configInput, outputPath) {
  const config = validateConfig(configInput);
  const resolved = assertExternalGeneratedPath(outputPath, 'GENERATED_ADAPTER_PATH_INVALID');
  const source = renderGeneratedAdapter(config);
  fs.writeFileSync(resolved, source, { encoding: 'utf8', flag: 'wx' });
  return Object.freeze({
    path: resolved,
    sha256: crypto.createHash('sha256').update(source, 'utf8').digest('hex'),
  });
}

function validateGeneratedAdapterFile(configInput, adapterPath) {
  const config = validateConfig(configInput);
  const resolved = assertExternalGeneratedPath(adapterPath, 'GENERATED_ADAPTER_PATH_INVALID');
  const actual = fs.readFileSync(resolved, 'utf8');
  const expected = renderGeneratedAdapter(config);
  if (actual !== expected) throw toolError('GENERATED_ADAPTER_BYTES_MISMATCH');
  delete require.cache[require.resolve(resolved)];
  const adapter = require(resolved);
  validateAdapterSurface(adapter);
  return Object.freeze({
    path: resolved,
    sha256: crypto.createHash('sha256').update(actual, 'utf8').digest('hex'),
    methods: Object.freeze([...ADAPTER_METHODS]),
  });
}

function readConfigFile(configPath) {
  const resolved = exactAbsolutePath(configPath, 'ADAPTER_CONFIG_PATH_INVALID');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    throw toolError('ADAPTER_CONFIG_FILE_INVALID');
  }
  return validateConfig(parsed);
}

function parseCli(argv) {
  if (!Array.isArray(argv) || !['generate', 'validate'].includes(argv[0])) {
    throw toolError('USAGE_GENERATE_OR_VALIDATE_REQUIRED');
  }
  const values = { command: argv[0], config: null, output: null, adapter: null };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config') values.config = argv[++index] || null;
    else if (arg === '--output') values.output = argv[++index] || null;
    else if (arg === '--adapter') values.adapter = argv[++index] || null;
    else throw toolError('UNKNOWN_ARGUMENT');
  }
  if (!values.config) throw toolError('ADAPTER_CONFIG_PATH_REQUIRED');
  if (values.command === 'generate' && (!values.output || values.adapter)) {
    throw toolError('GENERATE_OUTPUT_PATH_REQUIRED');
  }
  if (values.command === 'validate' && (!values.adapter || values.output)) {
    throw toolError('VALIDATE_ADAPTER_PATH_REQUIRED');
  }
  return Object.freeze(values);
}

function main() {
  const options = parseCli(process.argv.slice(2));
  const config = readConfigFile(options.config);
  const result = options.command === 'generate'
    ? generateAdapterFile(config, options.output)
    : validateGeneratedAdapterFile(config, options.adapter);
  process.stdout.write(`${JSON.stringify({ ok: true, command: options.command, ...result })}\n`);
}

module.exports = Object.freeze({
  ADAPTER_METHODS,
  CONFIG_KEYS,
  FIXED_IDENTITY,
  GENERATED_SUFFIX,
  createAdapter,
  generateAdapterFile,
  parseCli,
  readConfigFile,
  renderGeneratedAdapter,
  validateAdapterSurface,
  validateConfig,
  validateGeneratedAdapterFile,
});

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'ADAPTER_TOOL_FAILURE' })}\n`);
    process.exitCode = 1;
  }
}
