#!/usr/bin/env node
'use strict';

const { applyCancellationCreditRepair, buildCancellationCreditRepairPreview } = require('../api/_lesson-credit-cancellation-repair');
const { runTargetedRepair } = require('./lib/targeted-ledger-repair-runner');

const MUTATION_ENV_NAME = 'LIMKHOLWE_FREE_TRIAL_CREDIT_REPAIR_ENABLED';
const MUTATION_ENV_VALUE = 'LIMKHOLWE_FREE_TRIAL_CREDIT_REPAIR_REVIEWED';
const APPLY_CONFIRMATION = 'APPLY_LIMKHOLWE_FREE_TRIAL_CREDIT_REPAIR';

async function main(argv) {
  return runTargetedRepair({
    argv,
    applicationName: 'coachcarter_limkholwe_free_trial_credit_repair',
    mutationEnvName: MUTATION_ENV_NAME,
    mutationEnvValue: MUTATION_ENV_VALUE,
    applyConfirmation: APPLY_CONFIRMATION,
    buildPreview: client => buildCancellationCreditRepairPreview(client, 'limkholwe'),
    applyRepair: (client, options) => applyCancellationCreditRepair(client, 'limkholwe', options),
  });
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { APPLY_CONFIRMATION, MUTATION_ENV_NAME, MUTATION_ENV_VALUE, main };
