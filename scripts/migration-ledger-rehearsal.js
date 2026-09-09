#!/usr/bin/env node
'use strict';

const { Client } = require('pg');
const { MigrationGovernanceError } = require('./lib/migration-governance');
const {
  cleanupRehearsal,
  directDatabaseUrl,
  fingerprint,
  installOrRehearse,
  loadPacket,
  postflight,
  preflight,
  requireMutationApproval,
} = require('./lib/migration-ledger');

const MODES = new Map([
  ['--preflight', 'preflight'],
  ['--dry-run', 'preflight'],
  ['--rehearse-rollback-approved', 'rehearse'],
  ['--install-baseline-approved', 'install'],
  ['--postflight', 'postflight'],
  ['--cleanup-rehearsal-approved', 'cleanup'],
]);

function selectedMode(argv = process.argv.slice(2)) {
  const unknown = argv.filter(arg => !MODES.has(arg));
  if (unknown.length !== 0) {
    throw new MigrationGovernanceError('UNKNOWN_ARGUMENT', 'Unknown ledger command argument');
  }
  const selected = argv.filter(arg => MODES.has(arg));
  if (selected.length === 0) return 'preflight';
  if (selected.length !== 1) {
    throw new MigrationGovernanceError('MODE_CONFLICT', 'Choose exactly one ledger mode');
  }
  return MODES.get(selected[0]);
}

async function run() {
  const mode = selectedMode();
  const bundle = loadPacket();
  const databaseUrl = directDatabaseUrl();
  const targetFingerprint = fingerprint(databaseUrl);
  if (['rehearse', 'install', 'cleanup'].includes(mode)) {
    requireMutationApproval(mode, targetFingerprint);
  }

  const client = new Client({ connectionString: databaseUrl });
  // node-postgres reports idle connection failures through EventEmitter. Keep
  // those failures inside the CLI's sanitized error boundary instead of
  // allowing an unhandled event to print a stack trace or connection details.
  client.on('error', () => {});
  try {
    await client.connect();
    let result;
    if (mode === 'preflight') result = await preflight(client, bundle, targetFingerprint);
    if (mode === 'rehearse') {
      result = await installOrRehearse(client, bundle, targetFingerprint, { rollback: true });
    }
    if (mode === 'install') result = await installOrRehearse(client, bundle, targetFingerprint);
    if (mode === 'postflight') result = await postflight(client, bundle, targetFingerprint);
    if (mode === 'cleanup') result = await cleanupRehearsal(client);
    process.stdout.write(`${JSON.stringify({ ...result, targetFingerprint }, null, 2)}\n`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  run().catch(error => {
    const code = error instanceof MigrationGovernanceError
      ? error.code
      : 'MIGRATION_LEDGER_OPERATION_FAILED';
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code,
      error: 'Migration ledger operation blocked; inspect private database logs',
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { run, selectedMode };
