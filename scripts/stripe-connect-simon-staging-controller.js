#!/usr/bin/env node
'use strict';

const path = require('path');

const CONTROLLER_VERSION = 2;
const OPERATIONAL_APPROVAL = 'SIMON_STAGING_RECONCILIATION_APPROVED';
const RECONCILIATION_ROUTE = '/api/connect?action=v2-account';
const EXPECTED_IDENTITY = Object.freeze({
  schoolId: 1,
  instructorId: 3,
  intentId: '3c2349a0-1696-4b57-b732-fc14bbde57df',
  stableIdentity: 'cc:connect-v2:1:3:test:recipient',
  mode: 'test',
});

const GATES = Object.freeze({
  global: 'STRIPE_CONNECT_V2_ENABLED',
  accountCreation: 'STRIPE_CONNECT_V2_ACCOUNT_CREATION_ENABLED',
  accountLinks: 'STRIPE_CONNECT_V2_ACCOUNT_LINKS_ENABLED',
  dashboardLinks: 'STRIPE_CONNECT_V2_DASHBOARD_LINKS_ENABLED',
  agreements: 'STRIPE_CONNECT_V2_AGREEMENTS_ENABLED',
  webhookProcessing: 'STRIPE_CONNECT_V2_WEBHOOK_PROCESSING_ENABLED',
  live: 'STRIPE_CONNECT_V2_LIVE_ENABLED',
  mode: 'STRIPE_MODE',
});

const SIX_DISABLED_GATES = Object.freeze([
  GATES.global,
  GATES.accountCreation,
  GATES.accountLinks,
  GATES.dashboardLinks,
  GATES.agreements,
  GATES.webhookProcessing,
]);

const REQUIRED_ADAPTER_METHODS = Object.freeze([
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

const REQUEST_POLICY = Object.freeze({
  method: 'POST',
  route: RECONCILIATION_ROUTE,
  authenticated: true,
  csrfBound: true,
  redirect: 'manual',
  maxRedirects: 0,
  retries: 0,
  maxAttempts: 1,
});

class ControllerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ControllerError';
    this.code = code;
  }
}

function fail(code) {
  throw new ControllerError(code);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactString(value, pattern, failureCode) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(failureCode);
  return value;
}

function parseDeploymentUrlOutput(output) {
  if (typeof output !== 'string') fail('DEPLOY_OUTPUT_NOT_SCALAR');
  const trimmed = output.trim();
  if (!trimmed) fail('DEPLOY_OUTPUT_MISSING');

  let candidate = trimmed;
  if (/^["[{]/.test(trimmed)) {
    let parsedOutput;
    try {
      parsedOutput = JSON.parse(trimmed);
    } catch {
      fail('DEPLOY_OUTPUT_MALFORMED');
    }
    if (typeof parsedOutput === 'string') {
      candidate = parsedOutput;
    } else if (isPlainObject(parsedOutput)) {
      if (
        parsedOutput.status !== 'ok'
        || !isPlainObject(parsedOutput.deployment)
        || typeof parsedOutput.deployment.url !== 'string'
      ) {
        fail('DEPLOY_OUTPUT_AGENT_ENVELOPE_INVALID');
      }
      candidate = parsedOutput.deployment.url;
    } else {
      fail('DEPLOY_OUTPUT_NOT_SCALAR');
    }
  }

  if (!candidate || /[\r\n]/.test(candidate)) fail('DEPLOY_OUTPUT_POLLUTED');

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    fail('DEPLOY_URL_MALFORMED');
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
  ) {
    fail('DEPLOY_URL_NOT_ISOLATED_VERCEL');
  }

  if (candidate !== parsed.href && candidate !== parsed.href.slice(0, -1)) {
    fail('DEPLOY_OUTPUT_POLLUTED');
  }
  return parsed.href.slice(0, -1);
}

