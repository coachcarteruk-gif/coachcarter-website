#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const learnerAuth = require('../api/learner-auth');
const instructorAuth = require('../api/instructor-auth');
const {
  TEST_PASSWORD,
  LEARNER_FULL_EMAIL,
  INSTRUCTOR_EMAIL,
  getTestDatabaseUrl,
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

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    getHeader(key) { return this.headers[key.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function callLogin(handler, body) {
  const req = {
    method: 'POST',
    query: { action: 'login' },
    headers: {},
    body,
  };
  const res = fakeRes();
  await handler(req, res);
  return res;
}

async function main() {
  loadDotEnvLocal();
  const testUrl = getTestDatabaseUrl(process.env);
  process.env.POSTGRES_URL = testUrl;

  const learner = await callLogin(learnerAuth, {
    email: LEARNER_FULL_EMAIL,
    password: TEST_PASSWORD,
  });
  const instructor = await callLogin(instructorAuth, {
    email: INSTRUCTOR_EMAIL,
    password: TEST_PASSWORD,
  });

  const sql = neon(testUrl);
  const [balance] = await sql`
    SELECT lu.is_test_account,
           lu.school_id,
           lcb.balance_minutes
      FROM learner_users lu
      JOIN learner_credit_balances lcb
        ON lcb.learner_id = lu.id
       AND lcb.school_id = lu.school_id
      JOIN instructors i
        ON i.id = lcb.instructor_id
       AND i.school_id = lu.school_id
     WHERE lu.email = ${LEARNER_FULL_EMAIL}
       AND i.email = ${INSTRUCTOR_EMAIL}
  `;

  const result = {
    learnerLogin: {
      statusCode: learner.statusCode,
      success: learner.body?.success === true,
      email: learner.body?.user?.email,
      school_id: learner.body?.user?.school_id,
    },
    instructorLogin: {
      statusCode: instructor.statusCode,
      success: instructor.body?.success === true,
      email: instructor.body?.instructor?.email,
      school_id: instructor.body?.instructor?.school_id,
      must_change_password: instructor.body?.must_change_password === true,
    },
    seededBalance: balance || null,
  };

  console.log(JSON.stringify(result, null, 2));

  if (learner.statusCode !== 200 || learner.body?.success !== true) {
    throw new Error('Learner login failed.');
  }
  if (instructor.statusCode !== 200 || instructor.body?.success !== true) {
    throw new Error('Instructor login failed.');
  }
  if (!balance || balance.is_test_account !== true || balance.school_id !== 1 || balance.balance_minutes !== 360) {
    throw new Error('Seeded learner balance did not match expected Codex fixture.');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
