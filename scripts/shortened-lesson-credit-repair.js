#!/usr/bin/env node
'use strict';
const {runTargetedRepair} = require('./lib/targeted-ledger-repair-runner');
const {buildPreview,applyRepair} = require('./lib/shortened-lesson-credit-repair');
const main = argv => runTargetedRepair({argv,applicationName:'coachcarter_shortened_lesson_repair',
  mutationEnvName:'SHORTENED_LESSON_REPAIR_ENABLED',mutationEnvValue:'REVIEWED',
  applyConfirmation:'APPLY_SHORTENED_LESSON_REPAIR',buildPreview,applyRepair});
if (require.main===module) main().catch(error => {process.stderr.write(`${error.message}\n`);process.exitCode=1;});
module.exports = {main};