function selectDeploymentId(metadata) {
  if (!isPlainObject(metadata)) fail('DEPLOYMENT_METADATA_MALFORMED');
  return exactString(metadata.id, /^dpl_[A-Za-z0-9]+$/, 'DEPLOYMENT_ID_NOT_SCALAR');
}

function exactNamedBranch(value, failureCode) {
  const branch = exactString(value, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/, failureCode);
  if (
    branch === 'HEAD'
    || /^[a-f0-9]{40}$/i.test(branch)
    || branch.endsWith('.')
    || branch.endsWith('/')
    || branch.includes('..')
    || branch.includes('//')
    || branch.includes('@{')
  ) {
    fail(failureCode);
  }
  return branch;
}

function validateExpectedDeployment(expected) {
  if (!isPlainObject(expected)) fail('EXPECTED_DEPLOYMENT_MISSING');
  const normalized = {
    projectId: exactString(expected.projectId, /^prj_[A-Za-z0-9]+$/, 'EXPECTED_PROJECT_INVALID'),
    customEnvironmentId: exactString(expected.customEnvironmentId, /^env_[A-Za-z0-9]+$/, 'EXPECTED_ENVIRONMENT_INVALID'),
    customEnvironmentSlug: exactString(expected.customEnvironmentSlug, /^staging$/, 'EXPECTED_ENVIRONMENT_INVALID'),
    commitSha: exactString(expected.commitSha, /^[a-f0-9]{40}$/, 'EXPECTED_COMMIT_INVALID'),
    branch: exactNamedBranch(expected.branch, 'EXPECTED_BRANCH_INVALID'),
    alias: exactString(expected.alias, /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/i, 'EXPECTED_ALIAS_INVALID'),
    target: Object.prototype.hasOwnProperty.call(expected, 'target') ? expected.target : null,
  };
  if (normalized.target === 'production' || ![null, 'preview'].includes(normalized.target)) {
    fail('EXPECTED_TARGET_NOT_NON_PRODUCTION');
  }
  if (!/(?:^|-)staging(?:-|\.)/i.test(normalized.alias)) fail('EXPECTED_ALIAS_NOT_STAGING_ONLY');
  return Object.freeze(normalized);
}

function validateDeploymentSource(source, expectedInput) {
  const expected = validateExpectedDeployment(expectedInput);
  if (!isPlainObject(source)) fail('DEPLOYMENT_SOURCE_PROOF_MALFORMED');
  if (source.insideWorkTree !== true) fail('DEPLOYMENT_SOURCE_WORKTREE_AMBIGUOUS');
  if (source.detached !== false || source.symbolicRef !== `refs/heads/${expected.branch}`) {
    fail('DEPLOYMENT_SOURCE_DETACHED_OR_AMBIGUOUS');
  }
  if (exactNamedBranch(source.branch, 'DEPLOYMENT_SOURCE_BRANCH_AMBIGUOUS') !== expected.branch) {
    fail('DEPLOYMENT_SOURCE_BRANCH_MISMATCH');
  }
  if (source.headCommitSha !== expected.commitSha || source.branchCommitSha !== expected.commitSha) {
    fail('DEPLOYMENT_SOURCE_COMMIT_MISMATCH');
  }
  if (source.clean !== true || source.statusPorcelain !== '') fail('DEPLOYMENT_SOURCE_DIRTY_OR_AMBIGUOUS');
  return Object.freeze({
    branch: expected.branch,
    symbolicRef: `refs/heads/${expected.branch}`,
    headCommitSha: expected.commitSha,
    branchCommitSha: expected.commitSha,
    insideWorkTree: true,
    detached: false,
    clean: true,
    statusPorcelain: '',
  });
}

