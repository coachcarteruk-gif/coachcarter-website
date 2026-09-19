#!/usr/bin/env node
'use strict';

// Speed bump in front of `vercel --prod`.
//
// `vercel --prod` deploys the working directory to coachcarter.uk regardless of
// which branch is checked out. On 16 September 2026 that put the unmerged draft
// branch codex/trial-discount-pencilled-offers into production, where it stayed
// until two later main deploys happened to overwrite it. Its migrations (066-068)
// are still applied to production while its code is not.
//
// Manual deploys are normal here, so this does not try to stop them. It prints
// what is about to ship and only pauses when the branch is not main. Set
// DEPLOY_ANY_BRANCH=1 to skip the pause when deploying off-branch deliberately.

const { execFileSync } = require('child_process');

const PRODUCTION_BRANCH = 'main';
const PAUSE_SECONDS = 5;

function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function main() {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const sha = git('rev-parse', '--short', 'HEAD');
  const subject = git('log', '-1', '--format=%s');
  const dirty = git('status', '--porcelain');

  if (!branch) {
    console.log('[deploy] not a git checkout - skipping preflight');
    return;
  }

  console.log('');
  console.log('  Deploying to PRODUCTION (coachcarter.uk)');
  console.log(`    branch  ${branch}`);
  console.log(`    commit  ${sha} ${subject}`);
  if (dirty) {
    const count = dirty.split('\n').filter(Boolean).length;
    console.log(`    tree    ${count} uncommitted change(s) - these WILL ship`);
  }
  console.log('');

  if (branch === PRODUCTION_BRANCH) return;

  if (process.env.DEPLOY_ANY_BRANCH === '1') {
    console.log(`[deploy] off-branch deploy acknowledged via DEPLOY_ANY_BRANCH=1`);
    console.log('');
    return;
  }

  // Not main: the case that caused the incident. Pause, but do not block.
  const ahead = git('rev-list', '--count', `origin/${PRODUCTION_BRANCH}..HEAD`);
  const unpushed = git('log', '--oneline', `origin/${branch}..HEAD`);

  console.log(`  This is NOT ${PRODUCTION_BRANCH}.`);
  if (ahead && ahead !== '0') {
    console.log(`  ${ahead} commit(s) here are not on ${PRODUCTION_BRANCH} - they will be live`);
    console.log(`  but absent from the repo's main line, and a later ${PRODUCTION_BRANCH}`);
    console.log('  deploy will silently revert them.');
  }
  if (unpushed) {
    console.log('  Some commits are not pushed to origin.');
  }
  console.log('');
  console.log(`  Ctrl-C to stop. Continuing in ${PAUSE_SECONDS}s...`);

  // Synchronous sleep: keeps this a single blocking step before vercel runs.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, PAUSE_SECONDS * 1000);
  console.log('');
}

main();
