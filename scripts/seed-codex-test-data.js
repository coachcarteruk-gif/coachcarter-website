#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  seedCodexTestData,
  TEST_PASSWORD,
  LEARNER_FULL_EMAIL,
  LEARNER_EMPTY_EMAIL,
  LEARNER_DELETE_EMAIL,
  INSTRUCTOR_EMAIL,
} = require('../api/_codex-test-data');

function loadDotEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadDotEnvLocal();

  const action = process.argv.includes('--clean') ? 'clean' : 'reset';
  const results = await seedCodexTestData({ action });

  console.log(JSON.stringify({
    ok: true,
    action,
    results,
    accounts: {
      learner_full: LEARNER_FULL_EMAIL,
      learner_empty: LEARNER_EMPTY_EMAIL,
      learner_delete: LEARNER_DELETE_EMAIL,
      instructor: INSTRUCTOR_EMAIL,
      password: TEST_PASSWORD,
    },
    env: {
      CC_TEST_API: '1',
      CC_TEST_LEARNER_EMAIL: LEARNER_FULL_EMAIL,
      CC_TEST_LEARNER_PASSWORD: TEST_PASSWORD,
      CC_TEST_INSTRUCTOR_EMAIL: INSTRUCTOR_EMAIL,
      CC_TEST_INSTRUCTOR_PASSWORD: TEST_PASSWORD,
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