function validateDeploymentMetadata(metadata, expectedInput, deploymentUrl) {
  const expected = validateExpectedDeployment(expectedInput);
  const id = selectDeploymentId(metadata);
  if (metadata.readyState !== 'READY') fail('DEPLOYMENT_NOT_READY');
  if (metadata.projectId !== expected.projectId) fail('DEPLOYMENT_PROJECT_MISMATCH');
  if (metadata.target !== expected.target || metadata.target === 'production') fail('DEPLOYMENT_TARGET_MISMATCH');
  if (!isPlainObject(metadata.meta) || metadata.meta.gitCommitSha !== expected.commitSha) fail('DEPLOYMENT_COMMIT_MISMATCH');
  if (metadata.meta.gitCommitRef !== expected.branch) fail('DEPLOYMENT_BRANCH_MISMATCH');
  if (!Object.prototype.hasOwnProperty.call(metadata.meta, 'gitDirty') || metadata.meta.gitDirty !== null) {
    fail('DEPLOYMENT_DIRTY_OR_AMBIGUOUS');
  }
  if (
    !isPlainObject(metadata.customEnvironment)
    || metadata.customEnvironment.id !== expected.customEnvironmentId
    || metadata.customEnvironment.slug !== expected.customEnvironmentSlug
  ) {
    fail('DEPLOYMENT_ENVIRONMENT_MISMATCH');
  }
  if (!Array.isArray(metadata.alias) || metadata.alias.length !== 1 || metadata.alias[0] !== expected.alias) {
    fail('DEPLOYMENT_ALIAS_MISMATCH');
  }

  const parsedUrl = new URL(parseDeploymentUrlOutput(deploymentUrl));
  if (typeof metadata.url !== 'string' || metadata.url.toLowerCase() !== parsedUrl.hostname.toLowerCase()) {
    fail('DEPLOYMENT_DOMAIN_MISMATCH');
  }
  return Object.freeze({ id, url: parsedUrl.href.slice(0, -1) });
}

function assertProductionUntouched(production) {
  if (
    !isPlainObject(production)
    || production.untouched !== true
    || production.mutationCount !== 0
  ) {
    fail('PRODUCTION_NOT_PROVEN_UNTOUCHED');
  }
}

function validateGateState(state, { enabled }) {
  if (!isPlainObject(state) || !isPlainObject(state.values)) fail('GATE_STATE_MALFORMED');
  assertProductionUntouched(state.production);
  const values = state.values;

  for (const gate of SIX_DISABLED_GATES) {
    if (!Object.prototype.hasOwnProperty.call(values, gate)) fail('DISABLED_GATE_MISSING');
    const expected = enabled && (gate === GATES.global || gate === GATES.accountCreation) ? 'true' : 'false';
    if (values[gate] !== expected) fail(enabled ? 'MINIMAL_ENABLEMENT_MISMATCH' : 'DISABLED_GATE_NOT_FALSE');
  }
  if (!Object.prototype.hasOwnProperty.call(values, GATES.mode) || values[GATES.mode] !== 'test') {
    fail('STRIPE_MODE_NOT_TEST');
  }
  if (Object.prototype.hasOwnProperty.call(values, GATES.live) && values[GATES.live] !== 'false') {
    fail('LIVE_GATE_NOT_DISABLED');
  }
  return true;
}

function validateSchoolFeature(state, expectedValue) {
  if (
    !isPlainObject(state)
    || state.schoolId !== EXPECTED_IDENTITY.schoolId
    || typeof state.value !== 'boolean'
    || state.value !== expectedValue
    || state.guarded !== true
  ) {
    fail(expectedValue ? 'SCHOOL_ENABLEMENT_MISMATCH' : 'SCHOOL_DISABLED_STATE_MISMATCH');
  }
  return true;
}

function validateRetainedIntent(intent) {
  if (
    !isPlainObject(intent)
    || intent.schoolId !== EXPECTED_IDENTITY.schoolId
    || intent.instructorId !== EXPECTED_IDENTITY.instructorId
    || intent.intentId !== EXPECTED_IDENTITY.intentId
    || intent.stableIdentity !== EXPECTED_IDENTITY.stableIdentity
    || intent.mode !== EXPECTED_IDENTITY.mode
    || intent.state !== 'reconciling'
    || intent.providerAccountId !== null
    || intent.scopeCount !== 0
    || intent.replacementAccountCount !== 0
  ) {
    fail('RETAINED_INTENT_MISMATCH');
  }
  return true;
}

