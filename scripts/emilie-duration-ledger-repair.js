#!/usr/bin/env node
'use strict';

const { applyEmilieRepair, buildEmilieRepairPreview } = require('../api/_emilie-duration-ledger-repair');
const { runTargetedRepair } = require('./lib/targeted-ledger-repair-runner');

const MUTATION_ENV_NAME = 'EMILIE_DURATION_LEDGER_REPAIR_ENABLED';
const MUTATION_ENV_VALUE = 'EMILIE_DURATION_LEDGER_REPAIR_REVIEWED';
const APPLY_CONFIRMATION = 'APPLY_EMILIE_DURATION_LEDGER_REPAIR';

async function main(argv) {
  return runTargetedRepair({
    argv,
    applicationName: 'coachcarter_emilie_duration_ledger_repair',
    mutationEnvName: MUTATION_ENV_NAME,
    mutationEnvValue: MUTATION_ENV_VALUE,
    applyConfirmation: APPLY_CONFIRMATION,
    buildPreview: buildEmilieRepairPreview,
    applyRepair: applyEmilieRepair,
  });
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { APPLY_CONFIRMATION, MUTATION_ENV_NAME, MUTATION_ENV_VALUE, main };