function validateAdapter(adapter) {
  if (!isPlainObject(adapter)) fail('OPERATOR_ADAPTER_MISSING');
  for (const name of REQUIRED_ADAPTER_METHODS) {
    if (typeof adapter[name] !== 'function') fail('OPERATOR_ADAPTER_INCOMPLETE');
  }
  for (const [name, value] of Object.entries(adapter)) {
    if (typeof value === 'function' && !REQUIRED_ADAPTER_METHODS.includes(name)) {
      fail(/(?:create.*account|account.*create|provider.*create)/i.test(name)
        ? 'DIRECT_PROVIDER_CREATION_SURFACE_FORBIDDEN'
        : 'OPERATOR_ADAPTER_SURFACE_NOT_SEALED');
    }
  }
  validateExpectedDeployment(adapter.expectedDeployment);
  return true;
}

async function callAdapter(adapter, method, args, failureCode) {
  try {
    return await adapter[method](args);
  } catch {
    fail(failureCode);
  }
}

async function deployAndValidate(adapter, phase) {
  const source = validateDeploymentSource(
    await callAdapter(adapter, 'readDeploymentSource', {}, 'DEPLOYMENT_SOURCE_READ_FAILED'),
    adapter.expectedDeployment
  );
  const output = await callAdapter(adapter, 'deploy', { environment: 'staging', phase, source }, 'DEPLOYMENT_FAILED');
  const url = parseDeploymentUrlOutput(output);
  const metadata = await callAdapter(
    adapter,
    'resolveDeploymentUrl',
    { url, readOnly: true },
    'DEPLOYMENT_URL_RESOLUTION_FAILED'
  );
  return validateDeploymentMetadata(metadata, adapter.expectedDeployment, url);
}

function validateReconciliationResult(result) {
  if (!isPlainObject(result)) fail('RECONCILIATION_RESULT_MALFORMED');
  if (
    result.transport !== 'certain'
    || result.attempts !== 1
    || result.redirectsFollowed !== 0
    || result.retries !== 0
  ) {
    fail('RECONCILIATION_TRANSPORT_UNCERTAIN');
  }
  if (
    result.authenticated !== true
    || result.csrfBound !== true
    || result.method !== 'POST'
    || result.route !== RECONCILIATION_ROUTE
  ) {
    fail('RECONCILIATION_REQUEST_CONTRACT_MISMATCH');
  }
  if (
    result.httpStatus !== 200
    || result.applicationVersion !== 2
    || result.applicationState !== 'succeeded'
    || result.hasAccount !== true
  ) {
    fail('RECONCILIATION_APPLICATION_MISMATCH');
  }
  if (
    result.firstStripeAction !== 'accounts_v2_list'
    || result.matchCount !== 1
    || result.accountCreateCount !== 0
    || result.directProviderCreateCount !== 0
  ) {
    fail('RECONCILIATION_PROVIDER_PATH_MISMATCH');
  }
  if (
    result.intentId !== EXPECTED_IDENTITY.intentId
    || result.stableIdentity !== EXPECTED_IDENTITY.stableIdentity
  ) {
    fail('RECONCILIATION_IDENTITY_MISMATCH');
  }
  return true;
}

function validatePostflight(postflight) {
  if (
    !isPlainObject(postflight)
    || postflight.schoolId !== EXPECTED_IDENTITY.schoolId
    || postflight.instructorId !== EXPECTED_IDENTITY.instructorId
    || postflight.intentId !== EXPECTED_IDENTITY.intentId
    || postflight.stableIdentity !== EXPECTED_IDENTITY.stableIdentity
    || postflight.intentState !== 'succeeded'
    || postflight.matchCount !== 1
    || postflight.accountCreateCount !== 0
    || postflight.directProviderCreateCount !== 0
    || postflight.replacementAccountCount !== 0
    || postflight.scopeCount !== 1
  ) {
    fail('RECONCILIATION_POSTFLIGHT_MISMATCH');
  }
  return true;
}

function safeReport(report) {
  return Object.freeze({
    controllerVersion: CONTROLLER_VERSION,
    mode: report.mode,
    completed: report.completed === true,
    postCount: Number(report.postCount || 0),
    shutdownComplete: report.shutdownComplete === true,
  });
}

function offlinePlan() {
  return safeReport({
    mode: 'offline-dry-run',
    completed: true,
    postCount: 0,
    shutdownComplete: false,
  });
}

async function runOperationalController({ adapter, report = () => {} }) {
  validateAdapter(adapter);
  if (typeof report !== 'function') fail('REPORTER_INVALID');

  let postCount = 0;
  let completed = false;
  let primaryFailure = null;
  let shutdownComplete = false;

  try {
    validateGateState(await callAdapter(adapter, 'readGateState', {}, 'GATE_READ_FAILED'), { enabled: false });
    validateSchoolFeature(await callAdapter(adapter, 'readSchoolFeature', {}, 'SCHOOL_READ_FAILED'), false);
    validateRetainedIntent(await callAdapter(adapter, 'readRetainedIntent', {}, 'INTENT_READ_FAILED'));
    report(Object.freeze({ event: 'disabled_preflight_passed' }));

    await deployAndValidate(adapter, 'disabled-preflight');
    report(Object.freeze({ event: 'disabled_deployment_validated' }));

    await callAdapter(adapter, 'setStagingGate', { name: GATES.global, value: 'true' }, 'GLOBAL_ENABLE_FAILED');
    await callAdapter(adapter, 'setStagingGate', { name: GATES.accountCreation, value: 'true' }, 'ACCOUNT_CREATION_ENABLE_FAILED');
    await callAdapter(adapter, 'setSchoolFeature', { schoolId: EXPECTED_IDENTITY.schoolId, value: true, guarded: true }, 'SCHOOL_ENABLE_FAILED');

    validateGateState(await callAdapter(adapter, 'readGateState', {}, 'GATE_READ_FAILED'), { enabled: true });
    validateSchoolFeature(await callAdapter(adapter, 'readSchoolFeature', {}, 'SCHOOL_READ_FAILED'), true);
    report(Object.freeze({ event: 'minimal_enablement_proved' }));

    const enabledDeployment = await deployAndValidate(adapter, 'minimal-enabled');
    report(Object.freeze({ event: 'enabled_deployment_validated' }));

    if (postCount !== 0) fail('RECONCILIATION_POST_BUDGET_EXHAUSTED');
    postCount += 1;
    let reconciliation;
    try {
      reconciliation = await adapter.postAuthenticatedCsrfReconciliation({
        deploymentId: enabledDeployment.id,
        policy: REQUEST_POLICY,
        identity: EXPECTED_IDENTITY,
      });
    } catch {
      fail('RECONCILIATION_TRANSPORT_UNCERTAIN');
    }
    validateReconciliationResult(reconciliation);
    validatePostflight(await callAdapter(adapter, 'readPostflight', {}, 'POSTFLIGHT_READ_FAILED'));
    completed = true;
    report(Object.freeze({ event: 'reconciliation_succeeded' }));
  } catch (error) {
    primaryFailure = error instanceof ControllerError ? error : new ControllerError('CONTROLLER_FAILURE');
  } finally {
    const shutdownFailures = [];
    const shutdownSteps = [
      ['setStagingGate', { name: GATES.accountCreation, value: 'false' }, 'ACCOUNT_CREATION_SHUTDOWN_FAILED', 'account_creation_false'],
      ['setStagingGate', { name: GATES.global, value: 'false' }, 'GLOBAL_SHUTDOWN_FAILED', 'global_false'],
      ['setSchoolFeature', { schoolId: EXPECTED_IDENTITY.schoolId, value: false, guarded: true }, 'SCHOOL_SHUTDOWN_FAILED', 'school_false'],
    ];
    for (const [method, args, failureCode, step] of shutdownSteps) {
      try {
        await callAdapter(adapter, method, args, failureCode);
        report(Object.freeze({ event: 'shutdown_step', step }));
      } catch (error) {
        shutdownFailures.push(error.code || failureCode);
      }
    }

    try {
      validateGateState(await callAdapter(adapter, 'readGateState', {}, 'SHUTDOWN_GATE_READ_FAILED'), { enabled: false });
      validateSchoolFeature(await callAdapter(adapter, 'readSchoolFeature', {}, 'SHUTDOWN_SCHOOL_READ_FAILED'), false);
      await deployAndValidate(adapter, 'final-disabled');
      shutdownComplete = true;
      report(Object.freeze({ event: 'disabled_shutdown_proved' }));
    } catch (error) {
      shutdownFailures.push(error.code || 'SHUTDOWN_PROOF_FAILED');
    }

    if (shutdownFailures.length > 0) {
      primaryFailure = new ControllerError('MANDATORY_SHUTDOWN_FAILED');
    }
  }

  if (postCount > 1) fail('RECONCILIATION_POST_BUDGET_EXCEEDED');
  if (primaryFailure) throw primaryFailure;
  return safeReport({ mode: 'operational', completed, postCount, shutdownComplete });
}

function parseArguments(argv) {
  const options = { operational: false, adapterPath: null, approval: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--operational') options.operational = true;
    else if (arg === '--adapter') options.adapterPath = argv[++index] || null;
    else if (arg === '--approval') options.approval = argv[++index] || null;
    else fail('UNKNOWN_ARGUMENT');
  }
  return options;
}

function loadExternalAdapter(adapterPath) {
  if (typeof adapterPath !== 'string' || !path.isAbsolute(adapterPath)) fail('ADAPTER_PATH_MUST_BE_ABSOLUTE');
  const repositoryRoot = path.resolve(__dirname, '..');
  const resolved = path.resolve(adapterPath);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    fail('OPERATIONAL_ADAPTER_MUST_REMAIN_OUTSIDE_REPOSITORY');
  }
  let adapter;
  try {
    adapter = require(resolved);
  } catch {
    fail('OPERATOR_ADAPTER_LOAD_FAILED');
  }
  return adapter;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.operational) {
    if (options.adapterPath || options.approval) fail('DRY_RUN_REJECTS_OPERATIONAL_INPUT');
    process.stdout.write(`${JSON.stringify(offlinePlan())}\n`);
    return;
  }
  if (options.approval !== OPERATIONAL_APPROVAL) fail('EXPLICIT_OPERATIONAL_APPROVAL_REQUIRED');
  const adapter = loadExternalAdapter(options.adapterPath);
  const result = await runOperationalController({ adapter });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = {
  CONTROLLER_VERSION,
  EXPECTED_IDENTITY,
  GATES,
  OPERATIONAL_APPROVAL,
  RECONCILIATION_ROUTE,
  REQUEST_POLICY,
  SIX_DISABLED_GATES,
  ControllerError,
  deployAndValidate,
  loadExternalAdapter,
  offlinePlan,
  parseArguments,
  parseDeploymentUrlOutput,
  runOperationalController,
  selectDeploymentId,
  validateDeploymentMetadata,
  validateDeploymentSource,
  validateGateState,
  validatePostflight,
  validateReconciliationResult,
  validateRetainedIntent,
  validateSchoolFeature,
};

if (require.main === module) {
  main().catch((error) => {
    const code = error instanceof ControllerError ? error.code : 'CONTROLLER_FAILURE';
    process.stderr.write(`${JSON.stringify({ controllerVersion: CONTROLLER_VERSION, ok: false, code })}\n`);
    process.exitCode = 1;
  });
}
